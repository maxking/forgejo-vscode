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
});
