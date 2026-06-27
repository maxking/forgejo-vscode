import * as path from 'path';
import * as vscode from 'vscode';
import type { IssueListItem } from '../models/issue';
import type { IssueTreeItem } from '../providers/issueTreeProvider';
import type { API, GitExtension, Repository } from '../types/git';
import { activateGitExtension } from '../utils/gitExtension';
import { repositoryMatchesConfig } from '../utils/gitRepositoryMatch';
import { logError, logInfo } from '../utils/logger';

const CUSTOM_BRANCH_PICK = '__custom__';
const DEFAULT_BASE_REF = 'origin/master';

interface RepositoryPick extends vscode.QuickPickItem {
  repository: Repository;
}

interface BranchPick extends vscode.QuickPickItem {
  branchName: string;
}

type CheckoutResult =
  | { kind: 'created'; baseRef: string }
  | { kind: 'checkedOutExisting' };



function repositoryIsDirty(repository: Repository): boolean {
  return (repository.state.indexChanges?.length ?? 0) > 0
    || (repository.state.workingTreeChanges?.length ?? 0) > 0
    || (repository.state.mergeChanges?.length ?? 0) > 0;
}

function activeRepository(git: API): Repository | null {
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  return activeUri ? git.getRepository(activeUri) : null;
}

function repositorySelectionPriority(repository: Repository, active: Repository | null, preferredRootPath?: string): number {
  let priority = 0;
  if (preferredRootPath && repository.rootUri.fsPath === preferredRootPath) {
    priority += 2;
  }
  if (repository === active) {
    priority += 1;
  }
  return priority;
}

function repositoryDescription(repository: Repository, active: Repository | null, preferredRootPath?: string): string | undefined {
  const hints: string[] = [];
  if (preferredRootPath && repository.rootUri.fsPath === preferredRootPath) {
    hints.push('issue row');
  }
  if (repository === active) {
    hints.push('active editor');
  }

  return [repository.state.HEAD?.name, hints.join(', ')].filter(Boolean).join(' - ') || undefined;
}

async function pickRepository(
  repositories: Repository[],
  git: API,
  preferredRootPath?: string
): Promise<Repository | undefined> {
  const active = activeRepository(git);
  const sortedRepositories = [...repositories].sort((left, right) =>
    repositorySelectionPriority(right, active, preferredRootPath)
      - repositorySelectionPriority(left, active, preferredRootPath)
  );
  const picks: RepositoryPick[] = sortedRepositories.map(repository => ({
    label: path.basename(repository.rootUri.fsPath),
    description: repositoryDescription(repository, active, preferredRootPath),
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

async function checkoutBranch(repository: Repository, branchName: string): Promise<CheckoutResult | undefined> {
  if (await branchExists(repository, branchName)) {
    const action = await vscode.window.showWarningMessage(
      `Branch "${branchName}" already exists. Check it out?`,
      { modal: true },
      'Checkout Existing Branch',
      'Cancel'
    );

    if (action !== 'Checkout Existing Branch') {
      return undefined;
    }

    await repository.checkout(branchName);
    return { kind: 'checkedOutExisting' };
  }

  const baseRef = startWorkBaseRef();
  await createBranch(repository, branchName, baseRef);
  return { kind: 'created', baseRef };
}

function startWorkBaseRef(): string {
  return vscode.workspace.getConfiguration('forgejo').get<string>('startWorkOnIssueBaseRef', DEFAULT_BASE_REF).trim()
    || DEFAULT_BASE_REF;
}

async function createBranch(repository: Repository, branchName: string, baseRef: string): Promise<void> {
  await repository.createBranch(branchName, true, baseRef);
}

function successMessage(issueNumber: number, branchName: string, repository: Repository, result: CheckoutResult): string {
  const repoPath = repository.rootUri.fsPath;
  if (result.kind === 'created') {
    return `Created and checked out branch ${branchName} from ${result.baseRef} in existing local worktree ${repoPath} for issue #${issueNumber}.`;
  }

  return `Checked out existing branch ${branchName} in existing local worktree ${repoPath} for issue #${issueNumber}.`;
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
      repositoryMatchesConfig(repository, issueOwner, issueRepo, issueInstanceUrl)
    );
    if (matchingRepositories.length === 0) {
      void vscode.window.showErrorMessage(`No local Git repository found for ${issueOwner}/${issueRepo}.`);
      return;
    }

    const selectedRepository = matchingRepositories.length === 1
      ? matchingRepositories[0]
      : await pickRepository(matchingRepositories, git, preferredRootPath);
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

    const checkoutResult = await checkoutBranch(selectedRepository, branchName);
    if (!checkoutResult) {
      return;
    }

    const message = successMessage(issue.number, branchName, selectedRepository, checkoutResult);
    logInfo(message);
    void vscode.window.showInformationMessage(message);
  } catch (error) {
    logError('Error starting work on issue:', error);
    void vscode.window.showErrorMessage(
      `Failed to start work on issue: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
