import * as vscode from 'vscode';
import {
	getAllInstances,
	getInstanceById,
	setDefaultInstance,
	removeInstance,
	testInstanceConnection,
	getConnectionStatus,
	updateInstance
} from '../utils/instanceHelpers';
import { setToken } from '../utils/secretStorage';
import { startOnboarding } from './onboarding';

interface InstanceQuickPickItem extends vscode.QuickPickItem {
	instanceId?: string;
	action?: 'add';
}

/**
 * Shows the instance management UI
 */
export async function manageInstances(): Promise<void> {
	console.log('[Forgejo] Opening instance manager...');

	try {
		const instances = await getAllInstances();

		// Filter out invalid instances (defensive programming)
		const validInstances = instances.filter(i => {
			if (!i.id || !i.name || !i.instanceUrl) {
				console.warn('[Forgejo] Found invalid instance, skipping:', i);
				return false;
			}
			return true;
		});

		const items: InstanceQuickPickItem[] = [
			{
				label: '$(add) Add New Instance',
				description: 'Configure a new Forgejo instance',
				action: 'add'
			},
			{
				label: '',
				kind: vscode.QuickPickItemKind.Separator
			} as InstanceQuickPickItem,
			...validInstances.map(i => ({
				label: `${i.isDefault ? '$(star-full)' : '$(server)'} ${i.name}`,
				description: i.sshHost
					? `${i.instanceUrl} (SSH host ${i.sshHost})`
					: i.sshPort
						? `${i.instanceUrl} (SSH port ${String(i.sshPort)})`
						: i.instanceUrl,
				detail: getConnectionStatus(i),
				instanceId: i.id
			}))
		];

		if (validInstances.length === 0) {
			items.push({
				label: 'No instances configured',
				description: 'Add your first instance to get started'
			} as InstanceQuickPickItem);
		}

		const selected = await vscode.window.showQuickPick(items, {
			placeHolder: 'Manage Forgejo Instances',
			matchOnDescription: true,
			matchOnDetail: true
		});

		if (!selected) {
			return;
		}

		// Handle add new instance
		if (selected.action === 'add') {
			const success = await startOnboarding();
			if (success) {
				// Refresh and show again
				await manageInstances();
			}
			return;
		}

		// Handle instance selection
		if (selected.instanceId) {
			await showInstanceActions(selected.instanceId);
		}
	} catch (error) {
		console.error('[Forgejo] Error in instance manager:', error);
		void vscode.window.showErrorMessage(
			`Failed to manage instances: ${error instanceof Error ? error.message : 'Unknown error'}`
		);
	}
}

/**
 * Shows actions for a specific instance
 */
