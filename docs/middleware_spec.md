Here’s a concise but implementation-ready **Technical Spec for the GitHub ↔ Webflow CMS Middleware**. It assumes you’ll use your previously approved field mappings.

---

# Middleware Technical Spec

## 1) Objectives

* **Ingest** Markdown posts from GitHub and **create/update** Webflow CMS items.
* **Optionally** sync edits from Webflow back to GitHub (HTML⇄Markdown).
* Enforce mapping, media handling, conflict resolution, and safe publishing.
* Be **idempotent**, **observable**, and **secure**.

---

## 2) High-Level Architecture

* **Middleware service** (stateless app; Node/TypeScript or Python).
* **Persistent store** (Postgres preferred; SQLite acceptable for small teams).
* **Queue/worker** (BullMQ / SQS / Cloud Tasks) to process webhooks asynchronously.
* **Storage**: none (use GitHub URLs or Webflow Assets CDN).
* **Secrets** in platform KMS or GitHub Actions secrets.

```
GitHub Push → GitHub Webhook → Middleware (/webhooks/github)
                                      ↓ enqueue
                                   Worker: GH→WF sync
Webflow item updated → Webflow Webhook → Middleware (/webhooks/webflow)
                                      ↓ enqueue
                                   Worker: WF→GH sync
```

---

## 3) Data Model (DB)

**tables**

* `projects`

  * `id (pk)`, `name`, `webflow_site_id`, `webflow_collection_id`, `github_owner`, `github_repo`, `content_path` (e.g., `/posts`), `default_branch`, `directionality` (`gh_authoritative` | `bidirectional`), `use_assets_upload` (bool)

* `content_items`

  * `id (pk)`, `project_id (fk)`, `post_id` (frontmatter), `webflow_item_id`, `github_path`, `slug`, `last_update_github` (timestamp), `last_update_webflow` (timestamp), `hash_github` (sha256 of body+fm), `hash_webflow` (sha256 of fields), `status` (`active|deleted`)

* `sync_events`

  * `id (pk)`, `direction` (`gh_to_wf|wf_to_gh`), `project_id`, `content_item_id`, `trigger` (`webhook|manual|schedule`), `payload_json`, `status` (`queued|processing|success|error`), `error`, `created_at`, `updated_at`

* `media_cache` (optional)

  * `id`, `source_url`, `webflow_asset_url`, `sha256`, `created_at`

---

## 4) External Dependencies

* **GitHub API**: contents, commits, PRs, repo metadata.
* **Webflow CMS API**: list/create/update items, assets upload (optional), webhooks.
* **Markdown/HTML tooling**:

  * MD→HTML: *remark/rehype* (Node) or *markdown-it* (Node) / *Python-Markdown* (Python).
  * HTML→MD: *turndown* (Node) or *html2text/markdownify* (Python).
* **Signature validation**: HMAC SHA-256 for GitHub & Webflow webhooks.

---

## 5) Configuration & Secrets

**Env vars**

* `PORT`
* `DATABASE_URL`
* `QUEUE_URL` (or Redis for BullMQ)
* `GITHUB_APP_ID` / `GITHUB_INSTALLATION_ID` / `GITHUB_PRIVATE_KEY` **or** `GITHUB_TOKEN`
* `GITHUB_WEBHOOK_SECRET`
* `WEBFLOW_API_TOKEN`
* `WEBFLOW_WEBHOOK_SECRET` (if provided)
* `DEFAULT_BRANCH` (fallback)
* `ALLOWED_ORIGINS` (CORS)

**Per-project config** (in DB or a `projects.yaml`)

* `github.owner`, `github.repo`, `content_path`, `default_branch`
* `webflow.collection_id`, `webflow.site_id`
* `directionality`, `use_assets_upload`
* **mapping config** (from your mapping sheet)

---

## 6) API Surface (Middleware)

### 6.1 Public Webhooks

* `POST /webhooks/github`

  * Validates `X-Hub-Signature-256`.
  * Accepts `push` and `pull_request` (merged) events.
  * Enqueues jobs for files changed within `content_path` and `default_branch`.

* `POST /webhooks/webflow`

  * Validates signature (if configured).
  * Accepts `collection_item_created|updated|deleted`.
  * Enqueues WF→GH jobs for affected items.

