# Webflow CMS ↔ GitHub Two-Way Sync

A two-way synchronization system between GitHub repositories and Webflow CMS for blog content. Developers author posts in Markdown, commit to GitHub, and the system automatically syncs them to Webflow CMS. Optional bidirectional sync allows Webflow edits to flow back to GitHub.

## Features

- **GitHub → Webflow Sync**: Automatically sync Markdown posts to Webflow CMS on push
- **Webflow → GitHub Sync**: Optional bidirectional sync for marketing team edits
- **Markdown Support**: Full CommonMark/GFM support including code blocks, images, tables, videos
- **Frontmatter Validation**: Automated validation of required fields and types
- **Image Handling**: Automatic resolution of relative image paths to GitHub raw URLs
- **Idempotent Operations**: Safe re-runs without duplicate content
- **GitHub Actions Integration**: Ready-to-use workflows for automated syncing

## Architecture

```
GitHub Push → GitHub Webhook/Action → Middleware/Direct API → Webflow CMS
Webflow Edit → Webflow Webhook → Middleware → GitHub (PR/Commit)
```

Two implementation approaches:
1. **Middleware**: Custom service handling webhooks and sync logic
2. **Direct API**: GitHub Actions directly calling Webflow CMS API

## Repository Structure

```
/posts
  ├── post1.md
  ├── post2.md
/images
  ├── image.png
/tools
  ├── sync-webflow.js
  ├── validate-frontmatter.js
  └── package.json
.github/workflows
  ├── sync-to-webflow.yml
  ├── lint-frontmatter.yml
  └── writeback-post-id.yml
```

## Markdown Frontmatter

Posts require frontmatter with the following structure:

```yaml
---
title: "Blog Post Title"
date: 2025-11-06
image: "/images/hero.png"
author: "Author Name"
link: "https://example.com"
published: true
push_to_webflow: true
post_id: "webflow_item_id"  # Auto-populated after first sync
last_update: "2025-11-06T09:42:31Z"
tags: ["engineering", "webflow"]
excerpt: "Short summary"
seo:
  title: "Custom SEO Title"
  description: "Custom SEO description"
---
```

### Required Fields
- `title`: Post title (3-120 chars)
- `date`: ISO 8601 date (YYYY-MM-DD or full timestamp)
- `push_to_webflow`: Boolean flag to enable/disable sync

### Optional Fields
- `slug`: URL slug (auto-generated from title if omitted)
- `image`: Main image URL or relative path
- `author`: Author name
- `link`: External URL
- `published`: Boolean publish flag
- `post_id`: Webflow item ID (populated after first create)
- `last_update`: ISO timestamp for conflict detection
- `tags`: Array of tag strings
- `excerpt`: Short description
- `seo.title`: SEO title override
- `seo.description`: SEO description override

## Field Mappings

| GitHub Frontmatter | Webflow Field | Type | Direction |
|-------------------|---------------|------|-----------|
| `title` | `name` | Plain text | ↔ |
| `slug` (derived) | `slug` | Slug | ↔ |
| Markdown body | `body_rich` | Rich Text | ↔ |
| `image` | `main_image` | Image | ↔ |
| `date` | `publish_date` | Date/Time | ↔ |
| `author` | `author_text` | Plain text | ↔ |
| `link` | `external_link` | URL | ↔ |
| `published` | `is_published` | Switch | ↔ |
| `push_to_webflow` | `push_to_webflow` | Switch | GH→WF only |
| `post_id` | `post_id` | Plain text | ↔ |
| `last_update` | `last_update` | Date/Time | ↔ |
| `tags` | `tags_multi` | Multi-Reference/Text | ↔ |
| `excerpt` | `excerpt` | Plain text | ↔ |
| `seo.title` | `seo_title` | Plain text | ↔ |
| `seo.description` | `seo_description` | Plain text | ↔ |

## Setup

### Prerequisites

- Node.js 20+
- GitHub repository with blog posts in `/posts`
- Webflow CMS collection configured with matching fields
- Webflow API token

### Installation

1. **Install dependencies**:
```bash
cd tools
npm init -y
npm install gray-matter unified remark-parse remark-gfm remark-rehype rehype-stringify rehype-sanitize
```

2. **Configure environment variables** (GitHub Secrets):
   - `WEBFLOW_TOKEN`: Webflow CMS API token
   - `WEBFLOW_SITE_ID`: Webflow site ID
   - `WEBFLOW_COLLECTION_ID`: Webflow collection ID

