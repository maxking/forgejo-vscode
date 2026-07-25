import * as vscode from 'vscode';

/**
 * Centralized logging for the Forgejo extension using VS Code's Output API
 */
class Logger {
	private outputChannel: vscode.OutputChannel | null = null;
	private isDebugEnabled = false;

	/**
	 * Lazy initialization of the output channel
	 */
	private getOutputChannel(): vscode.OutputChannel {
		if (!this.outputChannel) {
			try {
				this.outputChannel = vscode.window.createOutputChannel('Forgejo');
			} catch (e) {
				console.error('[Forgejo] Failed to create output channel:', e);
			}

			// Fallback if output channel creation failed (e.g. in tests)
			this.outputChannel ??= {
				append: () => { /* noop fallback */ },
				appendLine: () => { /* noop fallback */ },
				replace: () => { /* noop fallback */ },
				clear: () => { /* noop fallback */ },
				show: () => { /* noop fallback */ },
				hide: () => { /* noop fallback */ },
				dispose: () => { /* noop fallback */ },
				name: 'Forgejo'
			};

			// Check if debug mode is enabled
			try {
				const config = vscode.workspace.getConfiguration('forgejo');
				this.isDebugEnabled = config.get<boolean>('debug', false);
			} catch (e) {
				console.error('[Forgejo] Failed to get configuration:', e);
			}
		}
		return this.outputChannel;
	}

	/**
	 * Log an info message
	 */
	info(message: string, ...args: unknown[]): void {
		const formatted = this.format('INFO', message, args);
		this.getOutputChannel().appendLine(formatted);
	}

	/**
	 * Log a warning message
	 */
	warn(message: string, ...args: unknown[]): void {
		const formatted = this.format('WARN', message, args);
		this.getOutputChannel().appendLine(formatted);
		// Also log to console for visibility
		console.warn(`[Forgejo] ${message}`, ...args);
	}

	/**
	 * Log an error message
	 */
	error(message: string, ...args: unknown[]): void {
		const formatted = this.format('ERROR', message, args);
		this.getOutputChannel().appendLine(formatted);
		// Also log to console for visibility
		console.error(`[Forgejo] ${message}`, ...args);
	}

	/**
	 * Log a debug message (only if debug mode is enabled)
	 */
	debug(message: string, ...args: unknown[]): void {
		if (!this.isDebugEnabled) {
			return;
		}
		const formatted = this.format('DEBUG', message, args);
		this.getOutputChannel().appendLine(formatted);
	}

	/**
	 * Show the output channel
	 */
	show(): void {
		this.getOutputChannel().show();
	}

	/**
	 * Clear the output channel
	 */
	clear(): void {
		this.getOutputChannel().clear();
	}

	/**
	 * Format a log message with timestamp and level
	 */
	private format(level: string, message: string, args: unknown[]): string {
		const timestamp = new Date().toISOString();
		const argsStr = args.length > 0 ? ' ' + args.map(arg => Logger.formatArg(arg)).join(' ') : '';

		return `[${timestamp}] [${level}] ${message}${argsStr}`;
	}

	private static formatArg(arg: unknown): string {
		// Positive typeof checks: TypeScript cannot narrow `unknown` in the
		// negative branch of a typeof guard, which no-base-to-string requires.
		if (typeof arg === 'string') {
			return arg;
		}
		if (typeof arg === 'number' || typeof arg === 'boolean' ||
			typeof arg === 'bigint' || typeof arg === 'undefined' ||
			typeof arg === 'symbol' || typeof arg === 'function') {
			return String(arg);
		}
		return JSON.stringify(arg, null, 2);
	}

	/**
	 * Dispose the output channel
	 */
	dispose(): void {
		if (this.outputChannel) {
			this.outputChannel.dispose();
		}
	}
}

// Create a singleton instance
export const logger = new Logger();

/**
 * Convenience functions for logging
 */
export function logInfo(message: string, ...args: unknown[]): void {
	logger.info(message, ...args);
}

export function logWarn(message: string, ...args: unknown[]): void {
	logger.warn(message, ...args);
}

export function logError(message: string, ...args: unknown[]): void {
	logger.error(message, ...args);
}

export function logDebug(message: string, ...args: unknown[]): void {
	logger.debug(message, ...args);
}

export function showOutput(): void {
	logger.show();
}
