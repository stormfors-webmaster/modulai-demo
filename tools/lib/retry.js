/**
 * Shared retry logic with exponential backoff
 * @module lib/retry
 */

import { SyncError, parseRetryAfter, wrapError } from "./errors.js";
import { logger } from "./logger.js";

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG = {
	maxAttempts: 3,
	baseDelayMs: 1000,
	maxDelayMs: 30000,
	backoffMultiplier: 2,
	jitterFactor: 0.1, // 10% jitter
};

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
export function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 * @param {Function} fn - Async function to retry, receives attempt number
 * @param {object} [options] - Retry options
 * @param {number} [options.maxAttempts] - Maximum retry attempts
 * @param {number} [options.baseDelayMs] - Base delay in milliseconds
 * @param {number} [options.maxDelayMs] - Maximum delay in milliseconds
 * @param {number} [options.backoffMultiplier] - Backoff multiplier
 * @param {number} [options.jitterFactor] - Jitter factor (0-1)
 * @param {object} [options.context] - Context for error wrapping
 * @returns {Promise<*>} Result of the function
 */
export async function retryWithBackoff(fn, options = {}) {
	const config = { ...DEFAULT_RETRY_CONFIG, ...options };
	const {
		maxAttempts,
		baseDelayMs,
		maxDelayMs,
		backoffMultiplier,
		jitterFactor,
		context = {},
	} = config;

	let lastError;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			return await fn(attempt);
		} catch (error) {
			lastError = wrapError(error, { ...context, attempt });

			// Check for Retry-After header (stored on error by caller)
			const retryAfter = lastError.context?.retryAfterMs;

			if (!lastError.isRetryable() || attempt === maxAttempts) {
				logger.error("Operation failed (not retrying)", {
					error: lastError.toJSON(),
					attempt,
					maxAttempts,
				});
				throw lastError;
			}

			// Calculate delay: use Retry-After if available, otherwise exponential backoff
			let delayMs;
			if (retryAfter) {
				delayMs = retryAfter;
			} else {
				delayMs = Math.min(
					baseDelayMs * Math.pow(backoffMultiplier, attempt - 1),
					maxDelayMs,
				);
			}

			// Add jitter to prevent thundering herd
			const jitter = delayMs * jitterFactor * Math.random();
			delayMs = Math.round(delayMs + jitter);

			logger.warn("Retrying operation", {
				attempt,
				maxAttempts,
				delayMs,
				errorType: lastError.type,
				errorMessage: lastError.message,
			});

			await sleep(delayMs);
		}
	}

	throw lastError;
}

/**
 * Create a fetch wrapper with retry logic
 * @param {object} [defaultOptions] - Default fetch options
 * @param {object} [retryConfig] - Retry configuration
 * @returns {Function} Fetch function with retry
 */
export function createRetryFetch(defaultOptions = {}, retryConfig = {}) {
	const config = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };

	/**
	 * Fetch with retry
	 * @param {string} url - URL to fetch
	 * @param {object} [options] - Fetch options
	 * @returns {Promise<Response>}
	 */
	return async function retryFetch(url, options = {}) {
		const fetchOptions = { ...defaultOptions, ...options };
		const context = { url: url.replace(/[a-f0-9]{64}/gi, "[TOKEN]") };

		return retryWithBackoff(
			async (attempt) => {
				const res = await fetch(url, fetchOptions);

				if (!res.ok) {
					const text = await res.text();
					const error = SyncError.fromFetchResponse(res, text, context);

					// Capture Retry-After header for rate limits
					if (res.status === 429) {
						const retryAfterMs = parseRetryAfter(res);
						if (retryAfterMs) {
							error.context.retryAfterMs = retryAfterMs;
						}
					}

					throw error;
				}

				return res;
			},
			{ ...config, context },
		);
	};
}

/**
 * Wrap an async operation with timeout
 * @param {Function} fn - Async function to wrap
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} [message] - Timeout error message
 * @returns {Promise<*>}
 */
export async function withTimeout(
	fn,
	timeoutMs,
	message = "Operation timed out",
) {
	let timeoutId;

	const timeoutPromise = new Promise((_, reject) => {
		timeoutId = setTimeout(() => {
			const error = new SyncError(message, {
				type: "RETRYABLE_NETWORK",
				context: { timeoutMs },
			});
			reject(error);
		}, timeoutMs);
	});

	try {
		return await Promise.race([fn(), timeoutPromise]);
	} finally {
		clearTimeout(timeoutId);
	}
}

/**
 * Batch operations with concurrency limit
 * @param {Array} items - Items to process
 * @param {Function} fn - Async function to apply to each item
 * @param {number} [concurrency=5] - Maximum concurrent operations
 * @returns {Promise<Array>} Results (throws AggregateError if any failures, with partial results on error.results)
 */
export async function batchWithConcurrency(items, fn, concurrency = 5) {
	const results = [];
	const executing = new Set();

	for (const [index, item] of items.entries()) {
		const promise = Promise.resolve()
			.then(() => fn(item, index))
			.then((result) => {
				executing.delete(promise);
				return { index, result, status: "fulfilled" };
			})
			.catch((error) => {
				executing.delete(promise);
				return { index, error, status: "rejected" };
			});

		executing.add(promise);
		results.push(promise);

		if (executing.size >= concurrency) {
			await Promise.race(executing);
		}
	}

	const settled = await Promise.all(results);

	// Reorder by original index
	settled.sort((a, b) => a.index - b.index);

	// Collect all errors and successful results
	const errors = settled
		.filter((s) => s.status === "rejected")
		.map((s) => s.error);
	const successResults = settled.map((s) =>
		s.status === "fulfilled" ? s.result : undefined,
	);

	// If any errors occurred, throw AggregateError with partial results attached
	if (errors.length > 0) {
		const aggregateError = new AggregateError(
			errors,
			`${errors.length} of ${items.length} operations failed`,
		);
		aggregateError.results = successResults;
		throw aggregateError;
	}

	return successResults;
}
