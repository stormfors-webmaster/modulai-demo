/**
 * Unit tests for lib/validators.js
 * Uses Node.js built-in test runner (node:test)
 */

import assert from "node:assert";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
	PATTERNS,
	isAllowedFieldSlug,
	loadAndValidateEnv,
	validateFieldLimits,
	validateImagePath,
	validateRepo,
} from "../../lib/validators.js";

describe("validateRepo()", () => {
	it("validates correct owner/repo format", () => {
		const result = validateRepo("owner/repo");
		assert.strictEqual(result.valid, true);
		assert.strictEqual(result.sanitized, "owner/repo");
	});

	it("validates repo with hyphens and underscores", () => {
		const result = validateRepo("my-org/my_repo-name");
		assert.strictEqual(result.valid, true);
	});

	it("validates repo with periods", () => {
		const result = validateRepo("my.org/repo.name");
		assert.strictEqual(result.valid, true);
	});

	it("rejects empty repo", () => {
		const result = validateRepo("");
		assert.strictEqual(result.valid, false);
		assert.ok(result.error.includes("required"));
	});

	it("rejects null repo", () => {
		const result = validateRepo(null);
		assert.strictEqual(result.valid, false);
	});

	it("rejects repo without slash", () => {
		const result = validateRepo("noslash");
		assert.strictEqual(result.valid, false);
		assert.ok(result.error.includes("owner/repo"));
	});

	it("rejects repo with special characters", () => {
		const result = validateRepo("owner/repo!@#");
		assert.strictEqual(result.valid, false);
	});

	it("rejects repo exceeding max length", () => {
		const longName = "a".repeat(101) + "/" + "b".repeat(101);
		const result = validateRepo(longName);
		assert.strictEqual(result.valid, false);
		assert.ok(result.error.includes("length"));
	});

	it("trims whitespace", () => {
		const result = validateRepo("  owner/repo  ");
		assert.strictEqual(result.valid, true);
		assert.strictEqual(result.sanitized, "owner/repo");
	});
});

describe("validateImagePath()", () => {
	it("allows null/empty path", () => {
		const result = validateImagePath(null);
		assert.strictEqual(result.valid, true);
	});

	it("allows absolute HTTPS URLs", () => {
		const result = validateImagePath("https://example.com/image.png");
		assert.strictEqual(result.valid, true);
	});

	it("allows trusted GitHub URLs", () => {
		const result = validateImagePath(
			"https://raw.githubusercontent.com/owner/repo/main/image.png",
		);
		assert.strictEqual(result.valid, true);
		assert.strictEqual(result.warning, undefined);
	});

	it("warns for untrusted hosts but still allows", () => {
		const result = validateImagePath("https://untrusted.com/image.png");
		assert.strictEqual(result.valid, true);
		assert.ok(result.warning?.includes("Untrusted"));
	});

	it("rejects path traversal attempts", () => {
		const result = validateImagePath("../../../etc/passwd");
		assert.strictEqual(result.valid, false);
		assert.ok(result.error.includes("traversal"));
	});

	it("rejects double dot sequences", () => {
		const result = validateImagePath("/images/../secrets/file.txt");
		assert.strictEqual(result.valid, false);
	});

	it("rejects null bytes", () => {
		const result = validateImagePath("/images/file\0.png");
		assert.strictEqual(result.valid, false);
		assert.ok(result.error.includes("Null byte"));
	});

	it("allows relative paths in images directory", () => {
		const result = validateImagePath("images/hero.png");
		assert.strictEqual(result.valid, true);
	});

	it("normalizes backslashes", () => {
		const result = validateImagePath("images\\hero.png");
		assert.strictEqual(result.valid, true);
		assert.strictEqual(result.sanitized, "images/hero.png");
	});

	it("normalizes double slashes", () => {
		const result = validateImagePath("images//hero.png");
		assert.strictEqual(result.valid, true);
		assert.strictEqual(result.sanitized, "images/hero.png");
	});

	it("rejects invalid URL format", () => {
		const result = validateImagePath("http://[invalid");
		assert.strictEqual(result.valid, false);
		assert.ok(result.error.includes("Invalid URL"));
	});
});

