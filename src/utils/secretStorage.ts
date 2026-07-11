import * as vscode from 'vscode';
import { logInfo } from './logger';

const TOKEN_KEY_PREFIX = 'forgejo-token-';

let secretStorage: vscode.SecretStorage | undefined;
const tokenChangeEmitter = new vscode.EventEmitter<string>();

/** Fires with the instance id whenever its stored credential changes. */
export const onDidChangeToken = tokenChangeEmitter.event;

/**
 * Initialize the secret storage with the extension context's secrets API.
 * Must be called early in activate() before any token operations.
 */
export function initializeSecretStorage(secrets: vscode.SecretStorage): void {
	secretStorage = secrets;
	logInfo('SecretStorage initialized');
}

function getStorage(): vscode.SecretStorage {
	if (!secretStorage) {
		throw new Error('SecretStorage not initialized. Call initializeSecretStorage() first.');
	}
	return secretStorage;
}

/**
 * Get a token for an instance from secure storage.
 */
export async function getToken(instanceId: string): Promise<string | undefined> {
	const storage = getStorage();
	return await storage.get(`${TOKEN_KEY_PREFIX}${instanceId}`);
}

/**
 * Store a token for an instance in secure storage.
 */
export async function setToken(instanceId: string, token: string): Promise<void> {
	const storage = getStorage();
	await storage.store(`${TOKEN_KEY_PREFIX}${instanceId}`, token);
	tokenChangeEmitter.fire(instanceId);
	logInfo(`Token stored securely for instance: ${instanceId}`);
}

/**
 * Delete a token for an instance from secure storage.
 */
export async function deleteToken(instanceId: string): Promise<void> {
	const storage = getStorage();
	await storage.delete(`${TOKEN_KEY_PREFIX}${instanceId}`);
	tokenChangeEmitter.fire(instanceId);
	logInfo(`Token deleted for instance: ${instanceId}`);
}

/**
 * Check if secret storage has been initialized.
 */
export function isInitialized(): boolean {
	return secretStorage !== undefined;
}

/**
 * Reset secret storage (for testing only).
 */
export function _resetForTesting(): void {
	secretStorage = undefined;
}
