import * as vscode from 'vscode';
import { execSync, spawnSync } from 'child_process';
import type { GitExtension, Repository, Remote } from '../types/git';

export interface GitRemoteInfo {
  owner: string;
  repo: string;
  remoteHost: string;
  instanceUrl?: string;
}

export interface GitRepositoryRemoteInfo extends GitRemoteInfo {
  rootPath?: string;
  remoteName?: string;
}

function maskRemoteUrlForLogging(remoteUrl: string): string {
  const trimmedRemoteUrl = remoteUrl.trim();

  try {
    const parsedUrl = new URL(trimmedRemoteUrl);
    if (parsedUrl.username || parsedUrl.password) {
      parsedUrl.username = parsedUrl.username ? '***' : '';
      parsedUrl.password = parsedUrl.password ? '***' : '';
    }
    return parsedUrl.toString();
  } catch {
    return trimmedRemoteUrl
      .replace(/(https?:\/\/)([^/@\s]+)@/i, '$1***@')
      .replace(/(ssh:\/\/)([^/@\s]+)@/i, '$1***@');
  }
}

function remoteUrl(remote: Remote): string | undefined {
  const urls = [remote.fetchUrl, remote.pushUrl];
  return urls.find((url): url is string => typeof url === 'string' && url.length > 0);
}

interface VSCodeExtension<T> {
  exports?: T;
  isActive: boolean;
  activate(): Promise<T>;
}

interface VSCodeExtensionsApi {
  getExtension<T>(extensionId: string): VSCodeExtension<T> | undefined;
}

function getGitExtension(): VSCodeExtension<GitExtension> | undefined {
  const extensions = (vscode as unknown as { extensions?: VSCodeExtensionsApi }).extensions;
  return extensions?.getExtension<GitExtension>('vscode.git');
}

function getGitExtensionApi(): ReturnType<GitExtension['getAPI']> | null {
  const extension = getGitExtension();
  const gitExtension = extension?.exports;

  if (!extension?.isActive || !gitExtension?.enabled) {
    return null;
  }

  return gitExtension.getAPI(1);
}

function selectRepositoryRemote(repository: Repository, remoteName?: string): Remote | undefined {
  const preferredRemoteName = remoteName ?? 'origin';
  return repository.state.remotes.find(remote => remote.name === preferredRemoteName)
    ?? (!remoteName ? repository.state.remotes.find(remote => remoteUrl(remote)) : undefined);
}

function parseRepositoryRemote(repository: Repository, remoteName?: string): GitRepositoryRemoteInfo | null {
  const selectedRemote = selectRepositoryRemote(repository, remoteName);
  const selectedRemoteUrl = selectedRemote ? remoteUrl(selectedRemote) : undefined;

  if (!selectedRemote || !selectedRemoteUrl) {
    return null;
  }

  console.log('[Forgejo] Found git remote URL from VS Code Git repository:', repository.rootUri.fsPath, maskRemoteUrlForLogging(selectedRemoteUrl));
  const parsed = parseRemoteUrl(selectedRemoteUrl);
  console.log('[Forgejo] Parsed VS Code Git remote info:', parsed);
  return parsed ? { ...parsed, rootPath: repository.rootUri.fsPath, remoteName: selectedRemote.name } : null;
}

function detectGitRemoteFromGitExtension(remoteName?: string, sourceUri?: vscode.Uri): GitRemoteInfo | null {
  const git = getGitExtensionApi();
  if (!git) {
    return null;
  }

  const activeUri = sourceUri ?? vscode.window.activeTextEditor?.document.uri;
  const activeRepository = activeUri ? git.getRepository(activeUri) : null;
  const [firstRepository] = git.repositories as readonly (Repository | undefined)[];
  const repository = activeRepository ?? firstRepository;

  if (!repository) {
    return null;
  }

  return parseRepositoryRemote(repository, remoteName);
}

function parseGitRepositories(git: ReturnType<GitExtension['getAPI']>, remoteName?: string): GitRepositoryRemoteInfo[] {
  return git.repositories
    .map(repository => parseRepositoryRemote(repository, remoteName))
    .filter((info): info is GitRepositoryRemoteInfo => info !== null);
}