async function showInstanceActions(instanceId: string): Promise<void> {
	const instance = await getInstanceById(instanceId);
	if (!instance) {
		console.error('[Forgejo] Instance not found:', instanceId);
		const allInstances = await getAllInstances();
		console.error('[Forgejo] Available instances:', allInstances.map(i => ({ id: i.id, name: i.name })));

		void vscode.window.showErrorMessage(
			`Instance ${instanceId} not found. Your settings may be corrupted. Try removing and re-adding the instance.`,
			'Open Settings'
		).then(action => {
			if (action === 'Open Settings') {
				void vscode.commands.executeCommand('workbench.action.openSettings', 'forgejo.instances');
			}
		});
		return;
	}

	interface ActionQuickPickItem extends vscode.QuickPickItem {
		action: 'test' | 'default' | 'edit' | 'editSshHost' | 'editSshPort' | 'remove' | 'back';
	}

	const actions: ActionQuickPickItem[] = [
		{
			label: '$(arrow-left) Back to Instance List',
			description: 'Return to the instance list',
			action: 'back'
		},
		{
			label: '',
			kind: vscode.QuickPickItemKind.Separator
		} as ActionQuickPickItem,
		{
			label: '$(testing-passed-icon) Test Connection',
			description: 'Verify connection to this instance',
			action: 'test'
		},
		{
			label: '$(edit) Edit Token',
			description: 'Update the personal access token',
			action: 'edit'
		},
		{
			label: '$(remote) Edit SSH Host',
			description: 'Set or clear the SSH hostname used to match git remotes and rewrite clone URLs',
			action: 'editSshHost'
		},
		{
			label: '$(remote) Edit SSH Port',
			description: 'SSH port for clone URLs (independent of SSH host)',
			action: 'editSshPort'
		}
	];

	// Only show "Set as Default" if not already default
	if (!instance.isDefault) {
		actions.push({
			label: '$(star) Set as Default',
			description: 'Make this the default instance',
			action: 'default'
		});
	}

	actions.push({
		label: '$(trash) Remove Instance',
		description: 'Delete this instance configuration',
		action: 'remove'
	});

	const selected = await vscode.window.showQuickPick(actions, {
		placeHolder: `${instance.name} - ${instance.instanceUrl}`
	});

	if (!selected) {
		return;
	}

	switch (selected.action) {
		case 'back':
			await manageInstances();
			break;
		case 'test':
			await handleTestConnection(instanceId);
			await showInstanceActions(instanceId);
			break;
		case 'default':
			await handleSetDefault(instanceId);
			await manageInstances();
			break;
		case 'edit':
			await handleEditToken(instanceId);
			await showInstanceActions(instanceId);
			break;
		case 'editSshHost':
			await handleEditSshHost(instanceId);
			await showInstanceActions(instanceId);
			break;
		case 'editSshPort':
			await handleEditSshPort(instanceId);
			await showInstanceActions(instanceId);
			break;
		case 'remove':
			await handleRemoveInstance(instanceId);
			await manageInstances();
			break;
	}
}

/**
 * Handles testing connection to an instance
 */
async function handleTestConnection(instanceId: string): Promise<void> {
	const instance = await getInstanceById(instanceId);
	if (!instance) {
		return;
	}

	const success = await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: `Testing connection to ${instance.name}...`,
			cancellable: false
		},
		async () => {
			return await testInstanceConnection(instance);
		}
	);

	if (success) {
		void vscode.window.showInformationMessage(
			`✓ Successfully connected to ${instance.name}`
		);
	} else {
		void vscode.window.showErrorMessage(
			`✗ Failed to connect to ${instance.name}. Check your token and instance URL.`
		);
	}
}

/**
 * Handles setting an instance as default
 */
async function handleSetDefault(instanceId: string): Promise<void> {
	const instance = await getInstanceById(instanceId);
	if (!instance) {
		return;
	}

	await setDefaultInstance(instanceId);
	void vscode.window.showInformationMessage(
		`$(star) ${instance.name} is now the default instance`
	);
	console.log(`[Forgejo] Set default instance: ${instance.name}`);
}

/**
 * Handles editing an instance's token
 */
async function handleEditToken(instanceId: string): Promise<void> {
	const instance = await getInstanceById(instanceId);
	if (!instance) {
		return;
	}

	const token = await vscode.window.showInputBox({
		prompt: `Enter new token for ${instance.name}`,
		password: true,
		value: instance.token,
		ignoreFocusOut: true,
		validateInput: (value) => {
			if (!value || value.trim() === '') {
				return 'Token is required';
			}
			return undefined;
		}
	});

	if (!token) {
		return;
	}

	// Test new token
	const tempInstance = { ...instance, token: token.trim() };
	const success = await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: `Testing new token for ${instance.name}...`,
			cancellable: false
		},
		async () => {
			return await testInstanceConnection(tempInstance);
		}
	);

	if (!success) {
		const proceed = await vscode.window.showWarningMessage(
			'Failed to authenticate with the new token. Save anyway?',
			'Save Anyway',
			'Cancel'
		);

		if (proceed !== 'Save Anyway') {
			return;
		}
	}

	// Store token in SecretStorage
	await setToken(instance.id, token.trim());

	// Update instance metadata (token is not stored in settings)
	instance.lastConnectionTest = tempInstance.lastConnectionTest;
	await updateInstance(instance);

	void vscode.window.showInformationMessage(
		`✓ Token updated for ${instance.name}`
	);
	console.log(`[Forgejo] Updated token for: ${instance.name}`);
}

