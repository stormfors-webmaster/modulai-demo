#!/usr/bin/env node
/**
 * Clear all items from a Webflow CMS collection
 * Node 20+. Use with caution - this is a destructive operation.
 *
 * ENV (secrets in Actions):
 *  - WEBFLOW_TOKEN
 *  - WEBFLOW_COLLECTION_ID
 *
 * CLI:
 *  - --dry-run   Preview items to delete without making changes
 *  - --force     Required to actually delete items (safety measure)
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { logger, auditLogger } from "./lib/logger.js";
import { getGlobalRateLimiter } from "./lib/rate-limiter.js";
import { retryWithBackoff } from "./lib/retry.js";
import { loadEnvLocal, loadAndValidateEnv } from "./lib/validators.js";
import { SyncError, sanitizeString } from "./lib/errors.js";

// Load .env.local for local development (skipped in CI)
loadEnvLocal();

// ---------- Rate Limiting ----------
const rateLimiter = getGlobalRateLimiter();

// ---------- Config ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const COLLECTION_ID = process.env.WEBFLOW_COLLECTION_ID;
const WEBFLOW_TOKEN = process.env.WEBFLOW_TOKEN;

// ---------- Graceful Shutdown ----------
let isShuttingDown = false;

function setupGracefulShutdown() {
	const handleSignal = (signal) => {
		if (isShuttingDown) {
			logger.warn(`Received ${signal} again, forcing exit`);
			process.exit(1);
		}
		isShuttingDown = true;
		logger.warn(`Received ${signal}, waiting for in-progress operations to complete...`);
	};

	process.on("SIGINT", () => handleSignal("SIGINT"));
	process.on("SIGTERM", () => handleSignal("SIGTERM"));
}

/**
 * Parse and validate command-line arguments
 * @returns {{ dryRun: boolean, force: boolean }}
 */
function parseArgs() {
	const validArgs = new Set(["--dry-run", "--force"]);
	const args = process.argv.slice(2);

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
		dryRun: argsSet.has("--dry-run"),
		force: argsSet.has("--force"),
	};
}

/**
 * Fetch all items from a Webflow collection with pagination
 * @returns {Promise<Array<{id: string, name: string, slug: string}>>}
 */
async function fetchAllItems() {
	logger.info("Fetching all items from Webflow collection...");

	const headers = {
		Authorization: `Bearer ${WEBFLOW_TOKEN}`,
		accept: "application/json",
	};

	const items = [];
	let offset = 0;
	const limit = 100;

	while (true) {
		if (isShuttingDown) {
			logger.warn("Shutdown requested, stopping fetch");
			break;
		}

		const url = `https://api.webflow.com/v2/collections/${COLLECTION_ID}/items?limit=${limit}&offset=${offset}`;

		const data = await retryWithBackoff(
			async () => {
				await rateLimiter.waitIfNeeded();
				const res = await fetch(url, { headers });

				if (!res.ok) {
					const text = await res.text();
					throw SyncError.fromFetchResponse(res, text, {
						operation: "fetchAllItems",
						offset,
					});
				}

				return await res.json();
			},
			{ context: { operation: "fetchAllItems", offset } },
		);

		const pageItems = data.items || [];
		for (const item of pageItems) {
			items.push({
				id: item.id,
				name: item.fieldData?.name || "(no name)",
				slug: item.fieldData?.slug || "(no slug)",
			});
		}

		logger.info(`Fetched ${items.length} items so far...`);

		const pagination = data.pagination;
		if (!pagination || offset + limit >= pagination.total) {
			break;
		}

		offset += limit;
	}

	logger.info(`Total items found: ${items.length}`);
	return items;
}

/**
 * Delete a single item from Webflow
 * @param {string} itemId - Webflow item ID
 * @returns {Promise<boolean>} True if deleted successfully
 */
