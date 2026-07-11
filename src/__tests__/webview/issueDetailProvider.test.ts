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

  function createProvider(token: string): { provider: IssueDetailWebviewProvider; postMessage: jest.Mock } {
    const postMessage = jest.fn();
    const provider = new IssueDetailWebviewProvider({} as never);

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
});
