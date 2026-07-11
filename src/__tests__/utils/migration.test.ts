import * as vscode from 'vscode';
import { migrateToMultiInstance, migrateTokensToSecretStorage } from '../../utils/migration';

// Mock logger
jest.mock('../../utils/logger', () => ({
    logInfo: jest.fn(),
    logWarn: jest.fn(),
    logError: jest.fn(),
    logDebug: jest.fn()
}));

// Mock SecretStorage
jest.mock('../../utils/secretStorage', () => ({
    setToken: jest.fn().mockResolvedValue(undefined),
    getToken: jest.fn().mockResolvedValue(undefined),
    isInitialized: jest.fn(() => true)
}));

import { setToken, isInitialized } from '../../utils/secretStorage';
const mockSetToken = setToken as jest.MockedFunction<typeof setToken>;
const mockIsInitialized = isInitialized as jest.MockedFunction<typeof isInitialized>;

// Helper to mock configuration
const mockConfig = (values: Record<string, any>) => {
    const get = jest.fn((key) => values[key]);
    const update = jest.fn().mockResolvedValue(undefined);
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
        get,
        update,
        inspect: jest.fn((key) => ({ globalValue: values[key] }))
    });
    return { get, update };
};

describe('migration', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        Object.defineProperty(vscode.workspace, 'workspaceFolders', { value: undefined, configurable: true, writable: true });
        // Re-set mock implementations after clearAllMocks
        mockIsInitialized.mockReturnValue(true);
        mockSetToken.mockResolvedValue(undefined);
    });

    describe('migrateToMultiInstance', () => {
        it('should do nothing if instances already exist', async () => {
            const { update } = mockConfig({
                instances: [{ id: '1', name: 'Test', instanceUrl: 'url' }],
                instanceUrl: 'https://legacy.com',
                token: 'legacy-token'
            });

            await migrateToMultiInstance();

            expect(update).not.toHaveBeenCalled();
        });

        it('should do nothing if no legacy config exists', async () => {
            const { update } = mockConfig({
                instances: [],
                instanceUrl: '',
                token: ''
            });

            await migrateToMultiInstance();

            expect(update).not.toHaveBeenCalled();
        });

        it('should migrate legacy config and store token in SecretStorage', async () => {
            const { update } = mockConfig({
                instances: undefined,
                instanceUrl: 'https://legacy.com',
                token: 'legacy-token'
            });

            await migrateToMultiInstance();

            // Token should be stored in SecretStorage
            expect(mockSetToken).toHaveBeenCalledWith(expect.any(String), 'legacy-token');

            // Instance in settings should NOT have token
            const instancesCall = update.mock.calls.find((c: any[]) => c[0] === 'instances');
            expect(instancesCall).toBeDefined();
            const savedInstance = instancesCall![1][0];
            expect(savedInstance.instanceUrl).toBe('https://legacy.com');
            expect(savedInstance.isDefault).toBe(true);
            expect(savedInstance.token).toBeUndefined();

            // Legacy token should be cleared from settings
            const tokenClearCall = update.mock.calls.find((c: any[]) => c[0] === 'token');
            expect(tokenClearCall).toBeDefined();
            expect(tokenClearCall![1]).toBeUndefined();
        });

        it('should handle legacy URL with trailing slash', async () => {
            const { update } = mockConfig({
                instances: [],
                instanceUrl: 'https://legacy.com/',
                token: 'legacy-token'
            });

            await migrateToMultiInstance();

            const instancesCall = update.mock.calls.find((c: any[]) => c[0] === 'instances');
            expect(instancesCall![1][0].instanceUrl).toBe('https://legacy.com');
        });

        it('should handle legacy URL without protocol', async () => {
            const { update } = mockConfig({
                instances: [],
                instanceUrl: 'legacy.com',
                token: 'legacy-token'
            });

            await migrateToMultiInstance();

            const instancesCall = update.mock.calls.find((c: any[]) => c[0] === 'instances');
            expect(instancesCall![1][0].instanceUrl).toBe('https://legacy.com');
        });
    });

    describe('migrateTokensToSecretStorage', () => {
        it('should migrate plaintext tokens from settings to SecretStorage', async () => {
            const { update } = mockConfig({
                instances: [
                    { id: '1', name: 'Test', instanceUrl: 'url', token: 'plaintext-token' }
                ],
                token: ''
            });

            await migrateTokensToSecretStorage();

            // Token should be stored in SecretStorage
            expect(mockSetToken).toHaveBeenCalledWith('1', 'plaintext-token');

            // Settings should be rewritten without tokens
            const instancesCall = update.mock.calls.find((c: any[]) => c[0] === 'instances');
            expect(instancesCall).toBeDefined();
            expect(instancesCall![1][0].token).toBeUndefined();
        });

        it('should do nothing when no tokens in settings', async () => {
            const { update } = mockConfig({
                instances: [
                    { id: '1', name: 'Test', instanceUrl: 'url' }
                ],
                token: ''
            });

            await migrateTokensToSecretStorage();

            expect(mockSetToken).not.toHaveBeenCalled();
            expect(update).not.toHaveBeenCalled();
        });

        it('should also migrate legacy forgejo.token setting', async () => {
            const { update } = mockConfig({
                instances: [
                    { id: '1', name: 'Test', instanceUrl: 'url', token: 'inst-token', isDefault: true }
                ],
                token: 'legacy-token'
            });

            await migrateTokensToSecretStorage();

            // Both instance token and legacy token should be stored
            expect(mockSetToken).toHaveBeenCalledWith('1', 'inst-token');
            expect(mockSetToken).toHaveBeenCalledWith('1', 'legacy-token');

            // Legacy token should be cleared
            const tokenClearCall = update.mock.calls.find((c: any[]) => c[0] === 'token');
            expect(tokenClearCall).toBeDefined();
            expect(tokenClearCall![1]).toBeUndefined();
        });

		it('migrates a legacy token even when instances have no plaintext tokens', async () => {
			const { update } = mockConfig({
				instances: [{ id: '1', name: 'Test', instanceUrl: 'url', isDefault: true }],
				token: 'legacy-token'
			});

			await migrateTokensToSecretStorage();

			expect(mockSetToken).toHaveBeenCalledWith('1', 'legacy-token');
			expect(update).toHaveBeenCalledWith('token', undefined, vscode.ConfigurationTarget.Global);
		});

		it('cleans tokens through resource-scoped configuration for every workspace folder', async () => {
			const folderOne = { uri: vscode.Uri.parse('file:///one'), name: 'one', index: 0 };
			const folderTwo = { uri: vscode.Uri.parse('file:///two'), name: 'two', index: 1 };
			Object.defineProperty(vscode.workspace, 'workspaceFolders', { value: [folderOne, folderTwo], configurable: true, writable: true });
			const baseUpdate = jest.fn().mockResolvedValue(undefined);
			const folderOneUpdate = jest.fn().mockResolvedValue(undefined);
			const folderTwoUpdate = jest.fn().mockResolvedValue(undefined);
			const baseConfig = {
				get: jest.fn((key) => key === 'instances' ? [{ id: 'workspace', name: 'Workspace', instanceUrl: 'w', isDefault: true }] : undefined),
				inspect: jest.fn((key) => key === 'instances' ? {
					globalValue: [{ id: 'global', name: 'Global', instanceUrl: 'g', token: 'g-token' }],
					workspaceValue: [{ id: 'workspace', name: 'Workspace', instanceUrl: 'w', token: 'w-token', isDefault: true }]
				} : { globalValue: 'legacy-global', workspaceValue: 'legacy-workspace' }),
				update: baseUpdate
			};
			const folderConfig = (id: string, update: jest.Mock) => ({
				get: jest.fn((key) => key === 'instances' ? [{ id, name: id, instanceUrl: id, token: `${id}-token`, isDefault: true }] : undefined),
				inspect: jest.fn((key) => key === 'instances'
					? { workspaceFolderValue: [{ id, name: id, instanceUrl: id, token: `${id}-token`, isDefault: true }] }
					: { workspaceFolderValue: `legacy-${id}` }),
				update
			});
			const oneConfig = folderConfig('folder-one', folderOneUpdate);
			const twoConfig = folderConfig('folder-two', folderTwoUpdate);
			(vscode.workspace.getConfiguration as jest.Mock).mockImplementation((_section, resource) => {
				if (resource?.toString() === folderOne.uri.toString()) return oneConfig;
				if (resource?.toString() === folderTwo.uri.toString()) return twoConfig;
				return baseConfig;
			});

			await migrateTokensToSecretStorage();

			expect(mockSetToken).toHaveBeenCalledWith('global', 'g-token');
			expect(mockSetToken).toHaveBeenCalledWith('workspace', 'w-token');
			expect(mockSetToken).toHaveBeenCalledWith('folder-one', 'folder-one-token');
			expect(mockSetToken).toHaveBeenCalledWith('folder-two', 'folder-two-token');
			expect(baseUpdate).toHaveBeenCalledWith('instances', [expect.not.objectContaining({ token: expect.anything() })], vscode.ConfigurationTarget.Global);
			expect(baseUpdate).toHaveBeenCalledWith('instances', [expect.not.objectContaining({ token: expect.anything() })], vscode.ConfigurationTarget.Workspace);
			expect(folderOneUpdate).toHaveBeenCalledWith('instances', [expect.not.objectContaining({ token: expect.anything() })], vscode.ConfigurationTarget.WorkspaceFolder);
			expect(folderTwoUpdate).toHaveBeenCalledWith('token', undefined, vscode.ConfigurationTarget.WorkspaceFolder);
			expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith('forgejo', folderOne.uri);
			expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith('forgejo', folderTwo.uri);
		});

		it('preserves a legacy token when no instance exists to receive it', async () => {
			const { update } = mockConfig({ instances: [], token: 'keep-me' });

			await migrateTokensToSecretStorage();

			expect(mockSetToken).not.toHaveBeenCalled();
			expect(update).not.toHaveBeenCalledWith('token', undefined, expect.anything());
		});
    });
});