async function deleteItem(itemId) {
	const url = `https://api.webflow.com/v2/collections/${COLLECTION_ID}/items/${encodeURIComponent(itemId)}`;
	const headers = {
		Authorization: `Bearer ${WEBFLOW_TOKEN}`,
		accept: "application/json",
	};

	await retryWithBackoff(
		async () => {
			await rateLimiter.waitIfNeeded();
			const res = await fetch(url, {
				method: "DELETE",
				headers,
			});

			if (!res.ok) {
				const text = await res.text();
				throw SyncError.fromFetchResponse(res, text, {
					operation: "deleteItem",
					itemId,
				});
			}

			return true;
		},
		{ context: { operation: "deleteItem", itemId } },
	);

	return true;
}

/**
 * Main entry point
 */
async function main() {
	logger.info("=== Webflow Collection Clear Script ===");

	setupGracefulShutdown();

	// Set correlation ID
	const correlationId = process.env.CORRELATION_ID ||
		`clear-${Date.now()}`;
	logger.setCorrelationId(correlationId);
	auditLogger.setCorrelationId(correlationId);

	// Validate environment
	const envValidation = loadAndValidateEnv();

	logger.info(`Collection ID: ${COLLECTION_ID ? COLLECTION_ID.substring(0, 8) + "..." : "(not set)"}`);
	logger.info(`Webflow Token: ${WEBFLOW_TOKEN ? "***" + WEBFLOW_TOKEN.slice(-4) : "(not set)"}`);
	logger.info("");

	if (!envValidation.valid) {
		for (const error of envValidation.errors) {
			logger.error(`Configuration error: ${error}`);
		}
		process.exitCode = 1;
		return;
	}

	const { dryRun, force } = parseArgs();

	// Safety check: require --force flag to actually delete
	if (!dryRun && !force) {
		logger.error("SAFETY: You must use --force to actually delete items");
		logger.info("Use --dry-run to preview what would be deleted");
		logger.info("");
		logger.info("Examples:");
		logger.info("  npm run clear:dry      # Preview items to delete");
		logger.info("  npm run clear:force    # Actually delete all items");
		process.exitCode = 1;
		return;
	}

	if (dryRun) {
		logger.info("DRY RUN MODE - No items will be deleted\n");
	} else {
		logger.warn("FORCE MODE - Items will be permanently deleted!\n");
	}

	// Fetch all items
	const items = await fetchAllItems();

	if (items.length === 0) {
		logger.info("No items found in collection. Nothing to delete.");
		return;
	}

	// Show items to be deleted
	logger.info(`\nItems to ${dryRun ? "be deleted (dry-run)" : "delete"}:`);
	for (const item of items) {
		logger.info(`  - ${item.name} (${item.slug}) [${item.id}]`);
	}
	logger.info("");

	if (dryRun) {
		logger.info(`DRY RUN: Would delete ${items.length} item(s)`);
		logger.info("Run with --force to actually delete these items");
		return;
	}

	// Delete items
	let successCount = 0;
	let errorCount = 0;

	logger.info(`Deleting ${items.length} item(s)...`);

	for (const item of items) {
		if (isShuttingDown) {
			logger.warn("Shutdown requested, stopping deletion");
			break;
		}

		const startTime = Date.now();
		try {
			await deleteItem(item.id);
			successCount++;
			logger.info(`Deleted: ${item.name} (${item.slug})`);

			auditLogger.recordOperation({
				type: "DELETE",
				itemId: item.id,
				itemName: item.name,
				status: "SUCCESS",
				durationMs: Date.now() - startTime,
			});
		} catch (e) {
			errorCount++;
			logger.error(`Failed to delete ${item.name}: ${e.message}`);

			auditLogger.recordOperation({
				type: "DELETE",
				itemId: item.id,
				itemName: item.name,
				status: "FAILED",
				error: sanitizeString(e.message),
				durationMs: Date.now() - startTime,
			});
		}
	}

	// Summary
	logger.info("\n=== Summary ===");
	logger.info(`Successfully deleted: ${successCount}`);
	if (errorCount > 0) {
		logger.info(`Failed: ${errorCount}`);
		process.exitCode = 1;
	} else {
		logger.info("All items deleted successfully!");
	}
}

// Run main
main().catch((e) => {
	logger.error("Unhandled error", { error: e.message });
	process.exitCode = 1;
});
