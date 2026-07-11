import * as vscode from 'vscode';
import { testInstanceConnection } from '../../utils/instanceHelpers';
import { ForgejoInstance } from '../../models/instance';
import { ForgejoClient } from '../../api/forgejoClient';

// Mock logger
jest.mock('../../utils/logger', () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
  logDebug: jest.fn()
}));

// Mock ForgejoClient
jest.mock('../../api/forgejoClient');

const MockForgejoClient = ForgejoClient as jest.MockedClass<typeof ForgejoClient>;

// Helper to mock configuration
const mockConfig = (instances: any[]) => {
  let currentInstances = [...instances];

  const get = jest.fn().mockImplementation((key: string) => {
    if (key === 'instances') { return currentInstances; }
    return undefined;
  });
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

  return { get, update };
};

describe('testInstanceConnection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const createInstance = (overrides?: Partial<ForgejoInstance>): ForgejoInstance => ({
    id: 'test-id',
    name: 'Test Instance',
    instanceUrl: 'https://example.com',
    token: 'test-token',
    ...overrides
  });

  it('should return true on successful connection', async () => {
	MockForgejoClient.prototype.rawRequest = jest.fn().mockResolvedValue({ login: 'alice' });
    mockConfig([]);

    const instance = createInstance();
    const result = await testInstanceConnection(instance, false);

    expect(result).toBe(true);
    expect(instance.lastConnectionTest).toBeDefined();
    expect(instance.lastConnectionTest!.success).toBe(true);
  });

  it('should return false on failed connection', async () => {
	MockForgejoClient.prototype.rawRequest = jest.fn().mockResolvedValue(undefined);
    mockConfig([]);

    const instance = createInstance();
    const result = await testInstanceConnection(instance, false);

    expect(result).toBe(false);
    expect(instance.lastConnectionTest).toBeDefined();
    expect(instance.lastConnectionTest!.success).toBe(false);
    expect(instance.lastConnectionTest!.error).toBe('Connection failed');
  });

  it('should return false on error and set error message', async () => {
	MockForgejoClient.prototype.rawRequest = jest.fn().mockRejectedValue(
      new Error('Network timeout')
    );
    mockConfig([]);

    const instance = createInstance();
    const result = await testInstanceConnection(instance, false);

    expect(result).toBe(false);
    expect(instance.lastConnectionTest!.success).toBe(false);
    expect(instance.lastConnectionTest!.error).toBe('Network timeout');
  });

  it('should handle non-Error thrown values', async () => {
	MockForgejoClient.prototype.rawRequest = jest.fn().mockRejectedValue('string error');
    mockConfig([]);

    const instance = createInstance();
    const result = await testInstanceConnection(instance, false);

    expect(result).toBe(false);
    expect(instance.lastConnectionTest!.error).toBe('Unknown error');
  });

  it('should save result when saveResult=true and instance exists in config', async () => {
	MockForgejoClient.prototype.rawRequest = jest.fn().mockResolvedValue({ login: 'alice' });
    const existingInstance = createInstance();
    const { update } = mockConfig([existingInstance]);

    const instance = createInstance();
    await testInstanceConnection(instance, true);

    expect(update).toHaveBeenCalled();
  });

  it('should not save result when saveResult=false', async () => {
	MockForgejoClient.prototype.rawRequest = jest.fn().mockResolvedValue({ login: 'alice' });
    const { update } = mockConfig([]);

    const instance = createInstance();
    await testInstanceConnection(instance, false);

    expect(update).not.toHaveBeenCalled();
  });

  it('should save error result when saveResult=true and instance exists', async () => {
	MockForgejoClient.prototype.rawRequest = jest.fn().mockRejectedValue(
      new Error('Auth failed')
    );
    const existingInstance = createInstance();
    const { update } = mockConfig([existingInstance]);

    const instance = createInstance();
    await testInstanceConnection(instance, true);

    expect(update).toHaveBeenCalled();
  });

  it('should set timestamp on connection test result', async () => {
	MockForgejoClient.prototype.rawRequest = jest.fn().mockResolvedValue({ login: 'alice' });
    mockConfig([]);

    const now = Date.now();
    const instance = createInstance();
    await testInstanceConnection(instance, false);

    expect(instance.lastConnectionTest!.timestamp).toBeGreaterThanOrEqual(now);
    expect(instance.lastConnectionTest!.timestamp).toBeLessThanOrEqual(Date.now());
  });

	it('uses the public connection check only when no token is configured', async () => {
		MockForgejoClient.prototype.testConnection = jest.fn().mockResolvedValue(true);
		MockForgejoClient.prototype.rawRequest = jest.fn();
		mockConfig([]);

		const result = await testInstanceConnection(createInstance({ token: undefined }), false);

		expect(result).toBe(true);
		expect(MockForgejoClient.prototype.testConnection).toHaveBeenCalled();
		expect(MockForgejoClient.prototype.rawRequest).not.toHaveBeenCalled();
	});
});
