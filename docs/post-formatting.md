# Post Formatting Guide

This guide covers recommended markdown formatting for optimal Webflow sync support.

## Quick Reference

| Feature | Support | Notes |
|---------|---------|-------|
| Headings (H1-H6) | Full | Use `#` through `######` |
| Bold/Italic | Full | `**bold**`, `*italic*` |
| Links | Full | `[text](url "title")` |
| Images | Full | Relative paths auto-converted to GitHub raw URLs |
| Code blocks | Full | Syntax highlighting via language tags |
| Tables | Full | GitHub Flavored Markdown (GFM) tables |
| Lists | Full | Ordered, unordered, nested |
| Blockquotes | Full | `> quoted text` |
| Task lists | Full | `- [ ] item` |
| Strikethrough | Full | `~~deleted~~` |

## Frontmatter Requirements

Every post needs YAML frontmatter at the top. See [CLAUDE.md](../CLAUDE.md) for the complete schema.

### Minimal Example

```yaml
---
title: "My Blog Post"
date: 2025-01-15
published: true
push_to_webflow: true
---
```

### Complete Example

```yaml
---
id: unique-post-identifier
title: "Building AI-Powered Features"
date: 2025-01-15
slug: building-ai-powered-features
image: "/images/ai-features-hero.png"
author: "Jane Doe"
published: true
push_to_webflow: true
tags: ["AI", "Engineering", "Tutorial"]
excerpt: "Learn how to integrate AI capabilities into your application."
seo:
  title: "Building AI-Powered Features | Your Blog"
  description: "A comprehensive guide to adding AI features to your app."
---
```

## Text Formatting

### Headings

Use standard markdown headings. Avoid bold markers inside headings.

```markdown
# Main Title (H1)
## Section Heading (H2)
### Subsection (H3)
```

**Avoid:**
```markdown
## **Bold Heading**  <!-- Bold markers auto-removed -->
```

### Emphasis

```markdown
This is **bold text** and this is *italic text*.

You can also use __bold__ and _italic_ with underscores.

~~Strikethrough~~ works too.
```

### Links

```markdown
[Link text](https://example.com)
[Link with title](https://example.com "Hover text")
```

## Images

### Recommended: Repository Images

Store images in `/images/` and reference with absolute paths:

```markdown
![Alt text](/images/my-image.png)
![Hero image](/images/hero.jpg "Optional title")
```

**Benefits:**
- Images pinned to specific commit SHA (immutable URLs)
- Proper versioning with your content
- No external dependency

### External Images

External URLs work but are not recommended:

```markdown
![External image](https://example.com/image.png)
```

### Image Attributes

Alt text and title are preserved:

```markdown
![Descriptive alt text](/images/chart.png "Figure 1: Sales data")
```

**Note:** Markdown image dimension syntax (`{width=200}`) is not supported. Webflow handles responsive sizing automatically.

## Code

### Inline Code

```markdown
Use `backticks` for inline code like `npm install`.
```

### Code Blocks

Always specify the language for syntax highlighting:

````markdown
```javascript
function greet(name) {
  return `Hello, ${name}!`;
}
```
````

**Supported languages:** All common languages recognized by GitHub (javascript, python, bash, json, yaml, html, css, typescript, go, rust, etc.)

### Command Output

Shell commands and output are auto-detected and fenced:

```markdown
Run the build command:

npm run build
```

Becomes properly fenced code in the output.

## Tables

Use GitHub Flavored Markdown table syntax:

```markdown
| Feature | Status | Notes |
|---------|--------|-------|
| Sync | Active | Runs on push |
| Validation | Active | Runs on PR |
```

### Column Alignment

```markdown
| Left | Center | Right |
|:-----|:------:|------:|
| A    | B      | C     |
```

### Table Styling

Tables are automatically styled with:
- Full-width layout
- Collapsed borders
- Header background highlighting
- Consistent padding

**Note:** Keep table cells simple. Links, bold, and italic work. Avoid images or code blocks inside cells.

## Lists

### Unordered Lists

```markdown
- First item
- Second item
  - Nested item
  - Another nested item
- Third item
```

### Ordered Lists

```markdown
1. First step
2. Second step
3. Third step
```

### Task Lists

```markdown
- [x] Completed task
- [ ] Pending task
- [ ] Another pending task
```

**Tip:** Avoid extra blank lines between list items, which can break the list into multiple elements.

## Blockquotes

```markdown
> This is a blockquote.
> It can span multiple lines.

> Nested quotes work too:
>> This is nested
```

## Best Practices

### DO

1. **Use descriptive alt text for images** - Improves accessibility and SEO
2. **Specify code block languages** - Enables syntax highlighting
3. **Use standard markdown bullets** (`-` or `*`) - Auto-normalized for consistency
4. **Keep tables simple** - Basic text, links, and emphasis only
5. **Use relative image paths** - `/images/filename.png` for version-pinned URLs
6. **Include an excerpt** - Prevents auto-generation from body content
7. **Add tags** - Improves discoverability in Webflow

### DON'T

1. **Don't use raw HTML** - Stripped for security (except allowed elements)
2. **Don't embed videos directly** - Use links instead; Webflow can auto-embed
3. **Don't use custom CSS classes** - Only syntax highlight classes preserved
4. **Don't use footnote syntax** - Not supported in the pipeline
5. **Don't use Mermaid diagrams** - Rendered as code blocks, not diagrams
6. **Don't use 4+ consecutive blank lines** - Collapsed to 2 maximum

## Content Imported from Other Sources

The sync pipeline handles common issues from WordPress and other imports:

### Auto-Fixed Issues

- **Decorative bullets** (•, ◦, ▪) → Standard markdown bullets
- **Bold markers in headings** → Cleaned automatically
- **Trailing whitespace** → Trimmed
- **Excessive blank lines** → Collapsed
- **Tab-separated tables** → Converted to GFM tables
- **Command-line output** → Auto-fenced as code blocks

### Manual Fixes Needed

If importing from HTML or WordPress:

1. Check image paths resolve correctly
2. Verify tables converted properly
3. Review code blocks have language tags
4. Remove any embedded media (replace with links)

## Webflow Rendering Notes

### Rich Text Field

The post body is sent to Webflow's Rich Text field, which:

- Renders semantic HTML (headings, paragraphs, lists, etc.)
- Handles responsive images automatically
- Applies your Webflow site's typography styles
- May auto-embed certain links (YouTube, Vimeo)

### Field Mappings

| Frontmatter | Webflow Field | Type |
|-------------|---------------|------|
| `title` | `name` | Plain text |
| body (HTML) | `post-body` | Rich Text |
| `image` | `main-image` | Image URL |
| `date` | `publish-date` | Date/Time |
| `author` | `author` | Plain text |
| `tags` | `tags` | Multi-text |
| `excerpt` | `post-summary` | Plain text |

See [webflow_field_mappings.md](webflow_field_mappings.md) for the complete mapping reference.

## Troubleshooting

### Images Not Displaying

1. Verify the image exists in `/images/`
2. Check the path is correct (case-sensitive)
3. Use absolute path starting with `/images/`
4. Run `npm run sync:dry` to see resolved URLs

### Tables Not Rendering

1. Ensure using pipe (`|`) syntax, not tabs
2. Include the header separator row (`| --- | --- |`)
3. Avoid complex content in cells

### Code Not Highlighting

1. Add the language identifier after opening backticks
2. Use lowercase language names
3. Ensure no space between backticks and language

### Content Appearing as Plain Text

1. Check that markdown syntax has no extra spaces
2. Verify no raw HTML is blocking conversion
3. Run validation: `npm run validate`
