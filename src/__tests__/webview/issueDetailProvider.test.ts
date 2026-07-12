import * as vscode from 'vscode';
import { ForgejoClient } from '../../api/forgejoClient';
import { getForgejoConfigFor } from '../../utils/config';
import { IssueDetailWebviewProvider } from '../../webview/issueDetail/provider';

jest.mock('../../api/forgejoClient');
jest.mock('../../utils/config');
jest.mock('../../utils/logger', () => ({
  logInfo: jest.fn(),
  logDebug: jest.fn(),
  logError: jest.fn(),
}));

const MockForgejoClient = ForgejoClient as jest.MockedClass<typeof ForgejoClient>;
const mockGetForgejoConfigFor = getForgejoConfigFor as jest.MockedFunction<typeof getForgejoConfigFor>;

describe('IssueDetailWebviewProvider', () => {
  const issue = {
    number: 200,
    title: 'Comment composer',
    state: 'open',
    body: 'Issue body',
    html_url: 'https://git.example.com/owner/repo/issues/200',
    user: { login: 'reporter' },
    labels: [],
    assignees: []
  };

  function createProvider(
    token: string,
    configuredSortOrder?: 'newest-first' | 'oldest-first'
  ): { provider: IssueDetailWebviewProvider; postMessage: jest.Mock } {
    const postMessage = jest.fn();
    const provider = new IssueDetailWebviewProvider({} as never);

    (vscode.workspace.getConfiguration as jest.Mock).mockImplementation(() => ({
      get: jest.fn((_key: string, defaultValue?: unknown) => configuredSortOrder ?? defaultValue),
      update: jest.fn(),
      has: jest.fn(),
      inspect: jest.fn()
    }));

    mockGetForgejoConfigFor.mockResolvedValue({
      instanceUrl: 'https://git.example.com',
      owner: 'owner',
      repo: 'repo',
      token
    });

    MockForgejoClient.mockImplementation(() => ({
      getIssueDetails: jest.fn().mockResolvedValue(issue),
      getIssueComments: jest.fn().mockResolvedValue([]),
      getIssueTimeline: jest.fn().mockResolvedValue([])
    } as any));

    (provider as any)._panels.set('panel', {
      panel: { webview: { postMessage } },
      owner: 'owner',
      repo: 'repo',
      number: 200,
      instanceUrl: 'https://git.example.com',
      isReady: true,
      pendingData: null
    });

    return { provider, postMessage };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test.each([
    ['configured token', 'test-token', true],
    ['missing token', '', false],
    ['blank token', '   ', false]
  ])('sets canComment from %s', async (_label, token, expectedCanComment) => {
    const { provider, postMessage } = createProvider(token);

    await (provider as any)._fetchIssueData('panel');

    const updateMessage = postMessage.mock.calls.find(([message]) => message.type === 'update')?.[0];
    expect(updateMessage).toMatchObject({
      type: 'update',
      data: {
        owner: 'owner',
        repo: 'repo',
        issue,
        activities: [],
        canComment: expectedCanComment
      }
    });
  });

  it('starts work on the loaded issue from the details page', async () => {
    const { provider } = createProvider('test-token');
    const state = (provider as any)._panels.get('panel');
    state.pendingData = {
      issue,
      activities: [],
      owner: 'owner',
      repo: 'repo',
      canComment: true,
      instanceUrl: 'https://git.example.com'
    };

    await (provider as any)._handleMessage({ type: 'startWork' }, 'panel');

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'forgejo.startWorkOnIssue',
      issue,
      'owner',
      'repo',
      'https://git.example.com'
    );
  });

  it('shows an error when start work is clicked before issue details load', async () => {
    const { provider } = createProvider('test-token');

    await (provider as any)._handleMessage({ type: 'startWork' }, 'panel');

    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Issue details are not loaded yet.');
  });

  it('delivers a fetch error that occurs before the webview is ready', async () => {
    const { provider, postMessage } = createProvider('test-token');
    const state = (provider as any)._panels.get('panel');
    state.isReady = false;
    mockGetForgejoConfigFor.mockRejectedValueOnce(new Error('Authentication failed'));

    await (provider as any)._fetchIssueData('panel');
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));

    await (provider as any)._handleMessage({ type: 'ready' }, 'panel');
    expect(postMessage).toHaveBeenCalledWith({ type: 'error', message: 'Authentication failed' });
  });

  it('defaults activitySortOrder to newest-first when no preference is configured', async () => {
    const { provider, postMessage } = createProvider('test-token');

    await (provider as any)._fetchIssueData('panel');

    const updateMessage = postMessage.mock.calls.find(([message]) => message.type === 'update')?.[0];
    expect(updateMessage).toMatchObject({ data: { activitySortOrder: 'newest-first' } });
  });

  it('reads activitySortOrder from the configured preference', async () => {
    const { provider, postMessage } = createProvider('test-token', 'oldest-first');

    await (provider as any)._fetchIssueData('panel');

    const updateMessage = postMessage.mock.calls.find(([message]) => message.type === 'update')?.[0];
    expect(updateMessage).toMatchObject({ data: { activitySortOrder: 'oldest-first' } });
  });

  it('does not change the underlying activity fetch order based on the sort preference', async () => {
    const activities = [
      { id: 1, type: 'comment', created_at: '2025-01-03T00:00:00Z' },
      { id: 2, type: 'comment', created_at: '2025-01-01T00:00:00Z' },
      { id: 3, type: 'comment', created_at: '2025-01-02T00:00:00Z' }
    ];

    const { provider, postMessage } = createProvider('test-token', 'oldest-first');
    MockForgejoClient.mockImplementation(() => ({
      getIssueDetails: jest.fn().mockResolvedValue(issue),
      getIssueComments: jest.fn().mockResolvedValue(activities),
      getIssueTimeline: jest.fn().mockResolvedValue([])
    } as any));
    await (provider as any)._fetchIssueData('panel');

    const updateMessage = postMessage.mock.calls.find(([message]) => message.type === 'update')?.[0];
    expect(updateMessage.data.activities.map((a: { id: number }) => a.id)).toEqual([1, 3, 2]);
  });

  it('persists the sort order choice as a global setting', async () => {
    const { provider } = createProvider('test-token');
    const state = (provider as any)._panels.get('panel');
    state.pendingData = {
      issue,
      activities: [],
      activitySortOrder: 'newest-first',
      owner: 'owner',
      repo: 'repo',
      canComment: true,
      instanceUrl: 'https://git.example.com'
    };

    await (provider as any)._handleMessage({ type: 'setActivitySortOrder', order: 'oldest-first' }, 'panel');

    const configInstance = (vscode.workspace.getConfiguration as jest.Mock).mock.results[0].value;
    expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith('forgejo');
    expect(configInstance.update).toHaveBeenCalledWith(
      'activityTimelineSortOrder',
      'oldest-first',
      vscode.ConfigurationTarget.Global
    );
  });

  describe('metadata editing', () => {
    function seedPendingData(provider: IssueDetailWebviewProvider, overrides: Record<string, unknown> = {}): void {
      const state = (provider as any)._panels.get('panel');
      state.pendingData = {
        issue: { ...issue, labels: [{ name: 'bug', color: 'ff0000' }], assignees: [{ login: 'alice' }], milestone: { id: 1, title: 'v1.0' } },
        activities: [],
        owner: 'owner',
        repo: 'repo',
        canComment: true,
        instanceUrl: 'https://git.example.com',
        ...overrides
      };
    }

    function mockClientWithMetadataMethods(overrides: Record<string, unknown> = {}): Record<string, jest.Mock> {
      const methods = {
        listRepoLabels: jest.fn().mockResolvedValue([{ id: 1, name: 'bug', color: 'ff0000' }, { id: 2, name: 'feature', color: '00ff00' }]),
        listAssignableUsers: jest.fn().mockResolvedValue([{ id: 1, login: 'alice' }, { id: 2, login: 'bob' }]),
        listMilestones: jest.fn().mockResolvedValue([{ id: 1, title: 'v1.0' }, { id: 2, title: 'v2.0' }]),
        setIssueLabels: jest.fn().mockResolvedValue(undefined),
        updateIssueMetadata: jest.fn().mockResolvedValue({ ...issue }),
        getIssueDetails: jest.fn().mockResolvedValue(issue),
        getIssueComments: jest.fn().mockResolvedValue([]),
        getIssueTimeline: jest.fn().mockResolvedValue([]),
        ...overrides
      };
      MockForgejoClient.mockImplementation(() => methods as any);
      return methods as any;
    }

    describe('_editLabels', () => {
      it('replaces labels with the QuickPick selection and refreshes the panel', async () => {
        const { provider, postMessage } = createProvider('test-token');
        seedPendingData(provider);
        const client = mockClientWithMetadataMethods();
        (vscode.window.showQuickPick as jest.Mock).mockResolvedValue([{ label: 'feature', labelId: 2 }]);

        await (provider as any)._handleMessage({ type: 'editLabels' }, 'panel');

        expect(client.listRepoLabels).toHaveBeenCalledWith('owner', 'repo');
        expect(client.setIssueLabels).toHaveBeenCalledWith('owner', 'repo', 200, [2]);
        expect(client.getIssueDetails).toHaveBeenCalled(); // refetch
        expect(postMessage).toHaveBeenCalledWith({ type: 'actionComplete', action: 'editLabels', success: true });
      });

      it('does nothing when the QuickPick is cancelled', async () => {
        const { provider, postMessage } = createProvider('test-token');
        seedPendingData(provider);
        const client = mockClientWithMetadataMethods();
        (vscode.window.showQuickPick as jest.Mock).mockResolvedValue(undefined);

        await (provider as any)._handleMessage({ type: 'editLabels' }, 'panel');

        expect(client.setIssueLabels).not.toHaveBeenCalled();
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'editLabels' }));
      });

      it('reports an API error without mutating panel state', async () => {
        const { provider, postMessage } = createProvider('test-token');
        seedPendingData(provider);
        const client = mockClientWithMetadataMethods({
          setIssueLabels: jest.fn().mockRejectedValue(new Error('Forbidden'))
        });
        (vscode.window.showQuickPick as jest.Mock).mockResolvedValue([{ label: 'bug', labelId: 1 }]);
        const state = (provider as any)._panels.get('panel');
        const originalLabels = state.pendingData.issue.labels;

        await (provider as any)._handleMessage({ type: 'editLabels' }, 'panel');

        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Failed to update labels: Forbidden');
        expect(postMessage).toHaveBeenCalledWith({ type: 'actionComplete', action: 'editLabels', success: false });
        expect(state.pendingData.issue.labels).toBe(originalLabels);
        expect(client.getIssueDetails).not.toHaveBeenCalled();
      });
    });

    describe('_editAssignees', () => {
      it('sends the full desired assignee list via updateIssueMetadata', async () => {
        const { provider, postMessage } = createProvider('test-token');
        seedPendingData(provider);
        const client = mockClientWithMetadataMethods();
        (vscode.window.showQuickPick as jest.Mock).mockResolvedValue([{ label: 'bob', login: 'bob' }]);

        await (provider as any)._handleMessage({ type: 'editAssignees' }, 'panel');

        expect(client.listAssignableUsers).toHaveBeenCalledWith('owner', 'repo');
        expect(client.updateIssueMetadata).toHaveBeenCalledWith('owner', 'repo', 200, { assignees: ['bob'] });
        expect(postMessage).toHaveBeenCalledWith({ type: 'actionComplete', action: 'editAssignees', success: true });
      });

      it('clears all assignees when the picker returns an empty selection', async () => {
        const { provider } = createProvider('test-token');
        seedPendingData(provider);
        const client = mockClientWithMetadataMethods();
        (vscode.window.showQuickPick as jest.Mock).mockResolvedValue([]);

        await (provider as any)._handleMessage({ type: 'editAssignees' }, 'panel');

        expect(client.updateIssueMetadata).toHaveBeenCalledWith('owner', 'repo', 200, { assignees: [] });
      });

      it('does nothing when the QuickPick is cancelled', async () => {
        const { provider } = createProvider('test-token');
        seedPendingData(provider);
        const client = mockClientWithMetadataMethods();
        (vscode.window.showQuickPick as jest.Mock).mockResolvedValue(undefined);

        await (provider as any)._handleMessage({ type: 'editAssignees' }, 'panel');

        expect(client.updateIssueMetadata).not.toHaveBeenCalled();
      });

      it('reports an unauthenticated/permission error from the API', async () => {
        const { provider, postMessage } = createProvider('test-token');
        seedPendingData(provider);
        mockClientWithMetadataMethods({
          updateIssueMetadata: jest.fn().mockRejectedValue(new Error('HTTP 401: Unauthorized'))
        });
        (vscode.window.showQuickPick as jest.Mock).mockResolvedValue([{ label: 'alice', login: 'alice' }]);

        await (provider as any)._handleMessage({ type: 'editAssignees' }, 'panel');

        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Failed to update assignees: HTTP 401: Unauthorized');
        expect(postMessage).toHaveBeenCalledWith({ type: 'actionComplete', action: 'editAssignees', success: false });
      });
    });

    describe('_editMilestone', () => {
      it('sends the selected milestone id via updateIssueMetadata', async () => {
        const { provider, postMessage } = createProvider('test-token');
        seedPendingData(provider);
        const client = mockClientWithMetadataMethods();
        (vscode.window.showQuickPick as jest.Mock).mockResolvedValue({ label: 'v2.0', milestoneId: 2 });

        await (provider as any)._handleMessage({ type: 'editMilestone' }, 'panel');

        expect(client.listMilestones).toHaveBeenCalledWith('owner', 'repo', 'open');
        expect(client.updateIssueMetadata).toHaveBeenCalledWith('owner', 'repo', 200, { milestone: 2 });
        expect(postMessage).toHaveBeenCalledWith({ type: 'actionComplete', action: 'editMilestone', success: true });
      });

      it('sends milestone: 0 when "No milestone" is selected (unset, not omit)', async () => {
        const { provider } = createProvider('test-token');
        seedPendingData(provider);
        const client = mockClientWithMetadataMethods();
        (vscode.window.showQuickPick as jest.Mock).mockResolvedValue({ label: 'No milestone', milestoneId: 0 });

        await (provider as any)._handleMessage({ type: 'editMilestone' }, 'panel');

        expect(client.updateIssueMetadata).toHaveBeenCalledWith('owner', 'repo', 200, { milestone: 0 });
      });

      it('does nothing when the QuickPick is cancelled', async () => {
        const { provider } = createProvider('test-token');
        seedPendingData(provider);
        const client = mockClientWithMetadataMethods();
        (vscode.window.showQuickPick as jest.Mock).mockResolvedValue(undefined);

        await (provider as any)._handleMessage({ type: 'editMilestone' }, 'panel');

        expect(client.updateIssueMetadata).not.toHaveBeenCalled();
      });
    });

    it('threads the panel instanceUrl into config resolution for every metadata action', async () => {
      const { provider } = createProvider('test-token');
      seedPendingData(provider);
      mockClientWithMetadataMethods();
      (vscode.window.showQuickPick as jest.Mock).mockResolvedValue([]);

      await (provider as any)._handleMessage({ type: 'editLabels' }, 'panel');
      await (provider as any)._handleMessage({ type: 'editAssignees' }, 'panel');
      (vscode.window.showQuickPick as jest.Mock).mockResolvedValue({ label: 'No milestone', milestoneId: 0 });
      await (provider as any)._handleMessage({ type: 'editMilestone' }, 'panel');

      // Each action resolves config once for itself and once again for the
      // post-success refetch — every call must carry the panel's instanceUrl,
      // never fall back to a default/active-editor config.
      expect(mockGetForgejoConfigFor.mock.calls.length).toBeGreaterThan(0);
      for (const call of mockGetForgejoConfigFor.mock.calls) {
        expect(call).toEqual(['owner', 'repo', 'https://git.example.com']);
      }
    });
  });
});
