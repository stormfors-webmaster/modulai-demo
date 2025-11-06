#!/usr/bin/env node
/**
 * Cleanup script to archive or delete test posts
 * 
 * Usage:
 *   node cleanup-test-posts.js --archive  # Move to _archive folder
 *   node cleanup-test-posts.js --delete    # Delete files (dangerous!)
 *   node cleanup-test-posts.js --list      # Just list test files
 */

import fs from "node:fs";
import path from "node:path";

const POSTS_DIR = "posts";
const ARCHIVE_DIR = path.join(POSTS_DIR, "_archive");

// Test post patterns to identify
const TEST_PATTERNS = [
	/test/i,
	/Test/i,
	/final.*workflow/i,
	/end-to-end/i,
	/new-post/i, // Template file
];

function isTestPost(filename) {
	return TEST_PATTERNS.some((pattern) => pattern.test(filename));
}

function getAllPosts() {
	if (!fs.existsSync(POSTS_DIR)) {
		console.error(`Posts directory not found: ${POSTS_DIR}`);
		process.exit(1);
	}
	return fs
		.readdirSync(POSTS_DIR)
		.filter((f) => f.endsWith(".md"))
		.map((f) => path.join(POSTS_DIR, f));
}

function listTestPosts() {
	const allPosts = getAllPosts();
	const testPosts = allPosts.filter((file) =>
		isTestPost(path.basename(file)),
	);
	return testPosts;
}

function archivePosts(files) {
	if (!fs.existsSync(ARCHIVE_DIR)) {
		fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
		console.log(`Created archive directory: ${ARCHIVE_DIR}`);
	}

	for (const file of files) {
		const basename = path.basename(file);
		const dest = path.join(ARCHIVE_DIR, basename);
		fs.renameSync(file, dest);
		console.log(`Archived: ${file} → ${dest}`);
	}
}

function deletePosts(files) {
	for (const file of files) {
		fs.unlinkSync(file);
		console.log(`Deleted: ${file}`);
	}
}

// Main
async function main() {
	const args = process.argv.slice(2);
	const mode = args[0];

	const testPosts = listTestPosts();

	if (testPosts.length === 0) {
		console.log("No test posts found.");
		process.exit(0);
	}

	console.log(`Found ${testPosts.length} test post(s):`);
	testPosts.forEach((f) => console.log(`  - ${f}`));

	if (mode === "--list") {
		console.log("\nUse --archive to move these files to _archive/");
		console.log("Use --delete to permanently delete them");
	} else if (mode === "--archive") {
		console.log("\nArchiving test posts...");
		archivePosts(testPosts);
		console.log(`✅ Archived ${testPosts.length} file(s) to ${ARCHIVE_DIR}`);
	} else if (mode === "--delete") {
		console.log("\n⚠️  WARNING: This will permanently delete test posts!");
		console.log("Press Ctrl+C to cancel, or wait 5 seconds...");
		await new Promise((resolve) => setTimeout(resolve, 5000));
		deletePosts(testPosts);
		console.log(`✅ Deleted ${testPosts.length} file(s)`);
	} else {
		console.error("Usage: node cleanup-test-posts.js [--list|--archive|--delete]");
		process.exit(1);
	}
}

main().catch((e) => {
	console.error("Error:", e);
	process.exit(1);
});

