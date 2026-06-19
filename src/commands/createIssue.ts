import * as vscode from 'vscode';
import { getForgejoConfig } from '../utils/config';
import { IssueCreateWebviewProvider } from '../webview/issueCreate/provider';

/**
 * Handles the forgejo.createIssue command.
 * Extracted from extension.ts for unit testability.
 */
export async function createIssueCommand(issueCreateWebviewProvider: IssueCreateWebviewProvider): Promise<void> {
	const config = await getForgejoConfig();
	if (!config) {
		void vscode.window.showErrorMessage('Forgejo configuration not found. Please configure an instance first.');
		return;
	}

	if (!config.token) {
		void vscode.window.showErrorMessage('A Forgejo token is required to create issues. Please configure your token first.');
		return;
	}

	issueCreateWebviewProvider.showCreateIssue(config);
}
