/**
 * Structured logging with correlation IDs
 * @module lib/logger
 */

import { sanitizeString } from "./errors.js";

const LOG_LEVELS = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

/**
 * Structured logger with JSON and pretty output modes
 */
class Logger {
	/**
	 * @param {object} options - Logger options
	 * @param {string} [options.name] - Logger name/prefix
	 * @param {string} [options.correlationId] - Correlation ID for tracing
	 */
	constructor(options = {}) {
		this.name = options.name || "sync";
		this.minLevel =
			LOG_LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LOG_LEVELS.info;
		this.useJson =
			process.env.LOG_FORMAT === "json" || process.env.CI === "true";
		this.correlationId =
			options.correlationId ||
			process.env.CORRELATION_ID ||
			this.generateCorrelationId();
		this.defaultContext = {};
	}

	/**
	 * Generate a unique correlation ID
	 * @returns {string}
	 */
	generateCorrelationId() {
		return `${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 9)}`;
	}

	/**
	 * Set correlation ID
	 * @param {string} id - Correlation ID
	 */
	setCorrelationId(id) {
		this.correlationId = id;
	}

	/**
	 * Get current correlation ID
	 * @returns {string}
	 */
	getCorrelationId() {
		return this.correlationId;
	}

	/**
	 * Core logging method
	 * @param {string} level - Log level
	 * @param {string} message - Log message
	 * @param {object} [data] - Additional data
	 */
	log(level, message, data = {}) {
		if (LOG_LEVELS[level] < this.minLevel) return;

		const entry = {
			timestamp: new Date().toISOString(),
			level: level.toUpperCase(),
			logger: this.name,
			correlationId: this.correlationId,
			message: sanitizeString(message),
			...this.defaultContext,
			...this.sanitizeData(data),
		};

		if (this.useJson) {
			this.outputJson(level, entry);
		} else {
			this.outputPretty(level, entry);
		}
	}

	/**
	 * Sanitize data object for logging
	 * @param {object} data - Data to sanitize
	 * @returns {object}
	 */
	sanitizeData(data) {
		if (!data || typeof data !== "object") return {};

		const sanitized = {};
		for (const [key, value] of Object.entries(data)) {
			if (value === undefined) continue;

			if (typeof value === "string") {
				sanitized[key] = sanitizeString(value);
			} else if (typeof value === "object" && value !== null) {
				if (value instanceof Error) {
					sanitized[key] = {
						name: value.name,
						message: sanitizeString(value.message),
						...(value.type && { type: value.type }),
						...(value.statusCode && { statusCode: value.statusCode }),
					};
				} else if (Array.isArray(value)) {
					sanitized[key] = value.map((v) =>
						typeof v === "string" ? sanitizeString(v) : v,
					);
				} else {
					sanitized[key] = this.sanitizeData(value);
				}
			} else {
				sanitized[key] = value;
			}
		}
		return sanitized;
	}

	/**
	 * Output log entry as JSON
	 * @param {string} level - Log level
	 * @param {object} entry - Log entry
	 */
	outputJson(level, entry) {
		const output = JSON.stringify(entry);
		if (level === "error") {
			console.error(output);
		} else if (level === "warn") {
			console.warn(output);
		} else {
			console.log(output);
		}
	}

	/**
	 * Output log entry in human-readable format
	 * @param {string} level - Log level
	 * @param {object} entry - Log entry
	 */
	outputPretty(level, entry) {
		const levelColors = {
			debug: "\x1b[90m", // gray
			info: "\x1b[36m", // cyan
			warn: "\x1b[33m", // yellow
			error: "\x1b[31m", // red
		};
		const reset = "\x1b[0m";
		const color = levelColors[level] || "";

		const prefix = `${color}[${entry.logger}:${level}]${reset}`;

		// Build suffix from additional data
		const dataKeys = Object.keys(entry).filter(
			(k) =>
				!["timestamp", "level", "logger", "message", "correlationId"].includes(
					k,
				),
		);

		let suffix = "";
		if (dataKeys.length > 0) {
			const dataObj = {};
			for (const k of dataKeys) {
				dataObj[k] = entry[k];
			}
			suffix = ` ${JSON.stringify(dataObj)}`;
		}

		const output = `${prefix} ${entry.message}${suffix}`;

		if (level === "error") {
			console.error(output);
		} else if (level === "warn") {
			console.warn(output);
		} else {
			console.log(output);
		}
	}

	/**
	 * Log at debug level
	 * @param {string} message - Log message
	 * @param {object} [data] - Additional data
	 */
	debug(message, data) {
		this.log("debug", message, data);
	}

	/**
	 * Log at info level
	 * @param {string} message - Log message
	 * @param {object} [data] - Additional data
	 */
	info(message, data) {
		this.log("info", message, data);
	}

	/**
	 * Log at warn level
	 * @param {string} message - Log message
	 * @param {object} [data] - Additional data
	 */
	warn(message, data) {
		this.log("warn", message, data);
	}

	/**
	 * Log at error level
	 * @param {string} message - Log message
	 * @param {object} [data] - Additional data
	 */
	error(message, data) {
		this.log("error", message, data);
	}

	/**
	 * Create child logger with additional context
	 * @param {object} [context] - Default context for child
	 * @returns {Logger}
	 */
	child(context = {}) {
		const child = new Logger({
			name: this.name,
			correlationId: this.correlationId,
		});
		child.defaultContext = { ...this.defaultContext, ...context };
		child.minLevel = this.minLevel;
		child.useJson = this.useJson;
		return child;
	}
}

/**
 * Audit logger for tracking sync operations
 */
class AuditLogger extends Logger {
	constructor() {
		super({ name: "audit" });
		this.operations = [];
	}

	/**
	 * Record an operation for audit trail
	 * @param {object} operation - Operation details
	 */
	recordOperation(operation) {
		const record = {
			timestamp: new Date().toISOString(),
			correlationId: this.correlationId,
			...operation,
		};
		this.operations.push(record);
		this.info("Audit record", record);
	}

	/**
	 * Get summary of all operations
	 * @returns {object}
	 */
	getSummary() {
		const summary = {
			correlationId: this.correlationId,
			totalOperations: this.operations.length,
			successful: this.operations.filter((op) => op.status === "SUCCESS")
				.length,
			failed: this.operations.filter((op) => op.status === "FAILED").length,
			skipped: this.operations.filter((op) => op.status === "SKIPPED").length,
		};

		return summary;
	}

	/**
	 * Reset operations list
	 */
	reset() {
		this.operations = [];
	}
}

// Singleton instances
export const logger = new Logger({ name: "sync-webflow" });
export const auditLogger = new AuditLogger();

/**
 * Factory for tool-specific loggers
 * @param {string} name - Logger name
 * @returns {Logger}
 */
export function createLogger(name) {
	return new Logger({ name, correlationId: logger.correlationId });
}

export { Logger, AuditLogger };
