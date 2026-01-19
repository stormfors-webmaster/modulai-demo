/**
 * Security validators for input sanitization
 * @module lib/validators
 */

// Strict patterns for environment variables
export const PATTERNS = {
	// GitHub repo: owner/repo format (alphanumeric, hyphens, underscores, periods)
	GITHUB_REPOSITORY: /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/,

	// Webflow token: 64 hex characters
	WEBFLOW_TOKEN: /^[a-f0-9]{64}$/i,

	// Webflow IDs: 24 hex characters (MongoDB ObjectId format)
	WEBFLOW_ID: /^[a-f0-9]{24}$/i,

	// GitHub SHA: 40 hex characters
	GITHUB_SHA: /^[a-f0-9]{40}$/i,

	// Branch names: alphanumeric, hyphens, underscores, slashes, periods
	GITHUB_REF_NAME: /^[a-zA-Z0-9_.\/-]+$/,

	// Safe file paths (no traversal)
	SAFE_PATH: /^(?!.*\.\.)(?!.*\/\/)[\w\-./]+$/,

	// Webflow field slugs: lowercase alphanumeric with hyphens
	FIELD_SLUG: /^[a-z0-9-]+$/,
};

// Whitelist of allowed Webflow field slugs
export const ALLOWED_FIELD_SLUGS = new Set([
	"name",
	"slug",
	"post-body",
	"main-image",
	"publish-date",
	"author",
	"link",
	"is-published",
	"push-to-webflow",
	"post-id",
	"github-id",
	"post-summary",
	"seo-title",
	"seo-description",
	"tags",
]);

// Trusted hosts for external image URLs
const TRUSTED_IMAGE_HOSTS = new Set([
	"raw.githubusercontent.com",
	"github.com",
	"user-images.githubusercontent.com",
	"avatars.githubusercontent.com",
	"images.unsplash.com",
	"cdn.pixabay.com",
]);

/**
 * Validate environment variable against pattern
 * @param {string} name - Environment variable name
 * @param {string} value - Value to validate
 * @param {RegExp} pattern - Validation pattern
 * @param {boolean} required - Whether the variable is required
 * @returns {{valid: boolean, error: string|null}}
 */
export function validateEnvVar(name, value, pattern, required = false) {
	if (!value) {
		if (required) {
			return { valid: false, error: `Missing required env: ${name}` };
		}
		return { valid: true, error: null };
	}

	if (!pattern.test(value)) {
		return {
			valid: false,
			error: `Invalid format for ${name}: does not match expected pattern`,
		};
	}

	return { valid: true, error: null };
}

/**
 * Validate REPO environment variable
 * @param {string} repo - Repository in owner/repo format
 * @returns {{valid: boolean, error: string|null, sanitized: string|null}}
 */
export function validateRepo(repo) {
	if (!repo) {
		return { valid: false, error: "REPO is required", sanitized: null };
	}

	const trimmed = String(repo).trim();

	if (!PATTERNS.GITHUB_REPOSITORY.test(trimmed)) {
		return {
			valid: false,
			error:
				"REPO must be in owner/repo format (alphanumeric, hyphens, underscores)",
			sanitized: null,
		};
	}

	// Additional length check
	if (trimmed.length > 200) {
		return {
			valid: false,
			error: "REPO exceeds maximum length",
			sanitized: null,
		};
	}

	return { valid: true, error: null, sanitized: trimmed };
}

/**
 * Validate and sanitize image path, preventing path traversal
 * @param {string} imagePath - Path to validate
 * @param {string} baseDir - Allowed base directory (unused but kept for API compatibility)
 * @returns {{valid: boolean, error: string|null, sanitized: string|null}}
 */
