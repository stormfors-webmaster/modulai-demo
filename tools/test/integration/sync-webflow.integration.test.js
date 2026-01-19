/**
 * Integration tests for sync-webflow.js
 * Uses Node.js built-in test runner (node:test)
 *
 * These tests mock external APIs (Webflow, GitHub) to test
 * the full orchestration flow without making real HTTP requests.
 */

import assert from "node:assert";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Store original values for restoration
let originalFetch;
let originalEnv;

// Helper to create mock fetch response
function mockResponse(body, status = 200, headers = {}) {
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: new Map(Object.entries(headers)),
		json: async () => body,
		text: async () => JSON.stringify(body),
	};
}

// Helper to create a Webflow items response
function createWebflowItemsResponse(items = [], total = null) {
	return {
		items: items.map((item, index) => ({
			id: item.id || `item-${index}`,
			fieldData: {
				name: item.name || `Test Item ${index}`,
				slug: item.slug || `test-item-${index}`,
				"github-id": item.githubId || null,
				...item.fieldData,
			},
		})),
		pagination: {
			total: total !== null ? total : items.length,
		},
	};
}

describe("Integration Tests: retry.js utilities", () => {
	describe("withTimeout()", () => {
		it("should clear timeout when operation completes before timeout", async () => {
			// Dynamically import to get fresh module state
			const { withTimeout } = await import("../../lib/retry.js");

			const result = await withTimeout(
				async () => {
					return "success";
				},
				5000, // 5 second timeout
				"Should not timeout",
			);

			assert.strictEqual(result, "success");
			// If the fix works, no lingering timer should exist
			// (We can't directly test this, but we verify the function works)
		});

		it("should throw SyncError when operation times out", async () => {
			const { withTimeout } = await import("../../lib/retry.js");

			await assert.rejects(
				async () => {
					await withTimeout(
						async () => {
							// Simulate slow operation
							await new Promise((resolve) => setTimeout(resolve, 200));
							return "too late";
						},
						50, // 50ms timeout
						"Test timeout message",
					);
				},
				(error) => {
					assert.strictEqual(error.message, "Test timeout message");
					assert.strictEqual(error.type, "RETRYABLE_NETWORK");
					return true;
				},
			);
		});

		it("should propagate errors from the wrapped function", async () => {
			const { withTimeout } = await import("../../lib/retry.js");

			await assert.rejects(
				async () => {
					await withTimeout(
						async () => {
							throw new Error("Inner error");
						},
						5000,
						"Timeout message",
					);
				},
				(error) => {
					assert.strictEqual(error.message, "Inner error");
					return true;
				},
			);
		});
	});

	describe("batchWithConcurrency()", () => {
		it("should return all results when all operations succeed", async () => {
			const { batchWithConcurrency } = await import("../../lib/retry.js");

			const items = [1, 2, 3, 4, 5];
			const results = await batchWithConcurrency(
				items,
				async (item) => item * 2,
				3,
			);

			assert.deepStrictEqual(results, [2, 4, 6, 8, 10]);
		});

		it("should throw AggregateError when any operations fail", async () => {
			const { batchWithConcurrency } = await import("../../lib/retry.js");

			const items = [1, 2, 3, 4, 5];

			await assert.rejects(
				async () => {
					await batchWithConcurrency(
						items,
						async (item) => {
							if (item === 2 || item === 4) {
								throw new Error(`Failed on ${item}`);
							}
							return item * 2;
						},
						3,
					);
				},
				(error) => {
					assert.ok(
						error instanceof AggregateError,
						"Should throw AggregateError",
					);
					assert.strictEqual(
						error.errors.length,
						2,
						"Should have 2 errors",
					);
					assert.ok(
						error.message.includes("2 of 5 operations failed"),
						"Message should indicate failure count",
					);
					// Check partial results are attached
					assert.ok(
						Array.isArray(error.results),
						"Should have results array",
					);
					assert.strictEqual(error.results[0], 2, "First result should be 2");
					assert.strictEqual(
						error.results[1],
						undefined,
						"Second result should be undefined (failed)",
					);
					assert.strictEqual(error.results[2], 6, "Third result should be 6");
					assert.strictEqual(
						error.results[3],
						undefined,
						"Fourth result should be undefined (failed)",
					);
					assert.strictEqual(error.results[4], 10, "Fifth result should be 10");
					return true;
				},
			);
		});

		it("should respect concurrency limit", async () => {
			const { batchWithConcurrency } = await import("../../lib/retry.js");

			const items = [1, 2, 3, 4, 5, 6];
			let maxConcurrent = 0;
			let currentConcurrent = 0;

			await batchWithConcurrency(
				items,
				async (item) => {
					currentConcurrent++;
					maxConcurrent = Math.max(maxConcurrent, currentConcurrent);

					// Simulate async work
					await new Promise((resolve) => setTimeout(resolve, 10));

					currentConcurrent--;
					return item;
				},
				2, // Limit to 2 concurrent
			);

			assert.ok(
				maxConcurrent <= 2,
				`Max concurrent should be 2, got ${maxConcurrent}`,
			);
		});

		it("should maintain order of results", async () => {
			const { batchWithConcurrency } = await import("../../lib/retry.js");

			const items = [5, 1, 4, 2, 3];
			const results = await batchWithConcurrency(
				items,
				async (item) => {
					// Variable delay to potentially reorder completion
					await new Promise((resolve) =>
						setTimeout(resolve, Math.random() * 20),
					);
					return item * 10;
				},
				3,
			);

			// Results should be in same order as input items
			assert.deepStrictEqual(results, [50, 10, 40, 20, 30]);
		});
	});
});

