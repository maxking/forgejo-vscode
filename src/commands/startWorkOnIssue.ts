import * as path from 'path';
import * as vscode from 'vscode';
import type { IssueListItem } from '../models/issue';
import type { IssueTreeItem } from '../providers/issueTreeProvider';
import type { API, GitExtension, Remote, Repository } from '../types/git';
import { activateGitExtension } from '../utils/gitExtension';
import { parseRemoteUrl } from '../utils/gitUtils';
import { logError, logInfo } from '../utils/logger';

const CUSTOM_BRANCH_PICK = '__custom__';

interface RepositoryPick extends vscode.QuickPickItem {
  repository: Repository;
}

interface BranchPick extends vscode.QuickPickItem {
  branchName: string;
}

function remoteUrl(remote: Remote): string | undefined {
  return [remote.fetchUrl, remote.pushUrl].find((url): url is string => typeof url === 'string' && url.length > 0);
}

function hostForInstanceUrl(instanceUrl?: string): { host: string; hostname: string } | undefined {
  if (!instanceUrl) {
    return undefined;
  }

  try {
    const parsed = new URL(instanceUrl);
    return { host: parsed.host, hostname: parsed.hostname };
  } catch {
    return undefined;
  }
}

function repositoryMatchesIssue(repository: Repository, owner: string, repo: string, instanceUrl?: string): boolean {
  const expectedHost = hostForInstanceUrl(instanceUrl);

  return repository.state.remotes.some(remote => {
    const url = remoteUrl(remote);
    const parsed = url ? parseRemoteUrl(url) : null;
    if (!parsed || parsed.owner !== owner || parsed.repo !== repo) {
      return false;
    }

    return !expectedHost
      || parsed.instanceUrl === instanceUrl
      || parsed.remoteHost === expectedHost.host
      || parsed.remoteHost === expectedHost.hostname;
  });
}

function repositoryIsDirty(repository: Repository): boolean {
  return (repository.state.indexChanges?.length ?? 0) > 0
    || (repository.state.workingTreeChanges?.length ?? 0) > 0
    || (repository.state.mergeChanges?.length ?? 0) > 0;
}

function activeRepository(git: API): Repository | null {
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  return activeUri ? git.getRepository(activeUri) : null;
}

function preferredRepository(repositories: Repository[], git: API, preferredRootPath?: string): Repository | undefined {
  if (preferredRootPath) {
    const matchingRoot = repositories.find(repository => repository.rootUri.fsPath === preferredRootPath);
    if (matchingRoot) {
      return matchingRoot;
    }
  }

  const active = activeRepository(git);
  return active ? repositories.find(repository => repository === active) : undefined;
}

async function pickRepository(repositories: Repository[]): Promise<Repository | undefined> {
  const picks: RepositoryPick[] = repositories.map(repository => ({
    label: path.basename(repository.rootUri.fsPath),
    description: repository.state.HEAD?.name,
    detail: repository.rootUri.fsPath,
    repository
  }));

  const selected = await vscode.window.showQuickPick(picks, {
    title: 'Start Work on Issue',
    placeHolder: 'Select the local repository for this issue'
  });

  return selected?.repository;
}

export function issueTitleToBranchSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  return slug.slice(0, 48).replace(/-+$/g, '') || 'issue';
}

export function issueBranchNameOptions(issue: Pick<IssueListItem, 'number' | 'title'>): string[] {
  const slug = issueTitleToBranchSlug(issue.title);
  return [
    `issue/${issue.number}-${slug}`,
    `feat/${issue.number}-${slug}`,
    `fix/${issue.number}-${slug}`
  ];
}

