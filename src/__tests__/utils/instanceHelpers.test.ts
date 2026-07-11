import * as vscode from 'vscode';
import {
	generateUUID,
	normalizeUrl,
	findBestInstanceMatch,
	getDefaultInstanceName,
	getConnectionStatus,
	getAllInstances,
	addInstance,
	updateInstance,
	removeInstance,
	setDefaultInstance,
	isValidInstance
} from '../../utils/instanceHelpers';
import { ForgejoInstance } from '../../models/instance';

// Mock logger
jest.mock('../../utils/logger', () => ({
	logInfo: jest.fn(),
	logWarn: jest.fn(),
	logError: jest.fn(),
	logDebug: jest.fn()
}));

// Mock SecretStorage
jest.mock('../../utils/secretStorage', () => ({
	getToken: jest.fn().mockResolvedValue(undefined),
	setToken: jest.fn().mockResolvedValue(undefined),
	deleteToken: jest.fn().mockResolvedValue(undefined),
	isInitialized: jest.fn(() => true)
}));

import { getToken, setToken, deleteToken, isInitialized } from '../../utils/secretStorage';
const mockGetToken = getToken as jest.MockedFunction<typeof getToken>;
const mockSetToken = setToken as jest.MockedFunction<typeof setToken>;
const mockDeleteToken = deleteToken as jest.MockedFunction<typeof deleteToken>;
const mockIsInitialized = isInitialized as jest.MockedFunction<typeof isInitialized>;

// Helper to mock configuration with state
const mockConfig = (initialInstances: any[]) => {
	let currentInstances = [...initialInstances];

	const get = jest.fn().mockImplementation(() => currentInstances);

	const update = jest.fn().mockImplementation((key, value) => {
		if (key === 'instances') {
			currentInstances = value;
		}
		return Promise.resolve();
	});

	(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
		get,
		update,
		inspect: jest.fn()
	});

	return {
		get,
		update,
		getCurrentInstances: () => currentInstances
	};
};

