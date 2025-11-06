#!/usr/bin/env node
/**
 * Test script to sync a single Markdown post to Webflow CMS
 * Uses .env.local for configuration
 * 
 * Usage: node test-sync.js [path-to-post.md]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

// Load .env.local
function loadEnv() {
  const envPath = path.join(rootDir, ".env.local");
  if (!fs.existsSync(envPath)) {
    throw new Error(`.env.local not found at ${envPath}`);
  }
  
  const env = {};
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [key, ...valueParts] = trimmed.split("=");
    if (key && valueParts.length > 0) {
      const value = valueParts.join("=").replace(/^["']|["']$/g, "");
      env[key.trim()] = value.trim();
    }
  }
  return env;
}

const env = loadEnv();
const WEBFLOW_TOKEN = env.WEBFLOW_TOKEN || env.WEBFLOW_API_KEY;
const WEBFLOW_COLLECTION_ID = env.WEBFLOW_COLLECTION_ID;
const WEBFLOW_SITE_ID = env.WEBFLOW_SITE_ID;

if (!WEBFLOW_TOKEN) {
  throw new Error("Missing WEBFLOW_TOKEN or WEBFLOW_API_KEY in .env.local");
}
if (!WEBFLOW_COLLECTION_ID) {
  throw new Error("Missing WEBFLOW_COLLECTION_ID in .env.local");
}

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

function log(...a) { console.log("[test-sync]", ...a); }
function warn(...a) { console.warn("[test-sync:warn]", ...a); }
function fail(msg, e) {
  console.error("[test-sync:error]", msg);
  if (e) console.error(e?.stack || e);
  process.exit(1);
}

function kebab(str) {
  return String(str || "")
    .trim()
    .toLowerCase()
    .replace(/['".,!?()[\]]+/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function mdToHtml(markdown) {
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
  if (/^https?:\/\//i.test(filePathOrUrl)) return filePathOrUrl;
  // For local testing, keep relative paths or convert to absolute file:// URLs
  // In production, this would be a GitHub raw URL
  return filePathOrUrl;
}

function rewriteImageLinksInMarkdown(md, fileDir) {
  return md.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt, url) => {
    const clean = url.split(/\s+/)[0].replace(/^<|>$/g, "");
    if (/^https?:\/\//i.test(clean)) return m;
    // For local testing, keep relative paths
    // In production, these would be resolved to GitHub raw URLs
    return m;
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

async function upsertWebflowItem({ fm, html, filePath }) {
  const published = Boolean(fm.published);
  const pushFlag = fm.push_to_webflow !== false;

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
    [FIELD_IDS.pushToWebflow]: true,
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

  if (fm.post_id) {
    // Update existing
    const url = `https://api.webflow.com/v2/collections/${WEBFLOW_COLLECTION_ID}/items/${encodeURIComponent(fm.post_id)}`;
    log(`Updating existing item: ${fm.post_id}`);
    const res = await fetch(url, { method: "PATCH", headers, body: JSON.stringify(payload) });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Webflow update failed (${res.status}): ${text}`);
    }
    const data = await res.json();
    log(`✅ Updated Webflow item ${fm.post_id} for ${filePath}`);
    log(`   Slug: ${slug}`);
    log(`   Published: ${published}`);
    return data;
  } else {
    // Create new
    const url = `https://api.webflow.com/v2/collections/${WEBFLOW_COLLECTION_ID}/items`;
    log(`Creating new item...`);
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Webflow create failed (${res.status}): ${text}`);
    }
    const data = await res.json();
    const itemId = data?.id || data?.item?.id;
    log(`✅ Created Webflow item ${itemId || "(unknown)"} for ${filePath}`);
    log(`   Slug: ${slug}`);
    log(`   Published: ${published}`);
    log(`\n💡 To update this post in the future, add this to frontmatter:`);
    log(`   post_id: "${itemId}"`);
    return data;
  }
}

async function processFile(filePath) {
  const src = fs.readFileSync(filePath, "utf8");
  const fm = matter(src);
  const fileDir = path.dirname(filePath);

  // Normalize booleans
  ["published", "push_to_webflow"].forEach(k => {
    if (k in fm.data) {
      const v = fm.data[k];
      if (typeof v === "string") {
        fm.data[k] = /^(true|yes|1)$/i.test(v);
      }
    }
  });

  // Rewrite relative images in markdown
  const mdWithRaw = rewriteImageLinksInMarkdown(fm.content, fileDir);
  const html = await mdToHtml(mdWithRaw);

  await upsertWebflowItem({
    fm: fm.data,
    html,
    filePath,
  });
}

async function main() {
  const postPath = process.argv[2] || path.join(rootDir, "posts", "example-post.md");
  
  if (!fs.existsSync(postPath)) {
    fail(`Post file not found: ${postPath}`);
  }

  log(`Syncing post: ${postPath}`);
  log(`Collection ID: ${WEBFLOW_COLLECTION_ID}`);
  log(`Site ID: ${WEBFLOW_SITE_ID || "(not set)"}`);
  log("");

  try {
    await processFile(postPath);
    log("\n✅ Sync completed successfully!");
  } catch (e) {
    fail("Sync failed", e);
  }
}

main().catch(e => fail("Unhandled error", e));

