/**
 * Unit tests for sync-webflow.js
 * Uses Node.js built-in test runner (node:test)
 */

import assert from "node:assert";
import { beforeEach, describe, it, mock } from "node:test";
import {
	getUniqueId,
	kebab,
	parseArgs,
	trimToExcerpt,
} from "../../sync-webflow.js";

describe("kebab()", () => {
	it("converts simple string to kebab-case", () => {
		assert.strictEqual(kebab("Hello World"), "hello-world");
	});

	it("converts multiple words with spaces", () => {
		assert.strictEqual(kebab("This Is A Test"), "this-is-a-test");
	});

	it("removes special characters", () => {
		assert.strictEqual(kebab("Hello's World!"), "hellos-world");
	});

	it("removes quotes and punctuation", () => {
		assert.strictEqual(kebab('Testing "Quotes" Here'), "testing-quotes-here");
	});

	it("handles parentheses and brackets", () => {
		assert.strictEqual(kebab("Test (with) [brackets]"), "test-with-brackets");
	});

	it("handles empty string", () => {
		assert.strictEqual(kebab(""), "");
	});

	it("handles null/undefined", () => {
		assert.strictEqual(kebab(null), "");
		assert.strictEqual(kebab(undefined), "");
	});

	it("handles string with only special characters", () => {
		assert.strictEqual(kebab("!!!???"), "");
	});

	it("removes leading and trailing hyphens", () => {
		assert.strictEqual(kebab("  Hello World  "), "hello-world");
	});

	it("handles numbers", () => {
		assert.strictEqual(kebab("Test 123 Numbers"), "test-123-numbers");
	});

	it("collapses multiple hyphens", () => {
		assert.strictEqual(kebab("Hello   World"), "hello-world");
	});
});

describe("trimToExcerpt()", () => {
	it("strips HTML tags", () => {
		const html = "<p>Hello <strong>World</strong></p>";
		const result = trimToExcerpt(html, 160);
		assert.strictEqual(result, "Hello World");
	});

	it("respects max length", () => {
		const html = "<p>This is a very long text that should be trimmed.</p>";
		const result = trimToExcerpt(html, 10);
		assert.strictEqual(result.length, 10);
	});

	it("handles nested HTML", () => {
		const html = "<div><p>Nested <em>content</em> here</p></div>";
		const result = trimToExcerpt(html, 160);
		assert.strictEqual(result, "Nested content here");
	});

	it("handles empty string", () => {
		assert.strictEqual(trimToExcerpt("", 160), "");
	});

	it("handles HTML entities", () => {
		const html = "<p>Hello &amp; World</p>";
		const result = trimToExcerpt(html, 160);
		// HTML entities may or may not be decoded depending on implementation
		assert.ok(result.includes("Hello"));
		assert.ok(result.includes("World"));
	});

	it("preserves text when under limit", () => {
		const html = "<p>Short</p>";
		const result = trimToExcerpt(html, 160);
		assert.strictEqual(result, "Short");
	});
});

describe("getUniqueId()", () => {
	it("uses frontmatter id if provided", () => {
		const fm = { id: "custom-id" };
		const filePath = "/path/to/posts/test-post.md";
		const result = getUniqueId(fm, filePath);
		assert.strictEqual(result, "custom-id");
	});

	it("derives id from filename when not provided", () => {
		const fm = {};
		const filePath = "/path/to/posts/my-test-post.md";
		const result = getUniqueId(fm, filePath);
		// Should be derived from filename
		assert.ok(result.includes("my-test-post"));
	});

	it("handles nested paths", () => {
		const fm = {};
		const filePath = "/path/to/posts/2024/01/nested-post.md";
		const result = getUniqueId(fm, filePath);
		assert.ok(result.includes("nested-post"));
	});

	it("prefers explicit id over derived", () => {
		const fm = { id: "explicit-id" };
		const filePath = "/path/to/posts/different-name.md";
		const result = getUniqueId(fm, filePath);
		assert.strictEqual(result, "explicit-id");
	});
});

describe("parseArgs()", () => {
	// Save original argv
	const originalArgv = process.argv;

	beforeEach(() => {
		// Reset argv to default state
		process.argv = ["node", "sync-webflow.js"];
	});

	it("parses --all flag", () => {
		process.argv = ["node", "sync-webflow.js", "--all"];
		const args = parseArgs();
		assert.strictEqual(args.all, true);
		assert.strictEqual(args.dryRun, false);
	});

	it("parses --dry-run flag", () => {
		process.argv = ["node", "sync-webflow.js", "--dry-run"];
		const args = parseArgs();
		assert.strictEqual(args.all, false);
		assert.strictEqual(args.dryRun, true);
	});

	it("parses both flags", () => {
		process.argv = ["node", "sync-webflow.js", "--all", "--dry-run"];
		const args = parseArgs();
		assert.strictEqual(args.all, true);
		assert.strictEqual(args.dryRun, true);
	});

	it("defaults to false when no flags", () => {
		process.argv = ["node", "sync-webflow.js"];
		const args = parseArgs();
		assert.strictEqual(args.all, false);
		assert.strictEqual(args.dryRun, false);
	});

	// Restore argv after tests
	it.after = () => {
		process.argv = originalArgv;
	};
});
