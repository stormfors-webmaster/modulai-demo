#!/usr/bin/env node

/**
 * Fetch a blog post from modulai.io and prepare it for the /posts directory.
 *
 * Usage:
 *   node fetch-modulai-post.js <url> [--save]
 *
 * Options:
 *   --save    Save the markdown file and images directly (otherwise outputs JSON)
 *
 * Examples:
 *   node fetch-modulai-post.js https://modulai.io/blog/my-post/
 *   node fetch-modulai-post.js https://modulai.io/blog/my-post/ --save
 */

import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const POSTS_DIR = path.join(REPO_ROOT, "posts");
const IMAGES_DIR = path.join(REPO_ROOT, "images");

/**
 * Extract slug from modulai URL
 */
function extractSlug(url) {
	const match = url.match(/\/blog\/([^/]+)\/?$/);
	return match ? match[1] : null;
}

/**
 * Parse HTML content and extract blog post data
 */
function parseHtmlContent(html, url) {
	const post = {
		title: "",
		date: "",
		author: "",
		excerpt: "",
		content: "",
		featuredImage: null,
		images: [],
		tags: [],
	};

	// Extract title from og:title or <title>
	const ogTitleMatch = html.match(
		/<meta\s+property="og:title"\s+content="([^"]+)"/i
	);
	const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
	let rawTitle = ogTitleMatch?.[1] || titleMatch?.[1] || "";
	// Clean up title - remove site suffix
	post.title = rawTitle.replace(/\s*[-–|]\s*[Mm]odulai.*$/i, "").trim();

	// Extract date from article:published_time or datePublished
	const publishedMatch = html.match(
		/<meta\s+property="article:published_time"\s+content="([^"]+)"/i
	);
	const datePublishedMatch = html.match(/"datePublished"\s*:\s*"([^"]+)"/);
	const dateStr = publishedMatch?.[1] || datePublishedMatch?.[1] || "";
	if (dateStr) {
		post.date = dateStr.split("T")[0]; // Extract YYYY-MM-DD
	}

	// Extract author - try multiple sources
	const authorMatch = html.match(
		/<meta\s+name="author"\s+content="([^"]+)"/i
	);
	const authorJsonMatch = html.match(/"author"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/);
	// modulai.io specific: look for "Authors:" section followed by author names
	const authorsListMatch = html.match(
		/Authors:\s*[\s\S]*?<li[^>]*>\s*-?\s*([^<\n]+)/i
	);
	// Also try hero subheader which often contains author name
	const heroAuthorMatch = html.match(
		/<p[^>]*class="[^"]*hero-subheader[^"]*"[^>]*>[\s\S]*?Written by\s*([^<]+)/i
	);
	post.author = authorMatch?.[1] || authorJsonMatch?.[1] || authorsListMatch?.[1]?.trim() || heroAuthorMatch?.[1]?.trim() || "";

	// Extract description/excerpt
	const descMatch = html.match(
		/<meta\s+property="og:description"\s+content="([^"]+)"/i
	);
	const metaDescMatch = html.match(
		/<meta\s+name="description"\s+content="([^"]+)"/i
	);
	post.excerpt = descMatch?.[1] || metaDescMatch?.[1] || "";

	// Extract featured image
	const ogImageMatch = html.match(
		/<meta\s+property="og:image"\s+content="([^"]+)"/i
	);
	if (ogImageMatch?.[1]) {
		post.featuredImage = ogImageMatch[1];
		post.images.push({
			url: ogImageMatch[1],
			type: "featured",
		});
	}

	// Extract article content - look for the main content area
	// modulai.io uses WordPress with custom theme structure
	let contentHtml = "";

	// Try multiple patterns for modulai.io's structure
	const patterns = [
		// modulai.io specific: content div inside article-wrapper
		/<div[^>]*class="content"[^>]*>([\s\S]*?)<\/div>\s*<div[^>]*class="(?:authors-wrapper|related)/i,
		// modulai.io specific: article-wrapper content
		/<div[^>]*class="article-wrapper"[^>]*>([\s\S]*?)<\/div>\s*<div[^>]*class="(?:authors-wrapper|related|call-to-action)/i,
		// Standard WordPress patterns
		/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<div|<footer|<\/article)/i,
		/<div[^>]*class="[^"]*post-content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<div|<footer|<\/article)/i,
		/<article[^>]*>([\s\S]*?)<\/article>/i,
	];

	for (const pattern of patterns) {
		const match = html.match(pattern);
		if (match?.[1]) {
			contentHtml = match[1];
			break;
		}
	}

	// If still no content, try to extract everything between article-wrapper and authors/footer
	if (!contentHtml) {
		const articleWrapperStart = html.indexOf('class="article-wrapper"');
		const authorsStart = html.indexOf('class="authors-wrapper"');
		if (articleWrapperStart !== -1 && authorsStart !== -1 && authorsStart > articleWrapperStart) {
			contentHtml = html.slice(articleWrapperStart, authorsStart);
		}
	}

	// Convert HTML content to Markdown
	post.content = htmlToMarkdown(contentHtml);

	// Extract images from content
	const imgRegex = /<img[^>]+src="([^"]+)"[^>]*(?:alt="([^"]*)")?[^>]*>/gi;
	let imgMatch;
	while ((imgMatch = imgRegex.exec(contentHtml)) !== null) {
		const imgUrl = imgMatch[1];
		if (imgUrl && !imgUrl.includes("data:") && !post.images.some(i => i.url === imgUrl)) {
			post.images.push({
				url: imgUrl,
				alt: imgMatch[2] || "",
				type: "content",
			});
		}
	}

	// Extract tags from article:tag meta tags
	const tagRegex = /<meta\s+property="article:tag"\s+content="([^"]+)"/gi;
	let tagMatch;
	while ((tagMatch = tagRegex.exec(html)) !== null) {
		post.tags.push(tagMatch[1]);
	}

	return post;
}

