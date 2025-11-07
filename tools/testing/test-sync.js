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
const rootDir = path.resolve(__dirname, "../..");

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

// Field slugs for Webflow v2 API (match your collection setup)
// Run `node tools/fetch-schema.js` to get the correct field slugs for your collection
// Note: Webflow v2 API uses field slugs in fieldData, not field IDs!
const FIELD_IDS = {
	name: "name", // Name (PlainText) [REQUIRED]
	slug: "slug", // Slug (PlainText) [REQUIRED]
	body: "post-body", // Post Body (RichText)
	mainImage: "main-image", // Main Image (Image)
	publishDate: "publish-date", // Publish Date (DateTime) - for scheduled publishing
	authorText: "author", // Author (PlainText)
	externalLink: "link", // Link (Link)
	isPublished: "is-published", // Is Published (Switch)
	pushToWebflow: "push-to-webflow", // Push to Webflow (Switch)
	postId: "post-id", // Post ID (PlainText)
	// Note: lastUpdated is a Webflow system field (read-only), not synced
	tags: "tags", // Tags (PlainText)
	excerpt: "post-summary", // Post Summary (PlainText)
	seoTitle: "seo-title", // SEO Title (PlainText)
	seoDescription: "seo-description", // SEO Description (PlainText)
};

function log(...a) {
	console.log("[test-sync]", ...a);
}
function warn(...a) {
	console.warn("[test-sync:warn]", ...a);
}
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
	schema.tagNames = Array.from(
		new Set([
			...(schema.tagNames || []),
			"pre",
			"code",
			"table",
			"thead",
			"tbody",
			"tr",
			"th",
			"td",
			"figure",
			"figcaption",
		]),
	);
	schema.attributes = {
		...(schema.attributes || {}),
		code: ["className"],
		img: ["src", "alt", "title", "width", "height", "loading"],
		a: ["href", "title", "target", "rel"],
	};
	const file = await unified()
		.use(remarkParse)
		.use(remarkGfm)
		.use(remarkRehype, { allowDangerousHtml: false })
		.use(rehypeSanitize, schema)
		.use(rehypeStringify)
		.process(markdown);
	let html = String(file);

	// Remove image tags with relative URLs for local testing (Webflow can't import them)
	html = html.replace(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi, (match, src) => {
		if (/^https?:\/\//i.test(src)) {
			return match; // Keep absolute URLs
		}
		// Remove relative URL images
		return "";
	});

	return html;
}

