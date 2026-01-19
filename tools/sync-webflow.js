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

import { execSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

import {
	SyncError,
	getUserMessage,
	sanitizeString,
	wrapError,
} from "./lib/errors.js";
// Import hardening modules
import { auditLogger, createLogger, logger } from "./lib/logger.js";
import { RateLimiter, getGlobalRateLimiter } from "./lib/rate-limiter.js";
import { retryWithBackoff, sleep } from "./lib/retry.js";
import {
	loadAndValidateEnv,
	loadEnvLocal,
	validateFieldLimits,
	validateImagePath,
	validateRepo,
} from "./lib/validators.js";
import { walk } from "./lib/fs-utils.js";

// Load .env.local for local development (skipped in CI)
loadEnvLocal();

// ---------- Rate Limiting ----------
// Use global rate limiter from lib/rate-limiter.js
const rateLimiter = getGlobalRateLimiter();

// ---------- Concurrency Control ----------
// Configurable via SYNC_CONCURRENCY_LIMIT env var, defaults to 5
const DEFAULT_CONCURRENCY_LIMIT = 5;
const CONCURRENCY_LIMIT = (() => {
	const envValue = process.env.SYNC_CONCURRENCY_LIMIT;
	if (!envValue) return DEFAULT_CONCURRENCY_LIMIT;
	const parsed = parseInt(envValue, 10);
	if (isNaN(parsed) || parsed < 1 || parsed > 50) {
		console.warn(`Invalid SYNC_CONCURRENCY_LIMIT="${envValue}", using default ${DEFAULT_CONCURRENCY_LIMIT}`);
		return DEFAULT_CONCURRENCY_LIMIT;
	}
	return parsed;
})();

// ---------- Writeback Configuration ----------
// SYNC_WRITEBACK_FATAL: If "true", writeback failures cause non-zero exit
const WRITEBACK_FATAL = process.env.SYNC_WRITEBACK_FATAL === "true";
// Track failed writebacks for reporting
const failedWritebacks = [];

// ---------- Graceful Shutdown ----------
let isShuttingDown = false;
let shutdownReason = null;

function setupGracefulShutdown() {
	const handleSignal = (signal) => {
		if (isShuttingDown) {
			// Force exit on second signal
			logger.warn(`Received ${signal} again, forcing exit`);
			process.exit(1);
		}
		isShuttingDown = true;
		shutdownReason = signal;
		logger.warn(`Received ${signal}, waiting for in-progress operations to complete...`);
	};

	process.on("SIGINT", () => handleSignal("SIGINT"));
	process.on("SIGTERM", () => handleSignal("SIGTERM"));
}

/**
 * Check if shutdown was requested
 * @returns {boolean} True if shutdown is in progress
 */
function isShutdownRequested() {
	return isShuttingDown;
}

// ---------- Webflow Item Cache ----------
// Cache of all Webflow items, keyed by github-id for fast lookup
let webflowItemCache = null;
// Promise-based lock to prevent concurrent cache population (race condition prevention)
let cachePopulationPromise = null;

// ---------- Config you may tweak ----------
// Resolve repo root relative to this script's location
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const POSTS_DIR = path.join(REPO_ROOT, "posts");
const IMAGE_DIR = path.join(REPO_ROOT, "images");
const COLLECTION_ID = process.env.WEBFLOW_COLLECTION_ID;
const WEBFLOW_TOKEN = process.env.WEBFLOW_TOKEN;

// ---------- GitHub CLI / Git Helpers ----------
/**
 * Try to get repository info from GitHub CLI (gh)
 * @returns {string|null} Repository in owner/repo format, or null if unavailable
 */
function getRepoFromGitHubCLI() {
	try {
		const result = execSync("gh repo view --json nameWithOwner -q .nameWithOwner", {
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
			cwd: REPO_ROOT,
			timeout: 5000,
		}).trim();
		return result || null;
	} catch {
		return null;
	}
}

/**
 * Try to get current commit SHA from git
 * @returns {string} Commit SHA or "main" as fallback
 */
function getCommitShaFromGit() {
	try {
		return execSync("git rev-parse HEAD", {
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
			cwd: REPO_ROOT,
			timeout: 5000,
		}).trim();
	} catch {
		return "main";
	}
}

/**
 * Try to get current branch name from git
 * @returns {string} Branch name or "main" as fallback
 */
function getBranchFromGit() {
	try {
		return execSync("git rev-parse --abbrev-ref HEAD", {
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
			cwd: REPO_ROOT,
			timeout: 5000,
		}).trim();
	} catch {
		return "main";
	}
}

// Prefer env vars (CI), then GitHub CLI, then git directly
const REPO = process.env.GITHUB_REPOSITORY || process.env.GH_REPOSITORY || getRepoFromGitHubCLI();
const COMMIT_SHA = process.env.GITHUB_SHA || getCommitShaFromGit();
const BRANCH = process.env.GITHUB_REF_NAME || getBranchFromGit();
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
	githubId: "github-id", // GitHub ID field slug (stable unique identifier)
	// Note: lastUpdated is a Webflow system field (read-only), automatically managed
	excerpt: "post-summary", // Excerpt/Summary field slug
	seoTitle: "seo-title", // SEO Title field slug
	seoDescription: "seo-description", // SEO Description field slug
	tags: "tags", // Tags field slug
};
// ------------------------------------------