async function waitForGitRepositoryDiscovery(git: ReturnType<GitExtension['getAPI']>, timeoutMs = 5000, quietMs = 750): Promise<void> {
  await new Promise<void>((resolve) => {
    const state: { disposable?: vscode.Disposable; quietTimer?: ReturnType<typeof setTimeout> } = {};
    let finished = false;
    const timeout = setTimeout(() => finish(), timeoutMs);
    const finish = () => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeout);
      if (state.quietTimer) {
        clearTimeout(state.quietTimer);
      }
      state.disposable?.dispose();
      resolve();
    };
    const scheduleQuietFinish = () => {
      if (state.quietTimer) {
        clearTimeout(state.quietTimer);
      }
      state.quietTimer = setTimeout(finish, quietMs);
    };

    state.disposable = git.onDidOpenRepository(scheduleQuietFinish);

    if (git.repositories.length > 0) {
      scheduleQuietFinish();
    }
  });
}

export function detectGitRepositories(remoteName?: string): GitRepositoryRemoteInfo[] {
  const git = getGitExtensionApi();
  return git ? parseGitRepositories(git, remoteName) : [];
}

export async function detectGitRepositoriesAsync(remoteName?: string): Promise<GitRepositoryRemoteInfo[]> {
  if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
    return [];
  }

  const activeGit = getGitExtensionApi();
  if (activeGit) {
    await waitForGitRepositoryDiscovery(activeGit);
    return parseGitRepositories(activeGit, remoteName);
  }

  const extension = getGitExtension();
  if (!extension) {
    return [];
  }

  try {
    const gitExtension = extension.isActive ? extension.exports : await extension.activate();
    if (!gitExtension?.enabled) {
      return [];
    }
    const git = gitExtension.getAPI(1);
    await waitForGitRepositoryDiscovery(git);
    return parseGitRepositories(git, remoteName);
  } catch (error) {
    console.log('[Forgejo] Git extension activation failed:', error instanceof Error ? error.message : error);
    return [];
  }
}

/**
 * Detect git repository and extract remote information
 * @param remoteName Optional remote name to use instead of 'origin'
 * @param sourceUri Optional document URI whose owning Git repository should be
 *   preferred over the active editor or first detected repository. This keeps
 *   multi-root/nested-repository workflows resolved against the originating
 *   file instead of an unrelated workspace default.
 */
