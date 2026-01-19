# Webflow to GitHub Reverse Sync - Implementation Plan

> **Status:** Planned (not yet implemented)
> **Created:** 2026-01-19
> **Author:** Claude Code

## Overview

This document outlines the plan for implementing bidirectional sync so changes made in Webflow CMS automatically sync back to GitHub markdown files.

## Requirements

| Requirement | Decision |
|-------------|----------|
| Conflict resolution | **Webflow wins** - Webflow changes take precedence |
| Trigger mechanism | **Webflow webhooks** - Real-time sync |
| Orphaned items | **Leave them** - Don't delete Webflow items without GitHub match |

## Architecture

```
Webflow CMS ──webhook──> Cloudflare Worker ──repository_dispatch──> GitHub Action
                              │                                           │
                         Validate signature                    Fetch item, convert HTML→MD
                         Filter events                         Find matching file by github-id
                                                               Update file, commit with [skip ci]
```

## Edge Cases Addressed

| Edge Case | Solution |
|-----------|----------|
| Infinite sync loop | `[skip ci]` in commit message + `synced_from` frontmatter marker |
| Orphaned Webflow items | Skip items without matching `github-id` in repo |
| Failed writebacks (from forward sync) | Reverse sync uses `github-id` lookup, not `post_id` |
| Concurrent edits | GitHub Actions concurrency group ensures serialization |
| Stale post_id references | Primary lookup is `github-id`, not `post_id` |

---

## Implementation Steps

### Step 1: Create HTML-to-Markdown Converter

**File:** `tools/lib/html-to-markdown.js`

Enhance existing converter from `fetch-modulai-post.js` (lines 166-242) with:
- Turndown library for robust conversion (optional upgrade)
- Code block language preservation
- Table support (GFM)
- Webflow figure/figcaption handling

### Step 2: Create Webflow API Client Module

**File:** `tools/lib/webflow-api.js`

```javascript
// Fetch single item by ID
async function fetchItemById(collectionId, itemId)

// Map Webflow fieldData to frontmatter structure
function mapWebflowFieldsToFrontmatter(fieldData)
```

Uses existing `rate-limiter.js` and `retry.js`.

### Step 3: Create Reverse Sync Script

**File:** `tools/reverse-sync-webflow.js`

