Below is a clean, structured **Product Requirements Document (PRD)** based on your description. You can copy/paste and revise as needed.

---

# **PRD: Webflow CMS ↔ GitHub Two-Way Sync for Markdown Blog Posts**

## **1. Overview**

### **1.1 Goal**

Enable a **two-way synchronization** between a GitHub repository and Webflow CMS for blog content.
Developers author blog posts in Markdown, commit them to GitHub, and the system automatically syncs them into Webflow CMS as draft or published items.
Edits performed in Webflow (e.g., by marketing team) can optionally sync back to GitHub as updated Markdown.

### **1.2 Primary Objectives**

* Support Markdown-authored content stored in GitHub.
* Automated creation & update of Webflow CMS Blog posts.
* Automated updates in Webflow when new pushes occur in GitHub.
* Allow developers to include metadata (frontmatter), images, videos, code blocks.
* Enable marketing to review/edit content in Webflow before publishing.
* Optional sync-back from Webflow → GitHub for version history.

---

## **2. Key Questions & Answers**

### ✅ **Can we send Markdown to Webflow?**

Yes. Webflow CMS API accepts RichText fields, which can receive:

* HTML (converted from Markdown)
* Some Markdown elements, but conversion to HTML is recommended for full fidelity.

### ✅ **Can we trigger updates to Webflow when GitHub updates occur?**

Yes. Approaches:

* GitHub Webhooks → Our middleware → Webflow API
* GitHub Actions → Middleware API endpoint
* Scheduled sync / polling (backup option)

### ✅ **What Markdown formats will work in Webflow RichText?**

Webflow RichText supports (via converted HTML):

* Headings
* Paragraphs
* Bold / Italic / Lists
* Blockquotes
* Links
* Images
* Video embeds (YouTube/Vimeo links)
* Code blocks (via `<pre><code>` HTML)
* Inline code `<code>`

### ✅ **Can we include images, videos, code blocks?**

| Feature               | Supported? | Method                                                                 |
| --------------------- | ---------- | ---------------------------------------------------------------------- |
| **Images**            | ✅          | HTML `<img>` or Webflow “Image Field”. GitHub-hosted raw URLs allowed. |
| **Videos**            | ✅          | YouTube/Vimeo links auto-embed in Webflow RichText.                    |
| **Code blocks**       | ✅          | Convert Markdown `code` to `<pre><code>` in HTML.                      |
| **Custom components** | ⚠️ Limited | Requires custom embeds or Migrations API.                              |

---

## **3. GitHub Repository Structure**

```
/README.md

/posts
  ├── post1.md
  ├── post2.md

/images
  ├── image.png
  ├── image2.png
```

Images should be stored in `/images` and referenced by raw GitHub URL or relative path.

---

## **4. Markdown Structure (Frontmatter Spec)**

Example Markdown file:

```md
---
title: "Blog Post Title"
date: 2025-11-06
image: "Github raw image link or relative path"
author: "GitHub User"
link: "External URL"
published: true/false
push_to_webflow: true/false
post_id: 12345
last_update:
---

```

code

```

Blog Title
```

### **Required Fields**

* `title`
* `date`
* `push_to_webflow`

### **Optional Fields**

* `post_id` (if updating existing Webflow CMS item)
* `image`
* `author`
* `link`
* `published`
* `last_update`

---

## **5. Functional Requirements**

### **5.1 GitHub → Webflow Sync**

#### **Trigger Options**

1. GitHub webhook on push
2. Manual GitHub Action
3. Scheduled sync (cron)

#### **Process**

1. Detect changed Markdown files under `/posts`.
2. Parse frontmatter & Markdown body.
3. Convert Markdown → HTML for Webflow RichText.
4. Resolve images:

   * Convert relative paths → raw GitHub URLs
   * Optionally upload to Webflow assets API (if needed)
5. If `post_id` exists:

   * Update the Webflow CMS item
6. Else:

   * Create a new Webflow CMS item
   * Write back the `post_id` to GitHub (optional)

#### Webflow CMS Mappings

| GitHub Frontmatter | Webflow Field                           |
| ------------------ | --------------------------------------- |
| title              | Name / Title                            |
| date               | Date field                              |
| image              | Main Image field                        |
| author             | Author reference / text                 |
| link               | URL field                               |
| published          | “Published” switch                      |
| Markdown body      | RichText field                          |
| post_id            | Item ID (custom field or local mapping) |

---

### **5.2 Webflow → GitHub Sync (Optional)**

Triggered when marketing edits or publishes a post.

Flow:

1. Webflow webhook (“collection_item_updated”) hits middleware.
2. Middleware fetches updated item via Webflow API.
3. Convert RichText HTML → Markdown.
4. Update corresponding Markdown file in GitHub (PR or commit).

---

## **6. Non-Functional Requirements**

### **6.1 Performance**

* Sync should process updates within 5–15 seconds of push.
* Bulk sync: up to 100 posts under 1 minute.

### **6.2 Reliability**

* Retry failed Webflow requests (up to 3 times).
* Log all sync attempts.
* Validate frontmatter before sync.

### **6.3 Security**

* Store Webflow API keys securely (GitHub Secrets / Vault).
* Middleware endpoint secured via token.

---

## **7. Constraints**

* Webflow CMS items have field length limits.
* RichText may not support some custom Markdown plugins.
* GitHub raw image links must be public unless using authenticated requests.
* HTML → Markdown conversion may cause formatting drift (optional sync-back feature should be careful).

---

## **8. Open Questions**

1. Should Webflow edits overwrite developer Markdown, or should developers always be the source of truth?
2. Should images be uploaded to Webflow assets or remain GitHub-hosted?
3. Should each blog post get its own folder (e.g., `/posts/post-123/`) for assets?

---

## **9. Future Enhancements**

* Preview environments (PR previews in Webflow staging)
* Scheduled publishing from GitHub
* Automated linting / formatting for Markdown
* Support for custom components (Callouts, Tips, Tables)

---

If you'd like, I can also produce:

✅ Architecture diagram
✅ API flow diagrams
✅ Acceptance criteria
✅ Technical spec for the middleware
✅ Webflow CMS field mapping table
✅ GitHub Action YAML templates

Just tell me what you'd like next.