export function detectGitRemote(remoteName?: string, sourceUri?: vscode.Uri): GitRemoteInfo | null {
  const gitExtensionRemote = detectGitRemoteFromGitExtension(remoteName, sourceUri);
  if (gitExtensionRemote) {
    return gitExtensionRemote;
  }

  const workspaceFolders = vscode.workspace.workspaceFolders;

  if (!workspaceFolders || workspaceFolders.length === 0) {
    console.log('[Forgejo] No workspace folders found');
    return null;
  }

  const workspaceRoot = workspaceFolders[0].uri.fsPath;
  const remote = remoteName ?? 'origin';
  console.log('[Forgejo] Detecting git remote in:', workspaceRoot, 'using remote:', remote);

  try {
    // Get the remote URL (use spawnSync to avoid shell injection via remote name)
    const result = spawnSync('git', ['config', '--get', `remote.${remote}.url`], {
      cwd: workspaceRoot,
      encoding: 'utf-8'
    });
    if (result.status !== 0) {
      console.log('[Forgejo] Could not get remote URL for:', remote);
      return null;
    }
    const remoteUrl = result.stdout.trim();

    console.log('[Forgejo] Found git remote URL:', maskRemoteUrlForLogging(remoteUrl));
    const parsed = parseRemoteUrl(remoteUrl);
    console.log('[Forgejo] Parsed remote info:', parsed);
    return parsed;
  } catch (error) {
    // Not a git repository or no remote configured
    console.log('[Forgejo] No git repository or remote found:', error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Detect all git remotes and extract their information
 * Returns a Map of remote name to GitRemoteInfo
 */
export function detectAllGitRemotes(): Map<string, GitRemoteInfo> {
  const result = new Map<string, GitRemoteInfo>();
  const workspaceFolders = vscode.workspace.workspaceFolders;

  if (!workspaceFolders || workspaceFolders.length === 0) {
    console.log('[Forgejo] No workspace folders found');
    return result;
  }

  const workspaceRoot = workspaceFolders[0].uri.fsPath;
  console.log('[Forgejo] Detecting all git remotes in:', workspaceRoot);

  try {
    // List all remote names
    const remotesOutput = execSync('git remote', {
      cwd: workspaceRoot,
      encoding: 'utf-8'
    }).trim();

    if (!remotesOutput) {
      console.log('[Forgejo] No git remotes found');
      return result;
    }

    const remoteNames = remotesOutput.split('\n').map(name => name.trim()).filter(name => name.length > 0);
    console.log('[Forgejo] Found git remotes:', remoteNames);

    for (const name of remoteNames) {
      try {
        const remoteResult = spawnSync('git', ['config', '--get', `remote.${name}.url`], {
          cwd: workspaceRoot,
          encoding: 'utf-8'
        });
        if (remoteResult.status !== 0) {
          console.log(`[Forgejo] Could not get URL for remote '${name}'`);
          continue;
        }
        const remoteUrl = remoteResult.stdout.trim();

        const parsed = parseRemoteUrl(remoteUrl);
        if (parsed) {
          result.set(name, parsed);
          console.log(`[Forgejo] Parsed remote '${name}':`, parsed);
        } else {
          console.log(`[Forgejo] Could not parse remote '${name}' URL:`, maskRemoteUrlForLogging(remoteUrl));
        }
      } catch (error) {
        console.log(`[Forgejo] Error getting URL for remote '${name}':`, error instanceof Error ? error.message : error);
      }
    }
  } catch (error) {
    console.log('[Forgejo] Error listing git remotes:', error instanceof Error ? error.message : error);
  }

  return result;
}

function decodeRemotePathSegment(segment: string): string | null {
  try {
    const decoded = decodeURIComponent(segment);
    if (!decoded || decoded.includes('/')) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

function parseRemotePath(pathname: string): Pick<GitRemoteInfo, 'owner' | 'repo'> | null {
  const segments = pathname
    .split('/')
    .filter(segment => segment.length > 0);

  if (segments.length !== 2) {
    return null;
  }

  const owner = decodeRemotePathSegment(segments[0]);
  const repoSegment = decodeRemotePathSegment(segments[1]);

  if (!owner || !repoSegment) {
    return null;
  }

  const repo = repoSegment.endsWith('.git')
    ? repoSegment.slice(0, -4)
    : repoSegment;

  if (!repo) {
    return null;
  }

  return { owner, repo };
}

function parseStandardRemoteUrl(parsedUrl: URL): GitRemoteInfo | null {
  if (!['http:', 'https:', 'ssh:'].includes(parsedUrl.protocol) || !parsedUrl.hostname) {
    return null;
  }

  const pathInfo = parseRemotePath(parsedUrl.pathname);
  if (!pathInfo) {
    return null;
  }

  if (parsedUrl.protocol === 'ssh:') {
    return {
      remoteHost: parsedUrl.hostname,
      ...pathInfo
    };
  }

  return {
    remoteHost: parsedUrl.host,
    instanceUrl: parsedUrl.origin,
    ...pathInfo
  };
}

function parseScpStyleRemoteUrl(remoteUrl: string): GitRemoteInfo | null {
  const atIndex = remoteUrl.indexOf('@');
  const colonIndex = remoteUrl.indexOf(':', atIndex + 1);

  if (atIndex <= 0 || colonIndex <= atIndex + 1) {
    return null;
  }

  const host = remoteUrl.slice(atIndex + 1, colonIndex).trim();
  const path = remoteUrl.slice(colonIndex + 1).trim();

  if (!host || !path) {
    return null;
  }

  const pathInfo = parseRemotePath(path);
  if (!pathInfo) {
    return null;
  }

  return {
    remoteHost: host,
    ...pathInfo
  };
}

/**
 * Parse git remote URL to extract owner/repo and remote host information.
 * For HTTP(S) remotes, also returns an explicit instanceUrl.
 * For SSH-based remotes, we intentionally avoid inferring the web/API URL from the git transport.
 */
export function parseRemoteUrl(remoteUrl: string): GitRemoteInfo | null {
  if (!remoteUrl) {
    return null;
  }

  const trimmedRemoteUrl = remoteUrl.trim();
  if (!trimmedRemoteUrl) {
    return null;
  }

  try {
    const parsedUrl = new URL(trimmedRemoteUrl);
    const parsedRemote = parseStandardRemoteUrl(parsedUrl);
    if (parsedRemote) {
      return parsedRemote;
    }
  } catch {
    // Fall back to scp-style parsing below.
  }

  const scpStyleRemote = parseScpStyleRemoteUrl(trimmedRemoteUrl);
  if (scpStyleRemote) {
    return scpStyleRemote;
  }

  console.warn('[Forgejo] Could not parse git remote URL:', maskRemoteUrlForLogging(remoteUrl));
  return null;
}

/**
 * Check if current workspace has a git repository
 */
export function hasGitRepository(): boolean {
  const workspaceFolders = vscode.workspace.workspaceFolders;

  if (!workspaceFolders || workspaceFolders.length === 0) {
    return false;
  }

  const workspaceRoot = workspaceFolders[0].uri.fsPath;

  try {
    execSync('git rev-parse --git-dir', {
      cwd: workspaceRoot,
      encoding: 'utf-8'
    });
    return true;
  } catch (error) {
    return false;
  }
}
