Awesome — here’s a clean, implementation-ready **Webflow CMS ↔ GitHub field mapping** you can drop into your spec. I’ve included: a quick reference table, detailed field definitions (with validation & transform rules), plus a sample “mapping config” JSON you can hand to engineering.

---

# Webflow CMS Field Mappings

## 1) Collection: **Blog Posts**

**Collection slug:** `blog-posts`
**Purpose:** Store posts authored in GitHub (`/posts/*.md`) and reviewed/published in Webflow.

### A. Quick Mapping Table

| #  | Webflow Field (Label) | API ID                        | Type                          | Source (GitHub)              | Direction | Required | Notes / Transform                                                          |
| -- | --------------------- | ----------------------------- | ----------------------------- | ---------------------------- | --------- | -------- | -------------------------------------------------------------------------- |
| 1  | Name                  | `name` (system)               | Plain text                    | `title`                      | ↔         | Yes      | Also used to auto-build slug if none provided.                             |
| 2  | Slug                  | `slug` (system)               | Slug                          | (derived)                    | ↔         | Yes      | From `title`, kebab-cased; override with `slug` in frontmatter if present. |
| 3  | Body                  | `body_rich`                   | Rich Text                     | Markdown body                | ↔         | Yes      | Convert MD ↔ HTML. Handle code blocks, images, links, embeds.              |
| 4  | Main Image            | `main_image`                  | Image                         | `image`                      | ↔         | No       | GitHub raw URL or uploaded asset; see image rules.                         |
| 5  | Publish Date          | `publish_date`                | Date/Time                     | `date`                       | ↔         | Yes      | ISO 8601. Use commit date if absent (optional).                            |
| 6  | Author                | `author_text` or `author_ref` | Plain text **or** Reference   | `author`                     | ↔         | No       | Start with text; upgrade to Reference later if needed.                     |
| 7  | External Link         | `external_link`               | URL                           | `link`                       | ↔         | No       | Valid URL; optional.                                                       |
| 8  | Is Published          | `is_published`                | Switch                        | `published`                  | ↔         | Yes      | Drives publish state in Webflow deploy pipeline.                           |
| 9  | Push to Webflow       | `push_to_webflow`             | Switch                        | `push_to_webflow`            | GH→WF     | No       | Controls ingestion on push; ignored in WF→GH.                              |
| 10 | Post ID               | `post_id`                     | Plain text                    | `post_id`                    | ↔         | No       | Stable key between systems. If missing, populated after first create.      |
| 11 | Last Update           | `last_update`                 | Date/Time                     | `last_update`                | ↔         | No       | For reconciliation; fallback to Git commit ISO time.                       |
| 12 | Tags                  | `tags_multi`                  | Multi-Reference or Multi-Text | `tags` (array)               | ↔         | No       | Optional. If not using a Tags collection, use Multi-Text.                  |
| 13 | Excerpt               | `excerpt`                     | Plain text                    | first 160 chars or `excerpt` | ↔         | No       | SEO/preview; auto-generated if absent.                                     |
| 14 | SEO Title             | `seo_title`                   | Plain text                    | `seo.title`                  | ↔         | No       | Optional SEO override.                                                     |
| 15 | SEO Description       | `seo_description`             | Plain text                    | `seo.description`            | ↔         | No       | Optional SEO override.                                                     |

> If you prefer an **Author** reference collection, set `author_ref` (Reference) instead of `author_text` and map GitHub `author` to an Author item (create if missing).

---

## 2) Detailed Field Definitions & Rules

### 1) **Name** (`name`)

* **Type:** Plain text
* **Required:** Yes
* **GitHub → Webflow:** `title` → `name`
* **Webflow → GitHub:** `name` → `title`
* **Validation:** 3–120 chars recommended; strip newlines.

### 2) **Slug** (`slug`)

* **Type:** System slug
* **Required:** Yes
* **GitHub → Webflow:** generate from `title` (`blog-post-title`), unless explicit `slug` provided in frontmatter.
* **Webflow → GitHub:** write back `slug` if your repo stores it (optional).
* **Collision:** append `-2`, `-3`, etc.

### 3) **Body** (`body_rich`)

