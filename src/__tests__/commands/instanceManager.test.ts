import * as vscode from 'vscode';
import { manageInstances } from '../../commands/instanceManager';

// Mock dependencies
jest.mock('../../utils/instanceHelpers');
jest.mock('../../commands/onboarding');
jest.mock('../../utils/secretStorage', () => ({
  setToken: jest.fn().mockResolvedValue(undefined),
  getToken: jest.fn().mockResolvedValue(undefined),
  deleteToken: jest.fn().mockResolvedValue(undefined),
  isInitialized: jest.fn(() => true)
}));

import {
  getAllInstances,
  getInstanceById,
  setDefaultInstance,
  removeInstance,
  testInstanceConnection,
  getConnectionStatus,
  updateInstance
} from '../../utils/instanceHelpers';
import { startOnboarding } from '../../commands/onboarding';
import { setToken } from '../../utils/secretStorage';

const mockSetToken = setToken as jest.MockedFunction<typeof setToken>;
const mockGetAllInstances = getAllInstances as jest.MockedFunction<typeof getAllInstances>;
const mockGetInstanceById = getInstanceById as jest.MockedFunction<typeof getInstanceById>;
const mockSetDefaultInstance = setDefaultInstance as jest.MockedFunction<typeof setDefaultInstance>;
const mockRemoveInstance = removeInstance as jest.MockedFunction<typeof removeInstance>;
const mockTestInstanceConnection = testInstanceConnection as jest.MockedFunction<typeof testInstanceConnection>;
const mockGetConnectionStatus = getConnectionStatus as jest.MockedFunction<typeof getConnectionStatus>;
const mockUpdateInstance = updateInstance as jest.MockedFunction<typeof updateInstance>;
const mockStartOnboarding = startOnboarding as jest.MockedFunction<typeof startOnboarding>;

