here are ready-to-drop **GitHub Actions YAML templates** for the repo. They cover: push-to-sync, manual full resync, scheduled backstop, and frontmatter lint in PRs. Pick the “Middleware” version if you’ll hit your own API; pick the “Direct Webflow API” version if your workflow will call Webflow’s CMS API from the runner.

---

# 1) Push → Sync changed posts (Middleware version)

Create: `.github/workflows/sync-to-webflow.yml`

```yaml
name: Sync posts to Webflow (middleware)

on:
  push:
    branches: [ main ]
    paths:
      - "posts/**/*.md"
      - "images/**"

  workflow_dispatch: {}

concurrency:
  group: sync-to-webflow-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Detect changed markdown files
        id: diff
        run: |
          git fetch --depth=2 origin ${{ github.ref }}
          echo "files<<EOF" >> $GITHUB_OUTPUT
          git diff --name-only HEAD~1 HEAD -- 'posts/**/*.md' | tr '\n' '\n' >> $GITHUB_OUTPUT
          echo "EOF" >> $GITHUB_OUTPUT

      - name: Call middleware for each changed file
        if: steps.diff.outputs.files != ''
        env:
          MIDDLEWARE_URL: ${{ secrets.MIDDLEWARE_URL }}   # e.g., https://sync.example.com/webflow/sync
          MIDDLEWARE_TOKEN: ${{ secrets.MIDDLEWARE_TOKEN }}
        run: |
          set -e
          while IFS= read -r f; do
            [ -z "$f" ] && continue
            echo "Syncing $f"
            curl -sS -X POST "$MIDDLEWARE_URL" \
              -H "Authorization: Bearer $MIDDLEWARE_TOKEN" \
              -H "Content-Type: application/json" \
              --data "$(jq -n --arg path "$f" '{ path: $path, ref: env.GITHUB_SHA }')"
          done <<< "${{ steps.diff.outputs.files }}"
```

**Secrets required**

* `MIDDLEWARE_URL`, `MIDDLEWARE_TOKEN`

---

# 2) Push → Sync changed posts (Direct Webflow API version)

Create: `.github/workflows/sync-to-webflow-direct.yml`

```yaml
name: Sync posts to Webflow (direct)

on:
  push:
    branches: [ main ]
    paths:
      - "posts/**/*.md"
      - "images/**"

  workflow_dispatch: {}

concurrency:
  group: sync-to-webflow-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

env:
  WEBFLOW_SITE_ID: ${{ secrets.WEBFLOW_SITE_ID }}
  WEBFLOW_COLLECTION_ID: ${{ secrets.WEBFLOW_COLLECTION_ID }}
  WEBFLOW_TOKEN: ${{ secrets.WEBFLOW_TOKEN }}

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install deps
        run: npm ci
        working-directory: tools

      - name: Sync changed files to Webflow
        run: node tools/sync-webflow.js
```

**Expectations**

