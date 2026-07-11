import * as vscode from 'vscode';
import { ForgejoClient } from '../../api/forgejoClient';
import { getForgejoConfigFor } from '../../utils/config';
import { PRDetailWebviewProvider } from '../../webview/prDetail/provider';

jest.mock('../../api/forgejoClient');
jest.mock('../../utils/config');
jest.mock('../../utils/logger', () => ({
  logInfo: jest.fn(),
  logDebug: jest.fn(),
  logError: jest.fn(),
}));

const MockForgejoClient = ForgejoClient as jest.MockedClass<typeof ForgejoClient>;
const mockGetForgejoConfigFor = getForgejoConfigFor as jest.MockedFunction<typeof getForgejoConfigFor>;

describe('PRDetailWebviewProvider activity sort order', () => {
  const pr = {
    number: 191,
    title: 'Add sort toggle',
    state: 'open',
    body: 'PR body',
    html_url: 'https://git.example.com/owner/repo/pulls/191',
    user: { login: 'author' },
    base: { ref: 'main' },
    head: { ref: 'feature', sha: '' }
  };

  function createProvider(
    configuredSortOrder?: 'newest-first' | 'oldest-first'
  ): { provider: PRDetailWebviewProvider; postMessage: jest.Mock } {
    const postMessage = jest.fn();
    const provider = new PRDetailWebviewProvider({} as never);

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
      token: 'test-token'
    });

    MockForgejoClient.mockImplementation(() => ({
      getPullRequestDetails: jest.fn().mockResolvedValue(pr),
      getIssueComments: jest.fn().mockResolvedValue([]),
      getPullRequestReviews: jest.fn().mockResolvedValue([]),
      getPullRequestCommits: jest.fn().mockResolvedValue([]),
      getIssueTimeline: jest.fn().mockResolvedValue([]),
      getCommitStatuses: jest.fn().mockResolvedValue([])
    } as any));

    (provider as any)._panels.set('panel', {
      panel: { webview: { postMessage } },
      owner: 'owner',
      repo: 'repo',
      number: 191,
      instanceUrl: 'https://git.example.com',
      isReady: true,
      pendingData: null
    });

    return { provider, postMessage };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('defaults activitySortOrder to newest-first when no preference is configured', async () => {
    const { provider, postMessage } = createProvider();

    await (provider as any)._fetchPRData('panel');

    const updateMessage = postMessage.mock.calls.find(([message]) => message.type === 'update')?.[0];
    expect(updateMessage).toMatchObject({ data: { activitySortOrder: 'newest-first' } });
  });

  it('reads activitySortOrder from the configured preference', async () => {
    const { provider, postMessage } = createProvider('oldest-first');

    await (provider as any)._fetchPRData('panel');

    const updateMessage = postMessage.mock.calls.find(([message]) => message.type === 'update')?.[0];
    expect(updateMessage).toMatchObject({ data: { activitySortOrder: 'oldest-first' } });
  });

  it('does not change the underlying activity fetch order based on the sort preference', async () => {
    const activities = [
      { id: 1, type: 'comment', created_at: '2025-01-03T00:00:00Z' },
      { id: 2, type: 'comment', created_at: '2025-01-01T00:00:00Z' },
      { id: 3, type: 'comment', created_at: '2025-01-02T00:00:00Z' }
    ];

    const { provider, postMessage } = createProvider('oldest-first');
    MockForgejoClient.mockImplementation(() => ({
      getPullRequestDetails: jest.fn().mockResolvedValue(pr),
      getIssueComments: jest.fn().mockResolvedValue(activities),
      getPullRequestReviews: jest.fn().mockResolvedValue([]),
      getPullRequestCommits: jest.fn().mockResolvedValue([]),
      getIssueTimeline: jest.fn().mockResolvedValue([]),
      getCommitStatuses: jest.fn().mockResolvedValue([])
    } as any));
    await (provider as any)._fetchPRData('panel');

    const updateMessage = postMessage.mock.calls.find(([message]) => message.type === 'update')?.[0];
    expect(updateMessage.data.activities.map((a: { id: number }) => a.id)).toEqual([1, 3, 2]);
  });

  it('persists the sort order choice as a global setting', async () => {
    const { provider } = createProvider();
    const state = (provider as any)._panels.get('panel');
    state.pendingData = {
      pr,
      activities: [],
      activitySortOrder: 'newest-first',
      statuses: [],
      owner: 'owner',
      repo: 'repo',
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
});