Main functions:
- `findMarkdownByGithubId(githubId)` - Glob posts/*.md, parse frontmatter, match by `id` field
- `updateMarkdownFile(filePath, webflowData)` - Update frontmatter + body
- `isLoopDetected(filePath)` - Check if recently synced from GitHub (prevent loop)
- `generateMarkdown(frontmatter, content)` - Use gray-matter to stringify

**Loop prevention:**
1. Check `synced_from: github` in frontmatter with recent timestamp
2. Check git log for recent commits by `github-actions[bot]` on this file
3. Skip if evidence of recent forward sync

### Step 4: Create Webhook Handler

**File:** `tools/webhook-handler/index.js` (Cloudflare Worker)

```javascript
export default {
  async fetch(request, env) {
    // 1. Validate X-Webflow-Signature
    // 2. Parse webhook payload
    // 3. Filter: only handle collection_item_updated, collection_item_published
    // 4. Skip collection_item_created (likely from forward sync)
    // 5. Skip collection_item_deleted (leave orphans)
    // 6. Dispatch repository_dispatch to GitHub
  }
}
```

**Cloudflare Worker config:** `tools/webhook-handler/wrangler.toml`

### Step 5: Create GitHub Action Workflow

**File:** `.github/workflows/reverse-sync-from-webflow.yml`

```yaml
name: Reverse sync from Webflow

on:
  repository_dispatch:
    types: [webflow_item_updated, webflow_item_published]

concurrency:
  group: webflow-sync
  cancel-in-progress: false

permissions:
  contents: write

jobs:
  reverse-sync:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
        with:
          token: ${{ secrets.GH_TOKEN_WITH_WRITE }}
          fetch-depth: 10

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci

      - name: Run reverse sync
        env:
          WEBFLOW_ITEM_ID: ${{ github.event.client_payload.itemId }}
          WEBFLOW_TOKEN: ${{ secrets.WEBFLOW_TOKEN }}
          WEBFLOW_COLLECTION_ID: ${{ secrets.WEBFLOW_COLLECTION_ID }}
        run: node tools/reverse-sync-webflow.js

      - name: Commit changes
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add posts/
          git diff --staged --quiet || git commit -m "chore(sync): reverse sync from Webflow [skip ci]"
          git push
```

### Step 6: Update Forward Sync for Loop Prevention

**File:** `tools/sync-webflow.js`

Add check at start of `upsertWebflowItem()`:
```javascript
// Skip if recently synced FROM Webflow (prevent loop)
if (fm.synced_from === 'webflow' && isRecentTimestamp(fm.last_sync)) {
  log(`Skipping ${filePath} - recently synced from Webflow`);
  return null;
}
```

Update frontmatter after successful sync:
```javascript
fm.synced_from = 'github';
fm.last_sync = new Date().toISOString();
```

### Step 7: Add Environment Variables

**File:** `.env.example`

```bash
# Reverse Sync (Webflow -> GitHub)
# WEBFLOW_WEBHOOK_SECRET=your_webhook_secret_here
```

### Step 8: Documentation

**File:** `docs/reverse-sync-setup.md`

- Cloudflare Worker deployment steps
- Webflow webhook configuration
- Troubleshooting guide

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `tools/lib/html-to-markdown.js` | Create |
| `tools/lib/webflow-api.js` | Create |
| `tools/reverse-sync-webflow.js` | Create |
| `tools/webhook-handler/index.js` | Create |
| `tools/webhook-handler/wrangler.toml` | Create |
| `.github/workflows/reverse-sync-from-webflow.yml` | Create |
| `tools/sync-webflow.js` | Modify (loop prevention) |
| `.env.example` | Modify (add webhook secret) |
| `docs/reverse-sync-setup.md` | Create |
| `package.json` | Modify (add turndown dependency, optional) |

---

## New Frontmatter Fields

To support bidirectional sync, add these optional fields:

```yaml
synced_from: github|webflow  # Source of last sync
last_sync: 2025-01-19T10:30:00Z  # Timestamp of last sync
```

---

## Verification Checklist

### Unit Tests
- [ ] HTML-to-Markdown conversion
- [ ] Webflow field mapping
- [ ] Loop detection logic

### Integration Test
- [ ] Edit post in Webflow admin
- [ ] Verify webhook received (Cloudflare logs)
- [ ] Verify GitHub Action triggers
- [ ] Verify markdown file updated
- [ ] Verify no infinite loop (edit doesn't trigger forward sync back)

### Manual Verification
- [ ] Edit title in Webflow → check GitHub file updated
- [ ] Edit body in Webflow → check markdown content updated
- [ ] Edit in GitHub → verify Webflow updated (forward sync)
- [ ] Verify no ping-pong between systems

---

## Deployment Steps

1. **Deploy Cloudflare Worker:**
   ```bash
   cd tools/webhook-handler
   wrangler secret put WEBFLOW_WEBHOOK_SECRET
   wrangler secret put GITHUB_TOKEN
   wrangler deploy
   ```

2. **Configure Webflow Webhook:**
   - Webflow Dashboard > Site Settings > Integrations > Webhooks
   - Add webhook URL: `https://webflow-webhook-handler.<account>.workers.dev`
   - Select events: `collection_item_updated`, `collection_item_published`
   - Copy secret for Worker configuration

3. **GitHub Secrets:**
   - No new secrets required (uses existing `WEBFLOW_TOKEN`, `WEBFLOW_COLLECTION_ID`, `GH_TOKEN_WITH_WRITE`)

---

## Dependencies

| Package | Purpose | Required |
|---------|---------|----------|
| `turndown` | HTML→Markdown conversion | Optional (can use existing regex-based converter) |
| `turndown-plugin-gfm` | GFM table support | Optional |
| `gray-matter` | Frontmatter parsing | Already installed |
