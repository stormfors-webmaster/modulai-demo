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
```

## Common Commands

All commands should be run from the repository root unless otherwise specified.

### Sync to Webflow
```bash
cd tools && npm run sync          # Sync changed posts only
cd tools && npm run sync:all      # Sync all posts
cd tools && npm run sync:dry      # Dry run (no writes)
```

### Validate Frontmatter
```bash
cd tools && npm run validate      # Validate all posts in /posts
```

### Install Dependencies
```bash
cd tools && npm ci                # Install from lockfile
```

### Fetch Modulai Blog Post
```bash
cd tools && npm run fetch-post <url>           # Output JSON (for inspection)
cd tools && npm run fetch-post <url> -- --save # Save markdown and images directly
```

Example:
```bash
cd tools && npm run fetch-post https://modulai.io/blog/my-post/ -- --save
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

| Frontmatter | Webflow API ID | Type |
|-------------|----------------|------|
| `title` | `name` | Plain text |
| (derived) | `slug` | Slug |
| Markdown body | `body_rich` | Rich Text |
| `image` | `main_image` | Image URL |
| `date` | `publish_date` | Date/Time |
| `author` | `author_text` | Plain text |
| `link` | `external_link` | URL |
| `published` | `is_published` | Switch |
| `push_to_webflow` | `push_to_webflow` | Switch |
| `post_id` | `post_id` | Plain text |
| `tags` | `tags_multi` | Multi-text |
| `excerpt` | `excerpt` | Plain text |
| `seo.title` | `seo_title` | Plain text |
| `seo.description` | `seo_description` | Plain text |

## Environment Variables

Required secrets for GitHub Actions:
- `WEBFLOW_TOKEN`: Webflow CMS API token
- `WEBFLOW_SITE_ID`: Webflow site ID
- `WEBFLOW_COLLECTION_ID`: Webflow collection ID

For local development, create `.env.local` with these values.

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

### Image Handling
- Relative paths (`/images/...`) are converted to raw GitHub URLs pinned to the commit SHA
- Absolute URLs pass through unchanged

### Sync Logic
- If `post_id` exists in frontmatter: UPDATE existing Webflow item
- If `post_id` missing: CREATE new item, then dispatch writeback event
- If `push_to_webflow: false`: Skip the file entirely

## Code Style

- ES modules (`"type": "module"` in package.json)
- No TypeScript, plain JavaScript
- Biome configured for linting (see `tools/biome.json`)
