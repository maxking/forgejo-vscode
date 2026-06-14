import * as vscode from 'vscode';
import { execSync, spawnSync } from 'child_process';
import { ForgejoClient } from '../api/forgejoClient';
import { ForgejoConfig, getForgejoConfig } from '../utils/config';
import { logInfo, logError } from '../utils/logger';
import { PRTreeProvider } from '../providers/prTreeProvider';

/**
 * Converts a git branch name to a human-readable title.
 * Replaces hyphens and underscores with spaces, then capitalizes the first letter.
 * Exported as a pure function for unit testability.
 */
export function branchNameToTitle(branchName: string): string {
	return branchName
		.replace(/[-_]/g, ' ')
		.replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Handles the forgejo.createPullRequest command.
 * Extracted from extension.ts for unit testability.
 */
export async function createPullRequestCommand(prTreeProvider: PRTreeProvider, repositoryConfig?: ForgejoConfig & { rootPath?: string }): Promise<void> {
	try {
		const config = repositoryConfig ?? await getForgejoConfig();
		if (!config) {
			void vscode.window.showErrorMessage('Forgejo configuration not found. Please configure an instance first.');
			return;
		}

		if (!config.token) {
			void vscode.window.showErrorMessage('A Forgejo token is required to create pull requests. Please configure your token first.');
			return;
		}

		const workspaceRoot = repositoryConfig?.rootPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!workspaceRoot) {
			void vscode.window.showErrorMessage('No workspace folder open.');
			return;
		}

		// Get current branch name
		let currentBranch: string;
		try {
			currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
				cwd: workspaceRoot,
				encoding: 'utf-8'
			}).trim();
		} catch {
			void vscode.window.showErrorMessage('Could not determine the current git branch.');
			return;
		}

		// Get default branch
		let defaultBranch = 'main';
		try {
			const preferredRemote = vscode.workspace.getConfiguration('forgejo').get<string>('preferredRemote', 'origin') || 'origin';
			const result = spawnSync('git', ['symbolic-ref', `refs/remotes/${preferredRemote}/HEAD`], {
				cwd: workspaceRoot,
				encoding: 'utf-8'
			});
			if (result.status === 0) {
				const symbolicRef = result.stdout.trim();
				// Extract branch name from refs/remotes/<remote>/<branch>
				defaultBranch = symbolicRef.replace(/^refs\/remotes\//, '').replace(/^[^/]+\//, '');
			}
		} catch {
			// Fall back to 'main' if we can't detect it
			defaultBranch = 'main';
		}

		const defaultTitle = branchNameToTitle(currentBranch);

		// Prompt for PR title
		const title = await vscode.window.showInputBox({
			prompt: 'Enter pull request title',
			placeHolder: 'Pull request title',
			value: defaultTitle,
			validateInput: (value) => {
				if (!value.trim()) {
					return 'Title is required';
				}
				return null;
			}
		});

		if (!title) {
			return; // User cancelled
		}

		// Prompt for PR body (optional)
		const body = await vscode.window.showInputBox({
			prompt: 'Enter pull request description (optional)',
			placeHolder: 'Brief description (you can edit the full description later)'
		});

		if (body === undefined) {
			return; // User cancelled (pressing Escape)
		}

		// Prompt for base branch
		const baseBranch = await vscode.window.showInputBox({
			prompt: 'Enter the base branch to merge into',
			placeHolder: defaultBranch,
			value: defaultBranch
		});

		if (!baseBranch) {
			return; // User cancelled
		}

		// Create the pull request
		const client = new ForgejoClient(config.instanceUrl, config.token);
		const pr = await client.createPullRequest(
			config.owner,
			config.repo,
			title.trim(),
			currentBranch,
			baseBranch.trim(),
			body.trim() || undefined
		);

		logInfo(`PR #${pr.number} created: ${pr.title}`);

		// Refresh immediately so the new PR appears regardless of notification interaction
		prTreeProvider.refresh();

		const action = await vscode.window.showInformationMessage(
			`PR #${pr.number} created successfully!`,
			'Open in Browser'
		);

		if (action === 'Open in Browser') {
			void vscode.env.openExternal(vscode.Uri.parse(pr.html_url));
		}
	} catch (error) {
		logError('Error creating pull request:', error);
		void vscode.window.showErrorMessage(
			`Failed to create pull request: ${error instanceof Error ? error.message : 'Unknown error'}`
		);
	}
}
