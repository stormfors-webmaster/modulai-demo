#!/usr/bin/env node
/**
 * Delete the duplicate 'last-update' field from Webflow collection
 * This field duplicates Webflow's built-in 'lastUpdated' system field
 *
 * Note: This is optional - the field can remain but won't be synced
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

// Load .env.local
function loadEnv() {
	const envPath = path.join(rootDir, ".env.local");
	if (!fs.existsSync(envPath)) {
		throw new Error(`.env.local not found at ${envPath}`);
	}

	const env = {};
	const content = fs.readFileSync(envPath, "utf8");
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const [key, ...valueParts] = trimmed.split("=");
		if (key && valueParts.length > 0) {
			const value = valueParts.join("=").replace(/^["']|["']$/g, "");
			env[key.trim()] = value.trim();
		}
	}
	return env;
}

const env = loadEnv();
const WEBFLOW_TOKEN = env.WEBFLOW_TOKEN || env.WEBFLOW_API_KEY;
const WEBFLOW_COLLECTION_ID = env.WEBFLOW_COLLECTION_ID;

if (!WEBFLOW_TOKEN) {
	throw new Error("Missing WEBFLOW_TOKEN or WEBFLOW_API_KEY in .env.local");
}
if (!WEBFLOW_COLLECTION_ID) {
	throw new Error("Missing WEBFLOW_COLLECTION_ID in .env.local");
}

const FIELD_TO_DELETE = "last-update"; // Field slug to delete

async function getCollectionFields() {
	const url = `https://api.webflow.com/v2/collections/${WEBFLOW_COLLECTION_ID}`;
	const headers = {
		Authorization: `Bearer ${WEBFLOW_TOKEN}`,
		accept: "application/json",
	};

	const res = await fetch(url, { headers });
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Failed to fetch collection (${res.status}): ${text}`);
	}

	const data = await res.json();
	return data.fields || [];
}

async function deleteField(fieldId) {
	const url = `https://api.webflow.com/v2/collections/${WEBFLOW_COLLECTION_ID}/fields/${fieldId}`;
	const headers = {
		Authorization: `Bearer ${WEBFLOW_TOKEN}`,
		accept: "application/json",
	};

	const res = await fetch(url, {
		method: "DELETE",
		headers,
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Failed to delete field (${res.status}): ${text}`);
	}

	return res.status === 204 || res.status === 200;
}

function log(...a) {
	console.log("[delete-field]", ...a);
}
function warn(...a) {
	console.warn("[delete-field:warn]", ...a);
}
function fail(msg, e) {
	console.error("[delete-field:error]", msg);
	if (e) console.error(e?.stack || e);
	process.exit(1);
}

async function main() {
	try {
		log(`Looking for field: ${FIELD_TO_DELETE}`);
		const fields = await getCollectionFields();

		const field = fields.find((f) => f.slug === FIELD_TO_DELETE);

		if (!field) {
			log(
				`✅ Field '${FIELD_TO_DELETE}' not found - may have already been deleted.`,
			);
			return;
		}

		log(`Found field: ${field.displayName} (${field.slug})`);
		log(`Field ID: ${field.id}`);
		log(
			`\n⚠️  WARNING: This will permanently delete the field and all its data!`,
		);
		log(`   Field: ${field.displayName}`);
		log(`   Type: ${field.type}`);
		log(
			`\nThis field duplicates Webflow's built-in 'lastUpdated' system field.`,
		);
		log(`Webflow automatically tracks 'lastUpdated' for all items.`);
		log(`\nTo proceed, run with --confirm flag:`);
		log(`   node delete-field.js --confirm`);

		if (!process.argv.includes("--confirm")) {
			log("\n❌ Deletion cancelled. Use --confirm to proceed.");
			process.exit(0);
		}

		log("\nDeleting field...");
		await deleteField(field.id);
		log(`✅ Successfully deleted field '${FIELD_TO_DELETE}'`);
		log(`\n💡 Remember: Use Webflow's 'lastUpdated' system field instead.`);
		log(`   It's automatically maintained and available in API responses.`);
	} catch (e) {
		fail("Failed to delete field", e);
	}
}

main();
