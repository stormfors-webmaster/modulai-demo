---
title: "Testing GitHub to Webflow Sync"
date: 2025-11-06
image: "/images/hero.png"
author: "Test User"
published: true
push_to_webflow: true
tags: ["test", "automation", "github-actions"]
excerpt: "This is a test post to verify that our GitHub Actions workflow successfully syncs markdown posts to Webflow CMS."
seo:
  title: "Testing GitHub Webflow Sync Integration"
  description: "A test post to validate automated syncing from GitHub to Webflow CMS"
---

# Testing the Sync Pipeline

This post was created to test the automated sync between GitHub and Webflow CMS.

## What Should Happen

When this file is committed and pushed to the `main` branch:

1. GitHub Actions will detect the change in `posts/**/*.md`
2. The `sync-to-webflow.yml` workflow will trigger
3. The workflow will run `sync-webflow.js`
4. The post will be created/updated in Webflow CMS

## Features Being Tested

### Frontmatter Parsing
- **Title**: Proper title extraction
- **Date**: ISO date format (2025-11-06)
- **Tags**: Array of tags
- **Published status**: `true`
- **Push to Webflow flag**: `true`

### Content Conversion
- Markdown to HTML conversion
- Heading levels (H1, H2, H3)
- Lists and formatting
- Code blocks

### Code Example

```javascript
console.log("Hello from the test post!");

function testSync() {
  return "Sync successful!";
}
```

## Expected Results

✅ Post appears in Webflow CMS  
✅ All frontmatter fields are mapped correctly  
✅ Markdown content is converted to HTML  
✅ Images are referenced properly  
✅ Tags are synced as expected  

---

GOOD NEWS Test 3 ! If you're reading this in Webflow, the sync worked! 🎉