export function validateBranchName(branchName: string): string | null {
  const value = branchName.trim();
  if (!value) {
    return 'Branch name is required';
  }
  if (value.includes('..')) {
    return 'Branch name cannot contain ".."';
  }
  if (/[\s~^:?*[\\]/.test(value)) {
    return 'Branch name contains unsupported characters';
  }
  if (value.startsWith('/') || value.endsWith('/') || value.includes('//')) {
    return 'Branch name cannot start, end, or repeat "/"';
  }
  if (value.endsWith('.') || value.endsWith('.lock')) {
    return 'Branch name cannot end with "." or ".lock"';
  }

  return null;
}

async function pickBranchName(issue: Pick<IssueListItem, 'number' | 'title'>): Promise<string | undefined> {
  const branchNames = issueBranchNameOptions(issue);
  const picks: BranchPick[] = [
    ...branchNames.map(branchName => ({
      label: branchName,
      description: 'Suggested branch name',
      branchName
    })),
    {
      label: 'Custom branch name...',
      branchName: CUSTOM_BRANCH_PICK
    }
  ];

  const selected = await vscode.window.showQuickPick(picks, {
    title: 'Start Work on Issue',
    placeHolder: 'Choose a branch name'
  });

  if (!selected) {
    return undefined;
  }

  if (selected.branchName !== CUSTOM_BRANCH_PICK) {
    return selected.branchName;
  }

  const custom = await vscode.window.showInputBox({
    title: 'Start Work on Issue',
    prompt: 'Enter branch name',
    value: branchNames[0],
    validateInput: validateBranchName
  });

  return custom?.trim();
}

async function branchExists(repository: Repository, branchName: string): Promise<boolean> {
  try {
    await repository.getBranch(branchName);
    return true;
  } catch {
    return false;
  }
}

async function confirmDirtyRepository(repository: Repository): Promise<boolean> {
  if (!repositoryIsDirty(repository)) {
    return true;
  }

  const action = await vscode.window.showWarningMessage(
    `Repository ${path.basename(repository.rootUri.fsPath)} has uncommitted changes. Start work on a new branch anyway?`,
    { modal: true },
    'Continue',
    'Cancel'
  );

  return action === 'Continue';
}

async function checkoutBranch(repository: Repository, branchName: string): Promise<boolean> {
  if (await branchExists(repository, branchName)) {
    const action = await vscode.window.showWarningMessage(
      `Branch "${branchName}" already exists. Check it out?`,
      { modal: true },
      'Checkout Existing Branch',
      'Cancel'
    );

    if (action !== 'Checkout Existing Branch') {
      return false;
    }

    await repository.checkout(branchName);
    return true;
  }

  await repository.branch(branchName, true);
  return true;
}

async function getGitApi(): Promise<API | undefined> {
  const gitExtension: GitExtension | undefined = await activateGitExtension();
  if (!gitExtension?.enabled) {
    return undefined;
  }

  return gitExtension.getAPI(1);
}

export async function startWorkOnIssueCommand(
  issueOrItem: IssueListItem | IssueTreeItem,
  owner?: string,
  repo?: string,
  instanceUrl?: string,
): Promise<void> {
  try {
    const issue = 'issue' in issueOrItem ? issueOrItem.issue : issueOrItem;
    const issueOwner = 'issue' in issueOrItem ? issueOrItem.owner : owner;
    const issueRepo = 'issue' in issueOrItem ? issueOrItem.repo : repo;
    const issueInstanceUrl = 'issue' in issueOrItem ? issueOrItem.instanceUrl : instanceUrl;
    const preferredRootPath = 'issue' in issueOrItem ? issueOrItem.config?.rootPath : undefined;

    if (!issueOwner || !issueRepo) {
      void vscode.window.showErrorMessage('Issue repository could not be determined.');
      return;
    }

    const git = await getGitApi();
    if (!git) {
      void vscode.window.showErrorMessage('VS Code Git extension is not available.');
      return;
    }

    const matchingRepositories = git.repositories.filter(repository =>
      repositoryMatchesIssue(repository, issueOwner, issueRepo, issueInstanceUrl)
    );
    if (matchingRepositories.length === 0) {
      void vscode.window.showErrorMessage(`No local Git repository found for ${issueOwner}/${issueRepo}.`);
      return;
    }

    const selectedRepository = preferredRepository(matchingRepositories, git, preferredRootPath)
      ?? (matchingRepositories.length === 1 ? matchingRepositories[0] : await pickRepository(matchingRepositories));
    if (!selectedRepository) {
      return;
    }

    if (!await confirmDirtyRepository(selectedRepository)) {
      return;
    }

    const branchName = await pickBranchName(issue);
    if (!branchName) {
      return;
    }

    const validationMessage = validateBranchName(branchName);
    if (validationMessage) {
      void vscode.window.showErrorMessage(validationMessage);
      return;
    }

    if (!await checkoutBranch(selectedRepository, branchName)) {
      return;
    }

    logInfo(`Started work on issue #${issue.number} in ${selectedRepository.rootUri.fsPath} on ${branchName}`);
    void vscode.window.showInformationMessage(`Started work on issue #${issue.number} on branch ${branchName}.`);
  } catch (error) {
    logError('Error starting work on issue:', error);
    void vscode.window.showErrorMessage(
      `Failed to start work on issue: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
