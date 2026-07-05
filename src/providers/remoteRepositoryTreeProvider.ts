import * as vscode from 'vscode';
import { ForgejoClient, RepositoryBranch, RepositoryContentEntry } from '../api/forgejoClient';
import { ForgejoInstance } from '../models/instance';
import { getAllInstances, normalizeUrl } from '../utils/instanceHelpers';
import { createRemoteFileUri } from './remoteFileContentProvider';

const REMOTE_DIRECTORY_PAGE_SIZE = 100;
const LOAD_MORE_BRANCHES_LABEL = 'Load more branches...';
const NEXT_BRANCH_PAGE_LABEL = 'Next branch page';
const PREVIOUS_BRANCH_PAGE_LABEL = 'Previous branch page';

interface BranchPage {
  items: RepositoryBranch[];
  page: number;
  hasMore: boolean;
}

interface BranchQuickPickItem extends vscode.QuickPickItem {
  branch?: RepositoryBranch;
  loadMore?: true;
  nextPage?: true;
  previousPage?: true;
}

function treeIdPart(value: string | number | undefined): string {
  return encodeURIComponent(String(value ?? ''));
}

function repositoryKey(instanceUrl: string, owner: string, repo: string): string {
  return `${normalizeUrl(instanceUrl)}/${owner}/${repo}`.toLowerCase();
}

function repositoryLabel(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

function pathBasename(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function splitRepositoryInput(value: string, instanceUrl: string): { owner: string; repo: string } | null {
  const trimmed = value.trim();
  let repositoryPath = trimmed;

  if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return null;
    }
    if (normalizeUrl(url.origin) !== normalizeUrl(instanceUrl)) {
      return null;
    }
    repositoryPath = url.pathname;
  }

  const parts = repositoryPath.replace(/\.git$/, '').split('/').filter(Boolean);
  if (parts.length !== 2) {
    return null;
  }

  return {
    owner: parts[0],
    repo: parts[1]
  };
}

function sortEntries(entries: RepositoryContentEntry[]): RepositoryContentEntry[] {
  return [...entries].sort((first, second) => {
    if (first.type === 'dir' && second.type !== 'dir') {
      return -1;
    }
    if (first.type !== 'dir' && second.type === 'dir') {
      return 1;
    }
    return first.name.localeCompare(second.name);
  });
}

export interface RemoteRepositorySelection {
  instanceId: string;
  instanceName: string;
  instanceUrl: string;
  token?: string;
  owner: string;
  repo: string;
  branch: string;
}

