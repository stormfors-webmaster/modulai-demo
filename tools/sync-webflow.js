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
 *  - --all       Sync all markdown files in posts directory
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
// Field slugs for Webflow v2 API (match your collection setup)
// Run `node tools/fetch-schema.js` to get the correct field slugs for your collection
// Note: Webflow v2 API uses field slugs in fieldData, not field IDs!
// Update these to match your actual Webflow collection field slugs
const FIELD_IDS = {
	name: "name", // Name field slug
	slug: "slug", // Slug field slug
	body: "post-body", // Body/RichText field slug
	mainImage: "main-image", // Main Image field slug
	publishDate: "publish-date", // Publish Date field slug (for scheduled publishing)
	authorText: "author", // Author field slug
	externalLink: "link", // External Link field slug
	isPublished: "is-published", // Published status field slug
	pushToWebflow: "push-to-webflow", // Push to Webflow flag field slug
	postId: "post-id", // Post ID field slug
	// Note: lastUpdated is a Webflow system field (read-only), automatically managed
	excerpt: "post-summary", // Excerpt/Summary field slug
	seoTitle: "seo-title", // SEO Title field slug
	seoDescription: "seo-description", // SEO Description field slug
	tags: "tags", // Tags field slug
};
// ------------------------------------------

function parseArgs() {
	const args = new Set(process.argv.slice(2));
	return {
		all: args.has("--all"),
		dryRun: args.has("--dry-run"),
	};
}

function log(...a) {
	console.log("[sync-webflow]", ...a);
}
function warn(...a) {
	console.warn("[sync-webflow:warn]", ...a);
}
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
	log("Detecting changed markdown files...");
	
	// Strategy 1 (Highest Priority): Use files provided by GitHub Actions workflow
	// This is the most reliable method as the workflow handles git operations
	if (process.env.CHANGED_FILES !== undefined) {
		// CHANGED_FILES is set (may be empty string)
		const changedFilesValue = String(process.env.CHANGED_FILES || "").trim();
		if (changedFilesValue === "") {
			log("No changed files detected by GitHub Actions workflow");
			// For manual triggers, if --all flag is used, we'll process all files
			if (process.env.MANUAL_TRIGGER === "true") {
				log("Manual trigger detected - use --all flag to sync all files");
			}
			return [];
		}
		
		const files = changedFilesValue
			.split("\n")
			.map((s) => s.trim())
			.filter(Boolean)
			.filter((f) => f.endsWith(".md") && f.startsWith(POSTS_DIR));
		
		if (files.length > 0) {
			log(`Found ${files.length} changed file(s) via GitHub Actions context:`);
			files.forEach((f) => log(`  - ${f}`));
			return files;
		} else {
			log("No markdown files found in CHANGED_FILES environment variable");
			return [];
		}
	}
	
	// Strategy 2: Try to use git diff with parent commit
	try {
		// Ensure we have history (Actions checkout may be shallow)
		log("Fetching git history...");
		execSync("git fetch --depth=2 origin " + (BRANCH || "HEAD"), {
			stdio: "ignore",
		});
		
		// Try to get parent commit
		let parentCommit;
		try {
			parentCommit = execSync("git rev-parse HEAD~1", {
				encoding: "utf8",
				stdio: "pipe",
			}).trim();
			log(`Found parent commit: ${parentCommit.substring(0, 7)}...`);
		} catch (e) {
			log("No parent commit found, checking if this is the first commit...");
			// Check if we're at the root commit
			const currentCommit = execSync("git rev-parse HEAD", {
				encoding: "utf8",
				stdio: "pipe",
			}).trim();
			const commitCount = execSync("git rev-list --count HEAD", {
				encoding: "utf8",
				stdio: "pipe",
			}).trim();
			
			if (commitCount === "1") {
				log("This appears to be the first commit, processing all markdown files");
				return getAllMarkdown();
			}
			throw new Error("Could not find parent commit");
		}
		
		const diff = execSync(
			`git diff --name-only HEAD~1 HEAD -- '${POSTS_DIR}/**/*.md'`,
			{ encoding: "utf8", stdio: "pipe" },
		);
		const files = diff
			.split("\n")
			.map((s) => s.trim())
			.filter(Boolean);
		
		if (files.length > 0) {
			log(`Found ${files.length} changed file(s) via git diff:`);
			files.forEach((f) => log(`  - ${f}`));
			return files;
		} else {
			log("No changed markdown files detected via git diff");
			return [];
		}
	} catch (e) {
		warn("git diff failed; trying alternative detection methods", e.message);
		
		// Strategy 3: Check if we're in GitHub Actions and use event context
		// GitHub Actions provides GITHUB_EVENT_PATH with commit info
		if (process.env.GITHUB_EVENT_PATH) {
			try {
				const eventData = JSON.parse(
					fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"),
				);
				const modifiedFiles =
					eventData?.head_commit?.modified ||
					eventData?.commits?.flatMap((c) => c.modified || []) ||
					[];
				const markdownFiles = modifiedFiles.filter((f) =>
					f.startsWith(`${POSTS_DIR}/`) && f.endsWith(".md"),
				);
				if (markdownFiles.length > 0) {
					log(`Found ${markdownFiles.length} changed file(s) via GitHub event:`);
					markdownFiles.forEach((f) => log(`  - ${f}`));
					return markdownFiles;
				}
			} catch (eventErr) {
				warn("Could not parse GitHub event data", eventErr.message);
			}
		}
		
		// Strategy 4: Fallback to all files (safer than failing silently)
		warn("Falling back to processing all markdown files");
		const allFiles = getAllMarkdown();
		if (allFiles.length > 0) {
			log(`Processing all ${allFiles.length} markdown file(s) as fallback`);
		}
		return allFiles;
	}
}

