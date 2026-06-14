import * as vscode from 'vscode';
import { detectGitRemote, detectGitRepositoriesAsync, GitRemoteInfo } from './gitUtils';
import { ForgejoInstance } from '../models/instance';
import {
	getAllInstances,
	getDefaultOrFirstInstance,
	findBestInstanceMatch,
	normalizeUrl
} from './instanceHelpers';
import { logInfo, logDebug } from './logger';

export interface ForgejoConfig {
	instanceUrl: string;
	token: string;
	owner: string;
	repo: string;
	instanceId?: string;
	matchConfidence?: 'exact' | 'domain' | 'default' | 'first';
}

export interface ForgejoRepositoryConfig extends ForgejoConfig {
	label: string;
	rootPath?: string;
	remoteName?: string;
}

function getInstanceMatchTarget(gitInfo: GitRemoteInfo | null): string | null {
	if (!gitInfo) {
		return null;
	}

	return gitInfo.instanceUrl ?? gitInfo.remoteHost;
}

async function configFromGitInfo(gitInfo: GitRemoteInfo, instances: ForgejoInstance[], autoDetectFromRemote: boolean): Promise<ForgejoConfig | null> {
	let selectedInstance: ForgejoInstance | undefined;
	let confidence: 'exact' | 'domain' | 'default' | 'first' = 'first';

	if (instances.length > 0) {
		if (autoDetectFromRemote) {
			const matchTarget = getInstanceMatchTarget(gitInfo);
			const match = findBestInstanceMatch(instances, matchTarget);
			if (match) {
				selectedInstance = match.instance;
				confidence = match.confidence;
				logInfo(`Matched instance: ${selectedInstance.name} (${confidence} match)`);
			}
		}

		if (!selectedInstance) {
			selectedInstance = await getDefaultOrFirstInstance();
			confidence = selectedInstance?.isDefault ? 'default' : 'first';

			if (selectedInstance) {
				logInfo(`Using ${confidence} instance: ${selectedInstance.name}`);
			}
		}
	}

	if (!selectedInstance) {
		if (!gitInfo.instanceUrl) {
			logInfo('Git remote is SSH-based and no configured Forgejo instance matched; cannot infer API URL safely');
			return null;
		}

		logInfo('No instances configured, using HTTP(S) git remote for unauthenticated access');
		return {
			instanceUrl: normalizeUrl(gitInfo.instanceUrl),
			token: '',
			owner: gitInfo.owner,
			repo: gitInfo.repo,
			matchConfidence: 'default'
		};
	}

	return {
		instanceUrl: normalizeUrl(selectedInstance.instanceUrl),
		token: selectedInstance.token ?? '',
		owner: gitInfo.owner,
		repo: gitInfo.repo,
		instanceId: selectedInstance.id,
		matchConfidence: confidence
	};
}

/**
 * Get Forgejo configuration from VS Code settings
 */
export async function getForgejoConfig(): Promise<ForgejoConfig | null> {
	logDebug('Getting configuration...');

	// Get all configured instances
	const instances = await getAllInstances();

	// Get preferred remote name from configuration
	const forgejoSettings = vscode.workspace.getConfiguration('forgejo');
	const preferredRemote = forgejoSettings.get<string>('preferredRemote', '');
	const autoDetectFromRemote = forgejoSettings.get<boolean>('autoDetectFromRemote') !== false;

	// Get git remote info, using preferred remote if configured
	const gitInfo = detectGitRemote(preferredRemote || undefined);

	if (!gitInfo) {
		logInfo('Could not determine owner/repo from git remote');
		return null;
	}

	const finalConfig = await configFromGitInfo(gitInfo, instances, autoDetectFromRemote);
	if (finalConfig) {
		logDebug('Final configuration:', {
			...finalConfig,
			token: finalConfig.token ? '***' : '(not set)'
		});
	}
	return finalConfig;
}

export async function getForgejoConfigFor(owner: string, repo: string, instanceUrl?: string): Promise<ForgejoConfig | null> {
	const normalizedInstanceUrl = instanceUrl ? normalizeUrl(instanceUrl) : undefined;
	const instances = await getAllInstances();

	if (normalizedInstanceUrl) {
		const instance = instances.find(item => normalizeUrl(item.instanceUrl) === normalizedInstanceUrl);
		return {
			instanceUrl: normalizedInstanceUrl,
			token: instance?.token ?? '',
			owner,
			repo,
			instanceId: instance?.id,
			matchConfidence: instance ? 'exact' : 'default'
		};
	}

	const repositoryConfigs = await getForgejoRepositoryConfigs();
	const matchingConfig = repositoryConfigs.find(config => config.owner === owner && config.repo === repo);
	if (matchingConfig) {
		return matchingConfig;
	}

	const activeConfig = await getForgejoConfig();
	return activeConfig?.owner === owner && activeConfig.repo === repo ? activeConfig : null;
}

export async function getForgejoRepositoryConfigs(): Promise<ForgejoRepositoryConfig[]> {
	const instances = await getAllInstances();
	const forgejoSettings = vscode.workspace.getConfiguration('forgejo');
	const preferredRemote = forgejoSettings.get<string>('preferredRemote', '');
	const autoDetectFromRemote = forgejoSettings.get<boolean>('autoDetectFromRemote') !== false;
	const gitInfos = await detectGitRepositoriesAsync(preferredRemote || undefined);
	const configs = new Map<string, ForgejoRepositoryConfig>();

	for (const gitInfo of gitInfos) {
		const config = await configFromGitInfo(gitInfo, instances, autoDetectFromRemote);
		if (config) {
			const key = `${normalizeUrl(config.instanceUrl)}/${config.owner}/${config.repo}`;
			if (!configs.has(key)) {
				configs.set(key, {
					...config,
					label: `${config.owner}/${config.repo}`,
					rootPath: gitInfo.rootPath,
					remoteName: gitInfo.remoteName
				});
			}
		}
	}

	if (configs.size > 0) {
		return Array.from(configs.values());
	}

	const fallbackConfig = await getForgejoConfig();
	return fallbackConfig ? [{ ...fallbackConfig, label: `${fallbackConfig.owner}/${fallbackConfig.repo}` }] : [];
}

/**
 * Set instance URL in configuration
 */
export async function setInstanceUrl(url: string): Promise<void> {
  const config = vscode.workspace.getConfiguration('forgejo');
  await config.update('instanceUrl', url, vscode.ConfigurationTarget.Global);
}

/**
 * @deprecated Token is now stored in SecretStorage. Use secretStorage.setToken() instead.
 */
export function setAuthToken(_token: string): Promise<void> {
  // This function is kept for backward compatibility but no longer stores tokens in settings.
  // Callers should use secretStorage.setToken() directly.
  throw new Error('setAuthToken is deprecated. Use SecretStorage instead.');
}
