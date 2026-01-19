#!/usr/bin/env python3
"""
Fetch a blog post from modulai.io and create a local markdown file.

Usage:
    python fetch-modulai-post.py <url>

Example:
    python fetch-modulai-post.py https://modulai.io/blog/evaluating-rag-systems-with-synthetic-data-and-llm-judge/
"""

import argparse
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse, urljoin

import requests
from bs4 import BeautifulSoup
import html2text

# Paths relative to this script
SCRIPT_DIR = Path(__file__).parent
REPO_ROOT = SCRIPT_DIR.parent
POSTS_DIR = REPO_ROOT / "posts"
IMAGES_DIR = REPO_ROOT / "images"


def slugify(text: str) -> str:
    """Convert text to URL-friendly slug."""
    text = text.lower().strip()
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[-\s]+', '-', text)
    return text.strip('-')


def download_image(image_url: str, slug: str) -> str | None:
    """Download image and save to images folder. Returns local path or None."""
    try:
        response = requests.get(image_url, timeout=30)
        response.raise_for_status()

        # Determine file extension from URL or content-type
        parsed_url = urlparse(image_url)
        ext = Path(parsed_url.path).suffix.lower()
        if not ext or ext not in ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg']:
            content_type = response.headers.get('content-type', '')
            if 'png' in content_type:
                ext = '.png'
            elif 'gif' in content_type:
                ext = '.gif'
            elif 'webp' in content_type:
                ext = '.webp'
            elif 'svg' in content_type:
                ext = '.svg'
            else:
                ext = '.jpg'

        # Create filename from slug
        filename = f"{slug}{ext}"
        filepath = IMAGES_DIR / filename

        # Ensure images directory exists
        IMAGES_DIR.mkdir(parents=True, exist_ok=True)

        # Save image
        filepath.write_bytes(response.content)
        print(f"Downloaded image: {filepath}")

        return f"/images/{filename}"
    except Exception as e:
        print(f"Warning: Failed to download image {image_url}: {e}")
        return None


def extract_post_content(soup: BeautifulSoup, url: str) -> dict:
    """Extract blog post content from BeautifulSoup parsed HTML."""
    data = {}

    # Extract title
    title_el = soup.find('h1')
    if title_el:
        data['title'] = title_el.get_text(strip=True)
    else:
        # Fallback to meta title
        meta_title = soup.find('meta', property='og:title')
        data['title'] = meta_title['content'] if meta_title else 'Untitled'

    # Extract main image
    og_image = soup.find('meta', property='og:image')
    if og_image and og_image.get('content'):
        data['image_url'] = og_image['content']
    else:
        # Try to find first large image in article
        article = soup.find('article') or soup.find('main') or soup
        img = article.find('img', src=True)
        if img:
            data['image_url'] = urljoin(url, img['src'])

    # Extract author - look for specific patterns on modulai.io
    author = None
    # Try finding author link or span
    author_link = soup.find('a', href=re.compile(r'/author/', re.I))
    if author_link:
        author = author_link.get_text(strip=True)
    else:
        # Look for "Authors:" or "Author:" label
        author_label = soup.find(string=re.compile(r'^Authors?:', re.I))
        if author_label:
            parent = author_label.parent
            if parent:
                # Get the next sibling or text after the label
                next_text = parent.get_text(strip=True)
                match = re.search(r'Authors?:\s*(.+?)(?:Editors?:|$)', next_text, re.I)
                if match:
                    author = match.group(1).strip()
        else:
            # Fallback to class-based search
            author_el = soup.find(class_=re.compile(r'^author$|author-name', re.I))
            if author_el:
                author = author_el.get_text(strip=True)
            else:
                # Try meta author
                meta_author = soup.find('meta', attrs={'name': 'author'})
                if meta_author:
                    author = meta_author['content']

    if author:
        # Clean up author string
        author = re.sub(r'^(Authors?|By):\s*', '', author, flags=re.I)
        author = author.strip(' ,')
        data['author'] = author

    # Extract date - try multiple sources
    date_str = None

    # Try meta published time first (most reliable)
    meta_date = soup.find('meta', property='article:published_time')
    if meta_date and meta_date.get('content'):
        date_str = meta_date['content']

    # Try time element
    if not date_str:
        date_el = soup.find('time')
        if date_el:
            date_str = date_el.get('datetime') or date_el.get_text(strip=True)

    # Try looking for date patterns in text
    if not date_str:
        date_pattern = re.compile(
            r'((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})',
            re.I
        )
        date_match = soup.find(string=date_pattern)
        if date_match:
            match = date_pattern.search(date_match)
            if match:
                date_str = match.group(1)

    if date_str:
        data['date_str'] = date_str

    # Extract description/excerpt
    meta_desc = soup.find('meta', property='og:description') or soup.find('meta', attrs={'name': 'description'})
    if meta_desc and meta_desc.get('content'):
        data['excerpt'] = meta_desc['content']

    # Extract tags/categories
    tags = []
    tag_els = soup.find_all(class_=re.compile(r'tag|category', re.I))
    for tag_el in tag_els:
        tag_text = tag_el.get_text(strip=True)
        if tag_text and len(tag_text) < 50:  # Filter out non-tag content
            tags.append(tag_text)
    data['tags'] = list(set(tags))[:10]  # Dedupe and limit

    # Extract main content
    article = soup.find('article') or soup.find('main') or soup.find(class_=re.compile(r'post-content|entry-content|article-content', re.I))

    if article:
        # Remove unwanted elements
        for unwanted in article.find_all(['script', 'style', 'nav', 'header', 'footer', 'aside']):
            unwanted.decompose()

        # Remove share buttons, related posts, etc.
        for unwanted in article.find_all(class_=re.compile(r'share|social|related|sidebar|comment|newsletter', re.I)):
            unwanted.decompose()

        data['content_html'] = str(article)
    else:
        data['content_html'] = ''

    return data


