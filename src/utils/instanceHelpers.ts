import * as vscode from 'vscode';
import { ForgejoInstance, InstanceMatch } from '../models/instance';
import { ForgejoClient } from '../api/forgejoClient';
import { logInfo, logWarn, logError } from './logger';
import { getToken, setToken, deleteToken, isInitialized } from './secretStorage';

/**
 * Generates a UUID v4
 */
export function generateUUID(): string {
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
		const r = Math.random() * 16 | 0;
		const v = c === 'x' ? r : (r & 0x3 | 0x8);
		return v.toString(16);
	});
}

/**
 * Normalizes a URL by removing trailing slashes and ensuring protocol
 */
export function normalizeUrl(url: string): string {
	let normalized = url.trim();

	// Add https:// if no protocol
	if (!normalized.match(/^https?:\/\//)) {
		normalized = `https://${normalized}`;
	}

	// Remove trailing slash
	normalized = normalized.replace(/\/$/, '');

	return normalized;
}

/**
 * Validates that an instance has all required fields
 */
export function isValidInstance(instance: unknown): instance is ForgejoInstance {
	if (!instance || typeof instance !== 'object') {
		return false;
	}
	const obj = instance as Record<string, unknown>;
	return (
		typeof obj.id === 'string' &&
		obj.id.trim() !== '' &&
		typeof obj.name === 'string' &&
		obj.name.trim() !== '' &&
		typeof obj.instanceUrl === 'string' &&
		obj.instanceUrl.trim() !== ''
	);
}

/**
 * Gets all configured instances, filtering out any invalid ones
 */
export async function getAllInstances(): Promise<ForgejoInstance[]> {
	const config = vscode.workspace.getConfiguration('forgejo');
	const instances = config.get<unknown[]>('instances', []);

	// Filter and validate instances (synchronous validation)
	const validInstances: ForgejoInstance[] = [];
	const invalidInstances: unknown[] = [];

	for (const instance of instances) {
		if (isValidInstance(instance)) {
			validInstances.push(instance);
		} else {
			invalidInstances.push(instance);
		}
	}

	// Log invalid instances
	for (const instance of invalidInstances) {
		logWarn('Found and skipped invalid instance:', instance);
	}

	// If we filtered out any invalid instances, save the cleaned list
	if (validInstances.length !== instances.length && instances.length > 0) {
		logInfo(`Cleaned up ${instances.length - validInstances.length} invalid instance(s)`);
		await config.update('instances', validInstances, vscode.ConfigurationTarget.Global);
	}

	// Hydrate tokens from SecretStorage
	if (isInitialized()) {
		for (const instance of validInstances) {
			const token = await getToken(instance.id);
			if (token) {
				instance.token = token;
			}
		}
	}

	return validInstances;
}

/**
 * Gets instance by ID
 */
export async function getInstanceById(id: string): Promise<ForgejoInstance | undefined> {
	const instances = await getAllInstances();
	return instances.find(i => i.id === id);
}

/**
 * Gets the default instance or the first one if no default is set
 */
export async function getDefaultOrFirstInstance(): Promise<ForgejoInstance | undefined> {
	const instances = await getAllInstances();
	if (instances.length === 0) {
		return undefined;
	}

	const defaultInstance = instances.find(i => i.isDefault);
	return defaultInstance ?? instances[0];
}

/**
 * Adds a new instance
 */
export async function addInstance(instance: ForgejoInstance): Promise<void> {
	logInfo('Adding instance:', { id: instance.id, name: instance.name, url: instance.instanceUrl });

	const config = vscode.workspace.getConfiguration('forgejo');
	const instances = await getAllInstances();

	logInfo('Current instances count:', instances.length);

	// If this is the first instance, make it default
	if (instances.length === 0) {
		instance.isDefault = true;
		logInfo('Set as default (first instance)');
	}

	// Store token in SecretStorage before saving instance to settings
	if (instance.token && isInitialized()) {
		await setToken(instance.id, instance.token);
		logInfo('Token stored in SecretStorage');
	}

	// Strip token from settings-bound copy
	const settingsInstance = stripTokenFromInstance(instance);
	instances.push(settingsInstance);
	logInfo('Saving instances array with', instances.length, 'instance(s)');

	try {
		await config.update('instances', instances.map(stripTokenFromInstance), vscode.ConfigurationTarget.Global);
		logInfo('Config updated successfully');

		// Verify the save worked
		const verification = await getAllInstances();
		logInfo('Verification: found', verification.length, 'instance(s) after save');

		if (verification.find(i => i.id === instance.id)) {
			logInfo('✓ Instance successfully saved and verified');
		} else {
			logError('✗ Instance was NOT saved properly!');
			throw new Error('Instance save verification failed');
		}

		// Sync to legacy settings for backward compatibility
		await syncToLegacySettings(instance);
		logInfo('Legacy settings synced');
	} catch (error) {
		logError('Error saving instance:', error);
		throw error;
	}
}

/**
 * Updates an existing instance
 */
export async function updateInstance(instance: ForgejoInstance): Promise<void> {
	const config = vscode.workspace.getConfiguration('forgejo');
	const instances = await getAllInstances();

	const index = instances.findIndex(i => i.id === instance.id);
	if (index === -1) {
		throw new Error(`Instance ${instance.id} not found`);
	}

	instances[index] = instance;
	// Strip tokens from all instances before writing to settings
	await config.update('instances', instances.map(stripTokenFromInstance), vscode.ConfigurationTarget.Global);

	// Sync to legacy settings if this is the default
	if (instance.isDefault) {
		await syncToLegacySettings(instance);
	}
}

/**
 * Removes an instance
 */
export async function removeInstance(id: string): Promise<void> {
	const config = vscode.workspace.getConfiguration('forgejo');
	const instances = await getAllInstances();

	const filtered = instances.filter(i => i.id !== id);
	await config.update('instances', filtered.map(stripTokenFromInstance), vscode.ConfigurationTarget.Global);

	// Delete token from SecretStorage
	if (isInitialized()) {
		await deleteToken(id);
	}

	// If we removed the default, make the first remaining instance default
	if (filtered.length > 0 && !filtered.some(i => i.isDefault)) {
		filtered[0].isDefault = true;
		await config.update('instances', filtered.map(stripTokenFromInstance), vscode.ConfigurationTarget.Global);
		await syncToLegacySettings(filtered[0]);
	} else if (filtered.length === 0) {
		// Do not leave compatibility settings capable of recreating the deleted
		// instance on the next activation.
		for (const key of ['instanceUrl', 'token'] as const) {
			const inspection = config.inspect(key);
			if (inspection?.globalValue !== undefined) await config.update(key, undefined, vscode.ConfigurationTarget.Global);
			if (inspection?.workspaceValue !== undefined) await config.update(key, undefined, vscode.ConfigurationTarget.Workspace);
		}
		for (const folder of vscode.workspace.workspaceFolders ?? []) {
			const folderConfig = vscode.workspace.getConfiguration('forgejo', folder.uri);
			for (const key of ['instanceUrl', 'token'] as const) {
				if (folderConfig.inspect(key)?.workspaceFolderValue !== undefined) {
					await folderConfig.update(key, undefined, vscode.ConfigurationTarget.WorkspaceFolder);
				}
			}
		}
	}
}

/**
 * Sets an instance as the default
 */
export async function setDefaultInstance(id: string): Promise<void> {
	const config = vscode.workspace.getConfiguration('forgejo');
	const instances = await getAllInstances();

	// Clear all defaults and set the new one
	instances.forEach(i => {
		i.isDefault = i.id === id;
	});

	await config.update('instances', instances.map(stripTokenFromInstance), vscode.ConfigurationTarget.Global);

	// Sync to legacy settings
	const defaultInstance = instances.find(i => i.id === id);
	if (defaultInstance) {
		await syncToLegacySettings(defaultInstance);
	}
}

/**
 * Tests connection to an instance
 * @param instance The instance to test
 * @param saveResult Whether to save the test result to config (default: true, set to false for temporary instances)
 */
export async function testInstanceConnection(instance: ForgejoInstance, saveResult = true): Promise<boolean> {
	logInfo('Testing connection to:', instance.instanceUrl);

	try {
		const client = new ForgejoClient(instance.instanceUrl, instance.token);
		logInfo('Calling testConnection API...');
		// `/version` is public and only proves that a Forgejo server is reachable.
		// When a token is supplied, validate it against an authenticated endpoint.
		const success = instance.token?.trim()
			? Boolean(await client.rawRequest<{ login?: string }>('GET', '/user'))
			: await client.testConnection();

		logInfo('Connection test result:', success ? 'SUCCESS' : 'FAILED');

		// Update instance with test result
		instance.lastConnectionTest = {
			success,
			timestamp: Date.now(),
			error: success ? undefined : 'Connection failed'
		};

		// Only save if the instance exists in config
		if (saveResult) {
			const existing = await getInstanceById(instance.id);
			if (existing) {
				logInfo('Saving test result to instance config');
				await updateInstance(instance);
			} else {
				logInfo('Skipping save (temporary instance)');
			}
		}

		return success;
	} catch (error) {
		logError('Connection test error:', error);

		// Update instance with error
		instance.lastConnectionTest = {
			success: false,
			timestamp: Date.now(),
			error: error instanceof Error ? error.message : 'Unknown error'
		};

		// Only save if the instance exists in config
		if (saveResult) {
			const existing = await getInstanceById(instance.id);
			if (existing) {
				await updateInstance(instance);
			}
		}

		return false;
	}
}

/**
 * Finds the best matching instance for a given remote URL
 */
export function findBestInstanceMatch(
	instances: ForgejoInstance[],
	remoteUrl: string | null
): InstanceMatch | null {
	if (!remoteUrl || instances.length === 0) {
		return null;
	}

	const normalizedRemote = normalizeUrl(remoteUrl);

	// Try exact match first
	for (const instance of instances) {
		if (normalizeUrl(instance.instanceUrl) === normalizedRemote) {
			return { instance, confidence: 'exact' };
		}
	}

	// Try domain match (handle http vs https, www vs non-www)
	try {
		const remoteHost = new URL(normalizedRemote).host;

		for (const instance of instances) {
			try {
				const instanceHost = new URL(normalizeUrl(instance.instanceUrl)).host;
				if (instanceHost === remoteHost) {
					return { instance, confidence: 'domain' };
				}
			} catch {
				continue;
			}
		}
	} catch {
		// remoteUrl is a bare host (SSH transport), not a full URL.
		// Fall through to the SSH-host match below.
	}

	// SSH-transport host match: for SSH git remotes the match target is the bare
	// SSH hostname (e.g. `ssh.example.com`), which may differ from the web/API
	// host. Match it against any instance that explicitly declares an `sshHost`.
	// Hostnames are case-insensitive (RFC 4343), so compare on lowercased,
	// trimmed values — the onboarding/schema allow uppercase input.
	const normalizedRemoteHost = remoteUrl.trim().toLowerCase();
	for (const instance of instances) {
		if (instance.sshHost && instance.sshHost.trim().toLowerCase() === normalizedRemoteHost) {
			return { instance, confidence: 'domain' };
		}
	}

	return null;
}

/**
 * Syncs instance to legacy settings for backward compatibility
 */
async function syncToLegacySettings(instance: ForgejoInstance): Promise<void> {
	const config = vscode.workspace.getConfiguration('forgejo');
	await config.update('instanceUrl', instance.instanceUrl, vscode.ConfigurationTarget.Global);
	// Token is no longer synced to legacy settings — stored in SecretStorage instead
}

/**
 * Creates a copy of the instance with the token stripped out, safe for writing to settings.json
 */
function stripTokenFromInstance(instance: ForgejoInstance): ForgejoInstance {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { token: _token, ...rest } = instance;
	return rest as ForgejoInstance;
}

/**
 * Generates a default instance name from URL
 */
export function getDefaultInstanceName(instanceUrl: string): string {
	try {
		const url = new URL(instanceUrl);
		const hostname = url.hostname;

		// Known instances
		const knownInstances: Record<string, string> = {
			'codeberg.org': 'Codeberg',
			'gitea.com': 'Gitea',
			'git.disroot.org': 'Disroot',
		};

		return knownInstances[hostname] ?? hostname;
	} catch {
		return 'Default Instance';
	}
}

/**
 * Gets connection status string for display
 */
export function getConnectionStatus(instance: ForgejoInstance): string {
	if (!instance.lastConnectionTest) {
		return '$(question) Not tested';
	}

	const { success, timestamp, error } = instance.lastConnectionTest;
	const timeAgo = getTimeAgo(timestamp);

	if (success) {
		return `$(check) Connected (${timeAgo})`;
	} else {
		return `$(x) Failed (${timeAgo})${error ? ': ' + error : ''}`;
	}
}

/**
 * Formats a timestamp as "time ago"
 */
function getTimeAgo(timestamp: number): string {
	const seconds = Math.floor((Date.now() - timestamp) / 1000);

	if (seconds < 60) {
		return 'just now';
	}

	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) {
		return `${minutes}m ago`;
	}

	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		return `${hours}h ago`;
	}

	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}
