import * as vscode from 'vscode';
import * as path from 'path';
import { ForgejoClient } from '../api/forgejoClient';
import { getAllInstances } from '../utils/instanceHelpers';
import { logInfo, logError } from '../utils/logger';
import type { Repository, RemoteSourcePublisher } from '../types/git';

export function createRemoteSourcePublisher(): RemoteSourcePublisher {
	return {
		name: 'Forgejo',
		icon: 'forgejo-logo',

		async publishRepository(repository: Repository): Promise<void> {
			const instances = await getAllInstances();

			if (instances.length === 0) {
				const action = await vscode.window.showErrorMessage(
					'No Forgejo instances configured.',
					'Add Instance'
				);
				if (action === 'Add Instance') {
					await vscode.commands.executeCommand('forgejo.addInstance');
				}
				return;
			}

			// Pick instance — skip picker if only one is configured
			let instanceUrl: string;
			let token: string | undefined;

			if (instances.length === 1) {
				instanceUrl = instances[0].instanceUrl;
				token = instances[0].token;
			} else {
				const picked = await vscode.window.showQuickPick(
					instances.map(i => ({
						label: i.name,
						description: i.instanceUrl,
						instanceUrl: i.instanceUrl,
						token: i.token,
					})),
					{ placeHolder: 'Select Forgejo instance to publish to' }
				);
				if (!picked) return;
				instanceUrl = picked.instanceUrl;
				token = picked.token;
			}

			if (!token) {
				void vscode.window.showErrorMessage(
					`No token configured for ${instanceUrl}. Please set a token in Forgejo: Manage Instances.`
				);
				return;
			}

			const client = new ForgejoClient(instanceUrl, token);

			// Default repo name from folder
			const folderName = path.basename(repository.rootUri.fsPath);

			const repoName = await vscode.window.showInputBox({
				title: 'Publish to Forgejo',
				prompt: 'Repository name',
				value: folderName,
				validateInput: v => (v?.trim() ? null : 'Name is required'),
			});
			if (!repoName) return;

			const description = await vscode.window.showInputBox({
				title: 'Publish to Forgejo',
				prompt: 'Repository description (optional)',
			});
			if (description === undefined) return; // user pressed Escape

			const visibility = await vscode.window.showQuickPick(
				[
					{ label: '$(globe) Public', isPrivate: false },
					{ label: '$(lock) Private', isPrivate: true },
				],
				{ title: 'Publish to Forgejo', placeHolder: 'Repository visibility' }
			);
			if (!visibility) return;

			logInfo(`Publishing repository "${repoName}" to ${instanceUrl}`);

			let repo;
			try {
				repo = await client.createRepository({
					name: repoName.trim(),
					description: description.trim() || undefined,
					private: visibility.isPrivate,
				});
			} catch (err) {
				logError('Failed to create repository on Forgejo', err);
				void vscode.window.showErrorMessage(
					`Failed to create repository: ${err instanceof Error ? err.message : String(err)}`
				);
				return;
			}

			// Add remote
			try {
				await repository.addRemote('origin', repo.clone_url);
				logInfo(`Remote 'origin' set to ${repo.clone_url}`);
			} catch (err) {
				logError('Failed to add remote', err);
				void vscode.window.showErrorMessage(
					`Repository created but could not add remote: ${err instanceof Error ? err.message : String(err)}`
				);
				return;
			}

			// If no commits yet, auto-commit everything (mirrors GitLab extension approach)
			if (!repository.state.HEAD?.commit) {
				try {
					await repository.commit('Initial commit', { all: true });
					logInfo('Initial commit created');
				} catch (err) {
					logError('Failed to create initial commit', err);
					void vscode.window.showErrorMessage(
						`Repository created but initial commit failed: ${err instanceof Error ? err.message : String(err)}`
					);
					return;
				}
			}

			const branch = repository.state.HEAD?.name ?? 'main';
			try {
				await repository.push('origin', branch, true);
				logInfo('Push successful');
			} catch (err) {
				logError('Failed to push to remote', err);
				void vscode.window.showErrorMessage(
					`Repository created but push failed: ${err instanceof Error ? err.message : String(err)}`
				);
				return;
			}

			const message = `Repository published to ${repo.html_url}`;

			const action = await vscode.window.showInformationMessage(message, 'Open in Browser');
			if (action === 'Open in Browser') {
				void vscode.env.openExternal(vscode.Uri.parse(repo.html_url));
			}
		},
	};
}
