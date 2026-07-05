import * as vscode from 'vscode';
import { ForgejoClient } from '../api/forgejoClient';
import { ForgejoConfig, getForgejoConfig, getForgejoRepositoryConfigs } from '../utils/config';
import { logInfo, logError } from '../utils/logger';
import { ReleaseGroupItem, ReleaseRepositoryItem, ReleaseTreeProvider } from '../providers/releaseTreeProvider';

type CreateReleaseTarget = ForgejoConfig | ReleaseRepositoryItem | ReleaseGroupItem | undefined;

function isRepositoryConfig(value: unknown): value is ForgejoConfig {
	return Boolean(
		value
		&& typeof value === 'object'
		&& 'instanceUrl' in value
		&& 'owner' in value
		&& 'repo' in value
	);
}

function configFromTarget(target: CreateReleaseTarget): ForgejoConfig | undefined {
	if (!target) {
		return undefined;
	}

	if (target instanceof ReleaseRepositoryItem || target instanceof ReleaseGroupItem) {
		return target.config;
	}

	return isRepositoryConfig(target) ? target : undefined;
}

async function pickRepositoryConfig(): Promise<ForgejoConfig | null> {
	const configs = await getForgejoRepositoryConfigs();
	if (configs.length === 1) {
		return configs[0];
	}

	if (configs.length > 1) {
		const picked = await vscode.window.showQuickPick(
			configs.map(config => ({
				label: config.label,
				description: config.rootPath,
				detail: `${config.instanceUrl}/${config.owner}/${config.repo}`,
				config,
			})),
			{ placeHolder: 'Select repository for the new release', title: 'Create Release: Repository' }
		);
		return picked?.config ?? null;
	}

	return getForgejoConfig();
}

async function resolveCreateReleaseConfig(target: CreateReleaseTarget): Promise<ForgejoConfig | null> {
	return configFromTarget(target) ?? pickRepositoryConfig();
}

/**
 * Handles the forgejo.createRelease command.
 * Extracted from extension.ts for unit testability.
 */
export async function createReleaseCommand(releaseTreeProvider: ReleaseTreeProvider, target?: CreateReleaseTarget): Promise<void> {
	try {
		const config = await resolveCreateReleaseConfig(target);
		if (!config) {
			void vscode.window.showErrorMessage('Forgejo configuration not found. Please configure an instance first.');
			return;
		}

		if (!config.token) {
			void vscode.window.showErrorMessage('A Forgejo token is required to create releases. Please configure your token first.');
			return;
		}

		const client = new ForgejoClient(config.instanceUrl, config.token);

		// Fetch existing tags for quick pick
		let tagItems: vscode.QuickPickItem[] = [];
		try {
			const tags = await client.listTags(config.owner, config.repo);
			tagItems = tags.map(t => ({ label: t.name, description: t.commit.sha.substring(0, 7) }));
		} catch {
			logInfo('Could not fetch tags, allowing manual entry');
		}

		let tagName: string | undefined;
		if (tagItems.length > 0) {
			const picked = await vscode.window.showQuickPick(
				[{ label: '$(add) Enter new tag name...', description: 'Type a new tag' }, ...tagItems],
				{ placeHolder: 'Select an existing tag or enter a new one', title: 'Create Release: Select Tag' }
			);
			if (!picked) return;
			if (picked.label.includes('Enter new tag name')) {
				tagName = await vscode.window.showInputBox({ prompt: 'Tag name', placeHolder: 'v1.0.0', title: 'Create Release: New Tag' });
			} else {
				tagName = picked.label;
			}
		} else {
			tagName = await vscode.window.showInputBox({ prompt: 'Tag name', placeHolder: 'v1.0.0', title: 'Create Release: Tag' });
		}
		if (!tagName) return;

		const releaseName = await vscode.window.showInputBox({
			prompt: 'Release name (leave empty to use tag name)',
			placeHolder: tagName,
			title: 'Create Release: Name'
		});
		if (releaseName === undefined) return;

		const releaseBody = await vscode.window.showInputBox({
			prompt: 'Release notes (optional)',
			placeHolder: 'Describe this release...',
			title: 'Create Release: Notes'
		});
		if (releaseBody === undefined) return;

		const releaseType = await vscode.window.showQuickPick(
			[
				{ label: 'Release', description: 'Published release', value: 'release' },
				{ label: 'Pre-release', description: 'Mark as pre-release', value: 'prerelease' },
				{ label: 'Draft', description: 'Save as draft', value: 'draft' }
			],
			{ placeHolder: 'Release type', title: 'Create Release: Type' }
		);
		if (!releaseType) return;

		const release = await client.createRelease(config.owner, config.repo, {
			tag_name: tagName,
			name: releaseName || tagName,
			body: releaseBody || '',
			draft: releaseType.value === 'draft',
			prerelease: releaseType.value === 'prerelease'
		});

		releaseTreeProvider.refresh();
		const openAction = await vscode.window.showInformationMessage(
			`Release "${release.name || release.tag_name}" created successfully`,
			'Open in Browser'
		);
		if (openAction === 'Open in Browser' && release.html_url) {
			void vscode.env.openExternal(vscode.Uri.parse(release.html_url));
		}
	} catch (error) {
		logError('Failed to create release:', error);
		void vscode.window.showErrorMessage(`Failed to create release: ${error instanceof Error ? error.message : 'Unknown error'}`);
	}
}
