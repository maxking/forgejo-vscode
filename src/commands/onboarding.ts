import * as vscode from 'vscode';
import { ForgejoInstance } from '../models/instance';
import {
	generateUUID,
	normalizeUrl,
	getDefaultInstanceName,
	addInstance,
	testInstanceConnection
} from '../utils/instanceHelpers';
import { logInfo, logWarn, logError } from '../utils/logger';
import { ForgejoClient } from '../api/forgejoClient';
import { executeCommand } from './registry';

/**
 * Starts the onboarding wizard for adding a new Forgejo instance
 */
export async function startOnboarding(): Promise<boolean> {
	logInfo('Starting onboarding wizard...');

	// Step 1: Get instance URL
	logInfo('Step 1: Prompting for instance URL...');
	const instanceUrl = await vscode.window.showInputBox({
		prompt: 'Step 1 of 4: Enter your Forgejo instance URL',
		placeHolder: 'https://codeberg.org',
		ignoreFocusOut: true,
		validateInput: (value) => {
			if (!value || value.trim() === '') {
				return 'Instance URL is required';
			}

			try {
				const url = normalizeUrl(value);
				new URL(url); // Validate URL format
				return undefined;
			} catch {
				return 'Invalid URL format. Example: https://codeberg.org';
			}
		}
	});

	if (!instanceUrl) {
		logInfo('Onboarding cancelled by user at step 1');
		return false;
	}

	const normalizedUrl = normalizeUrl(instanceUrl);
	logInfo('Received instance URL:', normalizedUrl);

	// Step 2: Open token creation page
	const tokenUrl = `${normalizedUrl}/user/settings/applications`;
	logInfo('Step 2: Opening browser for token creation:', tokenUrl);

	// Show persistent message and open browser
	void vscode.window.showInformationMessage(
		'Opening your browser to create a personal access token. ' +
		'After creating the token, return to VS Code to paste it.',
		'OK'
	);

	// Open browser
	await vscode.env.openExternal(vscode.Uri.parse(tokenUrl));

	// Wait a moment for browser to open, then show input box
	// The input box will stay open waiting for the user to return
	await new Promise(resolve => setTimeout(resolve, 500));

	// Step 3: Get token from user
	logInfo('Prompting for token...');
	const token = await vscode.window.showInputBox({
		prompt: 'Step 2 of 4: Paste your personal access token (grant "repo" permissions)',
		placeHolder: 'Paste your token here',
		password: true,
		ignoreFocusOut: true, // Keep input box open even when VS Code loses focus
		validateInput: (value) => {
			if (!value || value.trim() === '') {
				return 'Token is required';
			}
			return undefined;
		}
	});

	if (!token) {
		logInfo('Onboarding cancelled by user at step 2 (token)');
		return false;
	}

	logInfo('Token received, testing connection...');

	// Step 4: Test connection with token
	const tempInstance: ForgejoInstance = {
		id: generateUUID(),
		name: 'temp',
		instanceUrl: normalizedUrl,
		token: token.trim(),
	};

	const testResult = await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: 'Testing connection...',
			cancellable: false
		},
		async () => {
			// Don't save result for temporary instance (saveResult: false)
			return await testInstanceConnection(tempInstance, false);
		}
	);

	if (!testResult) {
		logWarn('Connection test failed for:', normalizedUrl);
		const action = await vscode.window.showWarningMessage(
			'Failed to connect to the instance. The token may be invalid or the instance may be unreachable.\n\n' +
			'You can save the instance anyway and fix the token later.',
			'Save Anyway',
			'Try Again',
			'Cancel'
		);

		if (action === 'Try Again') {
			logInfo('User chose to retry onboarding');
			return await startOnboarding();
		}

		if (action === 'Cancel' || !action) {
			logInfo('User cancelled after connection failure');
			return false;
		}

		logInfo('User chose to save instance despite connection failure');
		// Continue with saving even though connection failed
	} else {
		logInfo('Connection test successful');
	}

	// Fetch username if connection succeeded
	let username: string | undefined;
	if (testResult) {
		try {
			const client = new ForgejoClient(normalizedUrl, token.trim());
			const user = await client.rawRequest<{ login: string }>('GET', '/user');
			username = user.login;
			logInfo('Fetched username:', username);
		} catch {
			logWarn('Could not fetch username, continuing without it');
		}
	}

	// Step 5: Ask for friendly name
	const defaultName = getDefaultInstanceName(normalizedUrl);
	logInfo('Prompting for instance name, suggesting:', defaultName);
	const name = await vscode.window.showInputBox({
		prompt: 'Step 3 of 4: Give this instance a name',
		value: defaultName,
		ignoreFocusOut: true,
		validateInput: (value) => {
			if (!value || value.trim() === '') {
				return 'Name is required';
			}
			return undefined;
		}
	});

	if (!name) {
		logInfo('Onboarding cancelled by user at step 3 (name)');
		return false;
	}

	logInfo('Instance name received:', name.trim());

	// Step 6: Ask for optional SSH port
	const sshPortInput = await vscode.window.showInputBox({
		prompt: 'Step 4 of 4: SSH port for clone URLs (optional)',
		placeHolder: '22',
		ignoreFocusOut: true,
		validateInput: validateSshPortInput
	});
	const sshPort = parseSshPortInput(sshPortInput);

	// Step 7: Save instance
	const instance: ForgejoInstance = {
		id: tempInstance.id,
		name: name.trim(),
		instanceUrl: normalizedUrl,
		token: token.trim(),
		username,
		...(sshPort !== undefined ? { sshPort } : {}),
		lastConnectionTest: tempInstance.lastConnectionTest
	};

	try {
		logInfo('Attempting to save instance...');
		await addInstance(instance);

		// Show different message based on connection test result
		if (!testResult) {
			void vscode.window.showWarningMessage(
				`Instance "${instance.name}" saved, but connection test failed. You can edit the token later in "Manage Instances".`,
				'Manage Instances',
				'Show Output'
			).then(action => {
				if (action === 'Manage Instances') {
					void executeCommand('forgejo.manageInstances');
				} else if (action === 'Show Output') {
					void executeCommand('forgejo.showOutput');
				}
			});
		} else {
			void vscode.window.showInformationMessage(
				`Successfully added Forgejo instance: ${instance.name}`,
				'View Instances',
				'Show Output'
			).then(action => {
				if (action === 'View Instances') {
					void executeCommand('forgejo.manageInstances');
				} else if (action === 'Show Output') {
					void executeCommand('forgejo.showOutput');
				}
			});
		}

		logInfo(`Onboarding complete: ${instance.name} (${instance.instanceUrl})`);
		return true;
	} catch (error) {
		logError('Failed to save instance:', error);
		void vscode.window.showErrorMessage(
			`Failed to save instance: ${error instanceof Error ? error.message : 'Unknown error'}. Check the Forgejo Output channel for details.`,
			'Show Output'
		).then(action => {
			if (action === 'Show Output') {
				void executeCommand('forgejo.showOutput');
			}
		});
		return false;
	}
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
