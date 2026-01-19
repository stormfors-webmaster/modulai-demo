/**
 * Shared filesystem utility functions
 */

import fs from "node:fs";
import path from "node:path";

/**
 * Recursively walk a directory and return all files matching a pattern
 * @param {string} dir - Directory to walk
 * @param {string} [extension=".md"] - File extension to filter by
 * @returns {string[]} Array of file paths
 */
export function walk(dir, extension = ".md") {
	const out = [];
	for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, ent.name);
		if (ent.isDirectory()) {
			out.push(...walk(p, extension));
		} else if (ent.isFile() && p.endsWith(extension)) {
			out.push(p);
		}
	}
	return out;
}
