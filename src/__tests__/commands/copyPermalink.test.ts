import * as vscode from 'vscode';
import { buildPermalinkUrl, copyPermalinkCommand } from '../../commands/copyPermalink';
import { getForgejoConfig } from '../../utils/config';
import { activateGitExtension } from '../../utils/gitExtension';

jest.mock('../../utils/config');
jest.mock('../../utils/gitExtension');
jest.mock('../../utils/logger', () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
}));

const mockGetForgejoConfig = getForgejoConfig as jest.MockedFunction<typeof getForgejoConfig>;
const mockActivateGitExtension = activateGitExtension as jest.MockedFunction<typeof activateGitExtension>;

const mockConfig = {
  instanceUrl: 'https://git.example.com',
  owner: 'test-owner',
  repo: 'test-repo',
  token: 'test-token',
};

function createRepository(rootPath: string, overrides: Partial<{
  commit: string;
  upstream: { name: string; remote: string };
  indexChanges: { uri: vscode.Uri }[];
  workingTreeChanges: { uri: vscode.Uri }[];
  mergeChanges: { uri: vscode.Uri }[];
}> = {}) {
  return {
    rootUri: vscode.Uri.file(rootPath),
    state: {
      HEAD: {
        name: 'main',
        commit: 'commit' in overrides ? overrides.commit : 'a'.repeat(40),
        upstream: 'upstream' in overrides ? overrides.upstream : { name: 'main', remote: 'origin' },
      },
      remotes: [{ name: 'origin', fetchUrl: 'https://git.example.com/test-owner/test-repo.git' }],
      indexChanges: overrides.indexChanges ?? [],
      workingTreeChanges: overrides.workingTreeChanges ?? [],
      mergeChanges: overrides.mergeChanges ?? [],
    },
  };
}

function mockGitApi(repository: ReturnType<typeof createRepository> | null) {
  mockActivateGitExtension.mockResolvedValue({
    enabled: true,
    getAPI: () => ({
      repositories: repository ? [repository] : [],
      getRepository: jest.fn(() => repository),
    }),
  } as any);
}

function mockNoGitExtension() {
  mockActivateGitExtension.mockResolvedValue(undefined as any);
}

function createEditor(filePath: string, selection: { isEmpty: boolean; start: { line: number }; end: { line: number; character: number } } = {
  isEmpty: true,
  start: { line: 0 },
  end: { line: 0, character: 0 },
}) {
  return {
    document: { uri: vscode.Uri.file(filePath) },
    selection,
  };
}

describe('buildPermalinkUrl', () => {
  it('returns a whole-file URL with no line anchor when no range is given', () => {
    const url = buildPermalinkUrl('https://git.example.com', 'owner', 'repo', 'abc123', 'src/index.ts');
    expect(url).toBe('https://git.example.com/owner/repo/src/commit/abc123/src/index.ts');
  });

  it('uses a single #L{n} anchor for a single-line range', () => {
    const url = buildPermalinkUrl('https://git.example.com', 'owner', 'repo', 'abc123', 'src/index.ts', { start: 10, end: 10 });
    expect(url).toBe('https://git.example.com/owner/repo/src/commit/abc123/src/index.ts#L10');
  });

  it('uses a #L{start}-L{end} anchor for a multi-line range', () => {
    const url = buildPermalinkUrl('https://git.example.com', 'owner', 'repo', 'abc123', 'src/index.ts', { start: 10, end: 15 });
    expect(url).toBe('https://git.example.com/owner/repo/src/commit/abc123/src/index.ts#L10-L15');
  });

  it('percent-encodes path segments with special characters', () => {
    const url = buildPermalinkUrl('https://git.example.com', 'owner', 'repo', 'abc123', 'src/my folder/file name.ts');
    expect(url).toBe('https://git.example.com/owner/repo/src/commit/abc123/src/my%20folder/file%20name.ts');
  });
});

