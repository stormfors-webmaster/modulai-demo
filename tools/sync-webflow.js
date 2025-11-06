#!/usr/bin/env node
/**
 * Starter sync to Webflow CMS (v2) from Markdown files in /posts
 * Node 20+. Minimal, safe defaults. Extend as needed.
 *
 * ENV (secrets in Actions):
 *  - WEBFLOW_TOKEN
 *  - WEBFLOW_COLLECTION_ID
 *  - WEBFLOW_SITE_ID (optional, not used here but handy)
 *  - GH_REPOSITORY (auto in Actions: owner/repo)
 *  - GITHUB_SHA (auto)
 *  - GITHUB_REF_NAME (auto; branch)
 *
 * CLI:
 *  - --all       Sync all posts/**/*.md
 *  - --dry-run   Print actions, don't call Webflow
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import matter from "gray-matter";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

// ---------- Config you may tweak ----------
const POSTS_DIR = "posts";
const IMAGE_DIR = "images"; // for resolving relative image paths
const COLLECTION_ID = process.env.WEBFLOW_COLLECTION_ID;
const WEBFLOW_TOKEN = process.env.WEBFLOW_TOKEN;
const REPO = process.env.GITHUB_REPOSITORY || process.env.GH_REPOSITORY; // owner/repo
const COMMIT_SHA = process.env.GITHUB_SHA || "main";
const BRANCH = process.env.GITHUB_REF_NAME || "main";
// Field API IDs in Webflow (match your collection setup)
const FIELD_IDS = {
  name: "name",
  slug: "slug",
  body: "body_rich",
  mainImage: "main_image",
  publishDate: "publish_date",
  authorText: "author_text",
  externalLink: "external_link",
  isPublished: "is_published",
  pushToWebflow: "push_to_webflow",
  postId: "post_id",
  lastUpdate: "last_update",
  excerpt: "excerpt",
  seoTitle: "seo_title",
  seoDescription: "seo_description",
  tags: "tags_multi"
};
// ------------------------------------------

function parseArgs() {
  const args = new Set(process.argv.slice(2));
  return {
    all: args.has("--all"),
    dryRun: args.has("--dry-run"),
  };
}

function log(...a) { console.log("[sync-webflow]", ...a); }
function warn(...a) { console.warn("[sync-webflow:warn]", ...a); }
function fail(msg, e) {
  console.error("[sync-webflow:error]", msg);
  if (e) console.error(e?.stack || e);
  process.exitCode = 1;
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required env: ${name}`);
  }
  return v;
}

function kebab(str) {
  return String(str || "")
    .trim()
    .toLowerCase()
    .replace(/['".,!?()[\]]+/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getAllMarkdown() {
  function walk(dir) {
    const out = [];
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) out.push(...walk(p));
      else if (ent.isFile() && p.endsWith(".md")) out.push(p);
    }
    return out;
  }
  return fs.existsSync(POSTS_DIR) ? walk(POSTS_DIR) : [];
}

function getChangedMarkdown() {
  try {
    // Ensure we have history (Actions checkout may be shallow)
    execSync("git fetch --depth=2 origin "+(BRANCH || "HEAD"), { stdio: "ignore" });
  } catch {}
  let files = [];
  try {
    const diff = execSync(`git diff --name-only HEAD~1 HEAD -- '${POSTS_DIR}/**/*.md'`, { encoding: "utf8" });
    files = diff.split("\n").map(s => s.trim()).filter(Boolean);
  } catch (e) {
    warn("git diff failed; falling back to all files", e.message);
    files = getAllMarkdown();
  }
  return files;
}

async function mdToHtml(markdown) {
  // Allow code/pre/table/figure/figcaption in sanitation
  const schema = structuredClone(defaultSchema);
  schema.tagNames = Array.from(new Set([
    ...(schema.tagNames || []),
    "pre","code","table","thead","tbody","tr","th","td","figure","figcaption"
  ]));
  schema.attributes = {
    ...(schema.attributes || {}),
    code: ["className"],
    img: ["src","alt","title","width","height","loading"],
    a: ["href","title","target","rel"]
  };
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(rehypeSanitize, schema)
    .use(rehypeStringify)
    .process(markdown);
  return String(file);
}

function resolveToRawUrl(filePathOrUrl) {
  if (!filePathOrUrl) return filePathOrUrl;
  // Already absolute URL?
  if (/^https?:\/\//i.test(filePathOrUrl)) return filePathOrUrl;
  // Make repository raw URL pinned to the commit for immutability
  if (!REPO) return filePathOrUrl;
  const rel = filePathOrUrl.replace(/^\.?\//, "");
  return `https://raw.githubusercontent.com/${REPO}/${COMMIT_SHA}/${rel}`;
}

