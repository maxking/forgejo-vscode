import * as vscode from 'vscode';
import { ForgejoInstance } from '../models/instance';
import { generateUUID, normalizeUrl, getDefaultInstanceName } from './instanceHelpers';
import { setToken, isInitialized } from './secretStorage';
import { logInfo, logWarn } from './logger';

/**
 * Migrates legacy single-instance configuration to multi-instance format
 */
export async function migrateToMultiInstance(): Promise<void> {
	const config = vscode.workspace.getConfiguration('forgejo');
	const instances = config.get<ForgejoInstance[]>('instances');

	// Already migrated or no legacy config
	if (instances && instances.length > 0) {
		return;
	}

	// Check for legacy config
	const legacyUrl = config.get<string>('instanceUrl');
	const legacyToken = config.get<string>('token');

	if (legacyUrl && legacyUrl.trim() !== '') {
		const instance: ForgejoInstance = {
			id: generateUUID(),
			name: getDefaultInstanceName(legacyUrl),
			instanceUrl: normalizeUrl(legacyUrl),
			isDefault: true
		};

		// Store token in SecretStorage if available
		if (legacyToken && legacyToken.trim() !== '' && isInitialized()) {
			await setToken(instance.id, legacyToken.trim());
			logInfo('Legacy token migrated to SecretStorage');
		}

		await config.update('instances', [instance], vscode.ConfigurationTarget.Global);

		// Clear legacy token from settings
		if (legacyToken) {
			await config.update('token', undefined, vscode.ConfigurationTarget.Global);
			logInfo('Legacy token cleared from settings.json');
		}

		console.log('[Forgejo] Migrated legacy config to multi-instance');
		console.log(`[Forgejo] Created instance: ${instance.name} (${instance.instanceUrl})`);
	}
}

/**
 * Migrates plaintext tokens from settings.json instances to SecretStorage.
 * Called on activation after SecretStorage is initialized.
 */
export async function migrateTokensToSecretStorage(): Promise<void> {
	if (!isInitialized()) {
		logWarn('SecretStorage not initialized, skipping token migration');
		return;
	}

	const config = vscode.workspace.getConfiguration('forgejo');
	const instances = config.get<ForgejoInstance[]>('instances', []);

	// Check if any instances still have plaintext tokens in settings
	const instancesWithTokens = instances.filter(i => i.token && i.token.trim() !== '');
	if (instancesWithTokens.length > 0) {
		logInfo(`Migrating ${instancesWithTokens.length} plaintext token(s) to SecretStorage`);

		// Move each token to SecretStorage
		for (const instance of instancesWithTokens) {
			if (instance.id && instance.token) {
				await setToken(instance.id, instance.token.trim());
			}
		}

		// Rewrite instances without tokens
		const cleanedInstances = instances.map(i => {
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			const { token: _token, ...rest } = i;
			return rest;
		});
		await config.update('instances', cleanedInstances, vscode.ConfigurationTarget.Global);
		logInfo('Token migration to SecretStorage complete');
	}

	// Also clear legacy forgejo.token if still present
	const legacyToken = config.get<string>('token');
	if (legacyToken && legacyToken.trim() !== '') {
		// Find the default instance to associate the legacy token with
		const defaultInstance = instances.length > 0 ? (instances.find(i => i.isDefault) ?? instances[0]) : undefined;
		if (defaultInstance) {
			await setToken(defaultInstance.id, legacyToken.trim());
			await config.update('token', undefined, vscode.ConfigurationTarget.Global);
			logInfo('Legacy forgejo.token migrated to SecretStorage and cleared');
		} else {
			logWarn('Legacy forgejo.token could not be migrated because no instance exists');
		}
	}
}
