#!/usr/bin/env node
/**
 * Validate frontmatter schema in posts/*.md files
 * Intended for GitHub Actions PR linting.
 */

import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const POSTS_DIR = "posts";

// ---------- CONFIG: allowed & required fields ----------
const REQUIRED_FIELDS = ["title", "date", "push_to_webflow"];
const OPTIONAL_FIELDS = [
	"slug",
	"image",
	"author",
	"link",
	"published",
	"post_id",
	"last_update",
	"tags",
	"excerpt",
	"seo",
];
const ALLOWED_FIELDS = new Set([...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]);

// SEO subfields allowed
const ALLOWED_SEO_FIELDS = new Set(["title", "description"]);

// -------------------------------------------------------

let hasErrors = false;

function fail(file, msg) {
	console.error(`❌  ${file}: ${msg}`);
	hasErrors = true;
}

function warn(file, msg) {
	console.warn(`⚠️  ${file}: ${msg}`);
}

function isIsoDate(str) {
	// strictish ISO check - allows YYYY-MM-DD or full timestamp
	return /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d{3})?(Z|[+-]\d{2}:\d{2})?)?$/.test(
		str,
	);
}

function validateFile(filePath) {
	const raw = fs.readFileSync(filePath, "utf8");

	let fm;
	try {
		fm = matter(raw);
	} catch (e) {
		fail(filePath, `Invalid frontmatter: ${e.message}`);
		return;
	}

	const data = fm.data;

	// Missing required fields
	REQUIRED_FIELDS.forEach((f) => {
		if (!(f in data)) {
			fail(filePath, `Missing required field '${f}'`);
		}
	});

	// Unknown keys?
	Object.keys(data).forEach((k) => {
		if (!ALLOWED_FIELDS.has(k)) {
			fail(filePath, `Unknown field '${k}' — typo?`);
		}
	});

	// Validate: title
	if (data.title && typeof data.title !== "string") {
		fail(filePath, `title must be a string`);
	}

	// Validate: date (ISO)
	// gray-matter auto-parses dates as Date objects, so we need to handle both
	if (data.date) {
		let dateStr;
		if (data.date instanceof Date) {
			// Convert Date object to ISO string (YYYY-MM-DD format)
			dateStr = data.date.toISOString().split("T")[0];
		} else if (typeof data.date === "string") {
			dateStr = data.date;
		} else {
			dateStr = String(data.date);
		}
		if (!isIsoDate(dateStr)) {
			fail(
				filePath,
				`date must be ISO format (YYYY-MM-DD or full timestamp), got: ${dateStr}`,
			);
		}
	}

	// Validate: published (bool)
	if ("published" in data && typeof data.published !== "boolean") {
		fail(filePath, `published must be boolean (true/false)`);
	}

	// Validate: push_to_webflow (bool)
	if ("push_to_webflow" in data && typeof data.push_to_webflow !== "boolean") {
		fail(filePath, `push_to_webflow must be boolean (true/false)`);
	}

	// Validate: link (URL-ish)
	if (
		data.link &&
		typeof data.link === "string" &&
		!/^https?:\/\//i.test(data.link)
	) {
		warn(filePath, `link does not look like a valid URL`);
	}

	// Validate: image (relative or URL)
	if (data.image && typeof data.image === "string") {
		const img = data.image.trim();
		if (
			!/^https?:\/\//i.test(img) &&
			!fs.existsSync(path.join(process.cwd(), img))
		) {
			warn(
				filePath,
				`image path not found on disk (relative imports must resolve)`,
			);
		}
	}

	// Validate: tags
	if (data.tags) {
		if (!Array.isArray(data.tags)) {
			fail(filePath, `tags must be an array`);
		} else {
			data.tags.forEach((t, i) => {
				if (typeof t !== "string") {
					fail(filePath, `tags[${i}] must be a string`);
				}
			});
		}
	}

	// Validate: SEO structure
	if (data.seo) {
		if (typeof data.seo !== "object" || Array.isArray(data.seo)) {
			fail(filePath, `seo must be an object`);
		} else {
			Object.keys(data.seo).forEach((k) => {
				if (!ALLOWED_SEO_FIELDS.has(k)) {
					fail(filePath, `seo.${k} is not allowed`);
				}
			});
			if (data.seo.title && typeof data.seo.title !== "string") {
				fail(filePath, `seo.title must be a string`);
			}
			if (data.seo.description && typeof data.seo.description !== "string") {
				fail(filePath, `seo.description must be a string`);
			}
		}
	}

	// Validate: post_id (string)
	if (data.post_id && typeof data.post_id !== "string") {
		fail(filePath, `post_id must be a string`);
	}

	// Validate: last_update ISO
	if (
		data.last_update &&
		(!isIsoDate(data.last_update) || typeof data.last_update !== "string")
	) {
		fail(filePath, `last_update must be ISO date string`);
	}
}

function walk(dir) {
	const out = [];
	for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, ent.name);
		if (ent.isDirectory()) out.push(...walk(p));
		else if (ent.isFile() && p.endsWith(".md")) out.push(p);
	}
	return out;
}

// Main
if (!fs.existsSync(POSTS_DIR)) {
	console.error(`No '${POSTS_DIR}' directory found — nothing to validate.`);
	process.exit(0);
}

const files = walk(POSTS_DIR);
if (files.length === 0) {
	console.log("No markdown files found in /posts.");
	process.exit(0);
}

console.log(`Validating ${files.length} Markdown file(s)...`);
files.forEach((f) => validateFile(f));

if (hasErrors) {
	console.error("\n❌ Frontmatter validation failed.");
	process.exit(1);
}

console.log("\n✅ All frontmatter valid!");
process.exit(0);