function rewriteImageLinksInMarkdown(md, fileDir) {
  // Very light-touch: replace ![alt](relative) with commit-pinned raw URL
  // Handles () with spaces; doesn't touch full URLs.
  return md.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt, url) => {
    const clean = url.split(/\s+/)[0].replace(/^<|>$/g, "");
    if (/^https?:\/\//i.test(clean)) return m;
    const absPath = path.normalize(path.join(fileDir, clean));
    // Make repo-root relative (strip leading ../)
    let repoRel = absPath.replace(/^[.][/\\]*/, "");
    // If the image is under the shared images dir and markdown references "../images/..", normalize
    if (!fs.existsSync(absPath)) {
      // Try a common fallback into /images
      const baseName = path.basename(clean);
      const candidate = path.join(IMAGE_DIR, baseName);
      if (fs.existsSync(candidate)) repoRel = candidate;
    }
    const raw = resolveToRawUrl(repoRel);
    const rest = url.slice(clean.length); // preserve title if present
    return `![${alt}](${raw}${rest})`;
  });
}

function trimToExcerpt(html, max = 160) {
  const text = html
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, max);
}

async function upsertWebflowItem({ fm, html, filePath, dryRun }) {
  const published = Boolean(fm.published);
  const pushFlag = fm.push_to_webflow !== false; // default true if omitted

  if (!pushFlag) {
    log(`Skipping (push_to_webflow: false): ${filePath}`);
    return;
  }
  if (!fm.title) throw new Error(`Missing required 'title' in ${filePath}`);

  const bodyHtml = html;
  const name = String(fm.title);
  const slug = fm.slug ? String(fm.slug) : kebab(fm.title);
  const mainImage = fm.image ? resolveToRawUrl(String(fm.image)) : undefined;
  const publishDate = fm.date ? new Date(fm.date).toISOString() : new Date().toISOString();
  const author = fm.author ? String(fm.author) : undefined;
  const externalLink = fm.link ? String(fm.link) : undefined;
  const lastUpdate = fm.last_update ? new Date(fm.last_update).toISOString() : new Date().toISOString();
  const tags = Array.isArray(fm.tags) ? fm.tags.map(String) : undefined;
  const excerpt = fm.excerpt ? String(fm.excerpt) : trimToExcerpt(bodyHtml, 160);
  const seoTitle = fm?.seo?.title;
  const seoDescription = fm?.seo?.description;

  const fieldData = {
    [FIELD_IDS.name]: name,
    [FIELD_IDS.slug]: slug,
    [FIELD_IDS.body]: bodyHtml,
    ...(mainImage ? { [FIELD_IDS.mainImage]: mainImage } : {}),
    [FIELD_IDS.publishDate]: publishDate,
    ...(author ? { [FIELD_IDS.authorText]: author } : {}),
    ...(externalLink ? { [FIELD_IDS.externalLink]: externalLink } : {}),
    [FIELD_IDS.isPublished]: published,
    [FIELD_IDS.pushToWebflow]: true, // write-protect on WF→GH if you do two-way
    ...(fm.post_id ? { [FIELD_IDS.postId]: String(fm.post_id) } : {}),
    [FIELD_IDS.lastUpdate]: lastUpdate,
    ...(tags ? { [FIELD_IDS.tags]: tags } : {}),
    ...(excerpt ? { [FIELD_IDS.excerpt]: excerpt } : {}),
    ...(seoTitle ? { [FIELD_IDS.seoTitle]: seoTitle } : {}),
    ...(seoDescription ? { [FIELD_IDS.seoDescription]: seoDescription } : {}),
  };

  const payload = {
    isArchived: false,
    isDraft: !published,
    fieldData
  };

  const headers = {
    "Authorization": `Bearer ${WEBFLOW_TOKEN}`,
    "Content-Type": "application/json",
    "accept": "application/json",
  };

  if (dryRun) {
    log("(dry-run) UPSERT", { slug, hasPostId: Boolean(fm.post_id) });
    return;
  }

  if (fm.post_id) {
    // Update existing
    const url = `https://api.webflow.com/v2/collections/${COLLECTION_ID}/items/${encodeURIComponent(fm.post_id)}`;
    const res = await fetch(url, { method: "PATCH", headers, body: JSON.stringify(payload) });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Webflow update failed (${res.status}): ${text}`);
    }
    const data = await res.json();
    log(`Updated Webflow item ${fm.post_id} for ${filePath}`);
    return data;
  } else {
    // Create new
    const url = `https://api.webflow.com/v2/collections/${COLLECTION_ID}/items`;
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Webflow create failed (${res.status}): ${text}`);
    }
    const data = await res.json();
    const itemId = data?.id || data?.item?.id; // depending on response shape
    log(`Created Webflow item ${itemId || "(unknown)"} for ${filePath}`);

    // Optionally: emit repository_dispatch so a separate workflow can write back post_id
    // Requires a token with repo:dispatch scope; usually GITHUB_TOKEN works in the same repo.
    try {
      await dispatchWriteback({
        path: filePath,
        itemId,
      });
    } catch (e) {
      warn("repository_dispatch for writeback failed (non-fatal):", e.message);
    }
    return data;
  }
}

async function dispatchWriteback({ path: filePath, itemId }) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN_WITH_WRITE;
  if (!token || !REPO || !itemId) return;

  const url = `https://api.github.com/repos/${REPO}/dispatches`;
  const body = {
    event_type: "webflow_item_created",
    client_payload: { path: filePath, itemId }
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${token}`,
      "accept": "application/vnd.github+json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`repository_dispatch failed (${res.status}): ${text}`);
  }
  log(`repository_dispatch sent for ${filePath} -> itemId=${itemId}`);
}

async function processFile(filePath, opts) {
  const src = fs.readFileSync(filePath, "utf8");
  const fm = matter(src);
  const fileDir = path.dirname(filePath);

  // Normalize booleans if authors used True/False
  ["published", "push_to_webflow"].forEach(k => {
    if (k in fm.data) {
      const v = fm.data[k];
      if (typeof v === "string") {
        fm.data[k] = /^(true|yes|1)$/i.test(v);
      }
    }
  });

  // Rewrite relative images in markdown to commit-pinned raw URLs
  const mdWithRaw = rewriteImageLinksInMarkdown(fm.content, fileDir);
  const html = await mdToHtml(mdWithRaw);

  await upsertWebflowItem({
    fm: fm.data,
    html,
    filePath,
    dryRun: opts.dryRun
  });
}

async function main() {
  try {
    requireEnv("WEBFLOW_TOKEN");
    requireEnv("WEBFLOW_COLLECTION_ID");
  } catch (e) {
    fail(e.message);
    return;
  }
  const { all, dryRun } = parseArgs();

  const files = all ? getAllMarkdown() : getChangedMarkdown();
  if (files.length === 0) {
    log(all ? "No markdown files found." : "No changed markdown files.");
    return;
  }
  log(`Found ${files.length} file(s) to process.`);

  for (const f of files) {
    try {
      await processFile(f, { dryRun });
    } catch (e) {
      fail(`Failed processing ${f}`, e);
    }
  }
}

main().catch(e => fail("Unhandled error", e));