describe("validateFieldLimits()", () => {
	it("validates correct data", () => {
		const data = {
			title: "My Title",
			slug: "my-title",
			excerpt: "Short excerpt",
		};
		const result = validateFieldLimits(data);
		assert.strictEqual(result.valid, true);
		assert.strictEqual(result.errors.length, 0);
	});

	it("requires title", () => {
		const data = { slug: "no-title" };
		const result = validateFieldLimits(data);
		assert.strictEqual(result.valid, false);
		assert.ok(result.errors.some((e) => e.includes("title is required")));
	});

	it("rejects title exceeding limit", () => {
		const data = { title: "a".repeat(300) };
		const result = validateFieldLimits(data);
		assert.strictEqual(result.valid, false);
		assert.ok(result.errors.some((e) => e.includes("title exceeds")));
	});

	it("rejects invalid slug format", () => {
		const data = { title: "Test", slug: "Invalid Slug With Spaces" };
		const result = validateFieldLimits(data);
		assert.strictEqual(result.valid, false);
		assert.ok(result.errors.some((e) => e.includes("slug must be lowercase")));
	});

	it("allows valid slug format", () => {
		const data = { title: "Test", slug: "valid-slug-123" };
		const result = validateFieldLimits(data);
		assert.strictEqual(result.valid, true);
	});

	it("warns for long excerpt", () => {
		const data = { title: "Test", excerpt: "a".repeat(6000) };
		const result = validateFieldLimits(data);
		// Long excerpt is a warning, not an error
		assert.ok(result.warnings.some((w) => w.includes("excerpt exceeds")));
	});

	it("validates id format", () => {
		const data = { title: "Test", id: "valid_id-123" };
		const result = validateFieldLimits(data);
		assert.strictEqual(result.valid, true);
	});

	it("rejects invalid id format", () => {
		const data = { title: "Test", id: "invalid id with spaces" };
		const result = validateFieldLimits(data);
		assert.strictEqual(result.valid, false);
		assert.ok(result.errors.some((e) => e.includes("id must be")));
	});

	it("validates tags array", () => {
		const data = { title: "Test", tags: ["tag1", "tag2"] };
		const result = validateFieldLimits(data);
		assert.strictEqual(result.valid, true);
	});

	it("warns for too many tags", () => {
		const data = {
			title: "Test",
			tags: Array.from({ length: 30 }, (_, i) => `tag${i}`),
		};
		const result = validateFieldLimits(data);
		assert.ok(result.warnings.some((w) => w.includes("tags array exceeds")));
	});

	it("warns for long tag values", () => {
		const data = { title: "Test", tags: ["a".repeat(150)] };
		const result = validateFieldLimits(data);
		assert.ok(result.warnings.some((w) => w.includes("tags[0] exceeds")));
	});

	it("validates SEO fields", () => {
		const data = {
			title: "Test",
			seo: {
				title: "SEO Title",
				description: "SEO Description",
			},
		};
		const result = validateFieldLimits(data);
		assert.strictEqual(result.valid, true);
	});

	it("warns for long SEO description", () => {
		const data = {
			title: "Test",
			seo: { description: "a".repeat(600) },
		};
		const result = validateFieldLimits(data);
		assert.ok(
			result.warnings.some((w) => w.includes("seo.description exceeds")),
		);
	});
});

describe("isAllowedFieldSlug()", () => {
	it("allows known field slugs", () => {
		assert.strictEqual(isAllowedFieldSlug("name"), true);
		assert.strictEqual(isAllowedFieldSlug("slug"), true);
		assert.strictEqual(isAllowedFieldSlug("post-body"), true);
		assert.strictEqual(isAllowedFieldSlug("main-image"), true);
	});

	it("rejects unknown field slugs", () => {
		assert.strictEqual(isAllowedFieldSlug("unknown-field"), false);
		assert.strictEqual(isAllowedFieldSlug(""), false);
	});
});