describe('instanceHelpers', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		// Re-set mock implementations after clearAllMocks
		mockGetToken.mockResolvedValue(undefined);
		mockSetToken.mockResolvedValue(undefined);
		mockDeleteToken.mockResolvedValue(undefined);
		mockIsInitialized.mockReturnValue(true);
	});

	describe('isValidInstance', () => {
		it('should return true for valid instance without token', () => {
			const instance = {
				id: '1',
				name: 'Test',
				instanceUrl: 'https://example.com'
			};
			expect(isValidInstance(instance)).toBe(true);
		});

		it('should return true for valid instance with token', () => {
			const instance = {
				id: '1',
				name: 'Test',
				instanceUrl: 'https://example.com',
				token: 'token'
			};
			expect(isValidInstance(instance)).toBe(true);
		});

		it('should return false for missing id', () => {
			const instance = {
				name: 'Test',
				instanceUrl: 'https://example.com'
			};
			expect(isValidInstance(instance)).toBe(false);
		});

		it('should return false for empty name', () => {
			const instance = {
				id: '1',
				name: '',
				instanceUrl: 'https://example.com'
			};
			expect(isValidInstance(instance)).toBe(false);
		});
	});

	describe('getAllInstances', () => {
		it('should return empty array when no instances configured', async () => {
			mockConfig([]);
			const instances = await getAllInstances();
			expect(instances).toEqual([]);
		});

		it('should return configured instances with tokens hydrated from SecretStorage', async () => {
			const mockInstances = [{
				id: '1',
				name: 'Test',
				instanceUrl: 'https://example.com'
			}];
			mockGetToken.mockResolvedValue('secret-token');
			mockConfig(mockInstances);
			const instances = await getAllInstances();
			expect(instances).toHaveLength(1);
			expect(instances[0].token).toBe('secret-token');
		});

		it('should filter out invalid instances and update config', async () => {
			const validInstance = {
				id: '1',
				name: 'Valid',
				instanceUrl: 'https://valid.com'
			};
			const invalidInstance = {
				id: '2',
				// Missing name
				instanceUrl: 'https://invalid.com'
			};

			const { update } = mockConfig([validInstance, invalidInstance]);

			const instances = await getAllInstances();

			expect(instances).toHaveLength(1);
			expect(instances[0].id).toBe('1');
			expect(update).toHaveBeenCalledWith('instances', [validInstance], vscode.ConfigurationTarget.Global);
		});
	});

	describe('addInstance', () => {
		it('should add new instance, set as default if first one, and store token in SecretStorage', async () => {
			const { update } = mockConfig([]);
			const newInstance: ForgejoInstance = {
				id: '1',
				name: 'New',
				instanceUrl: 'https://new.com',
				token: 'my-token'
			};

			await addInstance(newInstance);

			// Token should be stored in SecretStorage
			expect(mockSetToken).toHaveBeenCalledWith('1', 'my-token');

			// Settings should NOT contain token
			const instancesCalls = update.mock.calls.filter((c: any[]) => c[0] === 'instances');
			const savedInstances = instancesCalls[0][1];
			expect(savedInstances[0].token).toBeUndefined();
			expect(savedInstances[0].isDefault).toBe(true);
		});

		it('should add to existing instances and store new token in SecretStorage', async () => {
			const existingInstance = {
				id: '1',
				name: 'Existing',
				instanceUrl: 'https://existing.com',
				isDefault: true
			};
			mockGetToken.mockResolvedValue('existing-token');
			const { update } = mockConfig([existingInstance]);

			const newInstance: ForgejoInstance = {
				id: '2',
				name: 'New',
				instanceUrl: 'https://new.com',
				token: 'new-token'
			};

			await addInstance(newInstance);

			// New token should be stored in SecretStorage
			expect(mockSetToken).toHaveBeenCalledWith('2', 'new-token');

			// Both instances should be saved to settings
			const instancesCalls = update.mock.calls.filter((c: any[]) => c[0] === 'instances');
			expect(instancesCalls.length).toBeGreaterThan(0);
			const savedInstances = instancesCalls[0][1];
			expect(savedInstances).toHaveLength(2);
			expect(savedInstances[0].id).toBe('1');
			expect(savedInstances[1].id).toBe('2');
		});
	});

	describe('updateInstance', () => {
		it('should update existing instance without token in settings', async () => {
			const originalInstance = {
				id: '1',
				name: 'Original',
				instanceUrl: 'https://original.com'
			};
			mockGetToken.mockResolvedValue('token');
			const { update } = mockConfig([originalInstance]);

			const updatedInstance = { ...originalInstance, name: 'Updated' };
			await updateInstance(updatedInstance);

			const instancesCalls = update.mock.calls.filter((c: any[]) => c[0] === 'instances');
			const savedInstances = instancesCalls[0][1];
			expect(savedInstances[0].name).toBe('Updated');
			expect(savedInstances[0].token).toBeUndefined();
		});

		it('should throw error if instance not found', async () => {
			mockConfig([]);
			const instance = {
				id: '1',
				name: 'Test',
				instanceUrl: 'https://test.com'
			};

			await expect(updateInstance(instance)).rejects.toThrow('Instance 1 not found');
		});
	});

	describe('removeInstance', () => {
		it('should remove instance by id and delete token from SecretStorage', async () => {
			const instance1 = { id: '1', name: '1', instanceUrl: 'url' };
			const instance2 = { id: '2', name: '2', instanceUrl: 'url' };
			mockConfig([instance1, instance2]);

			await removeInstance('1');

			expect(mockDeleteToken).toHaveBeenCalledWith('1');
		});

		it('should set new default if default instance removed', async () => {
			const instance1 = { id: '1', name: '1', instanceUrl: 'url', isDefault: true };
			const instance2 = { id: '2', name: '2', instanceUrl: 'url' };
			const { update } = mockConfig([instance1, instance2]);

			await removeInstance('1');

			// Check that the remaining instance was set as default
			const instancesUpdateCalls = update.mock.calls.filter((call: any[]) => call[0] === 'instances');
			const lastInstancesUpdate = instancesUpdateCalls[instancesUpdateCalls.length - 1];

			expect(lastInstancesUpdate[1]).toEqual([
				expect.objectContaining({ id: '2', isDefault: true })
			]);
			// Token should not be in settings
			expect(lastInstancesUpdate[1][0].token).toBeUndefined();
		});

		it('clears legacy settings when the final instance is removed', async () => {
			const { update } = mockConfig([{ id: '1', name: 'Only', instanceUrl: 'https://only.example', isDefault: true }]);

			await removeInstance('1');

			expect(update).toHaveBeenCalledWith('instanceUrl', undefined, vscode.ConfigurationTarget.Global);
			expect(update).toHaveBeenCalledWith('token', undefined, vscode.ConfigurationTarget.Global);
		});
	});

	describe('setDefaultInstance', () => {
		it('should set specified instance as default and unset others', async () => {
			const instance1 = { id: '1', name: '1', instanceUrl: 'url', isDefault: true };
			const instance2 = { id: '2', name: '2', instanceUrl: 'url', isDefault: false };
			const { update } = mockConfig([instance1, instance2]);

			await setDefaultInstance('2');

			expect(update).toHaveBeenCalledWith(
				'instances',
				[
					expect.objectContaining({ id: '1', isDefault: false }),
					expect.objectContaining({ id: '2', isDefault: true })
				],
				vscode.ConfigurationTarget.Global
			);
		});
	});

	describe('generateUUID', () => {
		it('should generate a valid UUID v4', () => {
			const uuid = generateUUID();
			expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		});

		it('should generate unique UUIDs', () => {
			const uuid1 = generateUUID();
			const uuid2 = generateUUID();
			expect(uuid1).not.toBe(uuid2);
		});
	});

	describe('normalizeUrl', () => {
		it('should add https:// to URL without protocol', () => {
			expect(normalizeUrl('codeberg.org')).toBe('https://codeberg.org');
		});

		it('should preserve existing https:// protocol', () => {
			expect(normalizeUrl('https://codeberg.org')).toBe('https://codeberg.org');
		});

		it('should preserve existing http:// protocol', () => {
			expect(normalizeUrl('http://localhost:3000')).toBe('http://localhost:3000');
		});

		it('should remove trailing slash', () => {
			expect(normalizeUrl('https://codeberg.org/')).toBe('https://codeberg.org');
		});

		it('should handle URL with path', () => {
			expect(normalizeUrl('https://codeberg.org/some/path/')).toBe('https://codeberg.org/some/path');
		});

		it('should trim whitespace', () => {
			expect(normalizeUrl('  https://codeberg.org  ')).toBe('https://codeberg.org');
		});
	});

	describe('findBestInstanceMatch', () => {
		const instances: ForgejoInstance[] = [
			{
				id: '1',
				name: 'Codeberg',
				instanceUrl: 'https://codeberg.org'
			},
			{
				id: '2',
				name: 'Work',
				instanceUrl: 'https://git.company.com'
			},
			{
				id: '3',
				name: 'Local',
				instanceUrl: 'http://localhost:3000'
			}
		];

		it('should return null when remoteUrl is null', () => {
			const result = findBestInstanceMatch(instances, null);
			expect(result).toBeNull();
		});

		it('should return null when instances array is empty', () => {
			const result = findBestInstanceMatch([], 'https://codeberg.org');
			expect(result).toBeNull();
		});

		it('should find exact match', () => {
			const result = findBestInstanceMatch(instances, 'https://codeberg.org');
			expect(result).not.toBeNull();
			expect(result?.instance.id).toBe('1');
			expect(result?.confidence).toBe('exact');
		});

		it('should find exact match ignoring trailing slash', () => {
			const result = findBestInstanceMatch(instances, 'https://codeberg.org/');
			expect(result).not.toBeNull();
			expect(result?.instance.id).toBe('1');
			expect(result?.confidence).toBe('exact');
		});

		it('should find exact match when only the remote host is available', () => {
			const result = findBestInstanceMatch(instances, 'codeberg.org');
			expect(result).not.toBeNull();
			expect(result?.instance.id).toBe('1');
			expect(result?.confidence).toBe('exact');
		});

		it('should find domain match for http vs https', () => {
			const result = findBestInstanceMatch(instances, 'http://codeberg.org');
			expect(result).not.toBeNull();
			expect(result?.instance.id).toBe('1');
			expect(result?.confidence).toBe('domain');
		});

		it('should find exact match even with different paths', () => {
			// normalizeUrl will strip the path for matching
			const result = findBestInstanceMatch(instances, 'https://git.company.com/some/path');
			expect(result).not.toBeNull();
			expect(result?.instance.id).toBe('2');
			// This should be domain match since the paths differ
			expect(result?.confidence).toBe('domain');
		});

		it('should return null for no match', () => {
			const result = findBestInstanceMatch(instances, 'https://github.com');
			expect(result).toBeNull();
		});

		it('should handle localhost URLs', () => {
			const result = findBestInstanceMatch(instances, 'http://localhost:3000');
			expect(result).not.toBeNull();
			expect(result?.instance.id).toBe('3');
			expect(result?.confidence).toBe('exact');
		});

		it('should NOT match when same hostname but different port', () => {
			// localhost:3000 is configured, but remote points to localhost:3001
			const result = findBestInstanceMatch(instances, 'http://localhost:3001');
			expect(result).toBeNull();
		});

		it('should prefer exact match over domain match', () => {
			const testInstances: ForgejoInstance[] = [
				{
					id: '1',
					name: 'HTTPS',
					instanceUrl: 'https://codeberg.org'
				},
				{
					id: '2',
					name: 'HTTP',
					instanceUrl: 'http://codeberg.org'
				}
			];

			const result = findBestInstanceMatch(testInstances, 'https://codeberg.org');
			expect(result).not.toBeNull();
			expect(result?.instance.id).toBe('1');
			expect(result?.confidence).toBe('exact');
		});

		it('should match a bare SSH remote host against a configured sshHost', () => {
			const splitInstances: ForgejoInstance[] = [
				{
					id: '1',
					name: 'Split',
					instanceUrl: 'https://forgejo.example.com',
					sshHost: 'ssh.example.com'
				}
			];

			// SSH remotes arrive as the bare transport host, not a full URL.
			const result = findBestInstanceMatch(splitInstances, 'ssh.example.com');
			expect(result).not.toBeNull();
			expect(result?.instance.id).toBe('1');
			expect(result?.confidence).toBe('domain');
		});

		it('should match an SSH remote host case-insensitively against sshHost', () => {
			const splitInstances: ForgejoInstance[] = [
				{
					id: '1',
					name: 'Split',
					instanceUrl: 'https://forgejo.example.com',
					sshHost: 'SSH.EXAMPLE.COM'
				}
			];

			// git remotes are conventionally lowercase, but the configured sshHost
			// may be uppercase since the onboarding/schema allow it. Hostnames are
			// case-insensitive (RFC 4343) and must still match.
			const result = findBestInstanceMatch(splitInstances, 'ssh.example.com');
			expect(result).not.toBeNull();
			expect(result?.instance.id).toBe('1');
			expect(result?.confidence).toBe('domain');
		});

		it('should match an SSH remote host with surrounding whitespace against sshHost', () => {
			const splitInstances: ForgejoInstance[] = [
				{
					id: '1',
					name: 'Split',
					instanceUrl: 'https://forgejo.example.com',
					sshHost: '  ssh.example.com  '
				}
			];

			const result = findBestInstanceMatch(splitInstances, 'ssh.example.com');
			expect(result).not.toBeNull();
			expect(result?.instance.id).toBe('1');
			expect(result?.confidence).toBe('domain');
		});

		it('should not match a bare SSH host against an instance without sshHost', () => {
			const noSshHostInstances: ForgejoInstance[] = [
				{
					id: '1',
					name: 'WebOnly',
					instanceUrl: 'https://forgejo.example.com'
				}
			];

			const result = findBestInstanceMatch(noSshHostInstances, 'ssh.example.com');
			expect(result).toBeNull();
		});

		it('should prefer an exact web-URL match over an sshHost match for the same host', () => {
			const instances: ForgejoInstance[] = [
				{
					id: '1',
					name: 'Unified',
					instanceUrl: 'https://codeberg.org',
					sshHost: 'codeberg.org'
				}
			];

			const result = findBestInstanceMatch(instances, 'https://codeberg.org');
			expect(result).not.toBeNull();
			expect(result?.instance.id).toBe('1');
			expect(result?.confidence).toBe('exact');
		});
	});

	describe('getDefaultInstanceName', () => {
		it('should return known instance name for Codeberg', () => {
			expect(getDefaultInstanceName('https://codeberg.org')).toBe('Codeberg');
		});

		it('should return known instance name for Gitea', () => {
			expect(getDefaultInstanceName('https://gitea.com')).toBe('Gitea');
		});

		it('should return known instance name for Disroot', () => {
			expect(getDefaultInstanceName('https://git.disroot.org')).toBe('Disroot');
		});

		it('should return hostname for unknown instances', () => {
			expect(getDefaultInstanceName('https://git.example.com')).toBe('git.example.com');
		});

		it('should handle URL without protocol', () => {
			expect(getDefaultInstanceName('git.example.com')).toBe('Default Instance');
		});

		it('should return default for invalid URLs', () => {
			expect(getDefaultInstanceName('not-a-url')).toBe('Default Instance');
		});
	});

	describe('getConnectionStatus', () => {
		it('should return "Not tested" when no test result', () => {
			const instance: ForgejoInstance = {
				id: '1',
				name: 'Test',
				instanceUrl: 'https://codeberg.org'
			};

			expect(getConnectionStatus(instance)).toBe('$(question) Not tested');
		});

		it('should return success status with time ago', () => {
			const instance: ForgejoInstance = {
				id: '1',
				name: 'Test',
				instanceUrl: 'https://codeberg.org',
				lastConnectionTest: {
					success: true,
					timestamp: Date.now() - 5 * 60 * 1000 // 5 minutes ago
				}
			};

			const status = getConnectionStatus(instance);
			expect(status).toContain('$(check) Connected');
			expect(status).toContain('5m ago');
		});

		it('should return failure status with error', () => {
			const instance: ForgejoInstance = {
				id: '1',
				name: 'Test',
				instanceUrl: 'https://codeberg.org',
				lastConnectionTest: {
					success: false,
					timestamp: Date.now() - 10 * 60 * 1000, // 10 minutes ago
					error: 'Network error'
				}
			};

			const status = getConnectionStatus(instance);
			expect(status).toContain('$(x) Failed');
			expect(status).toContain('Network error');
		});

		it('should show "just now" for very recent tests', () => {
			const instance: ForgejoInstance = {
				id: '1',
				name: 'Test',
				instanceUrl: 'https://codeberg.org',
				lastConnectionTest: {
					success: true,
					timestamp: Date.now() - 30 * 1000 // 30 seconds ago
				}
			};

			const status = getConnectionStatus(instance);
			expect(status).toContain('just now');
		});

		it('should show hours for older tests', () => {
			const instance: ForgejoInstance = {
				id: '1',
				name: 'Test',
				instanceUrl: 'https://codeberg.org',
				lastConnectionTest: {
					success: true,
					timestamp: Date.now() - 2 * 60 * 60 * 1000 // 2 hours ago
				}
			};

			const status = getConnectionStatus(instance);
			expect(status).toContain('2h ago');
		});

		it('should show days for very old tests', () => {
			const instance: ForgejoInstance = {
				id: '1',
				name: 'Test',
				instanceUrl: 'https://codeberg.org',
				lastConnectionTest: {
					success: true,
					timestamp: Date.now() - 3 * 24 * 60 * 60 * 1000 // 3 days ago
				}
			};

			const status = getConnectionStatus(instance);
			expect(status).toContain('3d ago');
		});
	});
});