/**
 * Parse and validate command-line arguments
 * @returns {{ all: boolean, dryRun: boolean }} Parsed arguments
 * @throws {Error} If unknown arguments are provided
 */
function parseArgs() {
	const validArgs = new Set(["--all", "--dry-run"]);
	const args = process.argv.slice(2);

	// Check for unknown arguments
	const unknownArgs = args.filter(arg => !validArgs.has(arg));
	if (unknownArgs.length > 0) {
		const unknown = unknownArgs.join(", ");
		const valid = Array.from(validArgs).join(", ");
		throw new Error(
			`Unknown argument(s): ${unknown}\n` +
			`Valid arguments are: ${valid}`
		);
	}

	const argsSet = new Set(args);
	return {
		all: argsSet.has("--all"),
		dryRun: argsSet.has("--dry-run"),
	};
}

/**
 * Log an info message with optional structured data
 * @param {string} message - Log message
 * @param {object} [data] - Optional structured data to include
 */
function log(message, data) {
	logger.info(message, data);
}

/**
 * Log a warning message with optional structured data
 * @param {string} message - Warning message
 * @param {object} [data] - Optional structured data to include
 */
function warn(message, data) {
	logger.warn(message, data);
}

function fail(msg, e) {
	logger.error(
		msg,
		e ? { error: e.message, type: e.type || "UNKNOWN" } : undefined,
	);
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

/** Default maximum character length for auto-generated excerpts */
const DEFAULT_EXCERPT_MAX_LENGTH = 160;

/**
 * Validate a git branch name to prevent shell injection
 * @param {string} branch - Branch name to validate
 * @returns {string} Validated branch name
 * @throws {Error} If branch name contains dangerous characters
 */
function validateBranchName(branch) {
	if (!branch) return "HEAD";
	// Git branch names cannot contain: space, ~, ^, :, ?, *, [, \, control chars
	// Also reject shell metacharacters: ; | & $ ` " ' ( ) { } < > # !
	const dangerousPattern = /[\s~^:?*[\]\\;|&$`"'(){}<>#!\x00-\x1f]/;
	if (dangerousPattern.test(branch)) {
		throw new Error(`Invalid branch name: contains dangerous characters`);
	}
	// Max length check (git has 255 char limit per component)
	if (branch.length > 255) {
		throw new Error(`Invalid branch name: too long (max 255 chars)`);
	}
	return branch;
}

/**
 * Get all markdown files from the posts directory
 * @returns {string[]} Array of absolute paths to markdown files
 */
function getAllMarkdown() {
	return fs.existsSync(POSTS_DIR) ? walk(POSTS_DIR, ".md") : [];
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
			.filter((f) => f.endsWith(".md") && f.startsWith("posts/"))
			.map((f) => path.join(REPO_ROOT, f));

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
		// Use execFileSync to avoid shell injection (BRANCH comes from env)
		const safeBranch = validateBranchName(BRANCH);
		execFileSync("git", ["fetch", "--depth=2", "origin", safeBranch], {
			stdio: "ignore",
		});

		// Try to get parent commit
		let parentCommit;
		try {
			parentCommit = execFileSync("git", ["rev-parse", "HEAD~1"], {
				encoding: "utf8",
				stdio: "pipe",
			}).trim();
			log(`Found parent commit: ${parentCommit.substring(0, 7)}...`);
		} catch (e) {
			log("No parent commit found, checking if this is the first commit...");
			// Check if we're at the root commit
			const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], {
				encoding: "utf8",
				stdio: "pipe",
			}).trim();
			const commitCount = execFileSync("git", ["rev-list", "--count", "HEAD"], {
				encoding: "utf8",
				stdio: "pipe",
			}).trim();

			if (commitCount === "1") {
				log(
					"This appears to be the first commit, processing all markdown files",
				);
				return getAllMarkdown();
			}
			throw new Error("Could not find parent commit");
		}

		const diff = execFileSync(
			"git",
			["diff", "--name-only", "HEAD~1", "HEAD", "--", `${POSTS_DIR}/**/*.md`],
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
		warn("git diff failed; trying alternative detection methods", { error: e.message });

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
				const markdownFiles = modifiedFiles.filter(
					(f) => f.startsWith(`${POSTS_DIR}/`) && f.endsWith(".md"),
				);
				if (markdownFiles.length > 0) {
					log(
						`Found ${markdownFiles.length} changed file(s) via GitHub event:`,
					);
					markdownFiles.forEach((f) => log(`  - ${f}`));
					return markdownFiles;
				}
			} catch (eventErr) {
				warn("Could not parse GitHub event data", { error: eventErr.message });
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

/**
 * Detect and convert space/tab-separated pseudo-tables to GFM table syntax
 * This handles cases where tables are formatted with spaces/tabs instead of pipes
 * @param {string} markdown - Raw markdown content
 * @returns {string} Markdown with pseudo-tables converted to GFM format
 */
function convertPseudoTablesToGfm(markdown) {
	const lines = markdown.split('\n');
	const result = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];

		// Check if this line could be the start of a pseudo-table
		// Must have multiple tab-separated or multi-space-separated values
		const tabColumns = line.split('\t').map(c => c.trim()).filter(Boolean);
		const spaceColumns = line.split(/\s{2,}/).map(c => c.trim()).filter(Boolean);

		// Use tab-separated if we have 3+ columns, otherwise try space-separated
		const columns = tabColumns.length >= 3 ? tabColumns : spaceColumns;
		const delimiter = tabColumns.length >= 3 ? '\t' : /\s{2,}/;

		// Need at least 3 columns and at least 2 rows to be considered a table
		if (columns.length >= 3) {
			// Look ahead to see if next lines have similar structure
			const tableLines = [{ line, columns }];
			let j = i + 1;

			while (j < lines.length) {
				const nextLine = lines[j];

				// Empty line or line that doesn't match pattern ends the potential table
				if (!nextLine.trim()) break;

				const nextTabCols = nextLine.split('\t').map(c => c.trim()).filter(Boolean);
				const nextSpaceCols = nextLine.split(/\s{2,}/).map(c => c.trim()).filter(Boolean);
				const nextColumns = tabColumns.length >= 3 ? nextTabCols : nextSpaceCols;

				// Check if column count is similar (within 1 to allow for empty cells)
				if (Math.abs(nextColumns.length - columns.length) <= 1 && nextColumns.length >= 2) {
					tableLines.push({ line: nextLine, columns: nextColumns });
					j++;
				} else {
					break;
				}
			}

			// If we have at least 2 lines with similar column structure, convert to GFM table
			if (tableLines.length >= 2) {
				// Determine the max column count
				const maxCols = Math.max(...tableLines.map(t => t.columns.length));

				// Convert to GFM format
				for (let k = 0; k < tableLines.length; k++) {
					const cols = tableLines[k].columns;
					// Pad columns to match max
					while (cols.length < maxCols) cols.push('');
					result.push('| ' + cols.join(' | ') + ' |');

					// Add header separator after first row
					if (k === 0) {
						result.push('| ' + cols.map(() => '---').join(' | ') + ' |');
					}
				}

				i = j;
				continue;
			}
		}

		// Not a pseudo-table, keep the line as-is
		result.push(line);
		i++;
	}

	return result.join('\n');
}

/**
 * Rehype plugin to add styling to tables for Webflow Rich Text compatibility
 * Adds inline styles to ensure tables display properly
 */
function rehypeStyleTables() {
	return (tree) => {
		const visit = (node) => {
			if (node.type === 'element') {
				if (node.tagName === 'table') {
					node.properties = node.properties || {};
					node.properties.style = 'width: 100%; border-collapse: collapse; margin: 1em 0;';
				} else if (node.tagName === 'th') {
					node.properties = node.properties || {};
					node.properties.style = 'border: 1px solid #ddd; padding: 8px 12px; text-align: left; background-color: #f5f5f5; font-weight: bold;';
				} else if (node.tagName === 'td') {
					node.properties = node.properties || {};
					node.properties.style = 'border: 1px solid #ddd; padding: 8px 12px; text-align: left;';
				}
			}
			if (node.children) {
				node.children.forEach(visit);
			}
		};
		visit(tree);
	};
}

async function mdToHtml(markdown) {
	// Convert pseudo-tables (tab/space-separated) to GFM format before processing
	const processedMarkdown = convertPseudoTablesToGfm(markdown);

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
		// Table element attributes for proper Webflow rendering
		table: ["className", "style"],
		th: ["scope", "align", "style"],
		td: ["align", "style"],
		tr: ["style"],
	};
	const file = await unified()
		.use(remarkParse)
		.use(remarkGfm)
		.use(remarkRehype, { allowDangerousHtml: false })
		.use(rehypeStyleTables)
		.use(rehypeSanitize, schema)
		.use(rehypeStringify)
		.process(processedMarkdown);
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

		// Handle absolute paths (starting with /) as repo-root-relative
		// Handle relative paths as relative to the markdown file's directory
		let repoRel;
		if (clean.startsWith("/")) {
			// Absolute path from repo root (e.g., /images/hero.png)
			repoRel = clean.slice(1); // Remove leading slash
		} else {
			// Relative path from markdown file location
			const absPath = path.normalize(path.join(fileDir, clean));
			// Make repo-root relative
			repoRel = path.relative(REPO_ROOT, absPath);
		}

		// If the image doesn't exist, try fallback into /images
		const fullPath = path.join(REPO_ROOT, repoRel);
		if (!fs.existsSync(fullPath)) {
			const baseName = path.basename(clean);
			const candidate = path.join(IMAGE_DIR, baseName);
			if (fs.existsSync(candidate)) {
				repoRel = path.relative(REPO_ROOT, candidate);
			}
		}

		const raw = resolveToRawUrl(repoRel);
		const rest = url.slice(clean.length); // preserve title if present
		return `![${alt}](${raw}${rest})`;
	});
}

function trimToExcerpt(html, max = DEFAULT_EXCERPT_MAX_LENGTH) {
	const text = html
		.replace(/<style[\s\S]*?<\/style>/g, "")
		.replace(/<script[\s\S]*?<\/script>/g, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return text.slice(0, max);
}

/**
 * Determine unique identifier for a post
 * Uses frontmatter `id` if present, otherwise generates from file path
 * @param {Object} fm - Frontmatter data
 * @param {string} filePath - Full path to the markdown file
 * @returns {string} Unique identifier
 */
function getUniqueId(fm, filePath) {
	// Use frontmatter id if present
	if (fm.id) {
		return String(fm.id);
	}

	// Generate stable ID from file path: filename without extension
	const relativePath = path.relative(POSTS_DIR, filePath);
	const baseName = path.basename(relativePath, path.extname(relativePath));
	return baseName;
}

/**
 * Fetch all Webflow items and build a cache for fast lookup
 * This is called once at startup instead of per-file lookups
 * Uses promise-based locking to prevent race conditions when called concurrently
 * @returns {Promise<{ byGithubId: Map<string, string>, bySlug: Map<string, string> }>} Cache with lookup maps
 */
async function fetchAllWebflowItems() {
	// If cache is already populated, return it
	if (webflowItemCache !== null) {
		log(`Using cached Webflow items (${webflowItemCache.byGithubId.size} by github-id, ${webflowItemCache.bySlug.size} by slug)`);
		return webflowItemCache;
	}

	// If population is in progress, wait for it (prevents race condition)
	if (cachePopulationPromise !== null) {
		log("Waiting for in-progress cache population...");
		return cachePopulationPromise;
	}

	// Start population and store the promise
	cachePopulationPromise = _populateCacheInternal();

	try {
		webflowItemCache = await cachePopulationPromise;
		return webflowItemCache;
	} finally {
		cachePopulationPromise = null;
	}
}

/**
 * Internal function to populate the Webflow item cache
 * @returns {Promise<{ byGithubId: Map<string, string>, bySlug: Map<string, string> }>} Cache object with maps
 * @private
 */
async function _populateCacheInternal() {
	log("Fetching all Webflow items for batch lookup...");
	const startTime = Date.now();

	const headers = {
		Authorization: `Bearer ${WEBFLOW_TOKEN}`,
		accept: "application/json",
	};

	const byGithubId = new Map();
	const bySlug = new Map();
	let offset = 0;
	const limit = 100; // Webflow API max limit

	while (true) {
		const url = `https://api.webflow.com/v2/collections/${COLLECTION_ID}/items?limit=${limit}&offset=${offset}`;

		const data = await retryWithBackoff(
			async () => {
				await rateLimiter.waitIfNeeded();
				const res = await fetch(url, { headers });

				if (!res.ok) {
					const text = await res.text();
					throw SyncError.fromFetchResponse(res, text, {
						operation: "fetchAllWebflowItems",
						offset,
					});
				}

				return await res.json();
			},
			{ context: { operation: "fetchAllWebflowItems", offset } },
		);

		const items = data.items || [];

		// Build caches: github-id -> webflow item id, slug -> webflow item id
		for (const item of items) {
			const githubId = item.fieldData?.[FIELD_IDS.githubId];
			if (githubId) {
				byGithubId.set(githubId, item.id);
			}
			// Also cache by slug for collision recovery
			const slug = item.fieldData?.[FIELD_IDS.slug];
			if (slug) {
				bySlug.set(slug, item.id);
			}
		}

		// Check if there are more items to fetch
		const pagination = data.pagination;
		if (!pagination || offset + limit >= pagination.total) {
			break;
		}

		offset += limit;
	}

	const duration = Date.now() - startTime;
	log(`Cached ${byGithubId.size} items by github-id, ${bySlug.size} items by slug in ${duration}ms`);

	return { byGithubId, bySlug };
}

/**
 * Reset the Webflow item cache (for testing)
 */
function resetWebflowItemCache() {
	webflowItemCache = null;
	cachePopulationPromise = null;
}

/**
 * Find Webflow item by github-id field using cached data
 * @param {string} githubId - The unique GitHub identifier to search for
 * @returns {Promise<string|null>} Webflow item ID if found, null otherwise
 */
async function findItemByGithubId(githubId) {
	if (!FIELD_IDS.githubId) {
		warn("github-id field not configured, skipping lookup");
		return null;
	}

	// Use cached lookup (cache should be pre-populated by main())
	const cache = await fetchAllWebflowItems();
	const itemId = cache.byGithubId.get(githubId);

	if (itemId) {
		log(`Found existing item by github-id (cached): ${itemId}`);
		return itemId;
	}

	return null;
}

/**
 * Find Webflow item by slug field using cached data
 * Used for recovering from slug collision errors during create
 * @param {string} slug - The slug to search for
 * @returns {Promise<string|null>} Webflow item ID if found, null otherwise
 */
async function findItemBySlug(slug) {
	if (!FIELD_IDS.slug) {
		warn("slug field not configured, skipping lookup");
		return null;
	}

	// Use cached lookup (cache should be pre-populated by main())
	const cache = await fetchAllWebflowItems();
	const itemId = cache.bySlug.get(slug);

	if (itemId) {
		log(`Found existing item by slug (cached): ${itemId}`);
		return itemId;
	}

	return null;
}

/**
 * Check if an error is a slug uniqueness collision from Webflow API
 * @param {Error} error - The error to check
 * @returns {{ isSlugCollision: boolean, slug: string|null }} Result with collision status and slug if found
 */
function isSlugCollisionError(error) {
	// Check if error message contains the Webflow validation error pattern
	const message = error?.message || "";

	// Match pattern: "Unique value is already in database: 'some-slug'"
	const slugMatch = message.match(/Unique value is already in database:\s*'([^']+)'/);
	if (slugMatch && message.includes('"param":"slug"')) {
		return { isSlugCollision: true, slug: slugMatch[1] };
	}

	// Also check for validation_error code with slug param
	if (message.includes("validation_error") && message.includes('"param":"slug"')) {
		// Try to extract slug from the message
		const altMatch = message.match(/'([^']+)'/);
		return { isSlugCollision: true, slug: altMatch ? altMatch[1] : null };
	}

	return { isSlugCollision: false, slug: null };
}

