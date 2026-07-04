import * as vscode from 'vscode';
import { startOnboarding } from '../../commands/onboarding';

// Mock dependencies
jest.mock('../../utils/instanceHelpers');
jest.mock('../../utils/logger', () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
  logDebug: jest.fn()
}));

import {
  generateUUID,
  normalizeUrl,
  getDefaultInstanceName,
  addInstance,
  testInstanceConnection
} from '../../utils/instanceHelpers';

const mockGenerateUUID = generateUUID as jest.MockedFunction<typeof generateUUID>;
const mockNormalizeUrl = normalizeUrl as jest.MockedFunction<typeof normalizeUrl>;
const mockGetDefaultInstanceName = getDefaultInstanceName as jest.MockedFunction<typeof getDefaultInstanceName>;
const mockAddInstance = addInstance as jest.MockedFunction<typeof addInstance>;
const mockTestInstanceConnection = testInstanceConnection as jest.MockedFunction<typeof testInstanceConnection>;

describe('onboarding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockGenerateUUID.mockReturnValue('test-uuid');
    mockNormalizeUrl.mockImplementation((url: string) => url.startsWith('http') ? url : `https://${url}`);
    mockGetDefaultInstanceName.mockReturnValue('Test Instance');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // Helper: start onboarding and advance past the 500ms browser-open delay.
  // Uses advanceTimersByTimeAsync to process microtasks (awaits) before
  // advancing, ensuring the setTimeout is registered before we try to fire it.
  async function runOnboarding(): Promise<boolean> {
    const promise = startOnboarding();
    await jest.advanceTimersByTimeAsync(600);
    return promise;
  }

  describe('startOnboarding', () => {
    it('should return false when user cancels URL input', async () => {
      (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce(undefined);

      const result = await startOnboarding();

      expect(result).toBe(false);
    });

    it('should return false when user cancels token input', async () => {
      (vscode.window.showInputBox as jest.Mock)
        .mockResolvedValueOnce('https://codeberg.org')
        .mockResolvedValueOnce(undefined);

      (vscode.env.openExternal as jest.Mock).mockResolvedValue(true);

      const result = await runOnboarding();

      expect(result).toBe(false);
    });

    it('should return false when user cancels name input', async () => {
      (vscode.window.showInputBox as jest.Mock)
        .mockResolvedValueOnce('https://codeberg.org')
        .mockResolvedValueOnce('test-token')
        .mockResolvedValueOnce(undefined);

      (vscode.env.openExternal as jest.Mock).mockResolvedValue(true);
      (vscode.window.withProgress as jest.Mock).mockImplementation(async (_opts: any, task: any) => task());
      mockTestInstanceConnection.mockResolvedValue(true);

      const result = await runOnboarding();

      expect(result).toBe(false);
    });

    it('should open browser for token creation', async () => {
      (vscode.window.showInputBox as jest.Mock)
        .mockResolvedValueOnce('https://codeberg.org')
        .mockResolvedValueOnce(undefined);

      (vscode.env.openExternal as jest.Mock).mockResolvedValue(true);

      await runOnboarding();

      expect(vscode.env.openExternal).toHaveBeenCalled();
    });

    it('should save instance on successful flow', async () => {
      (vscode.window.showInputBox as jest.Mock)
        .mockResolvedValueOnce('https://codeberg.org')
        .mockResolvedValueOnce('test-token')
        .mockResolvedValueOnce('My Codeberg')
        .mockResolvedValueOnce('');

      (vscode.env.openExternal as jest.Mock).mockResolvedValue(true);
      (vscode.window.withProgress as jest.Mock).mockImplementation(async (_opts: any, task: any) => task());
      mockTestInstanceConnection.mockResolvedValue(true);
      mockAddInstance.mockResolvedValue(undefined);
      (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);

      const result = await runOnboarding();

      expect(result).toBe(true);
      expect(mockAddInstance).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-uuid',
          name: 'My Codeberg',
          instanceUrl: 'https://codeberg.org',
          token: 'test-token'
        })
      );
    });

    it('should save optional SSH host when configured', async () => {
      (vscode.window.showInputBox as jest.Mock)
        .mockResolvedValueOnce('https://git.example.com')
        .mockResolvedValueOnce('test-token')
        .mockResolvedValueOnce('My Forgejo')
        .mockResolvedValueOnce(' ssh.example.com ');

      (vscode.env.openExternal as jest.Mock).mockResolvedValue(true);
      (vscode.window.withProgress as jest.Mock).mockImplementation(async (_opts: any, task: any) => task());
      mockTestInstanceConnection.mockResolvedValue(true);
      mockAddInstance.mockResolvedValue(undefined);
      (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);

      const result = await runOnboarding();

      expect(result).toBe(true);
      expect(mockAddInstance).toHaveBeenCalledWith(
        expect.objectContaining({
          instanceUrl: 'https://git.example.com',
          sshHost: 'ssh.example.com'
        })
      );
    });

    it('should return false when user cancels optional SSH host input', async () => {
      (vscode.window.showInputBox as jest.Mock)
        .mockResolvedValueOnce('https://git.example.com')
        .mockResolvedValueOnce('test-token')
        .mockResolvedValueOnce('My Forgejo')
        .mockResolvedValueOnce(undefined);

      (vscode.env.openExternal as jest.Mock).mockResolvedValue(true);
      (vscode.window.withProgress as jest.Mock).mockImplementation(async (_opts: any, task: any) => task());
      mockTestInstanceConnection.mockResolvedValue(true);

      const result = await runOnboarding();

      expect(result).toBe(false);
      expect(mockAddInstance).not.toHaveBeenCalled();
    });

    it('should validate optional SSH host input', async () => {
      (vscode.window.showInputBox as jest.Mock)
        .mockResolvedValueOnce('https://git.example.com')
        .mockResolvedValueOnce('test-token')
        .mockResolvedValueOnce('My Forgejo')
        .mockResolvedValueOnce('');

      (vscode.env.openExternal as jest.Mock).mockResolvedValue(true);
      (vscode.window.withProgress as jest.Mock).mockImplementation(async (_opts: any, task: any) => task());
      mockTestInstanceConnection.mockResolvedValue(true);
      mockAddInstance.mockResolvedValue(undefined);
      (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);

      await runOnboarding();

      const hostPromptOptions = (vscode.window.showInputBox as jest.Mock).mock.calls[3][0];
      expect(hostPromptOptions.validateInput('')).toBeUndefined();
      expect(hostPromptOptions.validateInput('ssh.example.com')).toBeUndefined();
      expect(hostPromptOptions.validateInput('https://ssh.example.com')).toContain('bare SSH hostname');
      expect(hostPromptOptions.validateInput('git@ssh.example.com')).toContain('bare SSH hostname');
      expect(hostPromptOptions.validateInput('ssh.example.com:2222')).toContain('without a port');
      expect(hostPromptOptions.validateInput('ssh.example.com/repo.git')).toContain('bare SSH hostname');
    });

    it('should show success message when connection test passes', async () => {
      (vscode.window.showInputBox as jest.Mock)
        .mockResolvedValueOnce('https://codeberg.org')
        .mockResolvedValueOnce('test-token')
        .mockResolvedValueOnce('Codeberg')
        .mockResolvedValueOnce('');

      (vscode.env.openExternal as jest.Mock).mockResolvedValue(true);
      (vscode.window.withProgress as jest.Mock).mockImplementation(async (_opts: any, task: any) => task());
      mockTestInstanceConnection.mockResolvedValue(true);
      mockAddInstance.mockResolvedValue(undefined);
      (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);

      await runOnboarding();

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('Successfully added Forgejo instance'),
        'View Instances',
        'Show Output'
      );
    });

    it('should allow saving when connection test fails and user chooses Save Anyway', async () => {
      (vscode.window.showInputBox as jest.Mock)
        .mockResolvedValueOnce('https://codeberg.org')
        .mockResolvedValueOnce('bad-token')
        .mockResolvedValueOnce('Codeberg')
        .mockResolvedValueOnce('');

      (vscode.env.openExternal as jest.Mock).mockResolvedValue(true);
      (vscode.window.withProgress as jest.Mock).mockImplementation(async (_opts: any, task: any) => task());
      mockTestInstanceConnection.mockResolvedValue(false);
      (vscode.window.showWarningMessage as jest.Mock).mockResolvedValueOnce('Save Anyway');
      mockAddInstance.mockResolvedValue(undefined);
      (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(undefined);

      const result = await runOnboarding();

      expect(result).toBe(true);
      expect(mockAddInstance).toHaveBeenCalled();
    });

    it('should return false when connection test fails and user cancels', async () => {
      (vscode.window.showInputBox as jest.Mock)
        .mockResolvedValueOnce('https://codeberg.org')
        .mockResolvedValueOnce('bad-token');

      (vscode.env.openExternal as jest.Mock).mockResolvedValue(true);
      (vscode.window.withProgress as jest.Mock).mockImplementation(async (_opts: any, task: any) => task());
      mockTestInstanceConnection.mockResolvedValue(false);
      (vscode.window.showWarningMessage as jest.Mock).mockResolvedValueOnce('Cancel');

      const result = await runOnboarding();

      expect(result).toBe(false);
      expect(mockAddInstance).not.toHaveBeenCalled();
    });

    it('should return false when connection test fails and user dismisses dialog', async () => {
      (vscode.window.showInputBox as jest.Mock)
        .mockResolvedValueOnce('https://codeberg.org')
        .mockResolvedValueOnce('bad-token');

      (vscode.env.openExternal as jest.Mock).mockResolvedValue(true);
      (vscode.window.withProgress as jest.Mock).mockImplementation(async (_opts: any, task: any) => task());
      mockTestInstanceConnection.mockResolvedValue(false);
      (vscode.window.showWarningMessage as jest.Mock).mockResolvedValueOnce(undefined);

      const result = await runOnboarding();

      expect(result).toBe(false);
    });

    it('should retry when connection test fails and user chooses Try Again', async () => {
      // First attempt: URL -> token -> connection fails -> Try Again
      // Second attempt: URL -> token -> connection succeeds -> name -> save
      (vscode.window.showInputBox as jest.Mock)
        .mockResolvedValueOnce('https://codeberg.org')  // 1st: URL
        .mockResolvedValueOnce('bad-token')              // 1st: Token
        .mockResolvedValueOnce('https://codeberg.org')  // 2nd: URL (retry)
        .mockResolvedValueOnce('good-token')             // 2nd: Token
        .mockResolvedValueOnce('Codeberg')               // 2nd: Name
        .mockResolvedValueOnce('');                      // 2nd: SSH port

      (vscode.env.openExternal as jest.Mock).mockResolvedValue(true);
      (vscode.window.withProgress as jest.Mock).mockImplementation(async (_opts: any, task: any) => task());
      mockTestInstanceConnection
        .mockResolvedValueOnce(false)   // 1st attempt fails
        .mockResolvedValueOnce(true);   // 2nd attempt succeeds
      (vscode.window.showWarningMessage as jest.Mock).mockResolvedValueOnce('Try Again');
      mockAddInstance.mockResolvedValue(undefined);
      (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);

      // Recursive call means two setTimeouts (one per attempt)
      const promise = startOnboarding();
      await jest.advanceTimersByTimeAsync(600);
      await jest.advanceTimersByTimeAsync(600);
      const result = await promise;

      expect(result).toBe(true);
      expect(mockTestInstanceConnection).toHaveBeenCalledTimes(2);
      expect(mockAddInstance).toHaveBeenCalledWith(
        expect.objectContaining({ token: 'good-token' })
      );
    });

    it('should handle addInstance failure', async () => {
      (vscode.window.showInputBox as jest.Mock)
        .mockResolvedValueOnce('https://codeberg.org')
        .mockResolvedValueOnce('test-token')
        .mockResolvedValueOnce('Codeberg')
        .mockResolvedValueOnce('');

      (vscode.env.openExternal as jest.Mock).mockResolvedValue(true);
      (vscode.window.withProgress as jest.Mock).mockImplementation(async (_opts: any, task: any) => task());
      mockTestInstanceConnection.mockResolvedValue(true);
      mockAddInstance.mockRejectedValue(new Error('Storage error'));
      (vscode.window.showErrorMessage as jest.Mock).mockResolvedValue(undefined);

      const result = await runOnboarding();

      expect(result).toBe(false);
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Failed to save instance: Storage error'),
        'Show Output'
      );
    });

    it('should show warning message when saved with failed connection', async () => {
      (vscode.window.showInputBox as jest.Mock)
        .mockResolvedValueOnce('https://codeberg.org')
        .mockResolvedValueOnce('bad-token')
        .mockResolvedValueOnce('Codeberg')
        .mockResolvedValueOnce('');

      (vscode.env.openExternal as jest.Mock).mockResolvedValue(true);
      (vscode.window.withProgress as jest.Mock).mockImplementation(async (_opts: any, task: any) => task());
      mockTestInstanceConnection.mockResolvedValue(false);
      (vscode.window.showWarningMessage as jest.Mock)
        .mockResolvedValueOnce('Save Anyway')
        .mockResolvedValue(undefined);
      mockAddInstance.mockResolvedValue(undefined);

      await runOnboarding();

      expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(2);
    });

    it('should trim token whitespace', async () => {
      (vscode.window.showInputBox as jest.Mock)
        .mockResolvedValueOnce('https://codeberg.org')
        .mockResolvedValueOnce('  test-token  ')
        .mockResolvedValueOnce('Codeberg')
        .mockResolvedValueOnce('');

      (vscode.env.openExternal as jest.Mock).mockResolvedValue(true);
      (vscode.window.withProgress as jest.Mock).mockImplementation(async (_opts: any, task: any) => task());
      mockTestInstanceConnection.mockResolvedValue(true);
      mockAddInstance.mockResolvedValue(undefined);
      (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);

      await runOnboarding();

      expect(mockAddInstance).toHaveBeenCalledWith(
        expect.objectContaining({ token: 'test-token' })
      );
    });

    it('should trim name whitespace', async () => {
      (vscode.window.showInputBox as jest.Mock)
        .mockResolvedValueOnce('https://codeberg.org')
        .mockResolvedValueOnce('test-token')
        .mockResolvedValueOnce('  My Instance  ')
        .mockResolvedValueOnce('');

      (vscode.env.openExternal as jest.Mock).mockResolvedValue(true);
      (vscode.window.withProgress as jest.Mock).mockImplementation(async (_opts: any, task: any) => task());
      mockTestInstanceConnection.mockResolvedValue(true);
      mockAddInstance.mockResolvedValue(undefined);
      (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);

      await runOnboarding();

      expect(mockAddInstance).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'My Instance' })
      );
    });
  });
});