def html_to_markdown(html: str) -> str:
    """Convert HTML to clean Markdown."""
    h = html2text.HTML2Text()
    h.ignore_links = False
    h.ignore_images = False
    h.ignore_emphasis = False
    h.body_width = 0  # Don't wrap lines
    h.unicode_snob = True
    h.skip_internal_links = True

    markdown = h.handle(html)

    # Clean up excessive newlines
    markdown = re.sub(r'\n{3,}', '\n\n', markdown)

    return markdown.strip()


def parse_date(date_str: str) -> str:
    """Parse date string and return ISO format (YYYY-MM-DD)."""
    if not date_str:
        return datetime.now().strftime('%Y-%m-%d')

    # Common date formats to try
    formats = [
        '%Y-%m-%dT%H:%M:%S%z',
        '%Y-%m-%dT%H:%M:%S.%f%z',
        '%Y-%m-%dT%H:%M:%S',
        '%Y-%m-%d',
        '%B %d, %Y',
        '%b %d, %Y',
        '%d %B %Y',
        '%d %b %Y',
        '%m/%d/%Y',
        '%d/%m/%Y',
    ]

    for fmt in formats:
        try:
            dt = datetime.strptime(date_str.strip(), fmt)
            return dt.strftime('%Y-%m-%d')
        except ValueError:
            continue

    # Try to extract date with regex
    match = re.search(r'(\d{4})-(\d{2})-(\d{2})', date_str)
    if match:
        return match.group(0)

    # Fallback to today
    print(f"Warning: Could not parse date '{date_str}', using today's date")
    return datetime.now().strftime('%Y-%m-%d')