describe('instanceManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConnectionStatus.mockReturnValue('$(question) Not tested');
  });

  describe('manageInstances', () => {
    it('should show quickpick with add option and no instances message when empty', async () => {
      mockGetAllInstances.mockResolvedValue([]);
      (vscode.window.showQuickPick as jest.Mock).mockResolvedValue(undefined);

      await manageInstances();

      expect(vscode.window.showQuickPick).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ label: '$(add) Add New Instance' })
        ]),
        expect.any(Object)
      );
    });

    it('should show instances in quickpick', async () => {
      const instances = [
        { id: '1', name: 'Codeberg', instanceUrl: 'https://codeberg.org', token: 'tok', isDefault: true },
        { id: '2', name: 'Work', instanceUrl: 'https://git.work.com', token: 'tok2', isDefault: false }
      ];
      mockGetAllInstances.mockResolvedValue(instances);
      (vscode.window.showQuickPick as jest.Mock).mockResolvedValue(undefined);

      await manageInstances();

      expect(vscode.window.showQuickPick).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ label: '$(star-full) Codeberg' }),
          expect.objectContaining({ label: '$(server) Work' })
        ]),
        expect.any(Object)
      );
    });

    it('should show configured SSH ports in quickpick descriptions', async () => {
      const instances = [
        { id: '1', name: 'Work', instanceUrl: 'https://git.work.com', token: 'tok', sshPort: 2222 }
      ];
      mockGetAllInstances.mockResolvedValue(instances);
      (vscode.window.showQuickPick as jest.Mock).mockResolvedValue(undefined);

      await manageInstances();

      expect(vscode.window.showQuickPick).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            label: '$(server) Work',
            description: 'https://git.work.com (SSH port 2222)'
          })
        ]),
        expect.any(Object)
      );
    });

    it('should do nothing when user cancels quickpick', async () => {
      mockGetAllInstances.mockResolvedValue([]);
      (vscode.window.showQuickPick as jest.Mock).mockResolvedValue(undefined);

      await manageInstances();

      expect(mockStartOnboarding).not.toHaveBeenCalled();
    });

    it('should start onboarding when add is selected', async () => {
      mockGetAllInstances.mockResolvedValue([]);
      (vscode.window.showQuickPick as jest.Mock)
        .mockResolvedValueOnce({ action: 'add' })
        .mockResolvedValueOnce(undefined); // After onboarding, manageInstances is called again
      mockStartOnboarding.mockResolvedValue(false);

      await manageInstances();

      expect(mockStartOnboarding).toHaveBeenCalled();
    });

    it('should recurse after successful onboarding', async () => {
      mockGetAllInstances.mockResolvedValue([]);
      (vscode.window.showQuickPick as jest.Mock)
        .mockResolvedValueOnce({ action: 'add' })
        .mockResolvedValueOnce(undefined);
      mockStartOnboarding.mockResolvedValue(true);

      await manageInstances();

      expect(mockStartOnboarding).toHaveBeenCalled();
      // showQuickPick called twice: once initially, once after recursion
      expect(vscode.window.showQuickPick).toHaveBeenCalledTimes(2);
    });

    it('should show instance actions when instance is selected', async () => {
      const instance = { id: '1', name: 'Test', instanceUrl: 'https://test.com', token: 'tok', isDefault: false };
      mockGetAllInstances.mockResolvedValue([instance]);
      mockGetInstanceById.mockResolvedValue(instance);

      (vscode.window.showQuickPick as jest.Mock)
        .mockResolvedValueOnce({ instanceId: '1' }) // Select instance
        .mockResolvedValueOnce(undefined); // Cancel action menu

      await manageInstances();

      expect(mockGetInstanceById).toHaveBeenCalledWith('1');
    });

    it('should handle errors gracefully', async () => {
      mockGetAllInstances.mockRejectedValue(new Error('Config error'));

      await manageInstances();

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Failed to manage instances: Config error')
      );
    });

    it('should filter out invalid instances', async () => {
      const validInstance = { id: '1', name: 'Valid', instanceUrl: 'https://valid.com', token: 'tok' };
      const invalidInstance = { id: null, name: null, instanceUrl: null, token: null };
      mockGetAllInstances.mockResolvedValue([validInstance, invalidInstance] as any);
      (vscode.window.showQuickPick as jest.Mock).mockResolvedValue(undefined);

      await manageInstances();

      // Should only show valid instance (plus the Add option and separator)
      const quickPickCall = (vscode.window.showQuickPick as jest.Mock).mock.calls[0][0];
      const instanceItems = quickPickCall.filter((item: any) => item.instanceId);
      expect(instanceItems).toHaveLength(1);
    });
  });

  describe('showInstanceActions - test connection', () => {
    it('should test connection when test action is selected', async () => {
      const instance = { id: '1', name: 'Test', instanceUrl: 'https://test.com', token: 'tok', isDefault: false };
      mockGetAllInstances.mockResolvedValue([instance]);
      mockGetInstanceById.mockResolvedValue(instance);
      mockTestInstanceConnection.mockResolvedValue(true);
      (vscode.window.withProgress as jest.Mock).mockImplementation(async (_opts, task) => task());

      (vscode.window.showQuickPick as jest.Mock)
        .mockResolvedValueOnce({ instanceId: '1' }) // Select instance
        .mockResolvedValueOnce({ action: 'test' }) // Test connection
        .mockResolvedValueOnce(undefined); // Cancel after action

      await manageInstances();

      expect(vscode.window.withProgress).toHaveBeenCalledWith(
        expect.objectContaining({ title: expect.stringContaining('Testing') }),
        expect.any(Function)
      );
      expect(mockTestInstanceConnection).toHaveBeenCalledWith(
        expect.objectContaining({ id: '1', instanceUrl: 'https://test.com' })
      );
    });
  });

  describe('showInstanceActions - set default', () => {
    it('should set instance as default', async () => {
      const instance = { id: '1', name: 'Test', instanceUrl: 'https://test.com', token: 'tok', isDefault: false };
      mockGetAllInstances.mockResolvedValue([instance]);
      mockGetInstanceById.mockResolvedValue(instance);
      mockSetDefaultInstance.mockResolvedValue(undefined);

      (vscode.window.showQuickPick as jest.Mock)
        .mockResolvedValueOnce({ instanceId: '1' }) // Select instance
        .mockResolvedValueOnce({ action: 'default' }) // Set default
        .mockResolvedValueOnce(undefined); // Cancel recursion

      await manageInstances();

      expect(mockSetDefaultInstance).toHaveBeenCalledWith('1');
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('Test is now the default instance')
      );
    });
  });

  describe('showInstanceActions - edit token', () => {
    it('should update token when new token passes connection test', async () => {
      const instance = { id: '1', name: 'Test', instanceUrl: 'https://test.com', token: 'old-tok', isDefault: false };
      mockGetAllInstances.mockResolvedValue([instance]);
      mockGetInstanceById.mockResolvedValue(instance);
      mockTestInstanceConnection.mockResolvedValue(true);
      mockUpdateInstance.mockResolvedValue(undefined);
      (vscode.window.withProgress as jest.Mock).mockImplementation(async (_opts, task) => task());

      (vscode.window.showQuickPick as jest.Mock)
        .mockResolvedValueOnce({ instanceId: '1' }) // Select instance
        .mockResolvedValueOnce({ action: 'edit' }) // Edit token
        .mockResolvedValueOnce(undefined); // Cancel after action

      (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce('new-token');

      await manageInstances();

      // Token should be stored in SecretStorage
      expect(mockSetToken).toHaveBeenCalledWith('1', 'new-token');
      // updateInstance should still be called (for metadata like lastConnectionTest)
      expect(mockUpdateInstance).toHaveBeenCalled();
    });

    it('should prompt to save anyway when connection test fails', async () => {
      const instance = { id: '1', name: 'Test', instanceUrl: 'https://test.com', token: 'old-tok', isDefault: false };
      mockGetAllInstances.mockResolvedValue([instance]);
      mockGetInstanceById.mockResolvedValue(instance);
      mockTestInstanceConnection.mockResolvedValue(false);
      (vscode.window.withProgress as jest.Mock).mockImplementation(async (_opts, task) => task());

      (vscode.window.showQuickPick as jest.Mock)
        .mockResolvedValueOnce({ instanceId: '1' }) // Select instance
        .mockResolvedValueOnce({ action: 'edit' }) // Edit token
        .mockResolvedValueOnce(undefined); // Cancel after action

      (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce('bad-token');
      (vscode.window.showWarningMessage as jest.Mock).mockResolvedValueOnce('Cancel');

      await manageInstances();

      // Should NOT update since user cancelled
      expect(mockUpdateInstance).not.toHaveBeenCalled();
    });

    it('should do nothing when user cancels token input', async () => {
      const instance = { id: '1', name: 'Test', instanceUrl: 'https://test.com', token: 'tok', isDefault: false };
      mockGetAllInstances.mockResolvedValue([instance]);
      mockGetInstanceById.mockResolvedValue(instance);

      (vscode.window.showQuickPick as jest.Mock)
        .mockResolvedValueOnce({ instanceId: '1' })
        .mockResolvedValueOnce({ action: 'edit' })
        .mockResolvedValueOnce(undefined);

      (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce(undefined);

      await manageInstances();

      expect(mockUpdateInstance).not.toHaveBeenCalled();
    });
  });

  describe('showInstanceActions - remove instance', () => {
    it('should remove instance when user confirms', async () => {
      const instance = { id: '1', name: 'Test', instanceUrl: 'https://test.com', token: 'tok', isDefault: false };
      mockGetAllInstances.mockResolvedValue([instance]);
      mockGetInstanceById.mockResolvedValue(instance);
      mockRemoveInstance.mockResolvedValue(undefined);

      (vscode.window.showQuickPick as jest.Mock)
        .mockResolvedValueOnce({ instanceId: '1' }) // Select instance
        .mockResolvedValueOnce({ action: 'remove' }) // Remove
        .mockResolvedValueOnce(undefined); // Cancel recursion

      (vscode.window.showWarningMessage as jest.Mock).mockResolvedValueOnce('Remove');

      await manageInstances();

      expect(mockRemoveInstance).toHaveBeenCalledWith('1');
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('Removed instance: Test')
      );
    });

    it('should not remove when user cancels confirmation', async () => {
      const instance = { id: '1', name: 'Test', instanceUrl: 'https://test.com', token: 'tok', isDefault: false };
      mockGetAllInstances.mockResolvedValue([instance]);
      mockGetInstanceById.mockResolvedValue(instance);

      (vscode.window.showQuickPick as jest.Mock)
        .mockResolvedValueOnce({ instanceId: '1' })
        .mockResolvedValueOnce({ action: 'remove' })
        .mockResolvedValueOnce(undefined);

      (vscode.window.showWarningMessage as jest.Mock).mockResolvedValueOnce('Cancel');

      await manageInstances();

      expect(mockRemoveInstance).not.toHaveBeenCalled();
    });
  });

  describe('showInstanceActions - back', () => {
    it('should return to instance list on back action', async () => {
      const instance = { id: '1', name: 'Test', instanceUrl: 'https://test.com', token: 'tok', isDefault: false };
      mockGetAllInstances.mockResolvedValue([instance]);
      mockGetInstanceById.mockResolvedValue(instance);

      (vscode.window.showQuickPick as jest.Mock)
        .mockResolvedValueOnce({ instanceId: '1' }) // Select instance
        .mockResolvedValueOnce({ action: 'back' }) // Go back
        .mockResolvedValueOnce(undefined); // Cancel at top level

      await manageInstances();

      // showQuickPick called 3 times: initial list, action menu, back to list
      expect(vscode.window.showQuickPick).toHaveBeenCalledTimes(3);
    });
  });

  describe('showInstanceActions - instance not found', () => {
    it('should show error when instance not found', async () => {
      const instance = { id: '1', name: 'Test', instanceUrl: 'https://test.com', token: 'tok' };
      mockGetAllInstances.mockResolvedValue([instance]);
      mockGetInstanceById.mockResolvedValue(undefined as any);

      (vscode.window.showQuickPick as jest.Mock)
        .mockResolvedValueOnce({ instanceId: 'nonexistent' });

      (vscode.window.showErrorMessage as jest.Mock).mockResolvedValue(undefined);

      await manageInstances();

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('not found'),
        'Open Settings'
      );
    });
  });
});
