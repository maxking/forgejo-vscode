import * as vscode from 'vscode';
import * as path from 'path';
import { ForgejoClient } from '../api/forgejoClient';
import { getAllInstances } from '../utils/instanceHelpers';
import { logInfo, logError } from '../utils/logger';
import type { Repository, RemoteSourcePublisher, API as GitAPI } from '../types/git';

async function pickInstance() {
	const instances = await getAllInstances();

	if (instances.length === 0) {
		const action = await vscode.window.showErrorMessage(
			'No Forgejo instances configured.',
			'Add Instance'
		);
		if (action === 'Add Instance') {
			await vscode.commands.executeCommand('forgejo.addInstance');
		}
		return undefined;
	}

	if (instances.length === 1) {
		return instances[0];
	}

	return vscode.window.showQuickPick(
		instances.map(i => ({
			label: i.name,
			description: i.instanceUrl,
			instanceUrl: i.instanceUrl,
			token: i.token,
		})),
		{ placeHolder: 'Select Forgejo instance to publish to' }
	);
}

async function collectInputs(folderName: string) {
	const repoName = await vscode.window.showInputBox({
		title: 'Publish to Forgejo',
		prompt: 'Repository name',
		value: folderName,
		validateInput: v => (v?.trim() ? null : 'Name is required'),
	});
	if (!repoName) return undefined;

	const description = await vscode.window.showInputBox({
		title: 'Publish to Forgejo',
		prompt: 'Repository description (optional)',
	});
	if (description === undefined) return undefined;

	const visibility = await vscode.window.showQuickPick(
		[
			{ label: '$(globe) Public', isPrivate: false },
			{ label: '$(lock) Private', isPrivate: true },
		],
		{ title: 'Publish to Forgejo', placeHolder: 'Repository visibility' }
	);
	if (!visibility) return undefined;

	return { repoName: repoName.trim(), description: description.trim(), visibility };
}

async function doPublish(
	repository: Repository,
	instanceUrl: string,
	token: string,
	repoName: string,
	description: string,
	isPrivate: boolean,
) {
	const client = new ForgejoClient(instanceUrl, token);

	logInfo(`Publishing repository "${repoName}" to ${instanceUrl}`);

	let remoteRepo;
	try {
		remoteRepo = await client.createRepository({
			name: repoName,
			description: description || undefined,
			private: isPrivate,
		});
	} catch (err) {
		logError('Failed to create repository on Forgejo', err);
		void vscode.window.showErrorMessage(
			`Failed to create repository: ${err instanceof Error ? err.message : String(err)}`
		);
		return;
	}

	const remoteName = repository.state.remotes.length > 0 ? 'forgejo' : 'origin';

	try {
		await repository.addRemote(remoteName, remoteRepo.clone_url);
		logInfo(`Remote '${remoteName}' set to ${remoteRepo.clone_url}`);
	} catch (err) {
		logError('Failed to add remote', err);
		void vscode.window.showErrorMessage(
			`Repository created but could not add remote: ${err instanceof Error ? err.message : String(err)}`
		);
		return;
	}

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
		await repository.push(remoteName, branch, true);
		logInfo('Push successful');
	} catch (err) {
		logError('Failed to push to remote', err);
		void vscode.window.showErrorMessage(
			`Repository created but push failed: ${err instanceof Error ? err.message : String(err)}`
		);
		return;
	}

	const action = await vscode.window.showInformationMessage(
		`Repository published to ${remoteRepo.html_url}`,
		'Open in Browser'
	);
	if (action === 'Open in Browser') {
		void vscode.env.openExternal(vscode.Uri.parse(remoteRepo.html_url));
	}
}

/** Called by the forgejo.publishToForgejo command — asks for inputs before git init. */
export async function publishRepositoryFromWorkspace(git: GitAPI, workspaceUri: vscode.Uri): Promise<void> {
	const instance = await pickInstance();
	if (!instance) return;

	if (!instance.token) {
		void vscode.window.showErrorMessage(
			`No token configured for ${instance.instanceUrl}. Please set a token in Forgejo: Manage Instances.`
		);
		return;
	}

	const folderName = path.basename(workspaceUri.fsPath);
	const inputs = await collectInputs(folderName);
	if (!inputs) return;

	// Only init git after the user has confirmed what they want to create
	let repository = git.getRepository(workspaceUri);
	if (!repository) {
		repository = await git.init(workspaceUri);
	}
	if (!repository) {
		void vscode.window.showErrorMessage('Could not initialize Git repository.');
		return;
	}

	await doPublish(repository, instance.instanceUrl, instance.token, inputs.repoName, inputs.description, inputs.visibility.isPrivate);
}

/** Called by VS Code's native "Publish Branch" picker — repo is already initialized. */
export function createRemoteSourcePublisher(): RemoteSourcePublisher {
	return {
		name: 'Forgejo',
		icon: 'forgejo-logo',

		async publishRepository(repository: Repository): Promise<void> {
			const instance = await pickInstance();
			if (!instance) return;

			if (!instance.token) {
				void vscode.window.showErrorMessage(
					`No token configured for ${instance.instanceUrl}. Please set a token in Forgejo: Manage Instances.`
				);
				return;
			}

			const folderName = path.basename(repository.rootUri.fsPath);
			const inputs = await collectInputs(folderName);
			if (!inputs) return;

			await doPublish(repository, instance.instanceUrl, instance.token, inputs.repoName, inputs.description, inputs.visibility.isPrivate);
		},
	};
}
