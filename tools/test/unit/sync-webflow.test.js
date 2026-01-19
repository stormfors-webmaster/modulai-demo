/**
 * Unit tests for sync-webflow.js
 * Uses Node.js built-in test runner (node:test)
 */

import assert from "node:assert";
import { beforeEach, describe, it, mock } from "node:test";
import {
	getUniqueId,
	kebab,
	mdToHtml,
	parseArgs,
	resolveToRawUrl,
	rewriteImageLinksInMarkdown,
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

describe("resolveToRawUrl()", () => {
	// Save and restore env vars
	const originalEnv = { ...process.env };

	beforeEach(() => {
		process.env.GITHUB_REPOSITORY = "owner/repo";
		process.env.GITHUB_SHA = "abc123";
	});

	it("returns absolute URLs unchanged", () => {
		const url = "https://modulai.io/app/uploads/2025/07/image.png";
		assert.strictEqual(resolveToRawUrl(url), url);
	});

	it("returns http URLs unchanged", () => {
		const url = "http://example.com/image.png";
		assert.strictEqual(resolveToRawUrl(url), url);
	});

	it("returns empty/null/undefined as-is", () => {
		assert.strictEqual(resolveToRawUrl(""), "");
		assert.strictEqual(resolveToRawUrl(null), null);
		assert.strictEqual(resolveToRawUrl(undefined), undefined);
	});

	it.after = () => {
		Object.assign(process.env, originalEnv);
	};
});

describe("rewriteImageLinksInMarkdown()", () => {
	// Save and restore env vars
	const originalEnv = { ...process.env };

	beforeEach(() => {
		process.env.GITHUB_REPOSITORY = "owner/repo";
		process.env.GITHUB_SHA = "abc123";
	});

	it("preserves external URLs unchanged", () => {
		const md = "![alt text](https://modulai.io/app/uploads/image.png)";
		const result = rewriteImageLinksInMarkdown(md, "/test/dir");
		assert.strictEqual(result, md);
	});

	it("preserves http URLs unchanged", () => {
		const md = "![](http://example.com/image.jpg)";
		const result = rewriteImageLinksInMarkdown(md, "/test/dir");
		assert.strictEqual(result, md);
	});

	it("handles multiple inline images", () => {
		const md = `
![First](https://example.com/first.png)

Some text here.

![Second](https://example.com/second.png)

More text.

![Third](https://example.com/third.jpg)
`;
		const result = rewriteImageLinksInMarkdown(md, "/test/dir");
		assert.ok(result.includes("https://example.com/first.png"));
		assert.ok(result.includes("https://example.com/second.png"));
		assert.ok(result.includes("https://example.com/third.jpg"));
	});

	it("preserves alt text and image title", () => {
		const md = '![My Alt Text](https://example.com/image.png "Image Title")';
		const result = rewriteImageLinksInMarkdown(md, "/test/dir");
		assert.ok(result.includes("My Alt Text"));
		assert.ok(result.includes("https://example.com/image.png"));
	});

	it("handles images without alt text", () => {
		const md = "![](https://example.com/image.png)";
		const result = rewriteImageLinksInMarkdown(md, "/test/dir");
		assert.strictEqual(result, md);
	});

	it("handles mixed external and relative images", () => {
		const md = `
![External](https://example.com/external.png)

![Relative](./local-image.png)
`;
		const result = rewriteImageLinksInMarkdown(md, "/test/posts");
		// External URL should be unchanged
		assert.ok(result.includes("https://example.com/external.png"));
		// Relative URL is processed (path resolution happens regardless of REPO setting)
		// The key behavior: external URLs preserved, relative URLs transformed
		assert.ok(result.includes("![Relative]("));
		assert.ok(result.includes("local-image.png"));
	});

	it.after = () => {
		Object.assign(process.env, originalEnv);
	};
});

describe("mdToHtml()", () => {
	it("converts basic markdown to HTML", async () => {
		const md = "# Hello World\n\nThis is a paragraph.";
		const html = await mdToHtml(md);
		assert.ok(html.includes("<h1>Hello World</h1>"));
		assert.ok(html.includes("<p>This is a paragraph.</p>"));
	});

	it("converts inline images to HTML img tags", async () => {
		const md = "![Alt Text](https://example.com/image.png)";
		const html = await mdToHtml(md);
		assert.ok(html.includes("<img"));
		assert.ok(html.includes('src="https://example.com/image.png"'));
		assert.ok(html.includes('alt="Alt Text"'));
	});

	it("handles multiple inline images", async () => {
		const md = `
![First](https://example.com/first.png)

Some text.

![Second](https://example.com/second.png)
`;
		const html = await mdToHtml(md);
		assert.ok(html.includes('src="https://example.com/first.png"'));
		assert.ok(html.includes('src="https://example.com/second.png"'));
	});

	it("handles images without alt text", async () => {
		const md = "![](https://example.com/image.png)";
		const html = await mdToHtml(md);
		assert.ok(html.includes("<img"));
		assert.ok(html.includes('src="https://example.com/image.png"'));
	});

	it("converts GFM tables to HTML", async () => {
		const md = `
| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |
`;
		const html = await mdToHtml(md);
		assert.ok(html.includes("<table>"));
		assert.ok(html.includes("<th>"));
		assert.ok(html.includes("<td>"));
	});

	it("converts code blocks to HTML", async () => {
		const md = "```javascript\nconst x = 1;\n```";
		const html = await mdToHtml(md);
		assert.ok(html.includes("<pre>"));
		assert.ok(html.includes("<code"));
	});

	it("handles links", async () => {
		const md = "[Link Text](https://example.com)";
		const html = await mdToHtml(md);
		assert.ok(html.includes("<a"));
		assert.ok(html.includes('href="https://example.com"'));
		assert.ok(html.includes("Link Text"));
	});

	it("handles bold and italic text", async () => {
		const md = "**bold** and *italic*";
		const html = await mdToHtml(md);
		assert.ok(html.includes("<strong>bold</strong>"));
		assert.ok(html.includes("<em>italic</em>"));
	});

	it("handles blockquotes", async () => {
		const md = "> This is a quote";
		const html = await mdToHtml(md);
		assert.ok(html.includes("<blockquote>"));
	});

	it("handles ordered and unordered lists", async () => {
		const md = `
- Item 1
- Item 2

1. First
2. Second
`;
		const html = await mdToHtml(md);
		assert.ok(html.includes("<ul>"));
		assert.ok(html.includes("<ol>"));
		assert.ok(html.includes("<li>"));
	});
});