def create_frontmatter(data: dict, slug: str, local_image: str | None) -> str:
    """Create YAML frontmatter for the blog post."""
    lines = ['---']

    # Required fields
    lines.append(f'id: {slug}')
    lines.append(f'title: "{data.get("title", "Untitled").replace('"', '\\"')}"')
    lines.append(f'slug: {slug}')
    lines.append(f'date: {data.get("date", datetime.now().strftime("%Y-%m-%d"))}')

    # Image
    if local_image:
        lines.append(f'image: "{local_image}"')
    elif data.get('image_url'):
        lines.append(f'image: "{data["image_url"]}"')

    # Optional fields
    if data.get('author'):
        lines.append(f'author: "{data["author"]}"')

    lines.append('published: true')
    lines.append('push_to_webflow: true')

    # Tags
    if data.get('tags'):
        tags_str = ', '.join(f'"{tag}"' for tag in data['tags'])
        lines.append(f'tags: [{tags_str}]')

    # Excerpt
    if data.get('excerpt'):
        excerpt = data['excerpt'].replace('"', '\\"').replace('\n', ' ')[:300]
        lines.append(f'excerpt: "{excerpt}"')

    # SEO
    lines.append('seo:')
    seo_title = data.get('title', 'Untitled').replace('"', '\\"')
    lines.append(f'  title: "{seo_title}"')
    if data.get('excerpt'):
        seo_desc = data['excerpt'].replace('"', '\\"').replace('\n', ' ')[:160]
        lines.append(f'  description: "{seo_desc}"')

    lines.append('---')
    return '\n'.join(lines)


def fetch_and_create_post(url: str, dry_run: bool = False) -> Path | None:
    """Fetch blog post from URL and create markdown file."""
    print(f"Fetching: {url}")

    # Fetch the page
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    }
    response = requests.get(url, headers=headers, timeout=30)
    response.raise_for_status()

    # Parse HTML
    soup = BeautifulSoup(response.text, 'html.parser')

    # Extract content
    data = extract_post_content(soup, url)

    if not data.get('title'):
        print("Error: Could not extract title from page")
        return None

    print(f"Title: {data['title']}")

    # Generate slug
    slug = slugify(data['title'])
    print(f"Slug: {slug}")

    # Parse date
    data['date'] = parse_date(data.get('date_str', ''))
    print(f"Date: {data['date']}")

    # Download main image
    local_image = None
    if data.get('image_url'):
        print(f"Image URL: {data['image_url']}")
        if not dry_run:
            local_image = download_image(data['image_url'], slug)

    # Convert content to markdown
    markdown_content = html_to_markdown(data.get('content_html', ''))

    if not markdown_content:
        print("Warning: No content extracted from page")

    # Create frontmatter
    frontmatter = create_frontmatter(data, slug, local_image)

    # Combine into final markdown
    full_content = f"{frontmatter}\n\n{markdown_content}\n"

    # Determine output path
    output_path = POSTS_DIR / f"{slug}.md"

    if dry_run:
        print("\n--- DRY RUN - Would create: ---")
        print(f"File: {output_path}")
        print("\n--- Content preview (first 1000 chars): ---")
        print(full_content[:1000])
        return None

    # Ensure posts directory exists
    POSTS_DIR.mkdir(parents=True, exist_ok=True)

    # Check if file already exists
    if output_path.exists():
        print(f"Warning: File already exists: {output_path}")
        response = input("Overwrite? [y/N]: ")
        if response.lower() != 'y':
            print("Aborted.")
            return None

    # Write file
    output_path.write_text(full_content, encoding='utf-8')
    print(f"\nCreated: {output_path}")

    return output_path


def main():
    parser = argparse.ArgumentParser(
        description='Fetch a blog post from modulai.io and create a local markdown file.'
    )
    parser.add_argument('url', help='URL of the blog post to fetch')
    parser.add_argument('--dry-run', '-n', action='store_true',
                        help='Preview without creating files')

    args = parser.parse_args()

    # Validate URL
    parsed = urlparse(args.url)
    if not parsed.scheme or not parsed.netloc:
        print(f"Error: Invalid URL: {args.url}")
        sys.exit(1)

    if 'modulai' not in parsed.netloc:
        print(f"Warning: URL is not from modulai.io: {parsed.netloc}")
        response = input("Continue anyway? [y/N]: ")
        if response.lower() != 'y':
            sys.exit(0)

    try:
        result = fetch_and_create_post(args.url, dry_run=args.dry_run)
        if result:
            print(f"\nSuccess! Post created at: {result}")
            print("\nNext steps:")
            print("  1. Review the generated markdown file")
            print("  2. Run 'cd tools && npm run validate' to validate frontmatter")
            print("  3. Commit and push to sync to Webflow")
    except requests.RequestException as e:
        print(f"Error fetching URL: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()