/**
 * Handles editing an instance's SSH host
 */
async function handleEditSshHost(instanceId: string): Promise<void> {
	const instance = await getInstanceById(instanceId);
	if (!instance) {
		return;
	}

	const sshHostInput = await vscode.window.showInputBox({
		prompt: `Enter SSH host for ${instance.name} (leave blank if SSH and HTTPS share the same host)`,
		placeHolder: 'ssh.example.com',
		value: instance.sshHost ?? '',
		ignoreFocusOut: true,
		validateInput: validateSshHostInput
	});

	if (sshHostInput === undefined) {
		return;
	}

	const sshHost = parseSshHostInput(sshHostInput);
	const updatedInstance = { ...instance };
	if (sshHost === undefined) {
		delete updatedInstance.sshHost;
	} else {
		updatedInstance.sshHost = sshHost;
	}

	await updateInstance(updatedInstance);
	void vscode.window.showInformationMessage(
		sshHost === undefined
			? `SSH host cleared for ${instance.name}`
			: `SSH host for ${instance.name} set to ${sshHost}`
	);
	console.log(`[Forgejo] Updated SSH host for: ${instance.name}`);
}

/**
 * Handles editing an instance's SSH clone port.
 * Independent of `sshHost`: both may be set simultaneously (e.g. SSH on
 * `ssh.example.com:2222`).
 */
async function handleEditSshPort(instanceId: string): Promise<void> {
	const instance = await getInstanceById(instanceId);
	if (!instance) {
		return;
	}

	const sshPortInput = await vscode.window.showInputBox({
		prompt: `Enter SSH port for ${instance.name} clone URLs (leave blank for default port 22)`,
		placeHolder: '22',
		value: instance.sshPort ? String(instance.sshPort) : '',
		ignoreFocusOut: true,
		validateInput: validateSshPortInput
	});

	if (sshPortInput === undefined) {
		return;
	}

	const sshPort = parseSshPortInput(sshPortInput);
	const updatedInstance = { ...instance };
	if (sshPort === undefined) {
		delete updatedInstance.sshPort;
	} else {
		updatedInstance.sshPort = sshPort;
	}

	await updateInstance(updatedInstance);
	void vscode.window.showInformationMessage(
		sshPort === undefined
			? `SSH port cleared for ${instance.name}`
			: `SSH port for ${instance.name} set to ${String(sshPort)}`
	);
	console.log(`[Forgejo] Updated SSH port for: ${instance.name}`);
}

/**
 * Handles removing an instance
 */
async function handleRemoveInstance(instanceId: string): Promise<void> {
	const instance = await getInstanceById(instanceId);
	if (!instance) {
		return;
	}

	const confirm = await vscode.window.showWarningMessage(
		`Are you sure you want to remove "${instance.name}"?`,
		{ modal: true },
		'Remove',
		'Cancel'
	);

	if (confirm !== 'Remove') {
		return;
	}

	await removeInstance(instanceId);
	void vscode.window.showInformationMessage(
		`$(trash) Removed instance: ${instance.name}`
	);
	console.log(`[Forgejo] Removed instance: ${instance.name}`);
}

function parseSshHostInput(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	if (!trimmed) {
		return undefined;
	}

	return trimmed;
}

function validateSshHostInput(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	if (!trimmed) {
		return undefined;
	}

	if (trimmed.includes('://') || trimmed.includes('/') || trimmed.includes('@')) {
		return 'Enter a bare SSH hostname (e.g. ssh.example.com), without a scheme, path, or user';
	}

	if (!/^[a-zA-Z0-9.-]+$/.test(trimmed)) {
		return 'Enter a valid SSH hostname (e.g. ssh.example.com), without a port, scheme, or path';
	}

	return undefined;
}

function parseSshPortInput(value: string | undefined): number | undefined {
	const trimmed = value?.trim();
	if (!trimmed) {
		return undefined;
	}

	return Number(trimmed);
}

function validateSshPortInput(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	if (!trimmed) {
		return undefined;
	}

	const port = Number(trimmed);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		return 'SSH port must be a whole number between 1 and 65535';
	}

	return undefined;
}