3. **Set up GitHub Actions workflows**:
   - Copy workflows from `.github/workflows/` (see [GitHub Actions docs](docs/github_actions_YAML.md))
   - Configure secrets in repository settings

## Usage

### Manual Sync

Sync all posts:
```bash
node tools/sync-webflow.js --all
```

Sync changed posts only:
```bash
node tools/sync-webflow.js
```

Dry run (no writes):
```bash
node tools/sync-webflow.js --dry-run --all
```

### Validate Frontmatter

```bash
node tools/validate-frontmatter.js
```

### Automated Sync

- **On Push**: Automatically syncs changed posts when pushed to main branch
- **On PR**: Validates frontmatter schema
- **Manual**: Trigger via GitHub Actions UI

## Configuration

### Webflow Collection Setup

Create a CMS collection in Webflow with these fields:

1. **Name** (`name`) - System field
2. **Slug** (`slug`) - System field
3. **Body** (`body_rich`) - Rich Text
4. **Main Image** (`main_image`) - Image
5. **Publish Date** (`publish_date`) - Date/Time
6. **Author** (`author_text`) - Plain text (or Reference to Authors collection)
7. **External Link** (`external_link`) - Link
8. **Is Published** (`is_published`) - Switch
9. **Push to Webflow** (`push_to_webflow`) - Switch
10. **Post ID** (`post_id`) - Plain text
11. **Last Update** (`last_update`) - Date/Time
12. **Tags** (`tags_multi`) - Multi-Reference or Multi-Text
13. **Excerpt** (`excerpt`) - Plain text
14. **SEO Title** (`seo_title`) - Plain text
15. **SEO Description** (`seo_description`) - Plain text

### Field API IDs

Ensure Webflow field API IDs match the mapping configuration. Use lowercase with underscores (e.g., `body_rich`, `main_image`).

## Image Handling

- **Relative paths**: `/images/image.png` → Resolved to GitHub raw URL
- **Absolute URLs**: Passed through as-is
- **Optional upload**: Middleware can upload to Webflow Assets CDN

Images are resolved to commit-pinned raw GitHub URLs for immutability:
```
https://raw.githubusercontent.com/owner/repo/COMMIT_SHA/images/image.png
```

## Markdown Conversion

- **Markdown → HTML**: Uses remark/rehype with GFM support
- **HTML → Markdown**: Uses turndown/html2text (for bidirectional sync)
- **Supported elements**: Headings, lists, blockquotes, code blocks, tables, images, links, videos

Code blocks preserve language classes:
```markdown
```python
code here
```
```
→
```html
<pre><code class="language-python">code here</code></pre>
```

## GitHub Actions Workflows

### Sync on Push
- Triggers on push to main branch
- Syncs changed Markdown files
- See `.github/workflows/sync-to-webflow.yml`

### Frontmatter Validation
- Runs on PRs affecting `/posts/**/*.md`
- Validates required fields and types
- See `.github/workflows/lint-frontmatter.yml`

### Writeback Post ID
- Updates frontmatter with Webflow item ID after creation
- Triggered via `repository_dispatch` event
- See `.github/workflows/writeback-post-id.yml`

See [GitHub Actions documentation](docs/github_actions_YAML.md) for complete workflow templates.

## Development

### Middleware Approach

For production deployments, consider the middleware approach:
- Handles webhooks from both GitHub and Webflow
- Provides conflict resolution and state management
- Supports multiple projects and collections
- See [Middleware Specification](docs/middleware_spec.md)

### Testing

1. **Unit tests**: Frontmatter parsing, MD↔HTML conversion, image resolution
2. **Integration tests**: Mock GitHub/Webflow APIs, end-to-end sync flows
3. **E2E tests**: Full round-trip sync with real APIs (staging)

### Error Handling

- **Validation errors**: Fail fast with clear error messages
- **API errors**: Retry with exponential backoff (3 attempts)
- **Rate limits**: Respect GitHub/Webflow rate limits with queuing

## Documentation

- [Product Requirements Document](docs/PRD.md)
- [Middleware Specification](docs/middleware_spec.md)
- [Sync Implementation Guide](docs/sync_webflow.md)
- [Frontmatter Validation](docs/validate_frontmatter.md)
- [Field Mappings](docs/webflow_field_mappings.md)
- [GitHub Actions Workflows](docs/github_actions_YAML.md)

## License

[Add your license here]
