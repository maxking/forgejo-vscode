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
                instanceUrl: 'url',
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
				instanceUrl: 'url/',
				token: 'legacy-token'
			});

			await migrateTokensToSecretStorage();

			expect(mockSetToken).toHaveBeenCalledWith('1', 'legacy-token');
			expect(update).toHaveBeenCalledWith('token', undefined, vscode.ConfigurationTarget.Global);
		});

		it('migrates a legacy token to the default instance when no instanceUrl is configured', async () => {
			const { update } = mockConfig({
				instances: [
					{ id: '1', name: 'One', instanceUrl: 'https://one.example' },
					{ id: '2', name: 'Two', instanceUrl: 'https://two.example', isDefault: true }
				],
				instanceUrl: undefined,
				token: 'orphan-token'
			});

			await migrateTokensToSecretStorage();

			expect(mockSetToken).toHaveBeenCalledWith('2', 'orphan-token');
			expect(mockSetToken).not.toHaveBeenCalledWith('1', 'orphan-token');
			expect(update).toHaveBeenCalledWith('token', undefined, vscode.ConfigurationTarget.Global);
		});

		it('falls back to the first instance for a legacy token when none is marked default and no instanceUrl is set', async () => {
			const { update } = mockConfig({
				instances: [{ id: 'first', name: 'First', instanceUrl: 'https://first.example' }],
				instanceUrl: undefined,
				token: 'orphan-token'
			});

			await migrateTokensToSecretStorage();

			expect(mockSetToken).toHaveBeenCalledWith('first', 'orphan-token');
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
				get: jest.fn((key) => key === 'instances' ? [{ id: 'workspace', name: 'Workspace', instanceUrl: 'w', isDefault: true }] : key === 'instanceUrl' ? 'w/' : undefined),
				inspect: jest.fn((key) => key === 'instances' ? {
					globalValue: [{ id: 'global', name: 'Global', instanceUrl: 'g', token: 'g-token' }],
					workspaceValue: [{ id: 'workspace', name: 'Workspace', instanceUrl: 'w', token: 'w-token', isDefault: true }]
				} : key === 'instanceUrl'
					? { globalValue: 'g', workspaceValue: 'w/' }
					: { globalValue: 'legacy-global', workspaceValue: 'legacy-workspace' }),
				update: baseUpdate
			};
			const folderConfig = (id: string, update: jest.Mock) => ({
				get: jest.fn((key) => key === 'instances' ? [{ id, name: id, instanceUrl: id, token: `${id}-token`, isDefault: true }] : key === 'instanceUrl' ? `${id}/` : undefined),
				inspect: jest.fn((key) => key === 'instances'
					? { workspaceFolderValue: [{ id, name: id, instanceUrl: id, token: `${id}-token`, isDefault: true }] }
					: key === 'instanceUrl' ? { workspaceFolderValue: `${id}/` } : { workspaceFolderValue: `legacy-${id}` }),
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

		it('pairs global and workspace legacy tokens with URLs from the same scopes', async () => {
			const update = jest.fn().mockResolvedValue(undefined);
			const instances = [
				{ id: 'a', name: 'A', instanceUrl: 'https://a.example' },
				{ id: 'b', name: 'B', instanceUrl: 'https://b.example/' }
			];
			(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
				get: jest.fn((key) => key === 'instances' ? instances : undefined),
				inspect: jest.fn((key) => key === 'instances'
					? { globalValue: instances, workspaceValue: instances }
					: key === 'instanceUrl'
						? { globalValue: 'a.example/', workspaceValue: 'https://b.example' }
						: { globalValue: 'token-a', workspaceValue: 'token-b' }),
				update
			});

			await migrateTokensToSecretStorage();

			expect(mockSetToken).toHaveBeenCalledWith('a', 'token-a');
			expect(mockSetToken).toHaveBeenCalledWith('b', 'token-b');
			expect(mockSetToken).not.toHaveBeenCalledWith('a', 'token-b');
			expect(update).toHaveBeenCalledWith('token', undefined, vscode.ConfigurationTarget.Global);
			expect(update).toHaveBeenCalledWith('token', undefined, vscode.ConfigurationTarget.Workspace);
		});

		it('preserves a legacy token when no instance exists to receive it', async () => {
			const { update } = mockConfig({ instances: [], instanceUrl: 'https://missing.example', token: 'keep-me' });

			await migrateTokensToSecretStorage();

			expect(mockSetToken).not.toHaveBeenCalled();
			expect(update).not.toHaveBeenCalledWith('token', undefined, expect.anything());
		});

		it('does not apply a folder legacy token to an inherited instance on another host', async () => {
			const folder = { uri: vscode.Uri.parse('file:///folder'), name: 'folder', index: 0 };
			Object.defineProperty(vscode.workspace, 'workspaceFolders', { value: [folder], configurable: true, writable: true });
			const baseConfig = mockConfig({ instances: [] });
			const folderUpdate = jest.fn().mockResolvedValue(undefined);
			const folderConfig = {
				get: jest.fn((key) => key === 'instances'
					? [{ id: 'global', name: 'Global', instanceUrl: 'https://global.example', isDefault: true }]
					: key === 'instanceUrl' ? 'https://folder.example/' : undefined),
				inspect: jest.fn((key) => key === 'token'
					? { workspaceFolderValue: 'folder-token' }
					: key === 'instanceUrl' ? { workspaceFolderValue: 'https://folder.example/' } : undefined),
				update: folderUpdate
			};
			(vscode.workspace.getConfiguration as jest.Mock).mockImplementation((_section, resource) => resource ? folderConfig : {
				get: baseConfig.get, update: baseConfig.update, inspect: jest.fn()
			});

			await migrateTokensToSecretStorage();

			expect(mockSetToken).not.toHaveBeenCalledWith('global', 'folder-token');
			expect(folderUpdate).not.toHaveBeenCalledWith('token', undefined, vscode.ConfigurationTarget.WorkspaceFolder);
			expect(folderUpdate).not.toHaveBeenCalledWith('instanceUrl', undefined, expect.anything());
		});

		it('migrates a folder legacy token only to the normalized matching instance URL', async () => {
			const folder = { uri: vscode.Uri.parse('file:///folder'), name: 'folder', index: 0 };
			Object.defineProperty(vscode.workspace, 'workspaceFolders', { value: [folder], configurable: true, writable: true });
			const update = jest.fn().mockResolvedValue(undefined);
			const config = {
				get: jest.fn((key) => key === 'instances' ? [
					{ id: 'other', name: 'Other', instanceUrl: 'https://other.example', isDefault: true },
					{ id: 'matching', name: 'Matching', instanceUrl: 'folder.example' }
				] : key === 'instanceUrl' ? 'https://folder.example/' : undefined),
				inspect: jest.fn((key) => key === 'token'
					? { workspaceFolderValue: 'folder-token' }
					: key === 'instanceUrl' ? { workspaceFolderValue: 'https://folder.example/' } : undefined),
				update
			};
			(vscode.workspace.getConfiguration as jest.Mock).mockImplementation((_section, resource) => resource ? config : { get: jest.fn((_key, defaultValue) => defaultValue), inspect: jest.fn(), update: jest.fn() });

			await migrateTokensToSecretStorage();

			expect(mockSetToken).toHaveBeenCalledWith('matching', 'folder-token');
			expect(mockSetToken).not.toHaveBeenCalledWith('other', 'folder-token');
			expect(update).toHaveBeenCalledWith('token', undefined, vscode.ConfigurationTarget.WorkspaceFolder);
		});
    });
});
