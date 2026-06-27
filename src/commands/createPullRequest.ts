import * as path from 'path';
import * as vscode from 'vscode';
import { execSync, spawnSync } from 'child_process';
import { ForgejoClient } from '../api/forgejoClient';
import { ForgejoConfig, getForgejoConfig } from '../utils/config';
import type { API, GitExtension, Repository } from '../types/git';
import { activateGitExtension } from '../utils/gitExtension';
import { repositoryMatchesConfig } from '../utils/gitRepositoryMatch';
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

interface RepositoryPick extends vscode.QuickPickItem {
	repository: Repository;
}

async function getGitApi(): Promise<API | undefined> {
	const gitExtension: GitExtension | undefined = await activateGitExtension();
	if (!gitExtension?.enabled) {
		return undefined;
	}

	return gitExtension.getAPI(1);
}

function activeRepository(git: API): Repository | null {
	const activeUri = vscode.window.activeTextEditor?.document.uri;
	return activeUri ? git.getRepository(activeUri) : null;
}

function repositorySelectionPriority(repository: Repository, active: Repository | null, preferredRootPath?: string): number {
	let priority = 0;
	if (preferredRootPath && repository.rootUri.fsPath === preferredRootPath) {
		priority += 2;
	}
	if (repository === active) {
		priority += 1;
	}
	return priority;
}

/**
 * Resolve the local checkout to read branch state from when no explicit
 * repository root was passed (i.e. the command-palette / view-title path).
 *
 * The branch must be read from the SAME local repository that the resolved
 * Forgejo config (owner/repo/instanceUrl) refers to. Previously this fell back
 * to `workspaceFolders[0]`, which can be a different checkout in multi-root or
 * nested-repository workspaces and produced PRs with the wrong head/base branch.
 *
 * Resolution order:
 *  1. VS Code Git repositories whose remotes match the resolved config.
 *     - single match -> use it
 *     - multiple matches -> prefer active editor / preferred root, else prompt
 *  2. A single unambiguous workspace folder (only when exactly one is open and
 *     no Git-extension repository matched).
 *  3. Otherwise surface an error so the user invokes the command from the tree.
 *
 * Returns `undefined` when the user cancelled a picker or no root could be
 * resolved safely; an error message is shown in that case.
 */
async function resolveWorkspaceRoot(
	config: ForgejoConfig,
	preferredRootPath?: string
): Promise<string | undefined> {
	const git = await getGitApi();
	if (git) {
		const matching = git.repositories.filter(repository =>
			repositoryMatchesConfig(repository, config.owner, config.repo, config.instanceUrl)
		);

		if (matching.length === 1) {
			return matching[0].rootUri.fsPath;
		}

		if (matching.length > 1) {
			const active = activeRepository(git);
			const sorted = [...matching].sort((left, right) =>
				repositorySelectionPriority(right, active, preferredRootPath)
					- repositorySelectionPriority(left, active, preferredRootPath)
			);
			const picks: RepositoryPick[] = sorted.map(repository => ({
				label: path.basename(repository.rootUri.fsPath),
				description: repository === active ? 'active editor' : undefined,
				detail: repository.rootUri.fsPath,
				repository
			}));

			const selected = await vscode.window.showQuickPick(picks, {
				title: 'Create Pull Request',
				placeHolder: 'Select the local repository to read the branch from'
			});

			return selected?.repository.rootUri.fsPath;
		}
	}

	// No matching Git-extension repository. Only fall back to a workspace folder
	// when it is unambiguous (exactly one folder open), so we never silently read
	// branch state from an unrelated checkout in a multi-root workspace.
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (workspaceFolders && workspaceFolders.length === 1) {
		return workspaceFolders[0].uri.fsPath;
	}

	void vscode.window.showErrorMessage(
		'Could not determine which local repository to create the pull request from. Open a single repository, or use the Create Pull Request action on a repository in the Forgejo view.'
	);
	return undefined;
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

		const workspaceRoot = repositoryConfig?.rootPath
			?? await resolveWorkspaceRoot(config, repositoryConfig?.rootPath);
		if (!workspaceRoot) {
			// resolveWorkspaceRoot already surfaced an error or the user cancelled.
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