export class RemoteRepositoryInstanceItem extends vscode.TreeItem {
  constructor(public readonly instance: ForgejoInstance) {
    super(instance.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = normalizeUrl(instance.instanceUrl);
    this.tooltip = `${instance.name}\n${normalizeUrl(instance.instanceUrl)}`;
    this.contextValue = 'forgejoRemoteInstance';
    this.iconPath = new vscode.ThemeIcon('server');
    this.id = ['remote-instance', instance.id, normalizeUrl(instance.instanceUrl)].map(treeIdPart).join('/');
  }
}

export class RemoteRepositoryBrowseItem extends vscode.TreeItem {
  constructor(public readonly instance: ForgejoInstance) {
    super('Browse remote repository...', vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'forgejoRemoteBrowse';
    this.iconPath = new vscode.ThemeIcon('search');
    this.id = ['remote-browse', instance.id, normalizeUrl(instance.instanceUrl)].map(treeIdPart).join('/');
    this.command = {
      command: 'forgejo.browseRemoteRepository',
      title: 'Browse Remote Repository',
      arguments: [this]
    };
  }
}

export class RemoteRepositoryItem extends vscode.TreeItem {
  constructor(public readonly selection: RemoteRepositorySelection) {
    super(repositoryLabel(selection.owner, selection.repo), vscode.TreeItemCollapsibleState.Collapsed);
    this.description = selection.branch;
    this.tooltip = `${repositoryLabel(selection.owner, selection.repo)}\n${selection.instanceUrl}\nBranch: ${selection.branch}`;
    this.contextValue = 'forgejoRemoteRepository';
    this.iconPath = new vscode.ThemeIcon('repo');
    this.id = [
      'remote-repository',
      selection.instanceUrl,
      selection.owner,
      selection.repo
    ].map(treeIdPart).join('/');
  }
}

export class RemoteRepositoryDirectoryItem extends vscode.TreeItem {
  constructor(
    public readonly selection: RemoteRepositorySelection,
    public readonly path: string
  ) {
    super(pathBasename(path), vscode.TreeItemCollapsibleState.Collapsed);
    this.tooltip = path;
    this.contextValue = 'forgejoRemoteDirectory';
    this.iconPath = new vscode.ThemeIcon('folder');
    this.id = [
      'remote-directory',
      selection.instanceUrl,
      selection.owner,
      selection.repo,
      selection.branch,
      path
    ].map(treeIdPart).join('/');
  }
}

export class RemoteRepositoryFileItem extends vscode.TreeItem {
  constructor(
    public readonly selection: RemoteRepositorySelection,
    public readonly entry: RepositoryContentEntry
  ) {
    super(entry.name, vscode.TreeItemCollapsibleState.None);
    this.description = entry.size !== undefined ? `${entry.size} bytes` : undefined;
    this.tooltip = entry.path;
    this.contextValue = 'forgejoRemoteFile';
    this.iconPath = new vscode.ThemeIcon('file');
    this.id = [
      'remote-file',
      selection.instanceUrl,
      selection.owner,
      selection.repo,
      selection.branch,
      entry.path
    ].map(treeIdPart).join('/');
    this.command = {
      command: 'forgejo.openRemoteFile',
      title: 'Open Remote File',
      arguments: [this]
    };
  }
}

export class RemoteRepositoryMessageItem extends vscode.TreeItem {
  constructor(message: string, isError = false, idContext?: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.contextValue = isError ? 'error' : 'info';
    this.iconPath = new vscode.ThemeIcon(isError ? 'error' : 'info');
    this.id = ['remote-message', isError ? 'error' : 'info', idContext ?? '', message].map(treeIdPart).join('/');
  }
}

export type RemoteRepositoryTreeElement =
  | RemoteRepositoryInstanceItem
  | RemoteRepositoryBrowseItem
  | RemoteRepositoryItem
  | RemoteRepositoryDirectoryItem
  | RemoteRepositoryFileItem
  | RemoteRepositoryMessageItem;

export class RemoteRepositoryTreeProvider implements vscode.TreeDataProvider<RemoteRepositoryTreeElement> {
  private _onDidChangeTreeData = new vscode.EventEmitter<RemoteRepositoryTreeElement | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private selectionsByInstance = new Map<string, RemoteRepositorySelection[]>();

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: RemoteRepositoryTreeElement): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: RemoteRepositoryTreeElement): Promise<RemoteRepositoryTreeElement[]> {
    if (!element) {
      const instances = await getAllInstances();
      if (instances.length === 0) {
        return [new RemoteRepositoryMessageItem('No Forgejo instance configured. Add an instance to browse remote repositories.', true)];
      }
      return instances.map(instance => new RemoteRepositoryInstanceItem(instance));
    }

    if (element instanceof RemoteRepositoryInstanceItem) {
      const selections = this.selectionsByInstance.get(element.instance.id) ?? [];
      return [
        new RemoteRepositoryBrowseItem(element.instance),
        ...selections.map(selection => new RemoteRepositoryItem(selection))
      ];
    }

    if (element instanceof RemoteRepositoryItem) {
      return this.getDirectoryChildren(element.selection, '');
    }

    if (element instanceof RemoteRepositoryDirectoryItem) {
      return this.getDirectoryChildren(element.selection, element.path);
    }

    return [];
  }

  async browseRepository(instanceItem?: RemoteRepositoryInstanceItem | RemoteRepositoryBrowseItem): Promise<RemoteRepositorySelection | undefined> {
    const instance = instanceItem instanceof RemoteRepositoryInstanceItem || instanceItem instanceof RemoteRepositoryBrowseItem
      ? instanceItem.instance
      : await this.pickInstance();
    if (!instance) {
      return undefined;
    }

    const repositoryInput = await vscode.window.showInputBox({
      title: 'Browse Remote Repository',
      prompt: 'Enter repository as owner/name',
      placeHolder: 'owner/repository'
    });
    if (!repositoryInput) {
      return undefined;
    }

    const repository = splitRepositoryInput(repositoryInput, instance.instanceUrl);
    if (!repository) {
      void vscode.window.showErrorMessage('Enter a repository as owner/name or a URL on the selected instance.');
      return undefined;
    }

    const client = this.createClient(instance);
    const firstBranchPage = await this.fetchBranchesPage(client, repository.owner, repository.repo);
    if (firstBranchPage.items.length === 0) {
      void vscode.window.showErrorMessage(`No branches found for ${repositoryLabel(repository.owner, repository.repo)}.`);
      return undefined;
    }

    const pickedBranch = await this.pickBranch(
      firstBranchPage,
      page => this.fetchBranchesPage(client, repository.owner, repository.repo, page)
    );
    if (!pickedBranch) {
      return undefined;
    }

    const selection: RemoteRepositorySelection = {
      instanceId: instance.id,
      instanceName: instance.name,
      instanceUrl: normalizeUrl(instance.instanceUrl),
      token: instance.token ?? '',
      owner: repository.owner,
      repo: repository.repo,
      branch: pickedBranch.name
    };
    this.upsertSelection(selection);
    this._onDidChangeTreeData.fire();
    return selection;
  }

