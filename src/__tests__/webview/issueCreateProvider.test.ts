import * as vscode from 'vscode';
import { IssueCreateWebviewProvider } from '../../webview/issueCreate/provider';
import { ForgejoClient } from '../../api/forgejoClient';
import { getForgejoConfigFor } from '../../utils/config';

jest.mock('../../api/forgejoClient');
jest.mock('../../utils/config');
jest.mock('../../utils/logger', () => ({
  logInfo: jest.fn(),
  logDebug: jest.fn(),
  logError: jest.fn(),
}));

const mockGetForgejoConfigFor = getForgejoConfigFor as jest.MockedFunction<typeof getForgejoConfigFor>;
const MockForgejoClient = ForgejoClient as jest.MockedClass<typeof ForgejoClient>;

const mockConfig = {
  instanceUrl: 'https://git.example.com',
  owner: 'test-owner',
  repo: 'test-repo',
  token: 'test-token',
};

const mockIssue = {
  number: 42,
  title: 'Created issue',
  html_url: 'https://git.example.com/test-owner/test-repo/issues/42',
};

describe('IssueCreateWebviewProvider', () => {
  let provider: IssueCreateWebviewProvider;
  let postMessage: jest.Mock;
  let refresh: jest.Mock;
  let createIssue: jest.Mock;
  let panel: { webview: { postMessage: jest.Mock } };

  beforeEach(() => {
    jest.clearAllMocks();
    postMessage = jest.fn();
    refresh = jest.fn();
    createIssue = jest.fn().mockResolvedValue(mockIssue);
    MockForgejoClient.mockImplementation(() => ({ createIssue } as any));
    mockGetForgejoConfigFor.mockResolvedValue(mockConfig);
    provider = new IssueCreateWebviewProvider(vscode.Uri.file('/extension'), { refresh } as any);
    panel = {
      webview: { postMessage }
    };
    (provider as any)._panels.set('https://git.example.com/test-owner/test-repo', {
      config: mockConfig,
      isReady: true,
      panel
    });
  });

  it('creates an issue with the rich form payload, refreshes the tree, and offers browser opening', async () => {
    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValueOnce('Open in Browser');

    await (provider as any)._createIssue({
      title: '  New issue  ',
      body: '  Details  ',
      labels: [1, 2],
      assignees: ['alice', 'bob'],
      milestone: 7,
      dueDate: '2026-07-10'
    });

    expect(mockGetForgejoConfigFor).toHaveBeenCalledWith('test-owner', 'test-repo', 'https://git.example.com');
    expect(createIssue).toHaveBeenCalledWith('test-owner', 'test-repo', 'New issue', 'Details', {
      labels: [1, 2],
      assignees: ['alice', 'bob'],
      milestone: 7,
      due_date: '2026-07-10T00:00:00Z'
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'created',
      number: 42,
      title: 'Created issue',
      url: mockIssue.html_url
    });
    expect(vscode.env.openExternal).toHaveBeenCalledWith(vscode.Uri.parse(mockIssue.html_url));
  });

  it('omits empty optional fields from the create issue request', async () => {
    await (provider as any)._createIssue({
      title: 'Title only',
      body: '',
      labels: [],
      assignees: []
    });

    expect(createIssue).toHaveBeenCalledWith('test-owner', 'test-repo', 'Title only', undefined, {});
  });

  it('rejects submission without a title before calling the API', async () => {
    await (provider as any)._createIssue({ title: '   ' });

    expect(createIssue).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith({ type: 'error', message: 'Title is required.' });
  });

  it('surfaces missing token validation errors on submit', async () => {
    mockGetForgejoConfigFor.mockResolvedValueOnce({ ...mockConfig, token: undefined } as any);

    await (provider as any)._createIssue({ title: 'Needs token' });

    expect(createIssue).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Failed to create issue: A Forgejo token is required to create issues. Please configure your token first.'
    );
  });

  it('opens a separate panel when the create issue config changes to another repository', () => {
    const panels: Array<{
      webview: {
        html: string;
        asWebviewUri: jest.Mock;
        onDidReceiveMessage: jest.Mock;
        postMessage: jest.Mock;
      };
      reveal: jest.Mock;
      onDidDispose: jest.Mock;
    }> = [];

    (vscode.window as any).createWebviewPanel = jest.fn(() => {
      const nextPanel = {
        webview: {
          html: '',
          asWebviewUri: jest.fn((uri: vscode.Uri) => uri),
          onDidReceiveMessage: jest.fn(),
          postMessage: jest.fn()
        },
        reveal: jest.fn(),
        onDidDispose: jest.fn()
      };
      panels.push(nextPanel);
      return nextPanel;
    });

    provider = new IssueCreateWebviewProvider(vscode.Uri.file('/extension'), { refresh } as any);
    provider.showCreateIssue(mockConfig);
    provider.showCreateIssue({
      ...mockConfig,
      instanceUrl: 'https://git.other.example.com',
      owner: 'other-owner',
      repo: 'other-repo'
    });

    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(2);
    expect(panels[0].webview.html).toContain('test-owner/test-repo');
    expect(panels[0].webview.html).not.toContain('other-owner/other-repo');
    expect(panels[1].webview.html).toContain('other-owner/other-repo');
    expect(panels[1].webview.html).not.toContain('test-owner/test-repo');
    expect((provider as any)._panels.size).toBe(2);
  });
});