* **Type:** Rich Text
* **Required:** Yes
* **GitHub → Webflow:** Convert Markdown → HTML (CommonMark/GFM).

  * Headings `#`–`######` → `<h1>`–`<h6>`
  * Lists, blockquotes, bold/italic, links → standard HTML
  * **Code blocks:** ```lang → `<pre><code class="language-lang">…</code></pre>`
  * **Inline code:** `code` → `<code>`
  * **Images:** `![alt](url "title")` → `<img>` inside RichText (or upload to asset + insert by URL)
  * **Video:** YouTube/Vimeo links on their own line → rich embed (or keep as link; Webflow will auto-embed in RichText)
  * **Tables:** Convert to `<table>` (supported inside RichText)
* **Webflow → GitHub:** Convert HTML back to Markdown. Preserve code fences and headings; allow minor formatting drift.
* **Sanitization:** Strip disallowed tags; allow `<pre>`, `<code>`, `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<th>`, `<td>`, `<figure>`, `<figcaption>`.

### 4) **Main Image** (`main_image`)

* **Type:** Image
* **GitHub → Webflow:** From `image` frontmatter. Accept:

  * Raw GitHub URL (`https://raw.githubusercontent.com/...`)
  * Relative `/images/foo.png` → resolve to raw URL
  * Optional: upload to Webflow Assets, then set image field to the uploaded asset URL
* **Webflow → GitHub:** Save the image URL into frontmatter `image`. Optionally download into `/images/` and rewrite to relative path in post.

### 5) **Publish Date** (`publish_date`)

* **Type:** Date/Time
* **GitHub → Webflow:** From `date` (ISO 8601 `YYYY-MM-DD` or full timestamp).
* **Fallback:** Latest commit timestamp for that file.
* **Webflow → GitHub:** Backfill `date` if missing.

### 6) **Author** (`author_text` or `author_ref`)

* **Option A (Simple):** `author_text` (Plain text) ⇄ `author`
* **Option B (Relational):** `author_ref` (Reference → Authors collection)

  * If the referenced author doesn’t exist, create it with fields: `name`, `slug`, optional `avatar`, `bio`.

### 7) **External Link** (`external_link`)

* **Type:** URL
* **Mapping:** `link` ⇄ `external_link`
* **Validation:** Must be absolute URL.

### 8) **Is Published** (`is_published`)

* **Type:** Switch
* **Mapping:** `published` ⇄ `is_published`
* **Behavior:**

  * When `true` on GH→WF, create/update item and (optionally) mark for publish in your deploy step.
  * When toggled in Webflow, write back to `published`.

### 9) **Push to Webflow** (`push_to_webflow`)

* **Type:** Switch
* **Direction:** **GitHub → Webflow only**
* **Usage:** If `false`, ignore file during ingestion; still allow manual sync overrides.
* **Do not** write back from Webflow.

### 10) **Post ID** (`post_id`)

* **Type:** Plain text
* **Purpose:** Stable cross-system key.
* **Behavior:**

  * If present, update that item.
  * If absent, after creating in Webflow, write Webflow item ID back to `post_id` in frontmatter.
* **Direction:** ↔ (except if your policy is one-way authority).

### 11) **Last Update** (`last_update`)

* **Type:** Date/Time
* **Mapping:** `last_update` ↔ `last_update`
* **Behavior:** On GH→WF, set from frontmatter or Git commit time. On WF→GH, set to Webflow edit timestamp. Used for conflict detection.

### 12) **Tags** (`tags_multi`)

* **Type:** Multi-Reference (to Tags) **or** Multi-Text
* **Mapping:** `tags` (array)
* **Behavior:** Create missing tags if using a Tags collection; normalize to lowercase slug.

### 13) **Excerpt** (`excerpt`)

* **Type:** Plain text
* **Mapping:** `excerpt` if provided; else auto-generate first ~160 chars of plain text body (strip HTML). ↔

### 14–15) **SEO Title / SEO Description** (`seo_title`, `seo_description`)

* **Type:** Plain text
* **Mapping:** `seo.title` / `seo.description` frontmatter paths (optional). ↔

---

## 3) Recommended Webflow Field Setup (Create in Designer)

1. **Name** (Title) — *System*
2. **Slug** — *System*
3. **Body** (`body_rich`) — *Rich Text*
4. **Main Image** (`main_image`) — *Image*
5. **Publish Date** (`publish_date`) — *Date/Time*
6. **Author**:

   * Start with **Plain text** (`author_text`), or
   * Create **Collection** “Authors” with fields: `name`, `slug`, `avatar`, `bio` and add **Reference** field (`author_ref`).
