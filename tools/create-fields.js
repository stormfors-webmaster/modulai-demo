#!/usr/bin/env node
/**
 * Create missing fields in Webflow collection
 * Adds fields that are referenced in the sync scripts but don't exist yet
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

// Field definitions to create
// Note: Field types must match Webflow API v2 specification
const FIELDS_TO_CREATE = [
  {
    displayName: "Publish Date",
    slug: "publish-date",
    type: "DateTime", // Webflow uses "DateTime" not "Date"
    isRequired: false,
    helpText: "Date when the post should be published"
  },
  {
    displayName: "Is Published",
    slug: "is-published",
    type: "Switch",
    isRequired: false,
    helpText: "Whether the post is published"
  },
  {
    displayName: "Push to Webflow",
    slug: "push-to-webflow",
    type: "Switch",
    isRequired: false,
    helpText: "Flag to control if this post should sync to Webflow"
  },
  {
    displayName: "Post ID",
    slug: "post-id",
    type: "PlainText",
    isRequired: false,
    helpText: "Stable identifier linking GitHub post to Webflow item"
  },
  {
    displayName: "Last Update",
    slug: "last-update",
    type: "DateTime", // Webflow uses "DateTime" not "Date"
    isRequired: false,
    helpText: "Timestamp of last update for conflict detection"
  },
  {
    displayName: "Tags",
    slug: "tags",
    type: "PlainText", // Using PlainText for now - can be comma-separated or JSON array
    isRequired: false,
    helpText: "Tags for categorizing posts (comma-separated)"
  },
  {
    displayName: "SEO Title",
    slug: "seo-title",
    type: "PlainText",
    isRequired: false,
    helpText: "Custom SEO title override"
  },
  {
    displayName: "SEO Description",
    slug: "seo-description",
    type: "PlainText",
    isRequired: false,
    helpText: "Custom SEO description override"
  }
];

async function createField(fieldDef) {
  const url = `https://api.webflow.com/v2/collections/${WEBFLOW_COLLECTION_ID}/fields`;
  const headers = {
    "Authorization": `Bearer ${WEBFLOW_TOKEN}`,
    "Content-Type": "application/json",
    "accept": "application/json",
  };

  const payload = {
    displayName: fieldDef.displayName,
    slug: fieldDef.slug,
    type: fieldDef.type,
    isRequired: fieldDef.isRequired || false,
    ...(fieldDef.helpText ? { helpText: fieldDef.helpText } : {})
  };

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create field ${fieldDef.slug} (${res.status}): ${text}`);
  }

  return await res.json();
}

async function checkExistingFields() {
  const url = `https://api.webflow.com/v2/collections/${WEBFLOW_COLLECTION_ID}`;
  const headers = {
    "Authorization": `Bearer ${WEBFLOW_TOKEN}`,
    "accept": "application/json",
  };

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch collection (${res.status}): ${text}`);
  }

  const data = await res.json();
  const existingSlugs = new Set(data.fields?.map(f => f.slug) || []);
  return existingSlugs;
}

function log(...a) { console.log("[create-fields]", ...a); }
function warn(...a) { console.warn("[create-fields:warn]", ...a); }
function fail(msg, e) {
  console.error("[create-fields:error]", msg);
  if (e) console.error(e?.stack || e);
  process.exit(1);
}

async function main() {
  try {
    log("Checking existing fields...");
    const existingSlugs = await checkExistingFields();
    
    const fieldsToCreate = FIELDS_TO_CREATE.filter(f => !existingSlugs.has(f.slug));
    
    if (fieldsToCreate.length === 0) {
      log("✅ All fields already exist in the collection!");
      return;
    }

    log(`\nFound ${fieldsToCreate.length} field(s) to create:\n`);
    fieldsToCreate.forEach(f => {
      log(`  - ${f.displayName} (${f.slug}) - ${f.type}`);
    });

    log("\nCreating fields...\n");

    for (const fieldDef of fieldsToCreate) {
      try {
        log(`Creating field: ${fieldDef.displayName} (${fieldDef.slug})...`);
        const result = await createField(fieldDef);
        log(`✅ Created: ${fieldDef.displayName}`);
        if (result.id) {
          log(`   Field ID: ${result.id}`);
        }
        if (result.slug) {
          log(`   Slug: ${result.slug}`);
        }
        log("");
      } catch (e) {
        warn(`Failed to create ${fieldDef.slug}: ${e.message}`);
        // Continue with other fields
      }
    }

    log("✅ Field creation complete!");
    log("\n💡 You may need to refresh your Webflow Designer to see the new fields.");
    
  } catch (e) {
    fail("Failed to create fields", e);
  }
}

main();