describe('copyPermalinkCommand', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.window as any).activeTextEditor = undefined;
    mockGetForgejoConfig.mockResolvedValue(mockConfig as any);
  });

  afterEach(async () => {
    await new Promise(process.nextTick);
  });

  it('warns and does not touch the clipboard when there is no active editor', async () => {
    (vscode.window as any).activeTextEditor = undefined;

    await copyPermalinkCommand();

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith('Open a file to copy a Forgejo permalink.');
    expect(vscode.env.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('warns when the file is not part of a configured Forgejo repository', async () => {
    (vscode.window as any).activeTextEditor = createEditor('/workspace/repo/src/index.ts');
    mockGetForgejoConfig.mockResolvedValue(null);

    await copyPermalinkCommand();

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith('This file is not part of a configured Forgejo repository.');
    expect(vscode.env.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('warns when there is no local Git repository for the file', async () => {
    (vscode.window as any).activeTextEditor = createEditor('/workspace/repo/src/index.ts');
    mockGitApi(null);

    await copyPermalinkCommand();

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith('Could not find a local Git repository for this file.');
    expect(vscode.env.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('warns when the Git extension is unavailable', async () => {
    (vscode.window as any).activeTextEditor = createEditor('/workspace/repo/src/index.ts');
    mockNoGitExtension();

    await copyPermalinkCommand();

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith('Could not find a local Git repository for this file.');
    expect(vscode.env.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('warns when the repository has no HEAD commit', async () => {
    (vscode.window as any).activeTextEditor = createEditor('/workspace/repo/src/index.ts');
    mockGitApi(createRepository('/workspace/repo', { commit: undefined as any }));

    await copyPermalinkCommand();

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith('Could not determine the current commit for this repository.');
    expect(vscode.env.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('copies a whole-file permalink when there is no selection', async () => {
    (vscode.window as any).activeTextEditor = createEditor('/workspace/repo/src/index.ts');
    mockGitApi(createRepository('/workspace/repo', { commit: 'deadbeef' }));

    await copyPermalinkCommand();

    expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith(
      'https://git.example.com/test-owner/test-repo/src/commit/deadbeef/src/index.ts'
    );
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Copied Forgejo permalink to clipboard.');
  });

  it('copies a line-range permalink when lines 10-15 are selected', async () => {
    (vscode.window as any).activeTextEditor = createEditor('/workspace/repo/src/index.ts', {
      isEmpty: false,
      start: { line: 9 },
      end: { line: 14, character: 5 },
    });
    mockGitApi(createRepository('/workspace/repo', { commit: 'deadbeef' }));

    await copyPermalinkCommand();

    expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith(
      'https://git.example.com/test-owner/test-repo/src/commit/deadbeef/src/index.ts#L10-L15'
    );
  });

  it('excludes the trailing line when a selection ends at column 0 of the next line', async () => {
    (vscode.window as any).activeTextEditor = createEditor('/workspace/repo/src/index.ts', {
      isEmpty: false,
      start: { line: 9 },
      end: { line: 15, character: 0 },
    });
    mockGitApi(createRepository('/workspace/repo', { commit: 'deadbeef' }));

    await copyPermalinkCommand();

    // Dragging to column 0 of line 16 (1-indexed) should report lines 10-15, not 10-16.
    expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith(
      'https://git.example.com/test-owner/test-repo/src/commit/deadbeef/src/index.ts#L10-L15'
    );
  });

  it('still copies a permalink but flags uncommitted changes for a dirty file', async () => {
    const fileUri = vscode.Uri.file('/workspace/repo/src/index.ts');
    (vscode.window as any).activeTextEditor = createEditor('/workspace/repo/src/index.ts');
    mockGitApi(createRepository('/workspace/repo', { commit: 'deadbeef', workingTreeChanges: [{ uri: fileUri }] }));

    await copyPermalinkCommand();

    expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith(
      'https://git.example.com/test-owner/test-repo/src/commit/deadbeef/src/index.ts'
    );
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('uncommitted changes')
    );
  });

  it('flags a missing upstream branch so the user knows the link may not resolve yet', async () => {
    (vscode.window as any).activeTextEditor = createEditor('/workspace/repo/src/index.ts');
    mockGitApi(createRepository('/workspace/repo', { commit: 'deadbeef', upstream: undefined }));

    await copyPermalinkCommand();

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('no upstream')
    );
  });

  it('does not flag a dirty file whose changes belong to a different file', async () => {
    const otherFileUri = vscode.Uri.file('/workspace/repo/src/other.ts');
    (vscode.window as any).activeTextEditor = createEditor('/workspace/repo/src/index.ts');
    mockGitApi(createRepository('/workspace/repo', { commit: 'deadbeef', workingTreeChanges: [{ uri: otherFileUri }] }));

    await copyPermalinkCommand();

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Copied Forgejo permalink to clipboard.');
  });

  it('uses the file-owning repository config in a multi-repo/multi-instance workspace', async () => {
    // Repo A is configured for instance-a, repo B (which owns the active file) for instance-b.
    // getForgejoConfig is called with the file's URI, so it must resolve repo B's identity —
    // proving the command threads the file through rather than falling back to any active/default config.
    (vscode.window as any).activeTextEditor = createEditor('/workspace/repo-b/src/index.ts');
    mockGetForgejoConfig.mockImplementation(async (uri?: vscode.Uri) => {
      if (uri?.fsPath === '/workspace/repo-b/src/index.ts') {
        return {
          instanceUrl: 'https://instance-b.example.com',
          owner: 'owner-b',
          repo: 'repo-b',
          token: 'token-b',
        } as any;
      }
      return {
        instanceUrl: 'https://instance-a.example.com',
        owner: 'owner-a',
        repo: 'repo-a',
        token: 'token-a',
      } as any;
    });
    mockGitApi(createRepository('/workspace/repo-b', { commit: 'cafefeed' }));

    await copyPermalinkCommand();

    expect(mockGetForgejoConfig).toHaveBeenCalledWith(expect.objectContaining({ fsPath: '/workspace/repo-b/src/index.ts' }));
    expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith(
      'https://instance-b.example.com/owner-b/repo-b/src/commit/cafefeed/src/index.ts'
    );
  });
});