7. **External Link** (`external_link`) — *Link*
8. **Is Published** (`is_published`) — *Switch*
9. **Push to Webflow** (`push_to_webflow`) — *Switch*
10. **Post ID** (`post_id`) — *Plain text*
11. **Last Update** (`last_update`) — *Date/Time*
12. **Tags** (`tags_multi`) — *Multi-Reference* (to “Tags” collection) or *Multi-Text*
13. **Excerpt** (`excerpt`) — *Plain text*
14. **SEO Title** (`seo_title`) — *Plain text*
15. **SEO Description** (`seo_description`) — *Plain text*

> Keep **field API IDs** predictable (lowercase, underscores). Example names above are safe.

---

## 4) Image & Media Rules

* **Relative → Absolute:** Convert `/images/image.png` → raw GitHub URL for ingestion.
* **Optional Upload:** Middleware can upload images to Webflow Assets and rewrite body `<img>` `src` to the CDN URL.
* **Alt text:** Prefer Markdown alt text; if absent, use post `title`.
* **Videos:** Paste plain YouTube/Vimeo URL on its own line in Markdown — Webflow auto-embeds in Rich Text.
* **Code blocks:** Preserve as fenced blocks; in HTML, keep `<pre><code class="language-…">`.

---

## 5) Conflict Resolution & Directionality

* **Source of truth:** Choose one:

  * **GitHub-authoritative:** Webflow edits create PRs to GitHub; GH wins on conflicts.
  * **Bidirectional with timestamps:** Use `last_update` to prefer newer side; warn/log on conflicts.
* **Fields to ignore on WF→GH:** `push_to_webflow` (write-protected), system-only fields (e.g., Webflow item status).

---

## 6) Example Frontmatter (final)

```yaml
---
title: "Blog Post Title"
slug: "blog-post-title"          # optional; else derived
date: 2025-11-06
image: "/images/hero.png"        # relative ok
author: "GitHub User"
link: "https://example.com"
published: true
push_to_webflow: true
post_id: "webflow_64f2c9..."     # filled after first create
last_update: "2025-11-06T09:42:31Z"
tags: ["engineering", "webflow", "sync"]
excerpt: "Short summary for cards and SEO."
seo:
  title: "Custom SEO Title"
  description: "Custom SEO description up to ~160 chars."
---
```

---

## 7) Sample Mapping Config (for middleware)

```json
{
  "collection": "blog-posts",
  "fields": {
    "name": { "from": "title", "direction": "both", "required": true },
    "slug": { "from": "slug", "derive": "kebab(title)", "direction": "both" },
    "body_rich": { "from": "markdown_body", "transform": "md_to_html", "reverse_transform": "html_to_md", "direction": "both", "required": true },
    "main_image": { "from": "image", "transform": "resolve_asset", "direction": "both" },
    "publish_date": { "from": "date", "fallback": "git_commit_time", "direction": "both", "required": true },
    "author_text": { "from": "author", "direction": "both" },
    "external_link": { "from": "link", "direction": "both" },
    "is_published": { "from": "published", "direction": "both", "required": true },
    "push_to_webflow": { "from": "push_to_webflow", "direction": "gh_to_wf" },
    "post_id": { "from": "post_id", "assign_on_create": "webflow_item_id", "direction": "both" },
    "last_update": { "from": "last_update", "fallback": "git_commit_time", "direction": "both" },
    "tags_multi": { "from": "tags[]", "transform": "ensure_tags", "direction": "both" },
    "excerpt": { "from": "excerpt", "fallback": "first_160_plain(body)", "direction": "both" },
    "seo_title": { "from": "seo.title", "direction": "both" },
    "seo_description": { "from": "seo.description", "direction": "both" }
  }
}
```

---

## 8) Acceptance Checks (spot test)

* Create new `/posts/new-post.md` with `push_to_webflow: true` → New Webflow item created, `post_id` written back via PR/commit.
* Update body text in GitHub → Body updates in Webflow with preserved code blocks & images.
* Toggle `published: false → true` in GitHub → Item published on next deploy.
* Edit Rich Text in Webflow (optional bidirectional mode) → Commit back to GitHub with updated Markdown and `last_update`.

---

If you want, I can turn this into a **one-page schema sheet** for your CMS team or generate a **Webflow API field creation checklist** to hand to the implementer.