describe("PATTERNS", () => {
	describe("WEBFLOW_TOKEN", () => {
		it("matches valid 64-char hex token", () => {
			const token = "a".repeat(64);
			assert.ok(PATTERNS.WEBFLOW_TOKEN.test(token));
		});

		it("rejects short token", () => {
			const token = "a".repeat(32);
			assert.strictEqual(PATTERNS.WEBFLOW_TOKEN.test(token), false);
		});

		it("rejects non-hex characters", () => {
			const token = "g".repeat(64);
			assert.strictEqual(PATTERNS.WEBFLOW_TOKEN.test(token), false);
		});
	});

	describe("WEBFLOW_ID", () => {
		it("matches valid 24-char hex ID", () => {
			const id = "a".repeat(24);
			assert.ok(PATTERNS.WEBFLOW_ID.test(id));
		});

		it("rejects wrong length", () => {
			assert.strictEqual(PATTERNS.WEBFLOW_ID.test("a".repeat(20)), false);
		});
	});

	describe("GITHUB_SHA", () => {
		it("matches valid 40-char hex SHA", () => {
			const sha = "abcdef1234567890abcdef1234567890abcdef12";
			assert.ok(PATTERNS.GITHUB_SHA.test(sha));
		});

		it("rejects short SHA", () => {
			assert.strictEqual(PATTERNS.GITHUB_SHA.test("abcdef"), false);
		});
	});
});

describe("loadAndValidateEnv()", () => {
	// Save original env
	const originalEnv = { ...process.env };

	beforeEach(() => {
		// Clear relevant env vars
		delete process.env.WEBFLOW_TOKEN;
		delete process.env.WEBFLOW_COLLECTION_ID;
		delete process.env.WEBFLOW_SITE_ID;
		delete process.env.GITHUB_TOKEN;
		delete process.env.GITHUB_REPOSITORY;
		delete process.env.GITHUB_SHA;
	});

	afterEach(() => {
		// Restore original env
		Object.assign(process.env, originalEnv);
	});

	it("reports missing required env vars", () => {
		const result = loadAndValidateEnv();
		assert.strictEqual(result.valid, false);
		assert.ok(result.errors.some((e) => e.includes("WEBFLOW_TOKEN")));
		assert.ok(result.errors.some((e) => e.includes("WEBFLOW_COLLECTION_ID")));
	});

	it("validates with correct env vars", () => {
		process.env.WEBFLOW_TOKEN = "a".repeat(64);
		process.env.WEBFLOW_COLLECTION_ID = "a".repeat(24);

		const result = loadAndValidateEnv();
		assert.strictEqual(result.valid, true);
		assert.strictEqual(result.config.webflowToken, process.env.WEBFLOW_TOKEN);
		assert.strictEqual(
			result.config.collectionId,
			process.env.WEBFLOW_COLLECTION_ID,
		);
	});

	it("reports invalid token format", () => {
		process.env.WEBFLOW_TOKEN = "invalid";
		process.env.WEBFLOW_COLLECTION_ID = "a".repeat(24);

		const result = loadAndValidateEnv();
		assert.strictEqual(result.valid, false);
		assert.ok(result.errors.some((e) => e.includes("WEBFLOW_TOKEN")));
	});

	it("warns for invalid GitHub repo format", () => {
		process.env.WEBFLOW_TOKEN = "a".repeat(64);
		process.env.WEBFLOW_COLLECTION_ID = "a".repeat(24);
		process.env.GITHUB_REPOSITORY = "invalid-format";

		const result = loadAndValidateEnv();
		// Should still be valid (GitHub vars are optional) but with warnings
		assert.strictEqual(result.valid, true);
		assert.ok(result.warnings.some((w) => w.includes("REPO")));
	});
});