* You have a `tools/sync-webflow.js` that:

  * finds changed files (`GITHUB_SHA` vs parent),
  * parses frontmatter + Markdown,
  * converts MD→HTML,
  * upserts to Webflow via CMS API,
  * writes back `post_id` when empty (see template #4).

**Secrets required**

* `WEBFLOW_TOKEN`, `WEBFLOW_SITE_ID`, `WEBFLOW_COLLECTION_ID`

---

# 3) Manual full re-sync (idempotent)

Create: `.github/workflows/resync-all.yml`

```yaml
name: Full re-sync all posts

on:
  workflow_dispatch:
    inputs:
      dry_run:
        description: "Dry run (no writes)"
        type: boolean
        default: false

concurrency:
  group: resync-all
  cancel-in-progress: true

permissions:
  contents: read

env:
  WEBFLOW_TOKEN: ${{ secrets.WEBFLOW_TOKEN }}
  WEBFLOW_SITE_ID: ${{ secrets.WEBFLOW_SITE_ID }}
  WEBFLOW_COLLECTION_ID: ${{ secrets.WEBFLOW_COLLECTION_ID }}

jobs:
  resync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install deps
        run: npm ci
        working-directory: tools

      - name: Re-sync all
        run: node tools/sync-webflow.js --all ${{ inputs.dry_run && '--dry-run' || '' }}
```

---

# 4) Write back `post_id` to frontmatter after create

Create: `.github/workflows/writeback-post-id.yml`

```yaml
name: Writeback post_id

on:
  repository_dispatch:
    types: [webflow_item_created]  # Triggered by your middleware after Webflow create

permissions:
  contents: write

jobs:
  writeback:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          token: ${{ secrets.GH_TOKEN_WITH_WRITE }}  # a PAT if needed; or default GITHUB_TOKEN if branch rules allow

      - name: Update frontmatter with post_id
        env:
          FILE_PATH: ${{ github.event.client_payload.path }}         # e.g., "posts/my-post.md"
          WEBFLOW_ITEM_ID: ${{ github.event.client_payload.itemId }} # returned by Webflow
          COMMIT_MSG: "chore(sync): record Webflow post_id"
        run: |
          set -e
          node -e '
            const fs = require("fs");
            const yaml = require("js-yaml");
            const matter = require("gray-matter");
            const p = process.env.FILE_PATH;
            const id = process.env.WEBFLOW_ITEM_ID;
            const src = fs.readFileSync(p, "utf8");
            const fm = matter(src);
            fm.data.post_id = id;
            fs.writeFileSync(p, matter.stringify(fm.content, fm.data), "utf8");
          '
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add "$FILE_PATH"
          git commit -m "$COMMIT_MSG" || echo "No changes"
          git push
```

**Note:** Your middleware should fire a `repository_dispatch` with payload `{ path, itemId }` after creating a new Webflow item.

---

# 5) Nightly backstop sync (optional)

Create: `.github/workflows/nightly-backstop.yml`

```yaml
name: Nightly backstop sync

on:
  schedule:
    - cron: "17 2 * * *"  # 02:17 UTC daily
  workflow_dispatch: {}

permissions:
  contents: read

jobs:
  backstop:
    uses: ./.github/workflows/resync-all.yml
    secrets: inherit
```

(Uses the reusable resync workflow above.)

---

# 6) PR lint: validate frontmatter (schema & flags)

Create: `.github/workflows/lint-frontmatter.yml`

```yaml
name: Lint Markdown frontmatter

on:
  pull_request:
    paths:
      - "posts/**/*.md"

permissions:
  contents: read

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install deps
        run: npm ci
        working-directory: tools

      - name: Validate frontmatter schema
        run: node tools/validate-frontmatter.js
```

**What `validate-frontmatter.js` should check**

* Required: `title`, `date`, `push_to_webflow`
* Types: `published`/`push_to_webflow` booleans, `date` ISO, `post_id` string (optional)
* Warn if `image` path missing or unreachable (optional)
* Enforce slug safety if `slug` present

---

## Minimal `tools/sync-webflow.js` shape (for Direct version)

> Not full code—just the contract to implement.

* Reads changed files (env `GITHUB_SHA`), or all with `--all`.
* For each `.md` with `push_to_webflow: true`:

  * parse frontmatter & body (gray-matter),
  * MD→HTML (remark/rehype, GitHub Flavored Markdown),
  * resolve image paths to raw URLs or upload,
  * if `post_id` present → `PATCH` Webflow item, else `POST` to create,
  * on create, emit `repository_dispatch` (template #4).

---

## Secrets to set

* `WEBFLOW_TOKEN` – Webflow CMS API token
* `WEBFLOW_SITE_ID`, `WEBFLOW_COLLECTION_ID`
* `MIDDLEWARE_URL`, `MIDDLEWARE_TOKEN` (if using middleware)
* `GH_TOKEN_WITH_WRITE` (if branch protection requires a PAT for writeback; otherwise default token may suffice)

---

If you want, I can also drop in a **starter `sync-webflow.js`** and **frontmatter validator** so you’re ready to run end-to-end.
