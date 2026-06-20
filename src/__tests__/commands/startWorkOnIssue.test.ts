import * as vscode from 'vscode';
import {
  issueBranchNameOptions,
  issueTitleToBranchSlug,
  startWorkOnIssueCommand,
  validateBranchName
} from '../../commands/startWorkOnIssue';
import { IssueTreeItem } from '../../providers/issueTreeProvider';
import { activateGitExtension } from '../../utils/gitExtension';
import { logInfo } from '../../utils/logger';

jest.mock('../../utils/gitExtension');
jest.mock('../../utils/logger', () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
}));

const mockActivateGitExtension = activateGitExtension as jest.MockedFunction<typeof activateGitExtension>;

const issue = {
  number: 188,
  title: 'Add start-work-on-issue command',
  state: 'open',
  comments: 0,
  html_url: 'https://git.example.com/owner/repo/issues/188',
  user: { login: 'alice' },
};

function createRepository(rootPath: string, remoteUrl: string, overrides: Record<string, unknown> = {}) {
  return {
    rootUri: vscode.Uri.file(rootPath),
    state: {
      HEAD: { name: 'main' },
      remotes: [{ name: 'origin', fetchUrl: remoteUrl }],
      indexChanges: [],
      workingTreeChanges: [],
      mergeChanges: [],
      ...(overrides.state as object | undefined),
    },
    createBranch: jest.fn().mockResolvedValue(undefined),
    checkout: jest.fn().mockResolvedValue(undefined),
    getBranch: jest.fn().mockRejectedValue(new Error('not found')),
    ...overrides,
  };
}

function mockGitApi(repositories: any[], activeRepository: any = null) {
  mockActivateGitExtension.mockResolvedValue({
    enabled: true,
    getAPI: () => ({
      repositories,
      getRepository: jest.fn(() => activeRepository),
      onDidOpenRepository: jest.fn(),
      onDidCloseRepository: jest.fn(),
      init: jest.fn(),
      registerRemoteSourceProvider: jest.fn(),
      registerRemoteSourcePublisher: jest.fn(),
    }),
  } as any);
}

function createIssueTreeItem(rootPath = '/workspace/repo') {
  return new IssueTreeItem(
    issue as any,
    issue.html_url,
    'owner',
    'repo',
    'https://git.example.com',
    'open',
    {
      instanceUrl: 'https://git.example.com',
      owner: 'owner',
      repo: 'repo',
      token: 'token',
      rootPath,
    } as any
  );
}

describe('issueTitleToBranchSlug', () => {
  it('normalizes issue titles for branch names', () => {
    expect(issueTitleToBranchSlug('Add start-work-on-issue command!')).toBe('add-start-work-on-issue-command');
    expect(issueTitleToBranchSlug('!!!')).toBe('issue');
  });
});

describe('issueBranchNameOptions', () => {
  it('returns issue, feature, and fix branch defaults', () => {
    expect(issueBranchNameOptions(issue as any)).toEqual([
      'issue/188-add-start-work-on-issue-command',
      'feat/188-add-start-work-on-issue-command',
      'fix/188-add-start-work-on-issue-command',
    ]);
  });
});

describe('validateBranchName', () => {
  it('rejects invalid git branch names before invoking the Git API', () => {
    expect(validateBranchName('')).toBe('Branch name is required');
    expect(validateBranchName('bad branch')).toBe('Branch name contains unsupported characters');
    expect(validateBranchName('bad..branch')).toBe('Branch name cannot contain ".."');
    expect(validateBranchName('/bad')).toBe('Branch name cannot start, end, or repeat "/"');
    expect(validateBranchName('bad.lock')).toBe('Branch name cannot end with "." or ".lock"');
    expect(validateBranchName('feat/188-good')).toBeNull();
  });
});

