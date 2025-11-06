# Webflow Collection Analysis & Improvements

## Current Collection Structure

### System Fields (Automatically Managed by Webflow)
- `createdOn` - Automatically set when item is created (ISO timestamp)
- `lastUpdated` - Automatically updated when item is modified (ISO timestamp)
- `lastPublished` - Set when item is published, null if draft (ISO timestamp)
- `isDraft` - Boolean indicating draft status
- `isArchived` - Boolean indicating archived status

### Custom Fields
- `name` (PlainText, Required) - Post title
- `slug` (PlainText, Required) - URL slug
- `post-body` (RichText) - Main content
- `post-summary` (PlainText) - Excerpt
- `main-image` (Image) - Hero image
- `thumbnail-image` (Image) - Thumbnail
- `author` (PlainText) - Author name
- `link` (Link) - External link
- `is-published` (Switch) - Published flag
- `push-to-webflow` (Switch) - Sync control flag
- `post-id` (PlainText) - Cross-system identifier
- `publish-date` (DateTime) - Scheduled publish date
- `last-update` (DateTime) - **DUPLICATE** - Webflow already has `lastUpdated`
- `tags` (PlainText) - Tags
- `seo-title` (PlainText) - SEO override
- `seo-description` (PlainText) - SEO override

## Recommended Improvements

### 1. Remove Duplicate Fields
- **Remove `last-update` field** - Use Webflow's built-in `lastUpdated` system field instead
- This field is automatically maintained by Webflow and doesn't need to be synced

### 2. Use System Fields Properly
- **`createdOn`**: Read-only, automatically set by Webflow (can't be synced)
- **`lastUpdated`**: Read-only, automatically updated by Webflow (can't be synced)
- **`lastPublished`**: Read-only, set when item is published (can't be synced)
- **`isDraft`**: Controlled via payload `isDraft` field, aligns with `is-published` switch

### 3. Field Mapping Strategy

#### GitHub → Webflow
- `date` → `publish-date` (for scheduled publishing)
- `last_update` → **Remove** - Use Webflow's `lastUpdated` system field (read-only)
- `createdOn` → **N/A** - Webflow manages this automatically
- `published` → `is-published` switch + `isDraft` payload field

#### Webflow → GitHub (for bidirectional sync)
- `lastUpdated` → `last_update` in frontmatter (read from system field)
- `lastPublished` → Could be used for `published` date
- `createdOn` → Could be used for `date` if not specified

### 4. Sync Script Updates Needed
1. Remove `last-update` from field mappings
2. Read `lastUpdated` from item response when syncing back
3. Use `lastUpdated` for conflict detection instead of custom field
4. Document that `createdOn` and `lastUpdated` are read-only system fields

## Action Items

1. ✅ Delete `last-update` field from collection (or repurpose it)
2. ✅ Update sync scripts to remove `last-update` field mapping
3. ✅ Update sync scripts to read `lastUpdated` from API responses
4. ✅ Update documentation to reflect system field usage