function resolveToRawUrl(filePathOrUrl) {
	if (!filePathOrUrl) return filePathOrUrl;
	if (/^https?:\/\//i.test(filePathOrUrl)) return filePathOrUrl;
	// For local testing, return undefined for relative paths
	// In production, this would resolve to a GitHub raw URL
	return undefined;
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
	// Only resolve to absolute URL if it's already absolute, otherwise skip for local testing
	const mainImage =
		fm.image && /^https?:\/\//i.test(String(fm.image))
			? resolveToRawUrl(String(fm.image))
			: undefined;
	const publishDate = fm.date
		? new Date(fm.date).toISOString()
		: new Date().toISOString();
	const author = fm.author ? String(fm.author) : undefined;
	const externalLink = fm.link ? String(fm.link) : undefined;
	// Note: lastUpdated is a Webflow system field, automatically managed
	// We don't sync it - Webflow updates it automatically on every change
	const tags = Array.isArray(fm.tags)
		? fm.tags.join(", ")
		: fm.tags
			? String(fm.tags)
			: undefined;
	const excerpt = fm.excerpt
		? String(fm.excerpt)
		: trimToExcerpt(bodyHtml, 160);
	const seoTitle = fm?.seo?.title;
	const seoDescription = fm?.seo?.description;

	// Build fieldData object, only including fields that exist in the collection
	const fieldData = {};

	if (FIELD_IDS.name) fieldData[FIELD_IDS.name] = name;
	if (FIELD_IDS.slug) fieldData[FIELD_IDS.slug] = slug;
	if (FIELD_IDS.body) fieldData[FIELD_IDS.body] = bodyHtml;
	// Only include image if it's an absolute URL (skip relative paths for local testing)
	if (FIELD_IDS.mainImage && mainImage && /^https?:\/\//i.test(mainImage)) {
		fieldData[FIELD_IDS.mainImage] = mainImage;
	} else if (FIELD_IDS.mainImage && mainImage) {
		warn(
			`Skipping relative image path: ${mainImage} (use absolute URL for Webflow)`,
		);
	}
	if (FIELD_IDS.publishDate) fieldData[FIELD_IDS.publishDate] = publishDate;
	if (FIELD_IDS.authorText && author) fieldData[FIELD_IDS.authorText] = author;
	if (FIELD_IDS.externalLink && externalLink)
		fieldData[FIELD_IDS.externalLink] = externalLink;
	if (FIELD_IDS.isPublished) fieldData[FIELD_IDS.isPublished] = published;
	if (FIELD_IDS.pushToWebflow) fieldData[FIELD_IDS.pushToWebflow] = true;
	if (FIELD_IDS.postId && fm.post_id)
		fieldData[FIELD_IDS.postId] = String(fm.post_id);
	// Note: lastUpdated is a Webflow system field - automatically managed, don't sync
	if (FIELD_IDS.tags && tags) fieldData[FIELD_IDS.tags] = tags;
	if (FIELD_IDS.excerpt && excerpt) fieldData[FIELD_IDS.excerpt] = excerpt;
	if (FIELD_IDS.seoTitle && seoTitle) fieldData[FIELD_IDS.seoTitle] = seoTitle;
	if (FIELD_IDS.seoDescription && seoDescription)
		fieldData[FIELD_IDS.seoDescription] = seoDescription;

	// Webflow API v2 structure
	const payload = {
		isArchived: false,
		...(FIELD_IDS.isPublished !== null ? { isDraft: !published } : {}),
		fieldData,
	};

	const headers = {
		Authorization: `Bearer ${WEBFLOW_TOKEN}`,
		"Content-Type": "application/json",
		accept: "application/json",
	};

	// Debug: log the payload structure
	log("Payload structure:", JSON.stringify(payload, null, 2));

	if (fm.post_id) {
		// Update existing
		const url = `https://api.webflow.com/v2/collections/${WEBFLOW_COLLECTION_ID}/items/${encodeURIComponent(fm.post_id)}`;
		log(`Updating existing item: ${fm.post_id}`);
		const res = await fetch(url, {
			method: "PATCH",
			headers,
			body: JSON.stringify(payload),
		});
		if (!res.ok) {
			const text = await res.text();
			throw new Error(`Webflow update failed (${res.status}): ${text}`);
		}
		const data = await res.json();
		log(`✅ Updated Webflow item ${fm.post_id} for ${filePath}`);
		log(`   Slug: ${slug}`);
		log(`   Published: ${published}`);
		log(`   Last Updated: ${data.lastUpdated || "N/A"} (system field)`);
		return data;
	} else {
		// Create new - using v2 API
		const url = `https://api.webflow.com/v2/collections/${WEBFLOW_COLLECTION_ID}/items`;
		log(`Creating new item...`);
		const res = await fetch(url, {
			method: "POST",
			headers,
			body: JSON.stringify(payload),
		});
		if (!res.ok) {
			const text = await res.text();
			throw new Error(`Webflow create failed (${res.status}): ${text}`);
		}
		const data = await res.json();
		const itemId = data?.id || data?.item?.id;
		log(`✅ Created Webflow item ${itemId || "(unknown)"} for ${filePath}`);
		log(`   Slug: ${slug}`);
		log(`   Published: ${published}`);
		log(`   Created: ${data.createdOn || "N/A"}`);
		log(`   Last Updated: ${data.lastUpdated || "N/A"} (system field)`);
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
	["published", "push_to_webflow"].forEach((k) => {
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
	const postPath =
		process.argv[2] || path.join(rootDir, "posts", "example-post.md");

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

main().catch((e) => fail("Unhandled error", e));
