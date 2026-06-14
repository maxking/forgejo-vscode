import * as vscode from 'vscode';
import { execSync, spawnSync } from 'child_process';
import { branchNameToTitle, createPullRequestCommand } from '../../commands/createPullRequest';
import { ForgejoClient } from '../../api/forgejoClient';
import { getForgejoConfig } from '../../utils/config';

// Mock dependencies
jest.mock('child_process', () => ({
  execSync: jest.fn(),
  spawnSync: jest.fn(),
}));
jest.mock('../../api/forgejoClient');
jest.mock('../../utils/config');
jest.mock('../../utils/logger', () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
}));

const mockGetForgejoConfig = getForgejoConfig as jest.MockedFunction<typeof getForgejoConfig>;
const MockForgejoClient = ForgejoClient as jest.MockedClass<typeof ForgejoClient>;
const mockedExecSync = execSync as jest.MockedFunction<typeof execSync>;
const mockedSpawnSync = spawnSync as jest.MockedFunction<typeof spawnSync>;

const mockConfig = {
  instanceUrl: 'https://git.example.com',
  owner: 'test-owner',
  repo: 'test-repo',
  token: 'test-token',
};

const mockPR = {
  number: 42,
  title: 'My Feature',
  html_url: 'https://git.example.com/test-owner/test-repo/pulls/42',
};

// ── branchNameToTitle ─────────────────────────────────────────────────────────

describe('branchNameToTitle', () => {
  it('replaces hyphens with spaces and capitalizes first letter', () => {
    expect(branchNameToTitle('fix-my-bug')).toBe('Fix my bug');
  });

  it('replaces underscores with spaces and capitalizes first letter', () => {
    expect(branchNameToTitle('add_feature')).toBe('Add feature');
  });

  it('replaces mixed hyphens and underscores with spaces and capitalizes first letter', () => {
    expect(branchNameToTitle('feat_add-login')).toBe('Feat add login');
  });

  it('capitalizes a single-word branch name', () => {
    expect(branchNameToTitle('feature')).toBe('Feature');
  });

  it('preserves numeric characters and capitalizes first letter', () => {
    expect(branchNameToTitle('fix-issue-123')).toBe('Fix issue 123');
  });

  it('handles branch names with slashes (slash preserved, hyphens after replaced)', () => {
    expect(branchNameToTitle('feature/my-branch')).toBe('Feature/my branch');
  });
});

// ── createPullRequestCommand ──────────────────────────────────────────────────