describe("Integration Tests: sync-webflow.js cache", () => {
	beforeEach(() => {
		originalFetch = globalThis.fetch;
		originalEnv = { ...process.env };

		// Set required environment variables
		process.env.WEBFLOW_TOKEN = "a".repeat(64);
		process.env.WEBFLOW_COLLECTION_ID = "a".repeat(24);
		process.env.GITHUB_REPOSITORY = "owner/repo";
		process.env.GITHUB_SHA = "abc123def456".padEnd(40, "0");
	});

	afterEach(async () => {
		globalThis.fetch = originalFetch;
		process.env = originalEnv;

		// Reset cache state
		try {
			const { resetWebflowItemCache } = await import("../../sync-webflow.js");
			resetWebflowItemCache();
		} catch (e) {
			// Ignore if module not loaded
		}
	});

	it("should use cached items on subsequent calls", async () => {
		let fetchCallCount = 0;

		globalThis.fetch = async (url) => {
			fetchCallCount++;
			return mockResponse(createWebflowItemsResponse([{ githubId: "test-1" }]));
		};

		// Fresh import to reset module state
		const module = await import(
			`../../sync-webflow.js?t=${Date.now()}-cache-test`
		);

		// First call should fetch
		await module.fetchAllWebflowItems();
		const firstFetchCount = fetchCallCount;

		// Second call should use cache
		await module.fetchAllWebflowItems();

		assert.strictEqual(
			fetchCallCount,
			firstFetchCount,
			"Should not make additional API calls when using cache",
		);

		// Reset cache
		module.resetWebflowItemCache();

		// Third call after reset should fetch again
		await module.fetchAllWebflowItems();
		assert.ok(
			fetchCallCount > firstFetchCount,
			"Should fetch again after cache reset",
		);
	});

	it("resetWebflowItemCache should clear cache state", async () => {
		let fetchCallCount = 0;

		globalThis.fetch = async () => {
			fetchCallCount++;
			return mockResponse(createWebflowItemsResponse([{ githubId: "test-1" }]));
		};

		const module = await import(
			`../../sync-webflow.js?t=${Date.now()}-reset-test`
		);

		// First fetch
		await module.fetchAllWebflowItems();
		const afterFirst = fetchCallCount;

		// Reset and fetch again
		module.resetWebflowItemCache();
		await module.fetchAllWebflowItems();

		assert.ok(
			fetchCallCount > afterFirst,
			"Should refetch after cache reset",
		);
	});
});

