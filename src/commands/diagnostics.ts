import * as vscode from 'vscode';
import { getAllInstances } from '../utils/instanceHelpers';
import { getForgejoConfig } from '../utils/config';

/**
 * Shows diagnostic information about the current Forgejo configuration
 */
export async function showDiagnostics(): Promise<string> {
	console.log('[Forgejo] === DIAGNOSTICS ===');

	const config = vscode.workspace.getConfiguration('forgejo');

	// Get all settings
	const instances = config.get('instances');
	const legacyUrl = config.get<string>('instanceUrl');
	const legacyToken = config.get<string>('token'); // May be empty after migration to SecretStorage
	const autoDetect = config.get<boolean>('autoDetectFromRemote');

	// Get instances through our helper (validates and cleans)
	const validInstances = await getAllInstances();

	// Get current active config
	const activeConfig = await getForgejoConfig();

	// Build diagnostic report
	const report = [
		'=== Forgejo Extension Diagnostics ===',
		'',
		'## Raw Settings:',
		`- forgejo.instances: ${JSON.stringify(instances, null, 2)}`,
		`- forgejo.instanceUrl: ${legacyUrl ?? '(not set)'}`,
		`- forgejo.token: ${legacyToken ? '*** (migrate to SecretStorage pending)' : '(migrated to secure storage)'}`,
		`- forgejo.autoDetectFromRemote: ${String(autoDetect)}`,
		'',
		'## Validated Instances:',
		`- Count: ${validInstances.length}`,
		...validInstances.map((inst, idx) => [
			``,
			`### Instance ${idx + 1}:`,
			`  - ID: ${inst.id}`,
			`  - Name: ${inst.name}`,
			`  - URL: ${inst.instanceUrl}`,
			`  - Token: ${inst.token ? '(set)' : '(empty)'}`,
			`  - Default: ${String(inst.isDefault ?? false)}`,
			`  - Last Test: ${inst.lastConnectionTest ?
				`${inst.lastConnectionTest.success ? '✓' : '✗'} (${new Date(inst.lastConnectionTest.timestamp).toLocaleString()})` :
				'Never'}`
		].join('\n')),
		'',
		'## Active Configuration:',
		activeConfig ? [
			`- Instance URL: ${activeConfig.instanceUrl}`,
			`- Owner: ${activeConfig.owner}`,
			`- Repo: ${activeConfig.repo}`,
			`- Instance ID: ${activeConfig.instanceId ?? '(not set)'}`,
			`- Match Confidence: ${activeConfig.matchConfidence ?? '(not set)'}`,
			`- Has Token: ${activeConfig.token ? 'Yes' : 'No'}`
		].join('\n') : '  (No active configuration - no git remote found)',
		'',
		'## Workspace:',
		`- Folders: ${vscode.workspace.workspaceFolders?.length ?? 0}`,
		...(vscode.workspace.workspaceFolders?.map(f => `  - ${f.uri.fsPath}`) ?? []),
		'',
		'=== End Diagnostics ===',
	].join('\n');

	// Log to console
	console.log(report);

	// Show in output channel
	const outputChannel = vscode.window.createOutputChannel('Forgejo Diagnostics');
	outputChannel.clear();
	outputChannel.appendLine(report);
	outputChannel.show();

	// Also show notification
	void vscode.window.showInformationMessage(
		`Diagnostics logged. Found ${validInstances.length} instance(s).`,
		'View Output',
		'Copy to Clipboard'
	).then(action => {
		if (action === 'View Output') {
			outputChannel.show();
		} else if (action === 'Copy to Clipboard') {
			void vscode.env.clipboard.writeText(report);
			void vscode.window.showInformationMessage('Diagnostics copied to clipboard');
		}
	});

	return report;
}
