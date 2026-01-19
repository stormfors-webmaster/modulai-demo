# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Webflow CMS ↔ GitHub Two-Way Sync** system. Blog posts are authored in Markdown files in the `/posts` directory, and automatically synced to Webflow CMS via GitHub Actions. The system supports bidirectional sync.

## Repository Structure

```
/posts              # Markdown blog posts with YAML frontmatter
/images             # Image assets referenced by posts
/tools              # Node.js sync and validation tools
  ├── sync-webflow.js         # Main sync script (Markdown → Webflow)
  ├── validate-frontmatter.js # Frontmatter schema validation
  ├── fetch-modulai-post.js   # Fetch blog posts from modulai.io
  ├── create-fields.js        # Webflow field creation utility
  ├── fetch-schema.js         # Fetch Webflow collection schema
  └── inspect-items.js        # Inspect Webflow collection items
/docs               # Documentation and specifications
/.github/workflows  # GitHub Actions workflows
package.json        # Dependencies and npm scripts (at root)
```

## Common Commands

All commands should be run from the repository root.

### Sync to Webflow
```bash
npm run sync          # Sync changed posts only
npm run sync:all      # Sync all posts
npm run sync:dry      # Dry run (no writes)
```

### Validate Frontmatter
```bash
npm run validate      # Validate all posts in /posts
```

### Install Dependencies
```bash
npm ci                # Install from lockfile
```

### Fetch Modulai Blog Post
```bash
npm run fetch-post <url>           # Output JSON (for inspection)
npm run fetch-post <url> -- --save # Save markdown and images directly
```

Example:
```bash
npm run fetch-post https://modulai.io/blog/my-post/ -- --save
```

This tool fetches a blog post from modulai.io, extracts the content, downloads images, and creates a properly formatted markdown file with frontmatter.

## Markdown Frontmatter Schema

Posts in `/posts/*.md` require this frontmatter structure:

### Required Fields
- `title` (string): Post title
- `date` (ISO date): Publish date (YYYY-MM-DD or full timestamp)
- `push_to_webflow` (boolean): Enable/disable sync to Webflow

### Optional Fields
- `id` (string): Unique identifier for preventing duplicates
- `slug` (string): URL slug (auto-generated from title if omitted)
- `image` (string): Main image path (relative `/images/...` or absolute URL)
- `author` (string): Author name
- `link` (string): External URL (must start with http:// or https://)
- `published` (boolean): Publish state
- `post_id` (string): Webflow item ID (auto-populated after first sync)
- `last_update` (ISO timestamp): For conflict detection
- `tags` (string[]): Array of tag strings
- `excerpt` (string): Short description
- `seo.title` (string): SEO title override
- `seo.description` (string): SEO description override

### Example Frontmatter
```yaml
---
id: my-unique-post-id
title: "Blog Post Title"
date: 2025-01-15
image: "/images/hero.png"
author: "Author Name"
published: true
push_to_webflow: true
tags: ["engineering", "webflow"]
excerpt: "Short summary for cards and SEO."
seo:
  title: "Custom SEO Title"
  description: "Custom SEO description"
---
```

## Webflow Field Mappings

| Frontmatter | Webflow Field Slug | Type |
|-------------|-------------------|------|
| `title` | `name` | Plain text |
| (derived) | `slug` | Slug |
| Markdown body | `post-body` | Rich Text |
| `image` | `main-image` | Image URL |
| `date` | `publish-date` | Date/Time |
| `author` | `author` | Plain text |
| `link` | `link` | URL |
| `published` | `is-published` | Switch |
| `push_to_webflow` | `push-to-webflow` | Switch |
| `post_id` | `post-id` | Plain text |
| `id` | `github-id` | Plain text |
| `tags` | `tags` | Multi-text |
| `excerpt` | `post-summary` | Plain text |
| `seo.title` | `seo-title` | Plain text |
| `seo.description` | `seo-description` | Plain text |

## Environment Variables

Required secrets for GitHub Actions:
- `WEBFLOW_TOKEN`: Webflow CMS API token
- `WEBFLOW_SITE_ID`: Webflow site ID
- `WEBFLOW_COLLECTION_ID`: Webflow collection ID
- `GH_TOKEN_WITH_WRITE`: GitHub token with write permissions (for post_id writeback)

### Local Development Setup

To sync directly from your local machine:

1. Copy the example environment file:
   ```bash
   cp .env.example .env.local
   ```

2. Edit `.env.local` with your Webflow credentials:
   ```bash
   WEBFLOW_TOKEN=your_64_char_hex_token
   WEBFLOW_COLLECTION_ID=your_24_char_collection_id
   ```

3. Run sync commands:
   ```bash
   npm run sync:dry   # Test without making changes
   npm run sync:all   # Sync all posts
   npm run sync       # Sync only changed posts (uses git diff)
   ```

The `.env.local` file is automatically loaded when running locally (skipped in CI).

**GitHub CLI Integration:** If you have `gh` CLI installed and authenticated, the script automatically detects repository info, commit SHA, and branch name. No manual `GH_REPOSITORY` configuration needed.

## GitHub Actions Workflows

- **sync-to-webflow.yml**: Syncs posts on push to main (paths: `posts/**/*.md`, `images/**`)
- **lint-frontmatter.yml**: Validates frontmatter on PRs
- **writeback-post-id.yml**: Updates frontmatter with Webflow item ID after creation
- **resync-all.yml**: Manual workflow to resync all posts

## Key Technical Details

### Node.js Version
Requires Node.js 20+ (uses native fetch, ES modules)

### Markdown Processing Pipeline
```
Markdown → gray-matter (frontmatter) → remark-parse → remark-gfm → remark-rehype → rehype-sanitize → rehype-stringify → HTML
```

### Supported Rich Text Elements
The following HTML elements are preserved through sanitization:
- **Code:** `<pre>`, `<code>` with `class="language-*"` for syntax highlighting
- **Tables:** `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<th>`, `<td>`
- **Media:** `<figure>`, `<figcaption>`, `<img>` with alt/title/dimensions
- **Text:** headings, paragraphs, lists, blockquotes, links, bold, italic
- **Links:** `<a>` with href, title, target, rel attributes

### Image Handling
- Relative paths (`/images/...`) are converted to raw GitHub URLs pinned to the commit SHA
- Absolute URLs pass through unchanged

### Sync Logic
- **Both `published: true` AND `push_to_webflow: true` are required** for a post to sync
- If `post_id` exists in frontmatter: UPDATE existing Webflow item
- If `post_id` missing but `github-id` matches: UPDATE existing item (deduplication)
- If no match found: CREATE new item, then dispatch writeback event
- If `push_to_webflow: false` OR `published: false`: Skip the file entirely

## Code Style

- ES modules (`"type": "module"` in package.json)
- No TypeScript, plain JavaScript
- Biome configured for linting (see `tools/biome.json`)
