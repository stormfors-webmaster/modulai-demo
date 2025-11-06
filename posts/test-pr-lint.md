---
title: "Testing PR Lint Workflow"
date: 2025-11-06
image: "/images/hero.png"
author: "GitHub Actions Tester"
published: false
push_to_webflow: true
tags: ["testing", "pr", "lint", "github-actions"]
excerpt: "This post is created to test the PR lint workflow that validates frontmatter before merging."
seo:
  title: "Testing PR Lint Workflow - Frontmatter Validation"
  description: "A test post to verify that the GitHub Actions lint workflow properly validates markdown frontmatter in pull requests"
---

# Testing PR Lint Workflow

This post was created specifically to test the **Lint Markdown frontmatter** workflow that runs on pull requests.

## Purpose

When this PR is opened, the `lint-frontmatter.yml` workflow should:

1. ✅ Detect changes to `posts/**/*.md` files
2. ✅ Run the `validate-frontmatter.js` script
3. ✅ Validate all required fields (`title`, `date`, `push_to_webflow`)
4. ✅ Check field types and formats
5. ✅ Report any validation errors

## Frontmatter Validation

This post includes all required fields:

- **title**: ✅ Present (string)
- **date**: ✅ Present (ISO format: 2025-11-06)
- **push_to_webflow**: ✅ Present (boolean: true)

### Optional Fields Included

- **image**: Relative path to hero image
- **author**: Author name
- **published**: Boolean flag (set to false for draft)
- **tags**: Array of tag strings
- **excerpt**: Short description
- **seo**: Nested object with title and description

## Expected Workflow Behavior

When this PR is created:

1. The lint workflow should trigger automatically
2. It should validate this file's frontmatter
3. It should pass validation (all fields are correct)
4. The PR should show a green checkmark ✅

## Code Example

Here's a code snippet to test markdown rendering:

```typescript
interface Post {
  title: string;
  date: string;
  push_to_webflow: boolean;
}

const testPost: Post = {
  title: "Testing PR Lint Workflow",
  date: "2025-11-06",
  push_to_webflow: true,
};
```

## Conclusion

If you see this PR with a passing lint check, the workflow is working correctly! 🎉