async function upsertWebflowItem({ fm, html, filePath, dryRun }) {
	const published = fm.published === true;
	const pushFlag = fm.push_to_webflow === true; // Must be explicitly true to sync

	if (!pushFlag) {
		log(`Skipping (push_to_webflow is not true): ${filePath}`);
		return null;
	}

	if (!published) {
		log(`Skipping (published is not true): ${filePath}`);
		return null;
	}
	if (!fm.title) throw new Error(`Missing required 'title' in ${filePath}`);

	log(`Processing: ${filePath}`);
	log(`  Title: ${fm.title}`);
	log(`  Published: ${published}`);
	log(`  Has post_id: ${Boolean(fm.post_id)}`);

	// Determine unique identifier for this post
	const githubId = getUniqueId(fm, filePath);
	log(`  GitHub ID: ${githubId}`);

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
		: trimToExcerpt(bodyHtml);
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
	if (FIELD_IDS.githubId) fieldData[FIELD_IDS.githubId] = githubId;
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
		log("(dry-run) UPSERT", { slug, hasPostId: Boolean(fm.post_id), githubId });
		log("(dry-run) Payload:", { payload });
		return null;
	}

	// Determine which Webflow item ID to use
	let webflowItemId = fm.post_id;

	// If no post_id, try to find existing item by github-id
	if (!webflowItemId) {
		log(
			`No post_id found, searching for existing item by github-id: ${githubId}`,
		);
		webflowItemId = await findItemByGithubId(githubId);
		if (webflowItemId) {
			log(`Found existing item by github-id, will update: ${webflowItemId}`);
		}
	}

	if (webflowItemId) {
		// Update existing
		log(`Updating existing Webflow item: ${webflowItemId}`);
		const url = `https://api.webflow.com/v2/collections/${COLLECTION_ID}/items/${encodeURIComponent(webflowItemId)}`;

		const data = await retryWithBackoff(
			async () => {
				await rateLimiter.waitIfNeeded();
				const res = await fetch(url, {
					method: "PATCH",
					headers,
					body: JSON.stringify(payload),
				});

				if (!res.ok) {
					const text = await res.text();
					throw SyncError.fromFetchResponse(res, text, {
						operation: "update",
						webflowItemId,
						filePath,
					});
				}

				return await res.json();
			},
			{ context: { operation: "update", webflowItemId, filePath } },
		);

		log(`Updated Webflow item ${webflowItemId} for ${filePath}`);
		log(`   Last Updated: ${data.lastUpdated || "N/A"} (system field)`);
		return webflowItemId;
	} else {
		// Create new
		log(`Creating new Webflow item for ${filePath}`);
		const createUrl = `https://api.webflow.com/v2/collections/${COLLECTION_ID}/items`;

		let itemId;

		try {
			// Note: HTTP 400 (slug collision) is classified as CLIENT_ERROR, which is not retryable
			// So if a slug collision occurs, it will throw immediately and we handle it below
			const data = await retryWithBackoff(
				async () => {
					await rateLimiter.waitIfNeeded();
					const res = await fetch(createUrl, {
						method: "POST",
						headers,
						body: JSON.stringify(payload),
					});

					if (!res.ok) {
						const text = await res.text();
						throw SyncError.fromFetchResponse(res, text, {
							operation: "create",
							filePath,
						});
					}

					return await res.json();
				},
				{ context: { operation: "create", filePath } },
			);

			itemId = data?.id || data?.item?.id; // depending on response shape
			log(`Created Webflow item ${itemId || "(unknown)"} for ${filePath}`);
			log(`   Created: ${data.createdOn || "N/A"} (system field)`);
			log(`   Last Updated: ${data.lastUpdated || "N/A"} (system field)`);
		} catch (createError) {
			// Check if this is a slug collision error
			const { isSlugCollision, slug: collisionSlug } = isSlugCollisionError(createError);

			if (!isSlugCollision) {
				// Not a slug collision, re-throw the original error
				throw createError;
			}

			// Slug collision detected - find existing item and update instead
			const slugToFind = collisionSlug || slug;
			log(`Slug collision detected for '${slugToFind}', attempting to find and update existing item...`);

			// Try to find the existing item by slug
			const existingItemId = await findItemBySlug(slugToFind);

			if (!existingItemId) {
				// Could not find the item - this shouldn't happen but handle gracefully
				warn(`Could not find existing item with slug '${slugToFind}' despite collision error`);
				warn(`This may indicate the item was created between cache fetch and now`);
				// Re-throw the original error since we can't recover
				throw createError;
			}

			// Update the existing item instead
			log(`Found existing item ${existingItemId}, updating instead of creating...`);

			const updateUrl = `https://api.webflow.com/v2/collections/${COLLECTION_ID}/items/${encodeURIComponent(existingItemId)}`;

			const updateData = await retryWithBackoff(
				async () => {
					await rateLimiter.waitIfNeeded();
					const res = await fetch(updateUrl, {
						method: "PATCH",
						headers,
						body: JSON.stringify(payload),
					});

					if (!res.ok) {
						const text = await res.text();
						throw SyncError.fromFetchResponse(res, text, {
							operation: "update-after-collision",
							webflowItemId: existingItemId,
							filePath,
						});
					}

					return await res.json();
				},
				{ context: { operation: "update-after-collision", webflowItemId: existingItemId, filePath } },
			);

			itemId = existingItemId;
			log(`Updated existing Webflow item ${itemId} after slug collision for ${filePath}`);
			log(`   Last Updated: ${updateData.lastUpdated || "N/A"} (system field)`);
		}

		// Emit repository_dispatch so a separate workflow can write back post_id
		// This is needed for both create and update-after-collision scenarios
		// since the markdown file doesn't have the post_id yet
		// Requires a token with repo:dispatch scope; usually GITHUB_TOKEN works in the same repo.
		// Failure behavior controlled by SYNC_WRITEBACK_FATAL env var
		try {
			await dispatchWriteback({
				path: filePath,
				itemId,
			});
		} catch (e) {
			const errorInfo = { filePath, itemId, error: e.message };
			failedWritebacks.push(errorInfo);
			if (WRITEBACK_FATAL) {
				logger.error(`repository_dispatch for writeback failed (fatal): ${e.message}`, errorInfo);
				throw e;
			}
			warn(`repository_dispatch for writeback failed (non-fatal): ${e.message}`);
			warn(`  -> post_id may not be written back; duplicate create possible on next sync`);
		}
		return itemId;
	}
}

