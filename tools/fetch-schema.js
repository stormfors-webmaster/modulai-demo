#!/usr/bin/env node
/**
 * Fetch and display Webflow collection schema
 * Helps identify the correct field API IDs for mapping
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

async function fetchCollectionSchema() {
  const url = `https://api.webflow.com/v2/collections/${WEBFLOW_COLLECTION_ID}`;
  const headers = {
    "Authorization": `Bearer ${WEBFLOW_TOKEN}`,
    "accept": "application/json",
  };

  console.log(`Fetching collection schema for: ${WEBFLOW_COLLECTION_ID}\n`);

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch collection (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data;
}

function displaySchema(collection) {
  console.log("=".repeat(80));
  console.log(`Collection: ${collection.displayName || collection.name}`);
  console.log(`Slug: ${collection.slug}`);
  console.log("=".repeat(80));
  console.log("\nField Mappings (API ID -> Display Name):\n");

  if (!collection.fields || collection.fields.length === 0) {
    console.log("No fields found in collection.");
    return;
  }

  const fieldMap = {};
  collection.fields.forEach(field => {
    const apiId = field.id || field.slug;
    const slug = field.slug || field.id; // Field slug for v2 API
    const displayName = field.displayName || field.name || apiId;
    const type = field.type || "unknown";
    const isRequired = field.isRequired || false;
    
    fieldMap[apiId] = {
      slug,
      displayName,
      type,
      isRequired,
      field
    };

    console.log(`  ID: ${apiId.padEnd(30)} Slug: ${(slug || 'N/A').padEnd(20)} -> ${displayName} (${type})${isRequired ? " [REQUIRED]" : ""}`);
  });

  console.log("\n" + "=".repeat(80));
  console.log("\nSuggested FIELD_IDS configuration (using field slugs for v2 API):\n");
  console.log("const FIELD_IDS = {");
  
  // Try to match common field names
  const suggestions = {
    name: findFieldByPattern(fieldMap, ["name", "title"]),
    slug: findFieldByPattern(fieldMap, ["slug"]),
    body: findFieldByPattern(fieldMap, ["body", "content", "rich", "text"]),
    mainImage: findFieldByPattern(fieldMap, ["image", "main", "hero", "thumbnail"]),
    publishDate: findFieldByPattern(fieldMap, ["date", "publish", "published"]),
    authorText: findFieldByPattern(fieldMap, ["author", "writer"]),
    externalLink: findFieldByPattern(fieldMap, ["link", "url", "external"]),
    isPublished: findFieldByPattern(fieldMap, ["published", "publish", "status"]),
    pushToWebflow: findFieldByPattern(fieldMap, ["push", "sync", "webflow"]),
    postId: findFieldByPattern(fieldMap, ["id", "post_id", "webflow_id"]),
    lastUpdate: findFieldByPattern(fieldMap, ["update", "modified", "last"]),
    tags: findFieldByPattern(fieldMap, ["tag", "tags", "category"]),
    excerpt: findFieldByPattern(fieldMap, ["excerpt", "summary", "description"]),
    seoTitle: findFieldByPattern(fieldMap, ["seo", "meta", "title"]),
    seoDescription: findFieldByPattern(fieldMap, ["seo", "meta", "description"]),
  };

  Object.entries(suggestions).forEach(([key, apiId]) => {
    if (apiId && fieldMap[apiId]) {
      const slug = fieldMap[apiId].slug || apiId;
      console.log(`  ${key.padEnd(20)}: "${slug}", // ${fieldMap[apiId].displayName}`);
    } else {
      console.log(`  ${key.padEnd(20)}: null, // FIELD_NOT_FOUND - Add this field to your collection`);
    }
  });

  console.log("};\n");
  console.log("Note: Webflow v2 API uses field slugs in fieldData, not field IDs!");
  console.log("=".repeat(80));
}

function findFieldByPattern(fieldMap, patterns) {
  for (const [apiId, info] of Object.entries(fieldMap)) {
    const searchStr = `${apiId} ${info.displayName}`.toLowerCase();
    for (const pattern of patterns) {
      if (searchStr.includes(pattern.toLowerCase())) {
        return apiId;
      }
    }
  }
  return null;
}

async function main() {
  try {
    const collection = await fetchCollectionSchema();
    displaySchema(collection);
  } catch (e) {
    console.error("Error:", e.message);
    if (e.stack) console.error(e.stack);
    process.exit(1);
  }
}

main();

