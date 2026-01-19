/**
 * Enhanced rate limiter for Webflow API
 * @module lib/rate-limiter
 */

import { parseRetryAfter } from "./errors.js";
import { logger } from "./logger.js";
import { sleep } from "./retry.js";

/**
 * Default rate limiter configuration
 * Based on Webflow API limits: https://developers.webflow.com/docs/rate-limits
 */
export const DEFAULT_RATE_LIMIT_CONFIG = {
	/** Maximum requests allowed per time window (Webflow allows ~120/min) */
	MAX_REQUESTS_PER_WINDOW: 120,
	/** Time window in milliseconds (1 minute) */
	WINDOW_MS: 60000,
	/** Default backoff time in ms when no Retry-After header is provided */
	DEFAULT_BACKOFF_MS: 60000,
};

/**
 * Rate limiter with 429 response handling and backoff support
 */
export class RateLimiter {
	/**
	 * @param {object} [options] - Rate limiter options
	 * @param {number} [options.maxRequests=120] - Max requests per window
	 * @param {number} [options.windowMs=60000] - Window size in milliseconds
	 */
	constructor(options = {}) {
		this.maxRequests = options.maxRequests || DEFAULT_RATE_LIMIT_CONFIG.MAX_REQUESTS_PER_WINDOW;
		this.windowMs = options.windowMs || DEFAULT_RATE_LIMIT_CONFIG.WINDOW_MS;
		this.requests = [];
		this.backoffUntil = 0; // Timestamp when backoff ends
	}

	/**
	 * Wait if needed before making a request
	 * @returns {Promise<void>}
	 */
	async waitIfNeeded() {
		const now = Date.now();

		// Check if we're in a backoff period (from 429 response)
		if (this.backoffUntil > now) {
			const waitTime = this.backoffUntil - now;
			logger.info("Rate limit backoff active", { waitTimeMs: waitTime });
			await sleep(waitTime);
		}

		// Clean old requests from window
		this.requests = this.requests.filter((time) => now - time < this.windowMs);

		if (this.requests.length >= this.maxRequests) {
			const oldestRequest = this.requests[0];
			const waitTime = this.windowMs - (now - oldestRequest) + 100; // Add 100ms buffer

			if (waitTime > 0) {
				logger.info("Pre-emptive rate limit wait", {
					waitTimeMs: waitTime,
					requestsInWindow: this.requests.length,
					maxRequests: this.maxRequests,
				});
				await sleep(waitTime);
				return this.waitIfNeeded();
			}
		}

		this.requests.push(Date.now());
	}

	/**
	 * Record a rate limit hit from 429 response
	 * @param {Response} response - Fetch response
	 * @returns {number} Backoff time in milliseconds
	 */
	recordRateLimitHit(response) {
		const retryAfterMs = parseRetryAfter(response) || DEFAULT_RATE_LIMIT_CONFIG.DEFAULT_BACKOFF_MS;
		this.backoffUntil = Date.now() + retryAfterMs;

		logger.warn("429 Rate limit hit - recording backoff", {
			retryAfterMs,
			backoffUntil: new Date(this.backoffUntil).toISOString(),
		});

		return retryAfterMs;
	}

	/**
	 * Get rate limiter statistics
	 * @returns {object}
	 */
	getStats() {
		const now = Date.now();
		const activeRequests = this.requests.filter((t) => now - t < this.windowMs);
		return {
			requestsInWindow: activeRequests.length,
			maxRequests: this.maxRequests,
			windowMs: this.windowMs,
			remainingRequests: Math.max(0, this.maxRequests - activeRequests.length),
			isBackoff: this.backoffUntil > now,
			backoffRemainingMs: Math.max(0, this.backoffUntil - now),
		};
	}

	/**
	 * Reset the rate limiter
	 */
	reset() {
		this.requests = [];
		this.backoffUntil = 0;
	}
}

// Singleton instance for use across the application
let globalRateLimiter = null;

/**
 * Get or create the global rate limiter instance
 * @param {object} [options] - Options (only used on first call)
 * @returns {RateLimiter}
 */
export function getGlobalRateLimiter(options) {
	if (!globalRateLimiter) {
		globalRateLimiter = new RateLimiter(options);
	}
	return globalRateLimiter;
}

/**
 * Reset the global rate limiter
 */
export function resetGlobalRateLimiter() {
	if (globalRateLimiter) {
		globalRateLimiter.reset();
	}
}

/**
 * Create a fetch wrapper with rate limiting
 * @param {RateLimiter} rateLimiter - Rate limiter instance
 * @param {string} token - Webflow API token
 * @returns {Function} Rate-limited fetch function
 */
export function createRateLimitedFetch(rateLimiter, token) {
	/**
	 * Fetch with rate limiting
	 * @param {string} url - URL to fetch
	 * @param {object} [options] - Fetch options
	 * @returns {Promise<Response>}
	 */
	return async function rateLimitedFetch(url, options = {}) {
		await rateLimiter.waitIfNeeded();

		const res = await fetch(url, {
			...options,
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
				accept: "application/json",
				...options.headers,
			},
		});

		if (res.status === 429) {
			rateLimiter.recordRateLimitHit(res);
		}

		return res;
	};
}
