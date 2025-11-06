# Test Sync Script

A Node.js script for testing Webflow CMS sync locally using `.env.local` configuration.

## Setup

1. Create a `.env.local` file in the project root with your Webflow credentials:

```bash
WEBFLOW_TOKEN=your_webflow_api_token_here
WEBFLOW_COLLECTION_ID=your_collection_id_here
WEBFLOW_SITE_ID=your_site_id_here
```

2. Get your Webflow API token from: https://webflow.com/dashboard/account/api

3. Find your Collection ID:
   - Go to your Webflow site
   - Navigate to CMS Collections
   - Click on your collection
   - The Collection ID is in the URL or API settings

## Usage

Test sync a specific post:
```bash
cd tools
npm install
node test-sync.js ../posts/react-typescript-guide.md
```

Or sync the default example post:
```bash
node test-sync.js
```

## What It Does

- Reads Webflow credentials from `.env.local`
- Parses the Markdown file with frontmatter
- Converts Markdown to HTML
- Creates or updates the item in Webflow CMS
- Shows the Webflow item ID for future updates

## Output

After a successful sync, the script will:
- Display the Webflow item ID
- Show the slug and published status
- Provide instructions to add `post_id` to frontmatter for future updates

## Notes

- The script will create a new item if `post_id` is not in frontmatter
- If `post_id` exists, it will update the existing item
- Image paths are kept as-is for local testing (GitHub URLs would be resolved in production)

