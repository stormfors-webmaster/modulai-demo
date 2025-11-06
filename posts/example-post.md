---
title: "Getting Started with Webflow GitHub Sync"
date: 2025-01-15
image: "/images/hero.png"
author: "Developer Team"
link: "https://example.com"
published: true
push_to_webflow: true
tags: ["engineering", "webflow", "github"]
excerpt: "Learn how to sync your Markdown blog posts from GitHub to Webflow CMS automatically."
seo:
  title: "Webflow GitHub Sync Guide"
  description: "Complete guide to syncing Markdown blog posts between GitHub and Webflow CMS"
---

# Getting Started with Webflow GitHub Sync

This is a sample blog post demonstrating the Webflow GitHub sync system. Posts are authored in Markdown and automatically synced to Webflow CMS.

## Features

- **Automatic Sync**: Changes pushed to GitHub automatically sync to Webflow
- **Markdown Support**: Full CommonMark/GFM support including code blocks, tables, and more
- **Image Handling**: Automatic resolution of relative image paths

## Code Example

Here's a code example:

```javascript
function syncToWebflow(post) {
  return fetch('https://api.webflow.com/v2/collections/...', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(post)
  });
}
```

## Lists

- First item
- Second item
- Third item

1. Ordered item one
2. Ordered item two
3. Ordered item three

## Tables

| Feature | Status |
|---------|--------|
| Markdown Support | ✅ |
| Image Sync | ✅ |
| Code Blocks | ✅ |

## Links and Images

Check out [the documentation](https://example.com/docs) for more information.

![Sample Image](/images/hero.png)

## Conclusion

This sync system makes it easy to manage blog content across GitHub and Webflow.

