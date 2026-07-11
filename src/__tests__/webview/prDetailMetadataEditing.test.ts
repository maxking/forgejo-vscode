import * as vscode from 'vscode';
import { ForgejoClient } from '../../api/forgejoClient';
import { getForgejoConfigFor } from '../../utils/config';
import { PRDetailWebviewProvider } from '../../webview/prDetail/provider';

jest.mock('../../api/forgejoClient');
jest.mock('../../utils/config');
jest.mock('../../utils/logger', () => ({
  logDebug: jest.fn(),
  logInfo: jest.fn(),
  logError: jest.fn(),
}));

const MockForgejoClient = ForgejoClient as jest.MockedClass<typeof ForgejoClient>;
const mockGetForgejoConfigFor = getForgejoConfigFor as jest.MockedFunction<typeof getForgejoConfigFor>;

describe('PRDetailWebviewProvider metadata editing', () => {
  const pr = {
    number: 191,
    title: 'Some PR',
    state: 'open',
    body: 'PR body',
    html_url: 'https://git.example.com/owner/repo/pulls/191',
    user: { login: 'author' },
    head: { ref: 'feature', sha: 'abc123', repo: { full_name: 'owner/repo' } },
    base: { ref: 'main' },
    mergeable: true,
    merged: false,
    merge_commit_sha: null,
    draft: false,
    comments: 0,
    labels: [{ name: 'bug', color: 'ff0000' }],
    assignees: [{ login: 'alice' }],
    milestone: { id: 1, title: 'v1.0' }
  };

  function createProvider(): { provider: PRDetailWebviewProvider; postMessage: jest.Mock } {
    const postMessage = jest.fn();
    const provider = new PRDetailWebviewProvider({} as never);

    mockGetForgejoConfigFor.mockResolvedValue({
      instanceUrl: 'https://git.example.com',
      owner: 'owner',
      repo: 'repo',
      token: 'test-token'
    });

    (provider as any)._panels.set('panel', {
      panel: { webview: { postMessage } },
      owner: 'owner',
      repo: 'repo',
      number: 191,
      instanceUrl: 'https://git.example.com',
      isReady: true,
      pendingData: {
        pr,
        activities: [],
        statuses: [],
        owner: 'owner',
        repo: 'repo',
        instanceUrl: 'https://git.example.com'
      }
    });

    return { provider, postMessage };
  }

  function mockClientWithMetadataMethods(overrides: Record<string, unknown> = {}): Record<string, jest.Mock> {
    const methods = {
      listRepoLabels: jest.fn().mockResolvedValue([{ id: 1, name: 'bug', color: 'ff0000' }, { id: 2, name: 'feature', color: '00ff00' }]),
      listAssignableUsers: jest.fn().mockResolvedValue([{ id: 1, login: 'alice' }, { id: 2, login: 'bob' }]),
      listMilestones: jest.fn().mockResolvedValue([{ id: 1, title: 'v1.0' }, { id: 2, title: 'v2.0' }]),
      setIssueLabels: jest.fn().mockResolvedValue(undefined),
      updateIssueMetadata: jest.fn().mockResolvedValue({ ...pr }),
      getPullRequestDetails: jest.fn().mockResolvedValue(pr),
      getCommitStatuses: jest.fn().mockResolvedValue([]),
      ...overrides
    };
    MockForgejoClient.mockImplementation(() => methods as any);
    return methods as any;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('editLabels', () => {
    it('replaces labels on the PR using the shared issue-labels endpoint', async () => {
      const { provider, postMessage } = createProvider();
      const client = mockClientWithMetadataMethods();
      (vscode.window.showQuickPick as jest.Mock).mockResolvedValue([{ label: 'feature', labelId: 2 }]);

      await (provider as any)._handleMessage({ type: 'editLabels' }, 'panel');

      expect(client.listRepoLabels).toHaveBeenCalledWith('owner', 'repo');
      expect(client.setIssueLabels).toHaveBeenCalledWith('owner', 'repo', 191, [2]);
      expect(client.getPullRequestDetails).toHaveBeenCalled(); // refetch
      expect(postMessage).toHaveBeenCalledWith({ type: 'actionComplete', action: 'editLabels', success: true });
    });

    it('does nothing when the QuickPick is cancelled', async () => {
      const { provider } = createProvider();
      const client = mockClientWithMetadataMethods();
      (vscode.window.showQuickPick as jest.Mock).mockResolvedValue(undefined);

      await (provider as any)._handleMessage({ type: 'editLabels' }, 'panel');

      expect(client.setIssueLabels).not.toHaveBeenCalled();
    });

    it('reports an API error and leaves pending data untouched', async () => {
      const { provider, postMessage } = createProvider();
      const client = mockClientWithMetadataMethods({
        setIssueLabels: jest.fn().mockRejectedValue(new Error('HTTP 403: Forbidden'))
      });
      (vscode.window.showQuickPick as jest.Mock).mockResolvedValue([{ label: 'bug', labelId: 1 }]);
      const state = (provider as any)._panels.get('panel');
      const originalLabels = state.pendingData.pr.labels;

      await (provider as any)._handleMessage({ type: 'editLabels' }, 'panel');

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Failed to update labels: HTTP 403: Forbidden');
      expect(postMessage).toHaveBeenCalledWith({ type: 'actionComplete', action: 'editLabels', success: false });
      expect(state.pendingData.pr.labels).toBe(originalLabels);
      expect(client.getPullRequestDetails).not.toHaveBeenCalled();
    });
  });

  describe('editAssignees', () => {
    it('replaces assignees via updateIssueMetadata (shared with issues)', async () => {
      const { provider, postMessage } = createProvider();
      const client = mockClientWithMetadataMethods();
      (vscode.window.showQuickPick as jest.Mock).mockResolvedValue([{ label: 'bob', login: 'bob' }]);

      await (provider as any)._handleMessage({ type: 'editAssignees' }, 'panel');

      expect(client.listAssignableUsers).toHaveBeenCalledWith('owner', 'repo');
      expect(client.updateIssueMetadata).toHaveBeenCalledWith('owner', 'repo', 191, { assignees: ['bob'] });
      expect(postMessage).toHaveBeenCalledWith({ type: 'actionComplete', action: 'editAssignees', success: true });
    });

    it('handles a PR with no current assignees without throwing', async () => {
      const { provider } = createProvider();
      const state = (provider as any)._panels.get('panel');
      state.pendingData.pr = { ...pr, assignees: undefined };
      const client = mockClientWithMetadataMethods();
      (vscode.window.showQuickPick as jest.Mock).mockResolvedValue([{ label: 'alice', login: 'alice' }]);

      await (provider as any)._handleMessage({ type: 'editAssignees' }, 'panel');

      expect(client.updateIssueMetadata).toHaveBeenCalledWith('owner', 'repo', 191, { assignees: ['alice'] });
    });

    it('does nothing when the QuickPick is cancelled', async () => {
      const { provider } = createProvider();
      const client = mockClientWithMetadataMethods();
      (vscode.window.showQuickPick as jest.Mock).mockResolvedValue(undefined);

      await (provider as any)._handleMessage({ type: 'editAssignees' }, 'panel');

      expect(client.updateIssueMetadata).not.toHaveBeenCalled();
    });

    it('reports an unauthenticated/permission error from the API', async () => {
      const { provider, postMessage } = createProvider();
      mockClientWithMetadataMethods({
        updateIssueMetadata: jest.fn().mockRejectedValue(new Error('HTTP 401: Unauthorized'))
      });
      (vscode.window.showQuickPick as jest.Mock).mockResolvedValue([{ label: 'alice', login: 'alice' }]);

      await (provider as any)._handleMessage({ type: 'editAssignees' }, 'panel');

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Failed to update assignees: HTTP 401: Unauthorized');
      expect(postMessage).toHaveBeenCalledWith({ type: 'actionComplete', action: 'editAssignees', success: false });
    });
  });

  describe('editMilestone', () => {
    it('sends the selected milestone id via updateIssueMetadata', async () => {
      const { provider, postMessage } = createProvider();
      const client = mockClientWithMetadataMethods();
      (vscode.window.showQuickPick as jest.Mock).mockResolvedValue({ label: 'v2.0', milestoneId: 2 });

      await (provider as any)._handleMessage({ type: 'editMilestone' }, 'panel');

      expect(client.listMilestones).toHaveBeenCalledWith('owner', 'repo', 'open');
      expect(client.updateIssueMetadata).toHaveBeenCalledWith('owner', 'repo', 191, { milestone: 2 });
      expect(postMessage).toHaveBeenCalledWith({ type: 'actionComplete', action: 'editMilestone', success: true });
    });

    it('sends milestone: 0 when "No milestone" is selected (unset, not omit)', async () => {
      const { provider } = createProvider();
      const client = mockClientWithMetadataMethods();
      (vscode.window.showQuickPick as jest.Mock).mockResolvedValue({ label: 'No milestone', milestoneId: 0 });

      await (provider as any)._handleMessage({ type: 'editMilestone' }, 'panel');

      expect(client.updateIssueMetadata).toHaveBeenCalledWith('owner', 'repo', 191, { milestone: 0 });
    });

    it('does nothing when the QuickPick is cancelled', async () => {
      const { provider } = createProvider();
      const client = mockClientWithMetadataMethods();
      (vscode.window.showQuickPick as jest.Mock).mockResolvedValue(undefined);

      await (provider as any)._handleMessage({ type: 'editMilestone' }, 'panel');

      expect(client.updateIssueMetadata).not.toHaveBeenCalled();
    });
  });

  it('threads the panel instanceUrl into config resolution for every metadata action', async () => {
    const { provider } = createProvider();
    mockClientWithMetadataMethods();
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValue([]);

    await (provider as any)._handleMessage({ type: 'editLabels' }, 'panel');
    await (provider as any)._handleMessage({ type: 'editAssignees' }, 'panel');
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValue({ label: 'No milestone', milestoneId: 0 });
    await (provider as any)._handleMessage({ type: 'editMilestone' }, 'panel');

    expect(mockGetForgejoConfigFor.mock.calls.length).toBeGreaterThan(0);
    for (const call of mockGetForgejoConfigFor.mock.calls) {
      expect(call).toEqual(['owner', 'repo', 'https://git.example.com']);
    }
  });
});
