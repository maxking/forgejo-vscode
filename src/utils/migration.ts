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
	const scopes = [
		{ value: 'globalValue' as const, target: vscode.ConfigurationTarget.Global },
		{ value: 'workspaceValue' as const, target: vscode.ConfigurationTarget.Workspace },
		{ value: 'workspaceFolderValue' as const, target: vscode.ConfigurationTarget.WorkspaceFolder }
	];
	const instanceInspection = config.inspect<ForgejoInstance[]>('instances');
	const effectiveInstances = config.get<ForgejoInstance[]>('instances', []);

	for (const scope of scopes) {
		const instances = instanceInspection?.[scope.value];
		if (!instances) continue;
		const tokenBearing = instances.filter(instance => instance.id && instance.token?.trim());
		for (const instance of tokenBearing) {
			const token = instance.token?.trim();
			if (token) await setToken(instance.id, token);
		}
		if (tokenBearing.length > 0) {
			await config.update('instances', instances.map(({ token: _token, ...rest }) => rest), scope.target);
		}
	}

	const tokenInspection = config.inspect<string>('token');
	const defaultInstance: ForgejoInstance | undefined = effectiveInstances.find(instance => instance.isDefault)
		?? (effectiveInstances.length > 0 ? effectiveInstances[0] : undefined);
	for (const scope of scopes) {
		const legacyToken = tokenInspection?.[scope.value];
		if (!legacyToken?.trim()) continue;
		if (defaultInstance) await setToken(defaultInstance.id, legacyToken.trim());
		else logWarn('Legacy forgejo.token could not be migrated because no instance exists');
		await config.update('token', undefined, scope.target);
	}
	logInfo('Token migration to SecretStorage complete');
}