describe('createPullRequestCommand', () => {
  let mockPRTreeProvider: { refresh: jest.Mock };
  let mockCreatePullRequest: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPRTreeProvider = { refresh: jest.fn() };
    mockCreatePullRequest = jest.fn().mockResolvedValue(mockPR);
    MockForgejoClient.mockImplementation(() => ({
      createPullRequest: mockCreatePullRequest,
    } as any));

    // Default workspace
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: '/workspace' } }];

    // Restore getConfiguration mock (resetMocks: true in jest.config clears it)
    (vscode.workspace.getConfiguration as jest.Mock).mockImplementation(() => ({
      get: jest.fn((key: string, defaultVal?: unknown) => {
        if (key === 'preferredRemote') return defaultVal ?? '';
        return defaultVal;
      }),
      update: jest.fn(),
      has: jest.fn(),
      inspect: jest.fn(),
    }));

    // Default: execSync returns current branch, spawnSync returns default branch
    mockedExecSync.mockReturnValueOnce('feat/issue-88\n' as any);  // current branch
    mockedSpawnSync.mockReturnValueOnce({ status: 0, stdout: 'refs/remotes/origin/master\n', stderr: '', pid: 0, output: [], signal: null } as any);  // default branch
  });

  // ── Config / token / workspace guards ────────────────────────────────────

  it('shows error and returns early when config is null', async () => {
    mockGetForgejoConfig.mockResolvedValue(null);

    await createPullRequestCommand(mockPRTreeProvider as any);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Forgejo configuration not found. Please configure an instance first.'
    );
    expect(mockCreatePullRequest).not.toHaveBeenCalled();
    expect(mockPRTreeProvider.refresh).not.toHaveBeenCalled();
  });

  it('shows error and returns early when token is missing', async () => {
    mockGetForgejoConfig.mockResolvedValue({ ...mockConfig, token: undefined } as any);

    await createPullRequestCommand(mockPRTreeProvider as any);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'A Forgejo token is required to create pull requests. Please configure your token first.'
    );
    expect(mockCreatePullRequest).not.toHaveBeenCalled();
    expect(mockPRTreeProvider.refresh).not.toHaveBeenCalled();
  });

  it('uses repository config root path when creating a PR from a repository group', async () => {
    const repositoryConfig = { ...mockConfig, rootPath: '/workspace/.worktrees/repo-a' };
    mockGetForgejoConfig.mockResolvedValue(null);
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('My PR')
      .mockResolvedValueOnce('Body')
      .mockResolvedValueOnce('master');

    await createPullRequestCommand(mockPRTreeProvider as any, repositoryConfig);

    expect(mockedExecSync).toHaveBeenCalledWith('git rev-parse --abbrev-ref HEAD', expect.objectContaining({
      cwd: '/workspace/.worktrees/repo-a'
    }));
    expect(mockedSpawnSync).toHaveBeenCalledWith('git', expect.any(Array), expect.objectContaining({
      cwd: '/workspace/.worktrees/repo-a'
    }));
    expect(mockCreatePullRequest).toHaveBeenCalledWith(
      mockConfig.owner,
      mockConfig.repo,
      'My PR',
      'feat/issue-88',
      'master',
      'Body'
    );
  });

  it('shows error and returns early when no workspace folder is open', async () => {
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    (vscode.workspace as any).workspaceFolders = undefined;

    await createPullRequestCommand(mockPRTreeProvider as any);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'No workspace folder open.'
    );
    expect(mockCreatePullRequest).not.toHaveBeenCalled();
  });

  // ── git execSync failure paths ────────────────────────────────────────────

  it('shows error and returns early when current branch detection throws', async () => {
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    mockedExecSync.mockReset();
    mockedExecSync.mockImplementationOnce(() => { throw new Error('not a git repo'); });

    await createPullRequestCommand(mockPRTreeProvider as any);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Could not determine the current git branch.'
    );
    expect(mockCreatePullRequest).not.toHaveBeenCalled();
    expect(mockPRTreeProvider.refresh).not.toHaveBeenCalled();
  });

  it('falls back to "main" when default branch detection fails, then continues', async () => {
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    mockedExecSync.mockReset();
    mockedSpawnSync.mockReset();
    mockedExecSync.mockReturnValueOnce('feat/my-feature\n' as any);  // current branch succeeds
    mockedSpawnSync.mockReturnValueOnce({ status: 1, stdout: '', stderr: 'error', pid: 0, output: [], signal: null } as any);  // default branch fails

    // User cancels at title so the test stays contained
    (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce(undefined);

    await createPullRequestCommand(mockPRTreeProvider as any);

    // Should NOT have shown an error for the branch detection
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    // Should have proceeded to show title input
    expect(vscode.window.showInputBox).toHaveBeenCalledWith(
      expect.objectContaining({ value: 'Feat/my feature', prompt: 'Enter pull request title' })
    );
    // baseBranch prompt should have defaulted to 'main'
    // (not reached because title was cancelled)
    expect(mockCreatePullRequest).not.toHaveBeenCalled();
  });

  // ── User cancellation paths ───────────────────────────────────────────────

  it('returns early when user cancels title input', async () => {
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce(undefined);

    await createPullRequestCommand(mockPRTreeProvider as any);

    expect(mockCreatePullRequest).not.toHaveBeenCalled();
    expect(mockPRTreeProvider.refresh).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('returns early when user cancels body input (Escape → undefined)', async () => {
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('My PR Title')  // title
      .mockResolvedValueOnce(undefined);      // body cancelled

    await createPullRequestCommand(mockPRTreeProvider as any);

    expect(mockCreatePullRequest).not.toHaveBeenCalled();
    expect(mockPRTreeProvider.refresh).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('does NOT return early when body is empty string (empty body is allowed)', async () => {
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('My PR Title')  // title
      .mockResolvedValueOnce('')             // body is empty string (not cancelled)
      .mockResolvedValueOnce('main');        // base branch
    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValueOnce(undefined);

    await createPullRequestCommand(mockPRTreeProvider as any);

    // API called with body: undefined (empty string coerced)
    expect(mockCreatePullRequest).toHaveBeenCalledWith(
      'test-owner', 'test-repo', 'My PR Title', expect.any(String), 'main', undefined
    );
    expect(mockPRTreeProvider.refresh).toHaveBeenCalled();
  });

  it('returns early when user cancels base-branch input', async () => {
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('My PR Title')  // title
      .mockResolvedValueOnce('Some body')    // body
      .mockResolvedValueOnce(undefined);     // base branch cancelled

    await createPullRequestCommand(mockPRTreeProvider as any);

    expect(mockCreatePullRequest).not.toHaveBeenCalled();
    expect(mockPRTreeProvider.refresh).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  // ── preferredRemote and branch extraction ─────────────────────────────────

  it('uses preferredRemote setting for default branch detection', async () => {
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    mockedExecSync.mockReset();
    mockedSpawnSync.mockReset();
    mockedExecSync.mockReturnValueOnce('feat/my-feature\n' as any);

    // Mock config to return a custom preferredRemote
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn((key: string, defaultVal?: unknown) => {
        if (key === 'preferredRemote') return 'upstream';
        return defaultVal;
      }),
    });

    mockedSpawnSync.mockReturnValueOnce({
      status: 0, stdout: 'refs/remotes/upstream/develop\n', stderr: '', pid: 0, output: [], signal: null
    } as any);

    // User cancels at title to keep test contained
    (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce(undefined);

    await createPullRequestCommand(mockPRTreeProvider as any);

    // Verify spawnSync was called with the preferred remote name
    expect(mockedSpawnSync).toHaveBeenCalledWith(
      'git',
      ['symbolic-ref', 'refs/remotes/upstream/HEAD'],
      expect.objectContaining({ encoding: 'utf-8' })
    );
  });

  it('correctly extracts branch name from non-origin remote ref', async () => {
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    mockedExecSync.mockReset();
    mockedSpawnSync.mockReset();
    mockedExecSync.mockReturnValueOnce('feat/my-feature\n' as any);

    mockedSpawnSync.mockReturnValueOnce({
      status: 0, stdout: 'refs/remotes/upstream/develop\n', stderr: '', pid: 0, output: [], signal: null
    } as any);

    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('My Title')  // title
      .mockResolvedValueOnce('')          // body
      .mockResolvedValueOnce(undefined);  // cancel at base branch to inspect default

    await createPullRequestCommand(mockPRTreeProvider as any);

    // Base branch prompt should have defaulted to 'develop' (extracted from upstream ref)
    const calls = (vscode.window.showInputBox as jest.Mock).mock.calls;
    const baseBranchCall = calls.find((c: any[]) => c[0]?.prompt === 'Enter the base branch to merge into');
    expect(baseBranchCall).toBeDefined();
    expect(baseBranchCall![0].value).toBe('develop');
  });

  it('uses spawnSync (not execSync) for default branch detection to prevent injection', async () => {
    // Import spawnSync from the mocked module to verify it's the same reference
    const cp = require('child_process');

    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    mockedExecSync.mockReset();
    cp.spawnSync.mockReset();
    mockedExecSync.mockReturnValueOnce('feat/test\n' as any);  // current branch only

    cp.spawnSync.mockReturnValueOnce({
      status: 0, stdout: 'refs/remotes/origin/main\n', stderr: '', pid: 0, output: [], signal: null
    });

    // Set up all showInputBox responses to let the function proceed to spawnSync
    (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce(undefined);

    await createPullRequestCommand(mockPRTreeProvider as any);

    // spawnSync should have been called for default branch detection
    expect(cp.spawnSync).toHaveBeenCalledTimes(1);
    expect(cp.spawnSync).toHaveBeenCalledWith(
      'git',
      ['symbolic-ref', expect.stringContaining('refs/remotes/')],
      expect.objectContaining({ encoding: 'utf-8' })
    );
    // execSync should only be called once (for current branch), NOT for default branch
    expect(mockedExecSync).toHaveBeenCalledTimes(1);
  });

  // ── API success paths ─────────────────────────────────────────────────────

  it('creates PR, refreshes tree, and offers "Open in Browser" on success', async () => {
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('My PR Title')
      .mockResolvedValueOnce('PR description')
      .mockResolvedValueOnce('main');
    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValueOnce('Open in Browser');

    await createPullRequestCommand(mockPRTreeProvider as any);

    expect(mockCreatePullRequest).toHaveBeenCalledWith(
      'test-owner', 'test-repo', 'My PR Title', expect.any(String), 'main', 'PR description'
    );
    expect(mockPRTreeProvider.refresh).toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'PR #42 created successfully!',
      'Open in Browser'
    );
    expect(vscode.env.openExternal).toHaveBeenCalledWith(
      vscode.Uri.parse(mockPR.html_url)
    );
  });

  it('refreshes tree but does not open browser when notification is dismissed', async () => {
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('My PR Title')
      .mockResolvedValueOnce('PR description')
      .mockResolvedValueOnce('main');
    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValueOnce(undefined);

    await createPullRequestCommand(mockPRTreeProvider as any);

    expect(mockPRTreeProvider.refresh).toHaveBeenCalled();
    expect(vscode.env.openExternal).not.toHaveBeenCalled();
  });

  // ── API error path ────────────────────────────────────────────────────────

  it('shows error message when createPullRequest API call fails', async () => {
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('My PR Title')
      .mockResolvedValueOnce('description')
      .mockResolvedValueOnce('main');
    mockCreatePullRequest.mockRejectedValueOnce(new Error('API error'));

    await createPullRequestCommand(mockPRTreeProvider as any);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Failed to create pull request: API error'
    );
    expect(mockPRTreeProvider.refresh).not.toHaveBeenCalled();
  });
});
