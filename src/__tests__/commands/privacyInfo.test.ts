import * as vscode from 'vscode';
import { showPrivacyInfo } from '../../commands/privacyInfo';

describe('showPrivacyInfo', () => {
	let mockDoc: { uri: { toString(): string } };

	beforeEach(() => {
		jest.clearAllMocks();

		mockDoc = { uri: { toString: () => 'untitled:privacy-info' } };
		(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockDoc);
		(vscode.commands.executeCommand as jest.Mock).mockResolvedValue(undefined);
	});

	it('opens a markdown document with the privacy report content', async () => {
		await showPrivacyInfo();

		expect(vscode.workspace.openTextDocument).toHaveBeenCalledTimes(1);
		const arg = (vscode.workspace.openTextDocument as jest.Mock).mock.calls[0][0];
		expect(arg.language).toBe('markdown');
		expect(arg.content).toContain('sends no telemetry or analytics');
		expect(arg.content).toContain('SecretStorage');
		expect(arg.content).toContain('only to the Forgejo instance(s) you configure');
		expect(arg.content).toContain('Settings Sync');
	});

	it('opens the markdown preview for the created document', async () => {
		await showPrivacyInfo();

		expect(vscode.commands.executeCommand).toHaveBeenCalledWith('markdown.showPreview', mockDoc.uri);
	});

	it('does not throw when no instances are configured', async () => {
		await expect(showPrivacyInfo()).resolves.toBeUndefined();
	});
});