describe("Integration Tests: error handling patterns", () => {
	beforeEach(() => {
		originalFetch = globalThis.fetch;
		originalEnv = { ...process.env };

		process.env.WEBFLOW_TOKEN = "a".repeat(64);
		process.env.WEBFLOW_COLLECTION_ID = "a".repeat(24);
		process.env.GITHUB_REPOSITORY = "owner/repo";
		process.env.GITHUB_SHA = "abc123def456".padEnd(40, "0");
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		process.env = originalEnv;
	});

	it("should collect all errors from AggregateError for reporting", async () => {
		const { batchWithConcurrency } = await import("../../lib/retry.js");

		const operations = ["file1.md", "file2.md", "file3.md", "file4.md"];
		const errors = [];

		try {
			await batchWithConcurrency(
				operations,
				async (file) => {
					if (file === "file2.md" || file === "file4.md") {
						throw new Error(`Failed to process ${file}`);
					}
					return { file, status: "success" };
				},
				2,
			);
		} catch (error) {
			if (error instanceof AggregateError) {
				// Collect all individual errors for reporting
				for (const e of error.errors) {
					errors.push(e.message);
				}
			}
		}

		assert.strictEqual(errors.length, 2);
		assert.ok(errors.some((e) => e.includes("file2.md")));
		assert.ok(errors.some((e) => e.includes("file4.md")));
	});

	it("should access partial results from AggregateError", async () => {
		const { batchWithConcurrency } = await import("../../lib/retry.js");

		const items = ["a", "b", "c", "d"];
		let partialResults = [];
		let errorCount = 0;

		try {
			await batchWithConcurrency(
				items,
				async (item) => {
					if (item === "b") {
						throw new Error("B failed");
					}
					return item.toUpperCase();
				},
				2,
			);
		} catch (error) {
			if (error instanceof AggregateError) {
				partialResults = error.results;
				errorCount = error.errors.length;
			}
		}

		assert.strictEqual(errorCount, 1);
		assert.deepStrictEqual(partialResults, ["A", undefined, "C", "D"]);
	});
});

describe("Integration Tests: concurrent cache population", () => {
	beforeEach(() => {
		originalFetch = globalThis.fetch;
		originalEnv = { ...process.env };

		process.env.WEBFLOW_TOKEN = "a".repeat(64);
		process.env.WEBFLOW_COLLECTION_ID = "a".repeat(24);
		process.env.GITHUB_REPOSITORY = "owner/repo";
		process.env.GITHUB_SHA = "abc123def456".padEnd(40, "0");
	});

	afterEach(async () => {
		globalThis.fetch = originalFetch;
		process.env = originalEnv;

		try {
			const { resetWebflowItemCache } = await import("../../sync-webflow.js");
			resetWebflowItemCache();
		} catch (e) {
			// Ignore
		}
	});

	it("should only make one API call when called concurrently (race condition fix)", async () => {
		let fetchCallCount = 0;

		globalThis.fetch = async () => {
			fetchCallCount++;
			// Simulate slow API response to allow concurrent calls to queue up
			await new Promise((resolve) => setTimeout(resolve, 50));
			return mockResponse(
				createWebflowItemsResponse([
					{ githubId: "item-1" },
					{ githubId: "item-2" },
				]),
			);
		};

		const module = await import(
			`../../sync-webflow.js?t=${Date.now()}-concurrent-test`
		);

		// Make 5 concurrent calls
		const results = await Promise.all([
			module.fetchAllWebflowItems(),
			module.fetchAllWebflowItems(),
			module.fetchAllWebflowItems(),
			module.fetchAllWebflowItems(),
			module.fetchAllWebflowItems(),
		]);

		// All calls should return the same cache instance
		for (const result of results) {
			assert.strictEqual(result, results[0], "All calls should return same Map instance");
		}

		// Only one API call should have been made
		assert.strictEqual(
			fetchCallCount,
			1,
			`Expected 1 API call but got ${fetchCallCount} - race condition may exist`,
		);
	});
});