/**
 * Convert HTML to Markdown with improved handling of edge cases
 * Handles callout boxes, styled divs, code blocks, and other WordPress patterns
 */
function htmlToMarkdown(html) {
	if (!html) return "";

	let md = html;

	// Remove scripts and styles
	md = md.replace(/<script[\s\S]*?<\/script>/gi, "");
	md = md.replace(/<style[\s\S]*?<\/style>/gi, "");

	// Remove WordPress spacer blocks
	md = md.replace(/<div[^>]*class="[^"]*wp-block-spacer[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "\n");

	// Convert callout/info boxes (styled divs with emoji headers) to blockquotes
	// Pattern: div with background-color style containing h3 with emoji
	md = md.replace(
		/<div[^>]*style="[^"]*background-color[^"]*"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>([\s\S]*?)<\/div>/gi,
		(match, title, content) => {
			// Clean up the title and content
			const cleanTitle = title.replace(/<[^>]+>/g, "").trim();
			const cleanContent = content
				.replace(/<[^>]+>/g, " ")
				.replace(/\s+/g, " ")
				.trim();
			return `\n> **${cleanTitle}**\n> ${cleanContent}\n`;
		}
	);

	// Convert styled code boxes (drug-discovery-codebox class pattern)
	md = md.replace(
		/<div[^>]*class="[^"]*codebox[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
		(match, content) => {
			const cleanContent = content
				.replace(/<br\s*\/?>/gi, "\n")
				.replace(/<[^>]+>/g, "")
				.trim();
			return `\n\`\`\`\n${cleanContent}\n\`\`\`\n`;
		}
	);

	// Convert headings - strip any inline styles/formatting from heading text
	md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (m, c) => `\n# ${c.replace(/<[^>]+>/g, "").trim()}\n`);
	md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (m, c) => `\n## ${c.replace(/<[^>]+>/g, "").trim()}\n`);
	md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (m, c) => `\n### ${c.replace(/<[^>]+>/g, "").trim()}\n`);
	md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (m, c) => `\n#### ${c.replace(/<[^>]+>/g, "").trim()}\n`);
	md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, (m, c) => `\n##### ${c.replace(/<[^>]+>/g, "").trim()}\n`);
	md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, (m, c) => `\n###### ${c.replace(/<[^>]+>/g, "").trim()}\n`);

	// Convert bold and italic
	md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**");
	md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**");
	md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*");
	md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, "*$1*");

	// Convert links
	md = md.replace(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");

	// Convert images - handle both orderings of src and alt
	md = md.replace(
		/<img[^>]+src="([^"]+)"[^>]*alt="([^"]*)"[^>]*\/?>/gi,
		"![$2]($1)"
	);
	md = md.replace(
		/<img[^>]+alt="([^"]*)"[^>]*src="([^"]+)"[^>]*\/?>/gi,
		"![$1]($2)"
	);
	md = md.replace(/<img[^>]+src="([^"]+)"[^>]*\/?>/gi, "![]($1)");

	// Convert figures with captions
	md = md.replace(/<figure[^>]*>([\s\S]*?)<figcaption[^>]*>([\s\S]*?)<\/figcaption>[\s\S]*?<\/figure>/gi,
		(m, img, caption) => {
			const imgMd = img.replace(/<[^>]+>/g, "").trim() || img;
			const captionText = caption.replace(/<[^>]+>/g, "").trim();
			return `${imgMd}\n\n*${captionText}*\n`;
		}
	);
	md = md.replace(/<figure[^>]*>([\s\S]*?)<\/figure>/gi, "$1");
	md = md.replace(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/gi, "\n*$1*\n");

	// Convert code blocks with language detection
	md = md.replace(
		/<pre[^>]*><code[^>]*class="[^"]*language-([^"]*)"[^>]*>([\s\S]*?)<\/code><\/pre>/gi,
		"\n```$1\n$2\n```\n"
	);
	md = md.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, "\n```\n$1\n```\n");
	md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "\n```\n$1\n```\n");
	md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");

	// Convert lists - handle nested structures better
	md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (match, content) => {
		return "\n" + content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (m, li) => {
			// Clean up the list item content
			const cleanLi = li.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
			return `- ${cleanLi}\n`;
		});
	});
	md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (match, content) => {
		let i = 1;
		return "\n" + content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (m, li) => {
			const cleanLi = li.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
			return `${i++}. ${cleanLi}\n`;
		});
	});

	// Convert blockquotes
	md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (match, content) => {
		const cleanContent = content.replace(/<[^>]+>/g, "").trim();
		return cleanContent.split("\n").map(line => `> ${line.trim()}`).join("\n") + "\n";
	});

	// Convert paragraphs
	md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n$1\n");

	// Convert line breaks and horizontal rules
	md = md.replace(/<br\s*\/?>/gi, "\n");
	md = md.replace(/<hr\s*\/?>/gi, "\n---\n");

	// Remove divs and spans but keep content
	md = md.replace(/<\/?div[^>]*>/gi, "\n");
	md = md.replace(/<\/?span[^>]*>/gi, "");

	// Remove remaining HTML tags
	md = md.replace(/<[^>]+>/g, "");

	// Decode HTML entities (comprehensive list)
	const entities = {
		"&nbsp;": " ",
		"&amp;": "&",
		"&lt;": "<",
		"&gt;": ">",
		"&quot;": '"',
		"&#39;": "'",
		"&#x27;": "'",
		"&apos;": "'",
		"&mdash;": "—",
		"&ndash;": "–",
		"&hellip;": "...",
		"&#8211;": "–",
		"&#8212;": "—",
		"&#8217;": "'",
		"&#8216;": "'",
		"&#8220;": '"',
		"&#8221;": '"',
		"&#8230;": "...",
		"&lsquo;": "'",
		"&rsquo;": "'",
		"&ldquo;": '"',
		"&rdquo;": '"',
		"&bull;": "•",
		"&middot;": "·",
		"&copy;": "©",
		"&reg;": "®",
		"&trade;": "™",
		"&deg;": "°",
		"&plusmn;": "±",
		"&times;": "×",
		"&divide;": "÷",
		"&frac12;": "½",
		"&frac14;": "¼",
		"&frac34;": "¾",
	};
	for (const [entity, char] of Object.entries(entities)) {
		md = md.split(entity).join(char);
	}
	// Handle numeric entities
	md = md.replace(/&#(\d+);/g, (m, code) => String.fromCharCode(parseInt(code, 10)));
	md = md.replace(/&#x([0-9a-fA-F]+);/g, (m, code) => String.fromCharCode(parseInt(code, 16)));

	// Clean up bullet point characters to standard markdown
	md = md.replace(/^[ \t]*[•◦▪▸][ \t]*/gm, "- ");

	// Clean up whitespace
	md = md.replace(/[ \t]+$/gm, "");  // Trailing whitespace on lines
	md = md.replace(/^\s+$/gm, "");     // Lines with only whitespace
	md = md.replace(/\n{3,}/g, "\n\n"); // Multiple blank lines
	md = md.trim();

	return md;
}

/**
 * Download an image and return the local path
 */
async function downloadImage(imageUrl, slug) {
	const ext = path.extname(new URL(imageUrl).pathname) || ".png";
	const filename = `${slug}${ext}`;
	const localPath = path.join(IMAGES_DIR, filename);

	const response = await fetch(imageUrl);
	if (!response.ok) {
		throw new Error(`Failed to download image: ${response.status}`);
	}

	const buffer = Buffer.from(await response.arrayBuffer());
	await writeFile(localPath, buffer);

	return `/images/${filename}`;
}

/**
 * Generate markdown frontmatter and content
 */
function generateMarkdown(post, slug, localImagePath) {
	const frontmatter = {
		id: slug,
		title: post.title,
		date: post.date,
		image: localImagePath || post.featuredImage,
		author: post.author,
		published: true,
		push_to_webflow: true,
		tags: post.tags.length > 0 ? post.tags : ["AI", "Machine Learning"],
		excerpt: post.excerpt,
		seo: {
			title: post.title,
			description: post.excerpt,
		},
	};

	// Build frontmatter string
	let md = "---\n";
	md += `id: ${frontmatter.id}\n`;
	md += `title: "${frontmatter.title.replace(/"/g, '\\"')}"\n`;
	md += `date: ${frontmatter.date}\n`;
	if (frontmatter.image) {
		md += `image: "${frontmatter.image}"\n`;
	}
	md += `author: "${frontmatter.author}"\n`;
	md += `published: ${frontmatter.published}\n`;
	md += `push_to_webflow: ${frontmatter.push_to_webflow}\n`;
	md += `tags: [${frontmatter.tags.map(t => `"${t}"`).join(", ")}]\n`;
	md += `excerpt: "${frontmatter.excerpt.replace(/"/g, '\\"')}"\n`;
	md += `seo:\n`;
	md += `  title: "${frontmatter.seo.title.replace(/"/g, '\\"')}"\n`;
	md += `  description: "${frontmatter.seo.description.replace(/"/g, '\\"')}"\n`;
	md += "---\n\n";
	md += post.content;

	return md;
}

/**
 * Main function
 */
async function main() {
	const args = process.argv.slice(2);
	const url = args.find(arg => arg.startsWith("http"));
	const shouldSave = args.includes("--save");

	if (!url) {
		console.error("Usage: node fetch-modulai-post.js <url> [--save]");
		console.error("");
		console.error("Example:");
		console.error("  node fetch-modulai-post.js https://modulai.io/blog/my-post/");
		console.error("  node fetch-modulai-post.js https://modulai.io/blog/my-post/ --save");
		process.exit(1);
	}

	if (!url.includes("modulai.io/blog/")) {
		console.error("Error: URL must be a modulai.io blog post");
		process.exit(1);
	}

	const slug = extractSlug(url);
	if (!slug) {
		console.error("Error: Could not extract slug from URL");
		process.exit(1);
	}

	console.error(`Fetching: ${url}`);

	// Fetch the page
	const response = await fetch(url);
	if (!response.ok) {
		console.error(`Error: Failed to fetch page (${response.status})`);
		process.exit(1);
	}

	const html = await response.text();
	const post = parseHtmlContent(html, url);

	if (!post.title) {
		console.error("Error: Could not extract post title");
		process.exit(1);
	}

	console.error(`Title: ${post.title}`);
	console.error(`Date: ${post.date}`);
	console.error(`Author: ${post.author}`);
	console.error(`Images found: ${post.images.length}`);

	if (shouldSave) {
		// Ensure directories exist
		if (!existsSync(POSTS_DIR)) {
			await mkdir(POSTS_DIR, { recursive: true });
		}
		if (!existsSync(IMAGES_DIR)) {
			await mkdir(IMAGES_DIR, { recursive: true });
		}

		// Download featured image if present
		let localImagePath = null;
		if (post.featuredImage) {
			console.error(`Downloading featured image...`);
			localImagePath = await downloadImage(post.featuredImage, slug);
			console.error(`Saved to: ${localImagePath}`);
		}

		// Generate and save markdown
		const markdown = generateMarkdown(post, slug, localImagePath);
		const mdPath = path.join(POSTS_DIR, `${slug}.md`);
		await writeFile(mdPath, markdown);
		console.error(`Saved markdown to: ${mdPath}`);

		// Output summary
		console.log(JSON.stringify({
			success: true,
			slug,
			title: post.title,
			markdownPath: mdPath,
			imagePath: localImagePath,
		}, null, 2));
	} else {
		// Output JSON for Claude to process
		console.log(JSON.stringify({
			slug,
			url,
			...post,
			suggestedMarkdown: generateMarkdown(post, slug, post.featuredImage ? `/images/${slug}.png` : null),
		}, null, 2));
	}
}

main().catch(err => {
	console.error(`Error: ${err.message}`);
	process.exit(1);
});