### 6.2 Internal/Operator Endpoints (auth required)

* `POST /sync/gh-to-wf?path=/posts/foo.md` (manual re-sync a file)
* `POST /sync/wf-to-gh?itemId=...` (manual push back)
* `POST /rebuild-index` (full re-index of collection)
* `GET /healthz` (liveness)
* `GET /readyz` (readiness)

---

## 7) Core Flows

### 7.1 GitHub → Webflow (GH→WF)

1. **Trigger**: GitHub webhook. Filter commits for changes in `/posts/**.md`.
2. **Fetch**: For each file:

   * Read file contents at commit SHA.
   * Parse **frontmatter** + **markdown body**.
   * Skip if `push_to_webflow: false`.
3. **Transform**:

   * Resolve image paths → absolute raw GitHub URLs (or upload → Webflow Asset URL if `use_assets_upload`).
   * Convert MD→HTML; allow `<pre><code class="language-xyz">`.
4. **Upsert**:

   * If `post_id` or known `webflow_item_id`: **update** item.
   * Else: **create** item; on success, write back `post_id` in GitHub (commit or PR).
5. **Publish**:

   * If `published: true`: mark for publish (your CI deploy step should publish the site).
6. **State**:

   * Update `content_items` with hashes and timestamps (`last_update_github`).
7. **Idempotency**:

   * If incoming hash matches stored `hash_github`, no-op.
8. **Error handling**:

   * Exponential backoff (3 tries). Log to `sync_events`. Dead-letter queue on persistent failure.

### 7.2 Webflow → GitHub (WF→GH, optional)

1. **Trigger**: Webflow webhook on collection item update.
2. **Fetch**: Get full item via Webflow API.
3. **Transform**:

   * HTML→Markdown (preserve headings, lists, code blocks).
   * Extract fields to frontmatter; keep mapping.
4. **Write**:

   * Find corresponding GitHub file by `post_id` or `slug`. If missing, create a path:

     * `posts/{slug}.md`
   * Create a PR (preferred) with changes and message: `chore(wf->gh): sync post {slug}`.
5. **State**:

   * Update `last_update_webflow`, `hash_webflow`.
6. **Conflicts**:

   * If `directionality = gh_authoritative`, store diffs as PR but tag for review; do **not** auto-merge.
   * If `bidirectional`, compare `last_update` timestamps; prefer newer; otherwise open PR with conflict label.

---

## 8) Mapping Application (Field-Level)

Use the prior mapping sheet. Enforcement rules:

* **Required fields** (`name`, `body_rich`, `publish_date`, `is_published`):

  * Validate presence; if missing, fail with actionable error.
* **Slug**:

  * Generate from `title` if absent. Deduplicate by suffixing `-2`, `-3`.
* **Images**:

  * If `use_assets_upload=true`, upload and rewrite `src`.
  * Otherwise, leave absolute raw URLs.
* **Tags**:

  * If Multi-Ref, ensure tag existence or create on-demand.

---

## 9) Webhook Security

* **GitHub**: Validate `X-Hub-Signature-256` with `GITHUB_WEBHOOK_SECRET`.
* **Webflow**: Validate `X-Webflow-Signature` (if available) or use a random shared secret query param.
* **Replay protection**: Reject timestamps older than N minutes; keep recent webhook IDs.

---

## 10) Rate Limits & Throttling

* **GitHub**: Use conditional requests (ETags). Respect secondary rate limits; backoff on `403` with `Retry-After`.
* **Webflow**: Batch writes; limit to ~60 req/min per token (tune as needed). Queue with concurrency 2–5.

---

## 11) Idempotency & Ordering

* Derive **job key** = `project_id + github_path + commit_sha` (for GH) or `project_id + webflow_item_id + updated_at` (for WF).
* Use **dedup** in queue (discard duplicates within 2 minutes).
* Store **hashes** per side; skip unchanged.

---

## 12) Error Handling

* **Validation errors** (missing required fields): mark `sync_events` as `error`, comment back to PR with details.
* **API errors**: automatic retry (max 3) with jittered backoff; DLQ on failure.
* **Mapping failures**: log field-level details; include input snippet.

---

