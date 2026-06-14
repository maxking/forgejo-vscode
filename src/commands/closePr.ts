import * as vscode from 'vscode';
import { ForgejoClient } from '../api/forgejoClient';
import { ForgejoConfig, getForgejoConfig, getForgejoConfigFor } from '../utils/config';
import { PullRequestListItem } from '../models/pullRequest';
import { PRTreeProvider } from '../providers/prTreeProvider';

/**
 * Handles the forgejo.closePr command.
 * Extracted from extension.ts for unit testability.
 */
export async function closePrCommand(
	pr: PullRequestListItem,
	owner: string,
	repo: string,
	prTreeProvider: PRTreeProvider,
	repositoryConfig?: ForgejoConfig,
	instanceUrl?: string
): Promise<void> {
	try {
		// Confirm close
		const confirm = await vscode.window.showWarningMessage(
			`Are you sure you want to close PR #${pr.number}: "${pr.title}"?`,
			{ modal: true },
			'Close PR'
		);

		if (confirm !== 'Close PR') {
			return;
		}

		// Execute close
		const config = repositoryConfig ?? await getForgejoConfigFor(owner, repo, instanceUrl) ?? await getForgejoConfig();
		if (!config) {
			void vscode.window.showErrorMessage('Forgejo configuration not found');
			return;
		}

		const client = new ForgejoClient(config.instanceUrl, config.token);
		await client.closePullRequest(owner, repo, pr.number);

		void vscode.window.showInformationMessage(`PR #${pr.number} closed successfully!`);
		prTreeProvider.refresh();
	} catch (error) {
		console.error('[Forgejo] Error closing PR:', error);
		void vscode.window.showErrorMessage(
			`Failed to close PR: ${error instanceof Error ? error.message : 'Unknown error'}`
		);
	}
}