  async selectBranch(repositoryItem: RemoteRepositoryItem): Promise<void> {
    const instance = await this.instanceForSelection(repositoryItem.selection);
    if (!instance) {
      void vscode.window.showErrorMessage('Forgejo instance not found for this remote repository.');
      return;
    }

    const client = this.createClient(instance);
    const firstBranchPage = await this.fetchBranchesPage(client, repositoryItem.selection.owner, repositoryItem.selection.repo);
    const pickedBranch = await this.pickBranch(
      firstBranchPage,
      page => this.fetchBranchesPage(client, repositoryItem.selection.owner, repositoryItem.selection.repo, page),
      repositoryItem.selection.branch
    );
    if (!pickedBranch || pickedBranch.name === repositoryItem.selection.branch) {
      return;
    }

    this.upsertSelection({
      ...repositoryItem.selection,
      branch: pickedBranch.name
    });
    this._onDidChangeTreeData.fire();
  }

  private async pickInstance(): Promise<ForgejoInstance | undefined> {
    const instances = await getAllInstances();
    if (instances.length === 0) {
      void vscode.window.showErrorMessage('No Forgejo instance configured.');
      return undefined;
    }
    if (instances.length === 1) {
      return instances[0];
    }

    const picked = await vscode.window.showQuickPick(
      instances.map(instance => ({
        label: instance.name,
        description: normalizeUrl(instance.instanceUrl),
        instance
      })),
      { title: 'Select Forgejo Instance' }
    );
    return picked?.instance;
  }

  private async instanceForSelection(selection: RemoteRepositorySelection): Promise<ForgejoInstance | undefined> {
    const instances = await getAllInstances();
    return instances.find(instance => instance.id === selection.instanceId)
      ?? instances.find(instance => normalizeUrl(instance.instanceUrl) === selection.instanceUrl);
  }

  private createClient(instance: ForgejoInstance): ForgejoClient {
    return new ForgejoClient(normalizeUrl(instance.instanceUrl), instance.token ?? '');
  }

  private async fetchBranchesPage(client: ForgejoClient, owner: string, repo: string, page = 1): Promise<BranchPage> {
    const branchPage = await client.listBranchesPage(owner, repo, { page, limit: REMOTE_DIRECTORY_PAGE_SIZE });
    return {
      items: branchPage.items,
      page: branchPage.page,
      hasMore: branchPage.hasMore
    };
  }