export function validateImagePath(imagePath, baseDir) {
	if (!imagePath) {
		return { valid: true, error: null, sanitized: null };
	}

	// If it's an absolute URL, validate the host
	if (/^https?:\/\//i.test(imagePath)) {
		try {
			const url = new URL(imagePath);
			if (!TRUSTED_IMAGE_HOSTS.has(url.hostname)) {
				// Allow but warn - don't block untrusted hosts entirely
				return {
					valid: true,
					error: null,
					sanitized: imagePath,
					warning: `Untrusted image host: ${url.hostname}`,
				};
			}
			return { valid: true, error: null, sanitized: imagePath };
		} catch {
			return { valid: false, error: "Invalid URL format", sanitized: null };
		}
	}

	// Check for path traversal attempts
	const normalized = imagePath
		.replace(/\\/g, "/") // Normalize backslashes
		.replace(/\/+/g, "/"); // Remove double slashes

	if (normalized.includes("..")) {
		return {
			valid: false,
			error: "Path traversal detected in image path",
			sanitized: null,
		};
	}

	// Check for null bytes
	if (normalized.includes("\0")) {
		return {
			valid: false,
			error: "Null byte detected in path",
			sanitized: null,
		};
	}

	// Validate path characters
	if (!PATTERNS.SAFE_PATH.test(normalized.replace(/^\.?\//, ""))) {
		return {
			valid: false,
			error: "Invalid characters in image path",
			sanitized: null,
		};
	}

	return { valid: true, error: null, sanitized: normalized };
}

/**
 * Validate Webflow field slug against whitelist
 * @param {string} slug - Field slug to validate
 * @returns {boolean}
 */
export function isAllowedFieldSlug(slug) {
	return ALLOWED_FIELD_SLUGS.has(slug);
}

/**
 * Validate and load all required environment variables
 * @returns {{valid: boolean, config: object, errors: string[], warnings: string[]}}
 */
export function loadAndValidateEnv() {
	const errors = [];
	const warnings = [];
	const config = {};

	// Webflow Token - 64 hex characters
	const token = process.env.WEBFLOW_TOKEN;
	if (!token) {
		errors.push("WEBFLOW_TOKEN is required");
	} else if (!/^[a-f0-9]{64}$/i.test(token)) {
		errors.push("WEBFLOW_TOKEN must be a 64-character hexadecimal string");
	} else {
		config.webflowToken = token;
	}

	// Collection ID - 24 hex characters (MongoDB ObjectId)
	const collectionId = process.env.WEBFLOW_COLLECTION_ID;
	if (!collectionId) {
		errors.push("WEBFLOW_COLLECTION_ID is required");
	} else if (!/^[a-f0-9]{24}$/i.test(collectionId)) {
		errors.push(
			"WEBFLOW_COLLECTION_ID must be a 24-character hexadecimal string",
		);
	} else {
		config.collectionId = collectionId;
	}

	// Site ID - 24 hex characters (optional)
	const siteId = process.env.WEBFLOW_SITE_ID;
	if (siteId) {
		if (!/^[a-f0-9]{24}$/i.test(siteId)) {
			warnings.push(
				"WEBFLOW_SITE_ID should be a 24-character hexadecimal string",
			);
		}
		config.siteId = siteId;
	}

	// GitHub Token (optional, used for repository_dispatch)
	const ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN_WITH_WRITE;
	if (ghToken) {
		// GitHub tokens start with specific prefixes
		const validPrefixes = ["ghp_", "gho_", "ghu_", "ghs_", "ghr_"];
		const hasValidPrefix = validPrefixes.some((p) => ghToken.startsWith(p));
		// Also allow classic tokens (40 hex chars)
		const isClassicToken = /^[a-f0-9]{40}$/i.test(ghToken);

		if (!hasValidPrefix && !isClassicToken) {
			warnings.push("GITHUB_TOKEN format may be invalid");
		}
		config.githubToken = ghToken;
	}

	// GitHub Repository (optional, auto-set in Actions)
	const repo = process.env.GITHUB_REPOSITORY || process.env.GH_REPOSITORY;
	if (repo) {
		const repoValidation = validateRepo(repo);
		if (!repoValidation.valid) {
			warnings.push(repoValidation.error);
		} else {
			config.repo = repoValidation.sanitized;
		}
	}

	// GitHub SHA (optional, auto-set in Actions)
	const sha = process.env.GITHUB_SHA;
	if (sha) {
		if (!/^[a-f0-9]{40}$/i.test(sha)) {
			warnings.push("GITHUB_SHA should be a 40-character hexadecimal string");
		}
		config.commitSha = sha;
	}

	// Branch name (optional)
	const branch = process.env.GITHUB_REF_NAME;
	if (branch) {
		if (!/^[a-zA-Z0-9_.\/-]+$/.test(branch) || branch.length > 250) {
			warnings.push(
				"GITHUB_REF_NAME contains invalid characters or is too long",
			);
		}
		config.branch = branch;
	}

	return {
		valid: errors.length === 0,
		config,
		errors,
		warnings,
	};
}

/**
 * Validate frontmatter field lengths against Webflow limits
 * @param {object} data - Frontmatter data
 * @returns {{valid: boolean, errors: string[], warnings: string[]}}
 */
export function validateFieldLimits(data) {
	const errors = [];
	const warnings = [];

	const limits = {
		title: { max: 256, required: true },
		slug: { max: 256, pattern: /^[a-z0-9-]+$/ },
		excerpt: { max: 5000 },
		author: { max: 256 },
		id: { max: 256, pattern: /^[a-zA-Z0-9_-]+$/ },
		"seo.title": { max: 256 },
		"seo.description": { max: 500 },
	};

	// Title
	if (!data.title) {
		errors.push("title is required");
	} else if (data.title.length > limits.title.max) {
		errors.push(`title exceeds ${limits.title.max} characters`);
	}

	// Slug format and length
	if (data.slug) {
		if (data.slug.length > limits.slug.max) {
			errors.push(`slug exceeds ${limits.slug.max} characters`);
		}
		if (!limits.slug.pattern.test(data.slug)) {
			errors.push("slug must be lowercase alphanumeric with hyphens only");
		}
	}

	// Excerpt length
	if (data.excerpt && data.excerpt.length > limits.excerpt.max) {
		warnings.push(`excerpt exceeds ${limits.excerpt.max} characters`);
	}

	// Author length
	if (data.author && data.author.length > limits.author.max) {
		errors.push(`author exceeds ${limits.author.max} characters`);
	}

	// ID format
	if (data.id) {
		if (data.id.length > limits.id.max) {
			errors.push(`id exceeds ${limits.id.max} characters`);
		}
		if (!limits.id.pattern.test(data.id)) {
			errors.push("id must be alphanumeric with underscores/hyphens only");
		}
	}

	// Tags validation
	if (data.tags && Array.isArray(data.tags)) {
		if (data.tags.length > 25) {
			warnings.push("tags array exceeds 25 items");
		}
		data.tags.forEach((tag, i) => {
			if (typeof tag === "string" && tag.length > 100) {
				warnings.push(`tags[${i}] exceeds 100 characters`);
			}
		});
	}

	// SEO fields
	if (data.seo) {
		if (data.seo.title && data.seo.title.length > limits["seo.title"].max) {
			warnings.push(`seo.title exceeds ${limits["seo.title"].max} characters`);
		}
		if (
			data.seo.description &&
			data.seo.description.length > limits["seo.description"].max
		) {
			warnings.push(
				`seo.description exceeds ${limits["seo.description"].max} characters`,
			);
		}
	}

	return {
		valid: errors.length === 0,
		errors,
		warnings,
	};
}
