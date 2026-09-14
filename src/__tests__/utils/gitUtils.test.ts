import * as vscode from 'vscode';
import {
  parseRemoteUrl,
  detectGitRemote,
  hasGitRepository,
  getActiveGitRepository,
  getGitApi,
  getGitApiAsync,
  waitForGitRepositoryDiscovery,
  resetGitRepositoryReadinessForTesting
} from '../../utils/gitUtils';

jest.mock('child_process');

import { execSync, spawnSync } from 'child_process';

const mockedExecSync = execSync as jest.MockedFunction<typeof execSync>;
const mockedSpawnSync = spawnSync as jest.MockedFunction<typeof spawnSync>;

describe('gitUtils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.workspace as any).workspaceFolders = undefined;
  });

  describe('parseRemoteUrl', () => {
    it('should parse HTTPS URL with .git suffix', () => {
      const result = parseRemoteUrl('https://codeberg.org/owner/repo.git');
      expect(result).toEqual({
        instanceUrl: 'https://codeberg.org',
        remoteHost: 'codeberg.org',
        owner: 'owner',
        repo: 'repo'
      });
    });

    it('should parse HTTPS URL without .git suffix', () => {
      const result = parseRemoteUrl('https://codeberg.org/owner/repo');
      expect(result).toEqual({
        instanceUrl: 'https://codeberg.org',
        remoteHost: 'codeberg.org',
        owner: 'owner',
        repo: 'repo'
      });
    });

    it('should preserve HTTP URL scheme', () => {
      const result = parseRemoteUrl('http://git.example.com/owner/repo.git');
      expect(result).toEqual({
        instanceUrl: 'http://git.example.com',
        remoteHost: 'git.example.com',
        owner: 'owner',
        repo: 'repo'
      });
    });

    it('should parse SSH scp-style URL with .git suffix without inferring instance URL', () => {
      const result = parseRemoteUrl('git@codeberg.org:owner/repo.git');
      expect(result).toEqual({
        remoteHost: 'codeberg.org',
        owner: 'owner',
        repo: 'repo'
      });
    });

    it('should parse SSH scp-style URL without .git suffix without inferring instance URL', () => {
      const result = parseRemoteUrl('git@codeberg.org:owner/repo');
      expect(result).toEqual({
        remoteHost: 'codeberg.org',
        owner: 'owner',
        repo: 'repo'
      });
    });

    it('should parse SSH protocol URL with .git suffix without inferring instance URL', () => {
      const result = parseRemoteUrl('ssh://git@git.example.com/owner/repo.git');
      expect(result).toEqual({
        remoteHost: 'git.example.com',
        owner: 'owner',
        repo: 'repo'
      });
    });

    it('should parse SSH protocol URL without .git suffix without inferring instance URL', () => {
      const result = parseRemoteUrl('ssh://git@git.example.com/owner/repo');
      expect(result).toEqual({
        remoteHost: 'git.example.com',
        owner: 'owner',
        repo: 'repo'
      });
    });

    it('should parse SSH protocol URL without git@ prefix', () => {
      const result = parseRemoteUrl('ssh://git.example.com/owner/repo.git');
      expect(result).toEqual({
        remoteHost: 'git.example.com',
        owner: 'owner',
        repo: 'repo'
      });
    });

    it('should return null for empty string', () => {
      expect(parseRemoteUrl('')).toBeNull();
    });

    it('should return null for null-ish input', () => {
      expect(parseRemoteUrl(null as any)).toBeNull();
      expect(parseRemoteUrl(undefined as any)).toBeNull();
    });

    it('should return null for invalid URL', () => {
      expect(parseRemoteUrl('not-a-url')).toBeNull();
      expect(parseRemoteUrl('ftp://example.com/repo')).toBeNull();
    });

    it('should keep HTTP(S) port in instanceUrl', () => {
      const result = parseRemoteUrl('https://git.example.com:3000/owner/repo.git');
      expect(result).toEqual({
        instanceUrl: 'https://git.example.com:3000',
        remoteHost: 'git.example.com:3000',
        owner: 'owner',
        repo: 'repo'
      });
    });

    it('should preserve http instanceUrl for insecure remotes', () => {
      const result = parseRemoteUrl('http://insecure.example.com/owner/repo');
      expect(result).not.toBeNull();
      expect(result!.instanceUrl).toBe('http://insecure.example.com');
      expect(result!.remoteHost).toBe('insecure.example.com');
    });

    it('should return the correct owner', () => {
      const result = parseRemoteUrl('https://codeberg.org/my-org/my-repo.git');
      expect(result!.owner).toBe('my-org');
    });

    it('should return repo name without .git suffix', () => {
      const result = parseRemoteUrl('https://codeberg.org/owner/my-repo.git');
      expect(result!.repo).toBe('my-repo');
    });

    it('should parse HTTPS URL with dots in repo name', () => {
      const result = parseRemoteUrl('https://forgejo.example.com/my-org/my.project.git');
      expect(result).toEqual({
        instanceUrl: 'https://forgejo.example.com',
        remoteHost: 'forgejo.example.com',
        owner: 'my-org',
        repo: 'my.project'
      });
    });

    it('should parse HTTPS URL with dots in repo name without .git suffix', () => {
      const result = parseRemoteUrl('https://forgejo.example.com/my-org/my.project');
      expect(result).toEqual({
        instanceUrl: 'https://forgejo.example.com',
        remoteHost: 'forgejo.example.com',
        owner: 'my-org',
        repo: 'my.project'
      });
    });

    it('should parse HTTPS URL with trailing slash', () => {
      const result = parseRemoteUrl('https://forgejo.example.com/my-org/my.project.git/');
      expect(result).toEqual({
        instanceUrl: 'https://forgejo.example.com',
        remoteHost: 'forgejo.example.com',
        owner: 'my-org',
        repo: 'my.project'
      });
    });

    it('should parse HTTPS URL with credentials', () => {
      const result = parseRemoteUrl('https://user:token@forgejo.example.com/my-org/my.project.git');
      expect(result).toEqual({
        instanceUrl: 'https://forgejo.example.com',
        remoteHost: 'forgejo.example.com',
        owner: 'my-org',
        repo: 'my.project'
      });
    });

    it('should parse SSH scp-style URL with dots in repo name', () => {
      const result = parseRemoteUrl('git@forgejo.example.com:my-org/my.project.git');
      expect(result).toEqual({
        remoteHost: 'forgejo.example.com',
        owner: 'my-org',
        repo: 'my.project'
      });
    });

    it('should parse SSH protocol URL with dots in repo name', () => {
      const result = parseRemoteUrl('ssh://git@forgejo.example.com/my-org/my.project.git');
      expect(result).toEqual({
        remoteHost: 'forgejo.example.com',
        owner: 'my-org',
        repo: 'my.project'
      });
    });

    it('should not infer instanceUrl from SSH remotes with custom ports', () => {
      const result = parseRemoteUrl('ssh://builder@forgejo.example.com:2222/my-org/my.project.git');
      expect(result).toEqual({
        remoteHost: 'forgejo.example.com',
        owner: 'my-org',
        repo: 'my.project'
      });
    });

    it('should parse SSH scp-style URL with trailing slash', () => {
      const result = parseRemoteUrl('git@forgejo.example.com:my-org/my.project.git/');
      expect(result).toEqual({
        remoteHost: 'forgejo.example.com',
        owner: 'my-org',
        repo: 'my.project'
      });
    });

    it('should treat leading path segments as the instance URL subpath (GitHub #21)', () => {
      const result = parseRemoteUrl('https://example.org/gitea/owner/repo.git');
      expect(result).toEqual({
        remoteHost: 'example.org',
        instanceUrl: 'https://example.org/gitea',
        owner: 'owner',
        repo: 'repo'
      });
    });

    it('should parse subpath HTTPS remotes without a .git suffix', () => {
      const result = parseRemoteUrl('https://example.org/gitea/owner/repo');
      expect(result).toEqual({
        remoteHost: 'example.org',
        instanceUrl: 'https://example.org/gitea',
        owner: 'owner',
        repo: 'repo'
      });
    });

    it('should keep every leading segment of deep subpath remotes', () => {
      const result = parseRemoteUrl('https://example.org/git/gitea/my-org/my.project.git');
      expect(result).toEqual({
        remoteHost: 'example.org',
        instanceUrl: 'https://example.org/git/gitea',
        owner: 'my-org',
        repo: 'my.project'
      });
    });

    it('should preserve the port in subpath instance URLs', () => {
      const result = parseRemoteUrl('https://git.example.com:3000/gitea/owner/repo.git');
      expect(result).toEqual({
        remoteHost: 'git.example.com:3000',
        instanceUrl: 'https://git.example.com:3000/gitea',
        owner: 'owner',
        repo: 'repo'
      });
    });

    it('should parse subpath HTTPS remotes with a trailing slash', () => {
      const result = parseRemoteUrl('https://example.org/gitea/owner/repo.git/');
      expect(result).toEqual({
        remoteHost: 'example.org',
        instanceUrl: 'https://example.org/gitea',
        owner: 'owner',
        repo: 'repo'
      });
    });

    it('should extract owner/repo from scp-style remotes with a subpath without inferring an instanceUrl', () => {
      const result = parseRemoteUrl('git@example.org:gitea/owner/repo.git');
      expect(result).toEqual({
        remoteHost: 'example.org',
        owner: 'owner',
        repo: 'repo'
      });
    });

    it('should extract owner/repo from ssh:// remotes with a subpath without inferring an instanceUrl', () => {
      const result = parseRemoteUrl('ssh://git@example.org/gitea/owner/repo.git');
      expect(result).toEqual({
        remoteHost: 'example.org',
        owner: 'owner',
        repo: 'repo'
      });
    });

    it('should still return null for remotes with fewer than two path segments', () => {
      expect(parseRemoteUrl('https://forgejo.example.com/owner')).toBeNull();
      expect(parseRemoteUrl('https://forgejo.example.com/gitea')).toBeNull();
      expect(parseRemoteUrl('git@forgejo.example.com:owner')).toBeNull();
    });

    it('should handle SSH URL with custom host', () => {
      const result = parseRemoteUrl('git@my-forgejo.internal:myorg/myproject.git');
      expect(result).toEqual({
        remoteHost: 'my-forgejo.internal',
        owner: 'myorg',
        repo: 'myproject'
      });
    });
  });

  describe('detectGitRemote', () => {
    it('should return null when no workspace folders', async () => {
      (vscode.workspace as any).workspaceFolders = undefined;
      const result = await detectGitRemote();
      expect(result).toBeNull();
    });

    it('should return parsed info when git remote exists', async () => {
      (vscode.workspace as any).workspaceFolders = [
        { uri: { fsPath: '/workspace/project' } }
      ];
      mockedSpawnSync.mockReturnValue({ status: 0, stdout: 'https://codeberg.org/owner/repo.git\n', stderr: '', pid: 0, output: [], signal: null } as any);

      const result = await detectGitRemote();
      expect(result).toEqual({
        instanceUrl: 'https://codeberg.org',
        remoteHost: 'codeberg.org',
        owner: 'owner',
        repo: 'repo'
      });
      expect(mockedSpawnSync).toHaveBeenCalledWith(
        'git', ['config', '--get', 'remote.origin.url'],
        { cwd: '/workspace/project', encoding: 'utf-8' }
      );
    });

    it('should mask credentials when logging git remote URLs', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      (vscode.workspace as any).workspaceFolders = [
        { uri: { fsPath: '/workspace/project' } }
      ];
      mockedSpawnSync.mockReturnValue({ status: 0, stdout: 'https://user:token@codeberg.org/owner/repo.git\n', stderr: '', pid: 0, output: [], signal: null } as any);

      const result = await detectGitRemote();

      expect(result).toEqual({
        instanceUrl: 'https://codeberg.org',
        remoteHost: 'codeberg.org',
        owner: 'owner',
        repo: 'repo'
      });
      const loggedOutput = logSpy.mock.calls.flat().join(' ');
      expect(loggedOutput).toContain('https://***:***@codeberg.org/owner/repo.git');
      expect(loggedOutput).not.toContain('user:token@codeberg.org');

      logSpy.mockRestore();
    });

    it('should return null when spawnSync returns non-zero', async () => {
      (vscode.workspace as any).workspaceFolders = [
        { uri: { fsPath: '/workspace/project' } }
      ];
      mockedSpawnSync.mockReturnValue({ status: 1, stdout: '', stderr: 'error', pid: 0, output: [], signal: null } as any);

      const result = await detectGitRemote();
      expect(result).toBeNull();
    });
  });

  describe('hasGitRepository', () => {
    it('should return false when no workspace folders', async () => {
      (vscode.workspace as any).workspaceFolders = undefined;
      const result = await hasGitRepository();
      expect(result).toBe(false);
    });

    it('should return true when git command succeeds', async () => {
      (vscode.workspace as any).workspaceFolders = [
        { uri: { fsPath: '/workspace/project' } }
      ];
      mockedExecSync.mockReturnValue('.git\n');

      const result = await hasGitRepository();
      expect(result).toBe(true);
    });

    it('should return false when git command throws', async () => {
      (vscode.workspace as any).workspaceFolders = [
        { uri: { fsPath: '/workspace/project' } }
      ];
      mockedExecSync.mockImplementation(() => { throw new Error('not a git repo'); });

      const result = await hasGitRepository();
      expect(result).toBe(false);
    });
  });

  describe('Git repository readiness', () => {
    it('shares the settling wait across concurrent and later consumers', async () => {
      jest.useFakeTimers();
      resetGitRepositoryReadinessForTesting();
      const dispose = jest.fn();
      const onDidOpenRepository = jest.fn(() => ({ dispose }));
      const git = { repositories: [{}], onDidOpenRepository } as any;

      const first = waitForGitRepositoryDiscovery(git);
      const second = waitForGitRepositoryDiscovery(git);
      expect(second).toBe(first);
      expect(onDidOpenRepository).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(750);
      await Promise.all([first, second]);
      await waitForGitRepositoryDiscovery(git);
      expect(onDidOpenRepository).toHaveBeenCalledTimes(1);
      expect(dispose).toHaveBeenCalledTimes(1);
      jest.useRealTimers();
    });
  });

  describe('getActiveGitRepository', () => {
    afterEach(() => {
      (vscode.window as any).activeTextEditor = undefined;
    });

    function mockGitExtension(repositories: any[], getRepositoryImpl: (uri: any) => any) {
      (vscode.extensions.getExtension as jest.Mock).mockReturnValue({
        isActive: true,
        exports: {
          enabled: true,
          getAPI: () => ({
            repositories,
            getRepository: jest.fn(getRepositoryImpl)
          })
        }
      });
    }

    it('returns null when the Git extension is not available', () => {
      expect(getActiveGitRepository()).toBeNull();
    });

    it('prefers the repository owning the active editor over the first repository (multi-root)', () => {
      const repoOne = { rootUri: { fsPath: '/workspace/repo-one' } };
      const repoTwo = { rootUri: { fsPath: '/workspace/repo-two' } };
      mockGitExtension([repoOne, repoTwo], (uri) => (uri?.fsPath === '/workspace/repo-two/src/file.ts' ? repoTwo : null));
      (vscode.window as any).activeTextEditor = { document: { uri: { fsPath: '/workspace/repo-two/src/file.ts' } } };

      expect(getActiveGitRepository()).toBe(repoTwo);
    });

    it('falls back to the first repository when no active editor matches any repository', () => {
      const repoOne = { rootUri: { fsPath: '/workspace/repo-one' } };
      const repoTwo = { rootUri: { fsPath: '/workspace/repo-two' } };
      mockGitExtension([repoOne, repoTwo], () => null);
      (vscode.window as any).activeTextEditor = undefined;

      expect(getActiveGitRepository()).toBe(repoOne);
    });

    it('uses an explicit sourceUri instead of the active editor when provided', () => {
      const repoOne = { rootUri: { fsPath: '/workspace/repo-one' } };
      const repoTwo = { rootUri: { fsPath: '/workspace/repo-two' } };
      mockGitExtension([repoOne, repoTwo], (uri) => (uri?.fsPath === '/workspace/repo-one/file.ts' ? repoOne : null));
      (vscode.window as any).activeTextEditor = { document: { uri: { fsPath: '/workspace/repo-two/file.ts' } } };

      expect(getActiveGitRepository({ fsPath: '/workspace/repo-one/file.ts' } as any)).toBe(repoOne);
    });
  });

  describe('getGitApi / getGitApiAsync (vscode.git activation race, issue #33)', () => {
    /**
     * Mirrors real VS Code: `Extension.exports` throws while the extension
     * has not finished activating instead of returning undefined.
     */
    function inactiveGitExtension() {
      return {
        isActive: false,
        get exports(): never {
          throw new Error("Extension 'vscode.git' is not known or not activated");
        },
        activate: jest.fn()
      };
    }

    function activeGitExtension(gitApi: object) {
      return {
        isActive: true,
        exports: { enabled: true, getAPI: () => gitApi }
      };
    }

    const gitApi = { repositories: [], onDidOpenRepository: jest.fn(), onDidCloseRepository: jest.fn() };

    afterEach(() => {
      (vscode.extensions.getExtension as jest.Mock).mockReset();
    });

    it('getGitApi returns null when the Git extension is not installed', () => {
      (vscode.extensions.getExtension as jest.Mock).mockReturnValue(undefined);
      expect(getGitApi()).toBeNull();
    });

    it('getGitApi returns null instead of throwing when vscode.git is not yet activated', () => {
      // Regression test for Codeberg issue #33: reading `exports` on a
      // not-yet-activated extension used to throw and abort activate().
      (vscode.extensions.getExtension as jest.Mock).mockReturnValue(inactiveGitExtension());

      expect(() => getGitApi()).not.toThrow();
      expect(getGitApi()).toBeNull();
    });

    it('getGitApi returns the API when vscode.git is already active', () => {
      (vscode.extensions.getExtension as jest.Mock).mockReturnValue(activeGitExtension(gitApi));
      expect(getGitApi()).toBe(gitApi);
    });

    it('getGitApiAsync activates vscode.git when it has not activated yet', async () => {
      const gitExports = { enabled: true, getAPI: () => gitApi };
      const extension = inactiveGitExtension();
      extension.activate.mockResolvedValue(gitExports);
      (vscode.extensions.getExtension as jest.Mock).mockReturnValue(extension);

      await expect(getGitApiAsync()).resolves.toBe(gitApi);
      expect(extension.activate).toHaveBeenCalledTimes(1);
    });

    it('getGitApiAsync returns null when vscode.git activation fails', async () => {
      const extension = inactiveGitExtension();
      extension.activate.mockRejectedValue(new Error('activation failed'));
      (vscode.extensions.getExtension as jest.Mock).mockReturnValue(extension);

      await expect(getGitApiAsync()).resolves.toBeNull();
    });

    it('getGitApiAsync returns null when vscode.git is disabled', async () => {
      const extension = inactiveGitExtension();
      extension.activate.mockResolvedValue({ enabled: false });
      (vscode.extensions.getExtension as jest.Mock).mockReturnValue(extension);

      await expect(getGitApiAsync()).resolves.toBeNull();
    });
  });
});