  private async pickBranch(
    firstPage: BranchPage,
    fetchPage: (page: number) => Promise<BranchPage>,
    currentBranch?: string
  ): Promise<RepositoryBranch | undefined> {
    const branchPages: RepositoryBranch[][] = [];
    const seenBranches = new Set<string>();
    let hasMore = firstPage.hasMore;
    let nextPage = firstPage.page + 1;
    let currentPageIndex = 0;

    const addBranches = (page: BranchPage): void => {
      const pageBranches: RepositoryBranch[] = [];
      for (const branch of page.items) {
        if (!seenBranches.has(branch.name)) {
          seenBranches.add(branch.name);
          pageBranches.push(branch);
        }
      }
      if (pageBranches.length > 0) {
        branchPages.push(pageBranches);
      }
    };

    addBranches(firstPage);

    while (branchPages.length > 0) {
      const visibleBranches = branchPages[currentPageIndex] ?? [];
      const items: BranchQuickPickItem[] = visibleBranches.map(branch => ({
        label: branch.name,
        description: branch.name === currentBranch ? 'current' : undefined,
        branch
      }));

      if (currentPageIndex > 0) {
        items.push({
          label: PREVIOUS_BRANCH_PAGE_LABEL,
          description: `Page ${currentPageIndex}`,
          previousPage: true,
          alwaysShow: true
        });
      }

      if (currentPageIndex < branchPages.length - 1) {
        items.push({
          label: NEXT_BRANCH_PAGE_LABEL,
          description: `Page ${currentPageIndex + 2}`,
          nextPage: true,
          alwaysShow: true
        });
      } else if (hasMore) {
        items.push({
          label: LOAD_MORE_BRANCHES_LABEL,
          description: `Page ${currentPageIndex + 2}`,
          loadMore: true,
          alwaysShow: true
        });
      }

      const picked = await vscode.window.showQuickPick(items, {
        title: 'Select Branch',
        matchOnDescription: true
      });

      if (!picked) {
        return undefined;
      }

      if (picked.previousPage) {
        currentPageIndex -= 1;
        continue;
      }

      if (picked.nextPage) {
        currentPageIndex += 1;
        continue;
      }

      if (picked.loadMore) {
        const previousPageCount = branchPages.length;
        const page = await fetchPage(nextPage);
        addBranches(page);
        hasMore = page.hasMore;
        nextPage = page.page + 1;
        if (branchPages.length > previousPageCount) {
          currentPageIndex = branchPages.length - 1;
        }
        continue;
      }

      return picked.branch;
    }

    return undefined;
  }

  private upsertSelection(selection: RemoteRepositorySelection): void {
    const selections = this.selectionsByInstance.get(selection.instanceId) ?? [];
    const key = repositoryKey(selection.instanceUrl, selection.owner, selection.repo);
    const index = selections.findIndex(item => repositoryKey(item.instanceUrl, item.owner, item.repo) === key);
    if (index === -1) {
      selections.push(selection);
    } else {
      selections[index] = selection;
    }
    this.selectionsByInstance.set(selection.instanceId, selections);
  }

  private async getDirectoryChildren(selection: RemoteRepositorySelection, path: string): Promise<RemoteRepositoryTreeElement[]> {
    try {
      const client = new ForgejoClient(selection.instanceUrl, selection.token ?? '');
      const contents = await client.getRepositoryContents(
        selection.owner,
        selection.repo,
        path,
        {
          ref: selection.branch,
          page: 1,
          limit: REMOTE_DIRECTORY_PAGE_SIZE
        }
      );
      if (!Array.isArray(contents)) {
        return [new RemoteRepositoryMessageItem('Remote path is not a directory.', true, path)];
      }

      const hasMore = contents.length >= REMOTE_DIRECTORY_PAGE_SIZE
        && await this.hasMoreDirectoryEntries(client, selection, path);
      const entries = sortEntries(contents).slice(0, REMOTE_DIRECTORY_PAGE_SIZE);
      if (entries.length === 0) {
        return [new RemoteRepositoryMessageItem('No files found', false, path)];
      }

      const children: RemoteRepositoryTreeElement[] = entries.map(entry => {
        if (entry.type === 'dir') {
          return new RemoteRepositoryDirectoryItem(selection, entry.path);
        }
        return new RemoteRepositoryFileItem(selection, entry);
      });

      if (hasMore) {
        children.push(new RemoteRepositoryMessageItem(`Showing first ${REMOTE_DIRECTORY_PAGE_SIZE} entries`, false, path));
      }

      return children;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch remote repository contents';
      return [new RemoteRepositoryMessageItem(message, true, path)];
    }
  }

  private async hasMoreDirectoryEntries(client: ForgejoClient, selection: RemoteRepositorySelection, path: string): Promise<boolean> {
    const nextPage = await client.getRepositoryContents(
      selection.owner,
      selection.repo,
      path,
      {
        ref: selection.branch,
        page: 2,
        limit: 1
      }
    );
    return Array.isArray(nextPage) && nextPage.length > 0;
  }
}

export async function openRemoteFile(item?: RemoteRepositoryFileItem): Promise<void> {
  if (!item) {
    void vscode.window.showInformationMessage('Select a remote file from the Forgejo Repositories view to open it.');
    return;
  }

  const uri = createRemoteFileUri(
    item.selection.instanceUrl,
    item.selection.owner,
    item.selection.repo,
    item.selection.branch,
    item.entry.path
  );
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document, { preview: true });
}
