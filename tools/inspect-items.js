#!/usr/bin/env node
/**
 * Inspect Webflow collection items
 * Shows the structure of items in the collection
 */

import { loadEnvLocal } from "./lib/validators.js";

// Load .env.local for local development (skipped in CI)
loadEnvLocal();

const WEBFLOW_TOKEN = process.env.WEBFLOW_TOKEN || process.env.WEBFLOW_API_KEY;
const WEBFLOW_COLLECTION_ID = process.env.WEBFLOW_COLLECTION_ID;

if (!WEBFLOW_TOKEN) {
	throw new Error("Missing WEBFLOW_TOKEN or WEBFLOW_API_KEY in .env.local");
}
if (!WEBFLOW_COLLECTION_ID) {
	throw new Error("Missing WEBFLOW_COLLECTION_ID in .env.local");
}

async function listItems(limit = 5) {
	const url = `https://api.webflow.com/v2/collections/${WEBFLOW_COLLECTION_ID}/items?limit=${limit}`;
	const headers = {
		Authorization: `Bearer ${WEBFLOW_TOKEN}`,
		accept: "application/json",
	};

	console.log(`Fetching items from collection: ${WEBFLOW_COLLECTION_ID}\n`);

	const res = await fetch(url, { headers });
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Failed to fetch items (${res.status}): ${text}`);
	}

	const data = await res.json();
	return data;
}

function displayItems(data) {
	console.log("=".repeat(80));
	console.log(
		`Total Items: ${data.pagination?.total || data.items?.length || 0}`,
	);
	console.log(`Items Returned: ${data.items?.length || 0}`);
	console.log("=".repeat(80));

	if (!data.items || data.items.length === 0) {
		console.log("\nNo items found in collection.");
		return;
	}

	data.items.forEach((item, index) => {
		console.log(`\n${"=".repeat(80)}`);
		console.log(
			`Item ${index + 1}: ${item.fieldData?.name || item.name || item.id}`,
		);
		console.log("=".repeat(80));
		console.log(`ID: ${item.id}`);
		console.log(`Slug: ${item.fieldData?.slug || item.slug || "N/A"}`);
		console.log(`Created: ${item.createdOn || "N/A"}`);
		console.log(`Updated: ${item.lastPublished || item.updatedOn || "N/A"}`);
		console.log(
			`Is Draft: ${item.isDraft !== undefined ? item.isDraft : "N/A"}`,
		);
		console.log(
			`Is Archived: ${item.isArchived !== undefined ? item.isArchived : "N/A"}`,
		);

		console.log("\nField Data:");
		if (item.fieldData) {
			Object.entries(item.fieldData).forEach(([key, value]) => {
				const displayValue =
					typeof value === "string" && value.length > 100
						? value.substring(0, 100) + "..."
						: value;
				console.log(`  ${key.padEnd(20)}: ${displayValue}`);
			});
		} else {
			console.log("  (No fieldData found)");
		}
	});

	console.log("\n" + "=".repeat(80));
}

async function main() {
	try {
		const data = await listItems(5);
		displayItems(data);
	} catch (e) {
		console.error("Error:", e.message);
		if (e.stack) console.error(e.stack);
		process.exit(1);
	}
}

main();