async function mdToHtml(markdown) {
	// Allow code/pre/table/figure/figcaption in sanitation
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

	log(`Processing: ${filePath}`);
	log(`  Title: ${fm.title}`);
	log(`  Published: ${published}`);
	log(`  Has post_id: ${Boolean(fm.post_id)}`);

	const bodyHtml = html;
	const name = String(fm.title);
	const slug = fm.slug ? String(fm.slug) : kebab(fm.title);
	const mainImage = fm.image ? resolveToRawUrl(String(fm.image)) : undefined;
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

	log(`  Slug: ${slug}`);
	if (mainImage) log(`  Main Image: ${mainImage}`);
	if (author) log(`  Author: ${author}`);
	if (tags) log(`  Tags: ${tags}`);

	// Build fieldData object, only including fields that exist in the collection
	const fieldData = {};

	if (FIELD_IDS.name) fieldData[FIELD_IDS.name] = name;
	if (FIELD_IDS.slug) fieldData[FIELD_IDS.slug] = slug;
	if (FIELD_IDS.body) fieldData[FIELD_IDS.body] = bodyHtml;
	if (FIELD_IDS.mainImage && mainImage)
		fieldData[FIELD_IDS.mainImage] = mainImage;
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
	// Note: isDraft controls whether item is draft or published
	// When isPublished field exists, we can use it, but isDraft still controls the item state
	const payload = {
		isArchived: false,
		isDraft: !published,
		fieldData,
	};

	const headers = {
		Authorization: `Bearer ${WEBFLOW_TOKEN}`,
		"Content-Type": "application/json",
		accept: "application/json",
	};

	if (dryRun) {
		log("(dry-run) UPSERT", { slug, hasPostId: Boolean(fm.post_id) });
		log("(dry-run) Payload:", JSON.stringify(payload, null, 2));
		return;
	}

	if (fm.post_id) {
		// Update existing
		log(`Updating existing Webflow item: ${fm.post_id}`);
		const url = `https://api.webflow.com/v2/collections/${COLLECTION_ID}/items/${encodeURIComponent(fm.post_id)}`;
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
		log(`   Last Updated: ${data.lastUpdated || "N/A"} (system field)`);
		return data;
	} else {
		// Create new
		log(`Creating new Webflow item for ${filePath}`);
		const url = `https://api.webflow.com/v2/collections/${COLLECTION_ID}/items`;
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
		const itemId = data?.id || data?.item?.id; // depending on response shape
		log(`✅ Created Webflow item ${itemId || "(unknown)"} for ${filePath}`);
		log(`   Created: ${data.createdOn || "N/A"} (system field)`);
		log(`   Last Updated: ${data.lastUpdated || "N/A"} (system field)`);

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
		client_payload: { path: filePath, itemId },
	};
	const res = await fetch(url, {
		method: "POST",
		headers: {
			authorization: `Bearer ${token}`,
			accept: "application/vnd.github+json",
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
	log(`\n--- Processing file: ${filePath} ---`);
	const src = fs.readFileSync(filePath, "utf8");
	const fm = matter(src);
	const fileDir = path.dirname(filePath);

	log(`Parsed frontmatter: ${Object.keys(fm.data).length} field(s)`);

	// Normalize booleans if authors used True/False
	["published", "push_to_webflow"].forEach((k) => {
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
	log(`Converted markdown to HTML (${html.length} chars)`);

	await upsertWebflowItem({
		fm: fm.data,
		html,
		filePath,
		dryRun: opts.dryRun,
	});
	log(`✅ Completed processing: ${filePath}\n`);
}

async function main() {
	log("=== Webflow Sync Script ===");
	log(`Repository: ${REPO || "(not set)"}`);
	log(`Commit SHA: ${COMMIT_SHA || "(not set)"}`);
	log(`Branch: ${BRANCH || "(not set)"}`);
	log(`Collection ID: ${COLLECTION_ID ? COLLECTION_ID.substring(0, 8) + "..." : "(not set)"}`);
	log(`Webflow Token: ${WEBFLOW_TOKEN ? "***" + WEBFLOW_TOKEN.slice(-4) : "(not set)"}`);
	log("");

	try {
		requireEnv("WEBFLOW_TOKEN");
		requireEnv("WEBFLOW_COLLECTION_ID");
	} catch (e) {
		fail(e.message);
		return;
	}
	const { all, dryRun } = parseArgs();

	if (dryRun) {
		log("🔍 DRY RUN MODE - No changes will be made to Webflow\n");
	}

	const files = all ? getAllMarkdown() : getChangedMarkdown();
	if (files.length === 0) {
		log(all ? "No markdown files found." : "No changed markdown files.");
		return;
	}
	log(`\n📝 Found ${files.length} file(s) to process.\n`);

	let successCount = 0;
	let errorCount = 0;

	for (const f of files) {
		try {
			await processFile(f, { dryRun });
			successCount++;
		} catch (e) {
			errorCount++;
			fail(`Failed processing ${f}`, e);
		}
	}

	log("\n=== Summary ===");
	log(`✅ Successfully processed: ${successCount}`);
	if (errorCount > 0) {
		log(`❌ Failed: ${errorCount}`);
		process.exitCode = 1;
	} else {
		log("✅ All files processed successfully!");
	}
}

main().catch((e) => fail("Unhandled error", e));