describe('startWorkOnIssueCommand', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.window as any).activeTextEditor = undefined;
    (vscode.workspace.getConfiguration as jest.Mock).mockImplementation(() => ({
      get: jest.fn((_key: string, defaultValue?: unknown) => defaultValue),
      update: jest.fn(),
      has: jest.fn(),
      inspect: jest.fn(),
    }));
  });

  it('creates and checks out a new branch in the issue tree repository', async () => {
    const repository = createRepository('/workspace/repo', 'https://git.example.com/owner/repo.git');
    mockGitApi([repository]);
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce({
      branchName: 'feat/188-add-start-work-on-issue-command',
    });

    await startWorkOnIssueCommand(createIssueTreeItem());

    expect(repository.getBranch).toHaveBeenCalledWith('feat/188-add-start-work-on-issue-command');
    expect(repository.createBranch).toHaveBeenCalledWith('feat/188-add-start-work-on-issue-command', true, 'origin/master');
    expect(repository.checkout).not.toHaveBeenCalled();
    expect(logInfo).toHaveBeenCalledWith(
      'Created and checked out branch feat/188-add-start-work-on-issue-command from origin/master in existing local worktree /workspace/repo for issue #188.'
    );
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'Created and checked out branch feat/188-add-start-work-on-issue-command from origin/master in existing local worktree /workspace/repo for issue #188.'
    );
  });

  it('lets the user choose among multiple matching repositories', async () => {
    const first = createRepository('/workspace/one', 'https://git.example.com/owner/repo.git');
    const second = createRepository('/workspace/two', 'ssh://git@git.example.com/owner/repo.git');
    mockGitApi([first, second]);
    (vscode.window.showQuickPick as jest.Mock)
      .mockResolvedValueOnce({ repository: second })
      .mockResolvedValueOnce({ branchName: 'issue/188-add-start-work-on-issue-command' });

    await startWorkOnIssueCommand(issue as any, 'owner', 'repo', 'https://git.example.com');

    expect(first.createBranch).not.toHaveBeenCalled();
    expect(second.createBranch).toHaveBeenCalledWith('issue/188-add-start-work-on-issue-command', true, 'origin/master');
  });

  it('shows the repository picker when multiple matches include the issue tree repository', async () => {
    const issueTreeRepository = createRepository('/workspace/repo', 'https://git.example.com/owner/repo.git');
    const otherRepository = createRepository('/workspace/other-worktree', 'https://git.example.com/owner/repo.git');
    mockGitApi([issueTreeRepository, otherRepository]);
    (vscode.window.showQuickPick as jest.Mock)
      .mockResolvedValueOnce({ repository: otherRepository })
      .mockResolvedValueOnce({ branchName: 'issue/188-add-start-work-on-issue-command' });

    await startWorkOnIssueCommand(createIssueTreeItem('/workspace/repo'));

    expect(vscode.window.showQuickPick).toHaveBeenNthCalledWith(1, [
      expect.objectContaining({
        detail: '/workspace/repo',
        description: 'main - issue row',
        repository: issueTreeRepository,
      }),
      expect.objectContaining({
        detail: '/workspace/other-worktree',
        description: 'main',
        repository: otherRepository,
      }),
    ], expect.objectContaining({
      placeHolder: 'Select the local repository for this issue',
    }));
    expect(issueTreeRepository.createBranch).not.toHaveBeenCalled();
    expect(otherRepository.createBranch).toHaveBeenCalledWith('issue/188-add-start-work-on-issue-command', true, 'origin/master');
  });

  it('shows the repository picker when multiple matches include the active editor repository', async () => {
    const active = createRepository('/workspace/active', 'https://git.example.com/owner/repo.git');
    const selected = createRepository('/workspace/selected', 'https://git.example.com/owner/repo.git');
    (vscode.window as any).activeTextEditor = {
      document: { uri: vscode.Uri.file('/workspace/active/file.ts') },
    };
    mockGitApi([active, selected], active);
    (vscode.window.showQuickPick as jest.Mock)
      .mockResolvedValueOnce({ repository: selected })
      .mockResolvedValueOnce({ branchName: 'issue/188-add-start-work-on-issue-command' });

    await startWorkOnIssueCommand(issue as any, 'owner', 'repo', 'https://git.example.com');

    expect(vscode.window.showQuickPick).toHaveBeenNthCalledWith(1, [
      expect.objectContaining({
        detail: '/workspace/active',
        description: 'main - active editor',
        repository: active,
      }),
      expect.objectContaining({
        detail: '/workspace/selected',
        description: 'main',
        repository: selected,
      }),
    ], expect.objectContaining({
      placeHolder: 'Select the local repository for this issue',
    }));
    expect(active.createBranch).not.toHaveBeenCalled();
    expect(selected.createBranch).toHaveBeenCalledWith('issue/188-add-start-work-on-issue-command', true, 'origin/master');
  });

  it('matches an SSH remote by hostname when the instance URL has an HTTP port', async () => {
    const repository = createRepository('/workspace/repo', 'ssh://git@git.example.com/owner/repo.git');
    mockGitApi([repository]);
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce({
      branchName: 'issue/188-add-start-work-on-issue-command',
    });

    await startWorkOnIssueCommand(issue as any, 'owner', 'repo', 'https://git.example.com:3000');

    expect(repository.createBranch).toHaveBeenCalledWith('issue/188-add-start-work-on-issue-command', true, 'origin/master');
  });

  it('uses the configured parent ref when creating a branch', async () => {
    const repository = createRepository('/workspace/repo', 'https://git.example.com/owner/repo.git');
    mockGitApi([repository]);
    (vscode.workspace.getConfiguration as jest.Mock).mockImplementation(() => ({
      get: jest.fn((key: string, defaultValue?: unknown) => key === 'startWorkOnIssueBaseRef' ? 'origin/main' : defaultValue),
      update: jest.fn(),
      has: jest.fn(),
      inspect: jest.fn(),
    }));
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce({
      branchName: 'issue/188-add-start-work-on-issue-command',
    });

    await startWorkOnIssueCommand(createIssueTreeItem());

    expect(repository.createBranch).toHaveBeenCalledWith('issue/188-add-start-work-on-issue-command', true, 'origin/main');
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'Created and checked out branch issue/188-add-start-work-on-issue-command from origin/main in existing local worktree /workspace/repo for issue #188.'
    );
  });

  it('returns early when repository selection is cancelled', async () => {
    const first = createRepository('/workspace/one', 'https://git.example.com/owner/repo.git');
    const second = createRepository('/workspace/two', 'https://git.example.com/owner/repo.git');
    mockGitApi([first, second]);
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce(undefined);

    await startWorkOnIssueCommand(issue as any, 'owner', 'repo', 'https://git.example.com');

    expect(first.createBranch).not.toHaveBeenCalled();
    expect(second.createBranch).not.toHaveBeenCalled();
  });

  it('returns early when dirty repository confirmation is cancelled', async () => {
    const repository = createRepository('/workspace/repo', 'https://git.example.com/owner/repo.git', {
      state: { workingTreeChanges: [{ uri: vscode.Uri.file('/workspace/repo/file.ts') }] },
    });
    mockGitApi([repository]);
    (vscode.window.showWarningMessage as jest.Mock).mockResolvedValueOnce('Cancel');

    await startWorkOnIssueCommand(createIssueTreeItem());

    expect(repository.createBranch).not.toHaveBeenCalled();
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
  });

  it('checks out an existing branch after confirmation', async () => {
    const repository = createRepository('/workspace/repo', 'https://git.example.com/owner/repo.git');
    repository.getBranch.mockResolvedValueOnce({ name: 'issue/188-add-start-work-on-issue-command' });
    mockGitApi([repository]);
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce({
      branchName: 'issue/188-add-start-work-on-issue-command',
    });
    (vscode.window.showWarningMessage as jest.Mock).mockResolvedValueOnce('Checkout Existing Branch');

    await startWorkOnIssueCommand(createIssueTreeItem());

    expect(repository.createBranch).not.toHaveBeenCalled();
    expect(repository.checkout).toHaveBeenCalledWith('issue/188-add-start-work-on-issue-command');
    expect(logInfo).toHaveBeenCalledWith(
      'Checked out existing branch issue/188-add-start-work-on-issue-command in existing local worktree /workspace/repo for issue #188.'
    );
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'Checked out existing branch issue/188-add-start-work-on-issue-command in existing local worktree /workspace/repo for issue #188.'
    );
  });

  it('returns early when branch selection is cancelled', async () => {
    const repository = createRepository('/workspace/repo', 'https://git.example.com/owner/repo.git');
    mockGitApi([repository]);
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce(undefined);

    await startWorkOnIssueCommand(createIssueTreeItem());

    expect(repository.createBranch).not.toHaveBeenCalled();
    expect(repository.checkout).not.toHaveBeenCalled();
  });

  it('shows an error when no local Git repository matches the issue', async () => {
    const repository = createRepository('/workspace/other', 'https://git.example.com/owner/other.git');
    mockGitApi([repository]);

    await startWorkOnIssueCommand(createIssueTreeItem());

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('No local Git repository found for owner/repo.');
    expect(repository.createBranch).not.toHaveBeenCalled();
  });
});
