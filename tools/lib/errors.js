/**
 * Error handling with sanitization
 * @module lib/errors
 */

// Patterns that indicate sensitive data
const SENSITIVE_PATTERNS = [
	/Bearer\s+[a-zA-Z0-9_-]+/gi, // Bearer tokens
	/[a-f0-9]{64}/gi, // 64-char hex (Webflow tokens)
	/ghp_[a-zA-Z0-9]{36}/gi, // GitHub PAT
	/gho_[a-zA-Z0-9]{36}/gi, // GitHub OAuth
	/ghs_[a-zA-Z0-9]{36}/gi, // GitHub Server-to-server
	/ghu_[a-zA-Z0-9]{36}/gi, // GitHub User-to-server
	/ghr_[a-zA-Z0-9]{36}/gi, // GitHub Refresh
	/Authorization:\s*[^\s]+/gi, // Authorization headers
	/token[=:]\s*['"]?[a-zA-Z0-9_-]{20,}/gi, // token= patterns
	/api[_-]?key[=:]\s*['"]?[a-zA-Z0-9_-]+/gi, // API keys
];

/**
 * Error classification for retry decisions
 */
export const ErrorType = {
	RETRYABLE_SERVER: "RETRYABLE_SERVER", // 5xx errors
	RETRYABLE_RATE_LIMIT: "RETRYABLE_RATE_LIMIT", // 429
	RETRYABLE_NETWORK: "RETRYABLE_NETWORK", // fetch failed, timeout
	CLIENT_ERROR: "CLIENT_ERROR", // 4xx (except 429)
	VALIDATION_ERROR: "VALIDATION_ERROR", // Bad input
	CONFIG_ERROR: "CONFIG_ERROR", // Missing env vars
	UNKNOWN: "UNKNOWN",
};

/**
 * Custom error class with context preservation
 */
export class SyncError extends Error {
	/**
	 * @param {string} message - Error message
	 * @param {object} options - Error options
	 * @param {Error} [options.cause] - Original error
	 * @param {string} [options.type] - Error type from ErrorType
	 * @param {object} [options.context] - Additional context
	 * @param {number} [options.statusCode] - HTTP status code if applicable
	 */
	constructor(message, { cause, type, context, statusCode } = {}) {
		super(message);
		this.name = "SyncError";
		this.cause = cause;
		this.type = type || ErrorType.UNKNOWN;
		this.context = context || {};
		this.statusCode = statusCode;
		this.timestamp = new Date().toISOString();
	}

	/**
	 * Create SyncError from a fetch Response
	 * @param {Response} response - Fetch response
	 * @param {string} text - Response body text
	 * @param {object} [context] - Additional context
	 * @returns {SyncError}
	 */
	static fromFetchResponse(response, text, context = {}) {
		const statusCode = response.status;
		let type;

		if (statusCode === 429) {
			type = ErrorType.RETRYABLE_RATE_LIMIT;
		} else if (statusCode >= 500) {
			type = ErrorType.RETRYABLE_SERVER;
		} else if (statusCode >= 400) {
			type = ErrorType.CLIENT_ERROR;
		} else {
			type = ErrorType.UNKNOWN;
		}

		// Sanitize response text before including in error
		const sanitizedText = sanitizeString(text);

		return new SyncError(`HTTP ${statusCode}: ${sanitizedText}`, {
			type,
			statusCode,
			context: {
				...context,
				url: response.url ? sanitizeString(response.url) : undefined,
			},
		});
	}

	/**
	 * Check if error is retryable
	 * @returns {boolean}
	 */
	isRetryable() {
		return [
			ErrorType.RETRYABLE_SERVER,
			ErrorType.RETRYABLE_RATE_LIMIT,
			ErrorType.RETRYABLE_NETWORK,
		].includes(this.type);
	}

	/**
	 * Convert to JSON for logging
	 * @returns {object}
	 */
	toJSON() {
		return {
			name: this.name,
			message: sanitizeString(this.message),
			type: this.type,
			statusCode: this.statusCode,
			context: this.context,
			timestamp: this.timestamp,
		};
	}
}

/**
 * Sanitize a string by removing sensitive data
 * @param {string} str - String to sanitize
 * @returns {string} Sanitized string
 */
export function sanitizeString(str) {
	if (typeof str !== "string") {
		return String(str);
	}

	let sanitized = str;
	for (const pattern of SENSITIVE_PATTERNS) {
		sanitized = sanitized.replace(pattern, "[REDACTED]");
	}

	return sanitized;
}

/**
 * Sanitize an error object for logging
 * @param {Error} error - Error to sanitize
 * @returns {{message: string, type: string, safe: boolean}}
 */
export function sanitizeError(error) {
	const message = sanitizeString(error?.message || String(error));

	// Classify error type
	let type = ErrorType.UNKNOWN;
	let safe = false; // Whether to show full message to user

	if (error instanceof SyncError) {
		type = error.type;
		safe = [ErrorType.VALIDATION_ERROR, ErrorType.CONFIG_ERROR].includes(type);
	} else if (message.includes("Missing required")) {
		type = ErrorType.CONFIG_ERROR;
		safe = true;
	} else if (
		message.includes("Invalid format") ||
		message.includes("must be")
	) {
		type = ErrorType.VALIDATION_ERROR;
		safe = true;
	} else if (
		message.includes("fetch failed") ||
		message.includes("ECONNREFUSED") ||
		message.includes("ETIMEDOUT")
	) {
		type = ErrorType.RETRYABLE_NETWORK;
		safe = true;
	} else if (
		message.includes("Missing required field") ||
		message.includes("title")
	) {
		type = ErrorType.VALIDATION_ERROR;
		safe = true;
	}

	return { message, type, safe };
}

/**
 * Wrap unknown errors with context
 * @param {Error} error - Error to wrap
 * @param {object} [context] - Additional context
 * @returns {SyncError}
 */
export function wrapError(error, context = {}) {
	if (error instanceof SyncError) {
		error.context = { ...error.context, ...context };
		return error;
	}

	let type = ErrorType.UNKNOWN;
	if (
		error.message?.includes("fetch failed") ||
		error.code === "ECONNREFUSED" ||
		error.code === "ETIMEDOUT"
	) {
		type = ErrorType.RETRYABLE_NETWORK;
	}

	return new SyncError(error.message, {
		cause: error,
		type,
		context,
	});
}

/**
 * Create a user-safe error message
 * @param {Error} error - Original error
 * @param {string} [context] - Context description (e.g., "processing file.md")
 * @returns {string} User-safe message
 */
export function getUserMessage(error, context = "") {
	const { message, type, safe } = sanitizeError(error);

	if (safe) {
		return context ? `${context}: ${message}` : message;
	}

	// Generic messages for unsafe errors
	const genericMessages = {
		[ErrorType.RETRYABLE_NETWORK]:
			"Network error occurred. Please check your connection and try again.",
		[ErrorType.RETRYABLE_SERVER]:
			"Server error occurred. The service may be temporarily unavailable.",
		[ErrorType.RETRYABLE_RATE_LIMIT]:
			"Rate limit exceeded. Please wait and try again.",
		[ErrorType.CONFIG_ERROR]:
			"Configuration error. Please check your environment variables.",
		[ErrorType.VALIDATION_ERROR]: "Validation failed. Please check your input.",
		[ErrorType.CLIENT_ERROR]: "Request failed. Please check your input.",
		[ErrorType.UNKNOWN]:
			"An unexpected error occurred. Please check the logs for details.",
	};

	return context
		? `${context}: ${genericMessages[type] || genericMessages[ErrorType.UNKNOWN]}`
		: genericMessages[type] || genericMessages[ErrorType.UNKNOWN];
}

/**
 * Parse Retry-After header from response
 * @param {Response} response - Fetch response
 * @returns {number|null} Milliseconds to wait, or null if not present
 */
export function parseRetryAfter(response) {
	const retryAfter = response.headers?.get?.("Retry-After");
	if (!retryAfter) return null;

	// Could be seconds (number) or HTTP date
	const seconds = Number.parseInt(retryAfter, 10);
	if (!Number.isNaN(seconds)) {
		return seconds * 1000; // Convert to ms
	}

	// Try parsing as date
	const date = new Date(retryAfter);
	if (!Number.isNaN(date.getTime())) {
		return Math.max(0, date.getTime() - Date.now());
	}

	return null;
}