## 13) Observability

* **Structured logs** (JSON): request_id, event_id, file, item_id, direction, duration, status.
* **Metrics**: `sync_jobs_total{direction,status}`, `sync_latency_seconds`, `api_rate_limit_remaining`.
* **Tracing**: OpenTelemetry spans around external API calls.
* **Dashboards**: error rate, queue depth, processing latency.

---

## 14) Deployment

* Containerized (Docker).
* Environments: `dev`, `staging`, `prod`.
* CI: lint, tests, type-check, SAST.
* CD: blue/green or rolling.
* Infra options: Fly.io, Render, Vercel functions (queue via external), GCP Cloud Run, AWS ECS/Fargate.

---

## 15) GitHub Automation

**Webhook**: `push` on `default_branch`, `content_path`.
**Action (optional)** for manual run:

```yaml
name: Sync Blog (manual)
on:
  workflow_dispatch:
    inputs:
      path:
        description: 'Path to post'
        required: false
jobs:
  trigger-middleware:
    runs-on: ubuntu-latest
    steps:
      - name: Call middleware
        run: |
          curl -X POST "$MIDDLEWARE_URL/sync/gh-to-wf?path=${{ github.event.inputs.path }}" \
            -H "Authorization: Bearer ${{ secrets.MIDDLEWARE_TOKEN }}"
```

---

## 16) Pseudocode (Core Upsert GH→WF)

```ts
async function syncFileToWebflow(project, commitSha, path) {
  const raw = await github.getFile(project, path, commitSha)
  const { frontmatter, bodyMd } = parseFrontmatter(raw)
  if (frontmatter.push_to_webflow === false) return

  const bodyHtml = mdToHtml(bodyMd, { allowTables: true, allowCode: true })
  const assets = await resolveImages(frontmatter.image, bodyHtml, project)

  const payload = mapToWebflowFields(frontmatter, bodyHtml, assets)

  // Determine target item
  let itemId = frontmatter.post_id || await db.lookupItemId(project.id, path)
  if (itemId) {
    await webflow.updateItem(project.webflow_collection_id, itemId, payload)
  } else {
    const created = await webflow.createItem(project.webflow_collection_id, payload)
    itemId = created._id
    await writeBackPostIdToGitHub(project, path, itemId) // via PR
  }

  if (frontmatter.published === true) {
    await markForPublish(project.webflow_site_id, [itemId]) // or defer to site deploy pipeline
  }

  await db.updateContentItem(project.id, {
    webflow_item_id: itemId,
    github_path: path,
    last_update_github: nowIso(),
    hash_github: sha256(frontmatter + bodyMd),
    hash_webflow: sha256(payload)
  })
}
```

---

## 17) Validation Rules (examples)

* `title` non-empty; 3–120 chars.
* `date` ISO 8601 or `YYYY-MM-DD`; else fallback to commit time.
* `image` must be absolute or resolvable; if cannot resolve, warn and continue (do not block).
* `published` defaults `false`.
* `slug` unique within collection.

---

## 18) Test Plan

* **Unit**: frontmatter parser, md↔html, image resolver, mapping, slugger.
* **Integration**: mock GH + WF APIs; upsert flows, publish toggle, tag creation.
* **E2E (staging)**:

  * New file → creates item, writes back `post_id`.
  * Update body → updates item (code blocks + images intact).
  * Toggle `published` → item marked for publish.
  * WF edit → PR opened with HTML→MD conversion.
  * Conflict timestamps → expected behavior per `directionality`.
* **Load**: 500 posts, 100 updates; ensure no rate-limit failures.

---

## 19) Rollout & Safeguards

* Start `gh_authoritative` mode; enable WF→GH after 1–2 weeks.
* Dry run mode: log-only without writing to Webflow.
* Feature flags: `use_assets_upload`, `wf_to_gh_enabled`.
* Backups: export Webflow collection JSON nightly.

---

## 20) Acceptance Criteria (Go/No-Go)

* 100% of posts in `/posts` appear in Webflow with correct fields and assets.
* Round-trip an edited post (both directions) with no data loss in headings, lists, links, code blocks, and tables.
* Errors < 1% per 100 sync jobs; no silent drops.
* Publish toggles respected end-to-end.
