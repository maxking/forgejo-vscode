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

	type ScopeKey = 'globalValue' | 'workspaceValue' | 'workspaceFolderValue';
	const migrateConfig = async (config: vscode.WorkspaceConfiguration, scopes: { value: ScopeKey; target: vscode.ConfigurationTarget }[]): Promise<void> => {
		const instanceInspection = config.inspect<ForgejoInstance[]>('instances');
		const effectiveInstances = config.get<ForgejoInstance[]>('instances', []);
		const candidateInstances = [
			...effectiveInstances,
			...scopes.flatMap(scope => instanceInspection?.[scope.value] ?? [])
		];
		for (const scope of scopes) {
			const instances = instanceInspection?.[scope.value];
			if (!instances) continue;
			let changed = false;
			for (const instance of instances) {
				const token = instance.token?.trim();
				if (!instance.id || !token) continue;
				await setToken(instance.id, token);
				changed = true;
			}
			if (changed) await config.update('instances', instances.map(({ token: _token, ...rest }) => rest), scope.target);
		}

		const urlInspection = config.inspect<string>('instanceUrl');
		const tokenInspection = config.inspect<string>('token');
		// Without a legacy instanceUrl there is no host to match against, so fall back to
		// the default instance (or the first one) as the pre-URL-matching behavior did.
		// This ensures the plaintext token is migrated and cleared instead of lingering
		// in settings.json forever. When a URL *is* configured but matches nothing we keep
		// the token in place, to avoid handing it to an instance on a different host.
		const defaultInstance = candidateInstances.find(instance => instance.isDefault && instance.id)
			?? candidateInstances.find(instance => instance.id);
		for (const scope of scopes) {
			const legacyToken = tokenInspection?.[scope.value]?.trim();
			if (!legacyToken) continue;
			const legacyInstanceUrl = urlInspection?.[scope.value]?.trim();
			const normalizedLegacyUrl = legacyInstanceUrl ? normalizeUrl(legacyInstanceUrl) : undefined;
			const matchingInstance = normalizedLegacyUrl
				? candidateInstances.find(instance => normalizeUrl(instance.instanceUrl) === normalizedLegacyUrl)
				: defaultInstance;
			if (!matchingInstance) {
				logWarn(normalizedLegacyUrl
					? 'Legacy forgejo.token could not be migrated because no instance matches forgejo.instanceUrl'
					: 'Legacy forgejo.token could not be migrated because no instance exists');
				continue;
			}
			await setToken(matchingInstance.id, legacyToken);
			await config.update('token', undefined, scope.target);
		}
	};

	await migrateConfig(vscode.workspace.getConfiguration('forgejo'), [
		{ value: 'globalValue', target: vscode.ConfigurationTarget.Global },
		{ value: 'workspaceValue', target: vscode.ConfigurationTarget.Workspace }
	]);
	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		await migrateConfig(vscode.workspace.getConfiguration('forgejo', folder.uri), [
			{ value: 'workspaceFolderValue', target: vscode.ConfigurationTarget.WorkspaceFolder }
		]);
	}
	logInfo('Token migration to SecretStorage complete');
}