/**
 * Publish item(s) to the live site
 * @param {string[]} itemIds - Array of Webflow item IDs to publish
 */
async function publishItems(itemIds) {
	if (!itemIds || itemIds.length === 0) return;

	const url = `https://api.webflow.com/v2/collections/${COLLECTION_ID}/items/publish`;
	const headers = {
		Authorization: `Bearer ${WEBFLOW_TOKEN}`,
		"Content-Type": "application/json",
		accept: "application/json",
	};

	const payload = { itemIds };

	const data = await retryWithBackoff(
		async () => {
			await rateLimiter.waitIfNeeded();
			const res = await fetch(url, {
				method: "POST",
				headers,
				body: JSON.stringify(payload),
			});

			if (!res.ok) {
				const text = await res.text();
				throw SyncError.fromFetchResponse(res, text, {
					operation: "publish",
					itemIds,
				});
			}

			return await res.json();
		},
		{ context: { operation: "publish", itemIds } },
	);

	log(`Published ${itemIds.length} item(s) to live site`);
	return data;
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

/**
 * Process a single markdown file and sync it to Webflow
 * Parses frontmatter, converts markdown to HTML, and upserts to Webflow CMS
 * @param {string} filePath - Absolute path to the markdown file
 * @param {object} opts - Processing options
 * @param {boolean} [opts.dryRun=false] - If true, skip Webflow API calls
 * @returns {Promise<string|null>} Webflow item ID if synced, null if skipped
 */
async function processFile(filePath, opts) {
	log(`\n--- Processing file: ${filePath} ---`);
	const src = await fs.promises.readFile(filePath, "utf8");
	const fm = matter(src);
	const fileDir = path.dirname(filePath);

	log(`Parsed frontmatter: ${Object.keys(fm.data).length} field(s)`);

	// Normalize booleans - handle strings from quoted YAML values
	// YAML 1.1 truthy: true, yes, on (case-insensitive), "1"
	// YAML 1.1 falsy: false, no, off (case-insensitive), "0", ""
	["published", "push_to_webflow"].forEach((k) => {
		if (k in fm.data) {
			const v = fm.data[k];
			if (typeof v === "string") {
				// Match YAML 1.1 boolean literals and numeric strings
				fm.data[k] = /^(true|yes|on|1)$/i.test(v.trim());
			} else if (typeof v === "number") {
				// Handle numeric values (rare but possible)
				fm.data[k] = v !== 0;
			}
			// Boolean values pass through unchanged
		}
	});

	// Rewrite relative images in markdown to commit-pinned raw URLs
	const mdWithRaw = rewriteImageLinksInMarkdown(fm.content, fileDir);
	const html = await mdToHtml(mdWithRaw);
	log(`Converted markdown to HTML (${html.length} chars)`);

	const itemId = await upsertWebflowItem({
		fm: fm.data,
		html,
		filePath,
		dryRun: opts.dryRun,
	});
	log(`✅ Completed processing: ${filePath}\n`);
	return itemId;
}

/**
 * Main entry point for the Webflow sync script
 * Processes markdown files and syncs them to Webflow CMS
 * Supports --all (sync all files) and --dry-run (preview changes) flags
 * @returns {Promise<void>}
 */
async function main() {
	log("=== Webflow Sync Script ===");

	// Set up graceful shutdown handling
	setupGracefulShutdown();

	// Set correlation ID for this run
	const correlationId =
		process.env.CORRELATION_ID || process.env.GITHUB_RUN_ID
			? `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT || 1}`
			: logger.getCorrelationId();
	logger.setCorrelationId(correlationId);
	auditLogger.setCorrelationId(correlationId);

	// Validate environment variables
	const envValidation = loadAndValidateEnv();

	// Log configuration (with redaction)
	log(`Repository: ${REPO || "(not set)"}`);
	log(`Commit SHA: ${COMMIT_SHA || "(not set)"}`);
	log(`Branch: ${BRANCH || "(not set)"}`);
	log(
		`Collection ID: ${COLLECTION_ID ? COLLECTION_ID.substring(0, 8) + "..." : "(not set)"}`,
	);
	log(
		`Webflow Token: ${WEBFLOW_TOKEN ? "***" + WEBFLOW_TOKEN.slice(-4) : "(not set)"}`,
	);
	log(`Correlation ID: ${correlationId}`);
	log("");

	// Report validation errors
	if (!envValidation.valid) {
		for (const error of envValidation.errors) {
			logger.error(`Configuration error: ${error}`);
		}
		fail("Environment validation failed");
		return;
	}

	// Report validation warnings
	for (const warning of envValidation.warnings) {
		warn(`Configuration warning: ${warning}`);
	}

	// Warn about missing repo in local development
	const isLocalDev = process.env.CI !== "true" && process.env.GITHUB_ACTIONS !== "true";
	if (isLocalDev && !REPO) {
		warn("GH_REPOSITORY not set - relative image paths will not be converted to GitHub URLs");
		warn("Add GH_REPOSITORY=owner/repo to .env.local for full local sync support");
	}

	const { all, dryRun } = parseArgs();

	if (dryRun) {
		log("DRY RUN MODE - No changes will be made to Webflow\n");
	}

	const files = all ? getAllMarkdown() : getChangedMarkdown();
	if (files.length === 0) {
		log(all ? "No markdown files found." : "No changed markdown files.");
		return;
	}
	log(`\nFound ${files.length} file(s) to process.\n`);

	// Pre-populate Webflow item cache for fast lookups (single API call vs per-file)
	if (!dryRun) {
		log("Pre-fetching Webflow items for batch lookup...");
		await fetchAllWebflowItems();
	}

	let successCount = 0;
	let errorCount = 0;

	// Process files in parallel with concurrency limit
	const processWithTracking = async (f) => {
		const startTime = Date.now();
		try {
			const itemId = await processFile(f, { dryRun });

			// Record successful operation in audit log
			auditLogger.recordOperation({
				type: "SYNC",
				filePath: f,
				status: "SUCCESS",
				durationMs: Date.now() - startTime,
				dryRun,
			});

			return { file: f, success: true, itemId };
		} catch (e) {
			fail(`Failed processing ${f}`, e);

			// Record failed operation in audit log
			auditLogger.recordOperation({
				type: "SYNC",
				filePath: f,
				status: "FAILED",
				error: sanitizeString(e.message),
				durationMs: Date.now() - startTime,
				dryRun,
			});

			return { file: f, success: false, error: e };
		}
	};

	// Process files in batches with concurrency control
	log(`Processing ${files.length} file(s) with concurrency limit of ${CONCURRENCY_LIMIT}...`);
	const results = [];
	let skippedDueToShutdown = 0;

	for (let i = 0; i < files.length; i += CONCURRENCY_LIMIT) {
		// Check for graceful shutdown before starting a new batch
		if (isShutdownRequested()) {
			skippedDueToShutdown = files.length - i;
			log(`\n⚠️ Shutdown requested, skipping remaining ${skippedDueToShutdown} file(s)`);
			break;
		}

		const batch = files.slice(i, i + CONCURRENCY_LIMIT);
		const batchNum = Math.floor(i / CONCURRENCY_LIMIT) + 1;
		const totalBatches = Math.ceil(files.length / CONCURRENCY_LIMIT);

		log(`\n--- Batch ${batchNum}/${totalBatches} (${batch.length} files) ---`);

		const batchResults = await Promise.all(batch.map(processWithTracking));
		results.push(...batchResults);
	}

	// Count results and collect item IDs for publishing
	const itemIdsToPublish = [];
	for (const result of results) {
		if (result.success) {
			successCount++;
			if (result.itemId) {
				itemIdsToPublish.push(result.itemId);
			}
		} else {
			errorCount++;
		}
	}

	// Publish all successfully synced items to the live site
	if (!dryRun && itemIdsToPublish.length > 0) {
		log(`\n--- Publishing ${itemIdsToPublish.length} item(s) to live site ---`);
		try {
			await publishItems(itemIdsToPublish);
			log("✅ Items published to live site");
		} catch (e) {
			fail("Failed to publish items to live site", e);
			errorCount++;
		}
	} else if (dryRun && itemIdsToPublish.length > 0) {
		log(`\n(dry-run) Would publish ${itemIdsToPublish.length} item(s) to live site`);
	}

	// Report failed writebacks
	if (failedWritebacks.length > 0) {
		log(`\n⚠️ Failed writebacks: ${failedWritebacks.length}`);
		for (const { filePath, itemId, error } of failedWritebacks) {
			log(`   - ${filePath} (itemId: ${itemId}): ${error}`);
		}
		log("   Note: These files may create duplicates on next sync. Run with --all after fixing.");
	}

	// Log summary
	const summary = auditLogger.getSummary();
	log("\n=== Summary ===");
	log(`Successfully processed: ${successCount}`);
	if (itemIdsToPublish.length > 0) {
		log(`Published to live site: ${itemIdsToPublish.length}`);
	}
	if (failedWritebacks.length > 0) {
		log(`Failed writebacks: ${failedWritebacks.length}`);
	}
	if (skippedDueToShutdown > 0) {
		log(`Skipped (shutdown requested): ${skippedDueToShutdown}`);
		process.exitCode = 130; // Standard exit code for SIGINT
	}
	if (errorCount > 0) {
		log(`Failed: ${errorCount}`);
		process.exitCode = 1;
	} else if (skippedDueToShutdown === 0) {
		log("All files processed successfully!");
	}
	logger.info("Sync complete", { ...summary, failedWritebacks: failedWritebacks.length, skippedDueToShutdown, shutdownReason });
}

// Only run main() when executed directly (not when imported for testing)
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
	main().catch((e) => fail("Unhandled error", e));
}

// Export functions for testing
export {
	kebab,
	trimToExcerpt,
	getUniqueId,
	mdToHtml,
	convertPseudoTablesToGfm,
	resolveToRawUrl,
	rewriteImageLinksInMarkdown,
	getAllMarkdown,
	parseArgs,
	main,
	fetchAllWebflowItems,
	resetWebflowItemCache,
	publishItems,
	validateBranchName,
	isShutdownRequested,
	isSlugCollisionError,
	findItemBySlug,
	CONCURRENCY_LIMIT,
};
