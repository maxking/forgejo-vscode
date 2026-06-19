import * as vscode from 'vscode';
import { createIssueCommand } from '../../commands/createIssue';
import { getForgejoConfig } from '../../utils/config';

jest.mock('../../utils/config');

const mockGetForgejoConfig = getForgejoConfig as jest.MockedFunction<typeof getForgejoConfig>;

const mockConfig = {
  instanceUrl: 'https://git.example.com',
  owner: 'test-owner',
  repo: 'test-repo',
  token: 'test-token',
};

describe('createIssueCommand', () => {
  let mockIssueCreateProvider: { showCreateIssue: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    mockIssueCreateProvider = { showCreateIssue: jest.fn() };
  });

  it('shows error and returns early when config is null', async () => {
    mockGetForgejoConfig.mockResolvedValue(null);

    await createIssueCommand(mockIssueCreateProvider as any);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Forgejo configuration not found. Please configure an instance first.'
    );
    expect(mockIssueCreateProvider.showCreateIssue).not.toHaveBeenCalled();
  });

  it('shows error and returns early when token is missing', async () => {
    mockGetForgejoConfig.mockResolvedValue({ ...mockConfig, token: undefined } as any);

    await createIssueCommand(mockIssueCreateProvider as any);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'A Forgejo token is required to create issues. Please configure your token first.'
    );
    expect(mockIssueCreateProvider.showCreateIssue).not.toHaveBeenCalled();
  });

  it('opens the create issue webview when config and token are present', async () => {
    mockGetForgejoConfig.mockResolvedValue(mockConfig);

    await createIssueCommand(mockIssueCreateProvider as any);

    expect(mockIssueCreateProvider.showCreateIssue).toHaveBeenCalledWith(mockConfig);
    expect(vscode.window.showInputBox).not.toHaveBeenCalled();
  });
});
