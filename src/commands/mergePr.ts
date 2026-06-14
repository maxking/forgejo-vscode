import * as vscode from 'vscode';
import { ForgejoClient } from '../api/forgejoClient';
import { ForgejoConfig, getForgejoConfig, getForgejoConfigFor } from '../utils/config';
import { PullRequestListItem } from '../models/pullRequest';
import { PRTreeProvider } from '../providers/prTreeProvider';

/**
 * Handles the forgejo.mergePr command.
 * Extracted from extension.ts for unit testability.
 */
export async function mergePrCommand(
	pr: PullRequestListItem,
	owner: string,
	repo: string,
	prTreeProvider: PRTreeProvider,
	repositoryConfig?: ForgejoConfig,
	instanceUrl?: string
): Promise<void> {
	try {
		// Show merge method picker
		const mergeOptions = [
			{ label: 'Create merge commit', value: 'merge' as const },
			{ label: 'Squash and merge', value: 'squash' as const },
			{ label: 'Rebase and merge', value: 'rebase' as const },
			{ label: 'Rebase then merge', value: 'rebase-merge' as const },
			{ label: 'Fast-forward only', value: 'fast-forward-only' as const }
		];

		const selected = await vscode.window.showQuickPick(mergeOptions, {
			placeHolder: 'Select merge method'
		});

		if (!selected) {
			return; // User cancelled
		}

		// Confirm merge
		const confirm = await vscode.window.showWarningMessage(
			`Are you sure you want to merge PR #${pr.number}: "${pr.title}"?`,
			{ modal: true },
			'Merge'
		);

		if (confirm !== 'Merge') {
			return;
		}

		// Execute merge
		const config = repositoryConfig ?? await getForgejoConfigFor(owner, repo, instanceUrl) ?? await getForgejoConfig();
		if (!config) {
			void vscode.window.showErrorMessage('Forgejo configuration not found');
			return;
		}

		const client = new ForgejoClient(config.instanceUrl, config.token);
		await client.mergePullRequest(owner, repo, pr.number, selected.value);

		void vscode.window.showInformationMessage(`PR #${pr.number} merged successfully!`);
		prTreeProvider.refresh();
	} catch (error) {
		console.error('[Forgejo] Error merging PR:', error);
		void vscode.window.showErrorMessage(
			`Failed to merge PR: ${error instanceof Error ? error.message : 'Unknown error'}`
		);
	}
}
