import * as vscode from 'vscode';
import { ForgejoClient } from '../api/forgejoClient';
import { PullRequestListItem, PullRequestFile } from '../models/pullRequest';
import { getForgejoConfig } from '../utils/config';

export class PRTreeItem extends vscode.TreeItem {
  public files?: PullRequestFile[];
  public filesError?: string;
  public baseRef?: string;
  public headRef?: string;

  constructor(
    public readonly pr: PullRequestListItem,
    public readonly htmlUrl: string,
    public readonly owner: string,
    public readonly repo: string
  ) {
    super(`#${pr.number}: ${pr.title}`, vscode.TreeItemCollapsibleState.Collapsed);

    this.tooltip = `${pr.title}\nby ${pr.user.login}\nState: ${pr.state}${pr.merged ? ' (merged)' : ''}${pr.draft ? ' (draft)' : ''}`;
    this.description = `by ${pr.user.login}`;
    this.contextValue = 'pullRequest';

    // Set icon based on state
    if (pr.merged) {
      this.iconPath = new vscode.ThemeIcon('git-merge', new vscode.ThemeColor('gitDecoration.addedResourceForeground'));
    } else if (pr.draft) {
      this.iconPath = new vscode.ThemeIcon('git-pull-request-draft');
    } else if (pr.state === 'closed') {
      this.iconPath = new vscode.ThemeIcon('git-pull-request-closed', new vscode.ThemeColor('gitDecoration.deletedResourceForeground'));
    } else {
      this.iconPath = new vscode.ThemeIcon('git-pull-request', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'));
    }

    // Remove command - expand/collapse instead of opening browser
    // Users can right-click to open in browser via context menu
    this.command = undefined;
  }
}

type PRGroupKind = 'open' | 'draft' | 'merged' | 'closed';

class PRGroupItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly kind: PRGroupKind,
    public readonly pullRequests: PullRequestListItem[] | null
  ) {
    const collapsibleState = kind === 'closed' || kind === 'merged'
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.Expanded;
    super(label, collapsibleState);
    this.description = pullRequests ? `${pullRequests.length}` : undefined;
    this.contextValue = 'prGroup';
  }
}

class PRMessageItem extends vscode.TreeItem {
  constructor(
    public readonly message: string,
    public readonly isError = false
  ) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(isError ? 'error' : 'info');
    this.contextValue = isError ? 'error' : 'info';
  }
}

/**
 * Represents a file changed in a PR
 */
export class PRFileItem extends vscode.TreeItem {
  constructor(
    public readonly file: PullRequestFile,
    public readonly pr: PullRequestListItem,
    public readonly owner: string,
    public readonly repo: string,
    public readonly baseRef: string,
    public readonly headRef: string
  ) {
    super(file.filename, vscode.TreeItemCollapsibleState.None);

    this.description = `+${file.additions} -${file.deletions}`;
    this.tooltip = `${file.filename}\nStatus: ${file.status}\n+${file.additions} -${file.deletions}`;
    this.contextValue = 'prFile';

    // Set icon based on file status
    switch (file.status) {
      case 'added':
        this.iconPath = new vscode.ThemeIcon('diff-added', new vscode.ThemeColor('gitDecoration.addedResourceForeground'));
        break;
      case 'removed':
        this.iconPath = new vscode.ThemeIcon('diff-removed', new vscode.ThemeColor('gitDecoration.deletedResourceForeground'));
        break;
      case 'modified':
      case 'changed':
        this.iconPath = new vscode.ThemeIcon('diff-modified', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'));
        break;
      case 'renamed':
        this.iconPath = new vscode.ThemeIcon('diff-renamed', new vscode.ThemeColor('gitDecoration.renamedResourceForeground'));
        break;
      default:
        this.iconPath = new vscode.ThemeIcon('file');
    }

    // Command to open diff view
    this.command = {
      command: 'forgejo.showPrFileDiff',
      title: 'Show Diff',
      arguments: [this.file, this.pr, this.owner, this.repo, this.baseRef, this.headRef]
    };
  }
}

/**
 * Loading indicator item
 */
class PRLoadingItem extends vscode.TreeItem {
  constructor() {
    super('Loading files...', vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('loading~spin');
    this.contextValue = 'loading';
  }
}

/**
 * Overview item for PR details
 */
export class PROverviewItem extends vscode.TreeItem {
  constructor(
    public readonly pr: PullRequestListItem,
    public readonly owner: string,
    public readonly repo: string
  ) {
    super('Overview', vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('info');
    this.contextValue = 'prOverview';
    this.command = {
      command: 'forgejo.showPrDetails',
      title: 'Show PR Details',
      arguments: [pr, owner, repo]
    };
  }
}

type PRTreeElement = PRTreeItem | PRGroupItem | PRMessageItem | PRFileItem | PRLoadingItem | PROverviewItem;

export class PRTreeProvider implements vscode.TreeDataProvider<PRTreeElement> {
  private _onDidChangeTreeData: vscode.EventEmitter<PRTreeElement | undefined | null | void> = new vscode.EventEmitter<PRTreeElement | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<PRTreeElement | undefined | null | void> = this._onDidChangeTreeData.event;

  private pullRequests: PullRequestListItem[] = [];
  private closedPullRequests: PullRequestListItem[] | null = null;
  private closedPullRequestsPromise: Promise<PullRequestListItem[]> | null = null;
  private closedPullRequestCount: number | null = null;
  private error: string | null = null;

  constructor() {
    this.refresh();
  }

  refresh(): void {
    this.closedPullRequests = null;
    this.closedPullRequestsPromise = null;
    this.closedPullRequestCount = null;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: PRTreeElement): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: PRTreeElement): Promise<PRTreeElement[]> {
    if (!element) {
      // Root level - fetch PRs and group them
      try {
        await this.fetchOpenPullRequests();

        if (this.error) {
          console.error('Forgejo PR fetch error:', this.error);
          return [new PRMessageItem(this.error, true)];
        }

        // Group open-state PRs immediately. Historical closed-state PRs are
        // loaded only when users expand Merged or Closed, which avoids fetching
        // thousands of PRs on initial view load.
        const openPRs = this.pullRequests.filter(pr => pr.state === 'open' && !pr.draft);
        const draftPRs = this.pullRequests.filter(pr => pr.draft);

        const groups: PRGroupItem[] = [];

        if (openPRs.length > 0) {
          groups.push(new PRGroupItem('Open', 'open', openPRs));
        }
        if (draftPRs.length > 0) {
          groups.push(new PRGroupItem('Draft', 'draft', draftPRs));
        }

        const closedPullRequestCount = await this.fetchClosedPullRequestCount();
        if (closedPullRequestCount === null || closedPullRequestCount > 0) {
          groups.push(new PRGroupItem('Merged', 'merged', null));
          groups.push(new PRGroupItem('Closed', 'closed', null));
        }

        if (groups.length === 0) {
          return [new PRMessageItem('No pull requests found', false)];
        }

        return groups;
      } catch (error) {
        this.error = error instanceof Error ? error.message : 'Unknown error';
        return [new PRMessageItem(this.error, true)];
      }
    } else if (element instanceof PRGroupItem) {
      // Show PRs in this group. Closed-state groups lazy-load on expansion.
      const config = await getForgejoConfig();
      if (!config) {
        return [];
      }

      try {
        const pullRequests = await this.getPullRequestsForGroup(element);
        element.description = `${pullRequests.length}`;
        this._onDidChangeTreeData.fire(element);
        if (pullRequests.length === 0) {
          return [new PRMessageItem(`No ${element.label.toLowerCase()} pull requests found`, false)];
        }
        return pullRequests.map(pr => new PRTreeItem(pr, pr.html_url, config.owner, config.repo));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to fetch pull requests';
        return [new PRMessageItem(message, true)];
      }
    } else if (element instanceof PRTreeItem) {
      // Fetch and show files for this PR
      return this.getPRFiles(element);
    } else if (element instanceof PRMessageItem || element instanceof PRLoadingItem) {
      // Message items have no children
      return [];
    }

    return [];
  }

  /**
   * Fetch files for a PR (lazy loading with caching)
   */
  private async getPRFiles(prItem: PRTreeItem): Promise<PRTreeElement[]> {
    // Create overview item (always shown first)
    const overviewItem = new PROverviewItem(prItem.pr, prItem.owner, prItem.repo);

    // Return cached files if available
    if (prItem.files && prItem.baseRef && prItem.headRef) {
      const baseRef = prItem.baseRef;
      const headRef = prItem.headRef;
      const fileItems = prItem.files.map(file =>
        new PRFileItem(file, prItem.pr, prItem.owner, prItem.repo, baseRef, headRef)
      );
      return [overviewItem, ...fileItems];
    }

    // Return error if previous fetch failed
    if (prItem.filesError) {
      return [overviewItem, new PRMessageItem(prItem.filesError, true)];
    }

    // Fetch files from API
    try {
      const config = await getForgejoConfig();
      if (!config) {
        return [overviewItem, new PRMessageItem('Configuration not available', true)];
      }

      const client = new ForgejoClient(config.instanceUrl, config.token);
      console.log(`[Forgejo] Fetching files for PR #${prItem.pr.number}...`);

      // Fetch both files and PR details (for refs)
      const [files, refs] = await Promise.all([
        client.getPullRequestFiles(prItem.owner, prItem.repo, prItem.pr.number),
        client.getPullRequestRefs(prItem.owner, prItem.repo, prItem.pr.number)
      ]);

      // Cache the results
      prItem.files = files;
      prItem.baseRef = refs.base;
      prItem.headRef = refs.head;

      console.log(`[Forgejo] Fetched ${files.length} files for PR #${prItem.pr.number}`);

      if (files.length === 0) {
        return [overviewItem, new PRMessageItem('No files changed', false)];
      }

      // Sort files: added, modified, renamed, removed
      const statusOrder: Record<string, number> = { added: 0, modified: 1, changed: 1, renamed: 2, removed: 3 };
      const getStatusPriority = (status: string): number => statusOrder[status] ?? 99;
      const sortedFiles = files.sort((a, b) => getStatusPriority(a.status) - getStatusPriority(b.status));

      const fileItems = sortedFiles.map(file =>
        new PRFileItem(file, prItem.pr, prItem.owner, prItem.repo, refs.base, refs.head)
      );
      return [overviewItem, ...fileItems];
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to fetch files';
      prItem.filesError = errorMsg;
      console.error(`[Forgejo] Error fetching files for PR #${prItem.pr.number}:`, error);
      return [overviewItem, new PRMessageItem(errorMsg, true)];
    }
  }

  private async getPullRequestsForGroup(group: PRGroupItem): Promise<PullRequestListItem[]> {
    if (group.pullRequests) {
      return group.pullRequests;
    }

    const closedPullRequests = await this.fetchClosedPullRequests();
    if (group.kind === 'merged') {
      return closedPullRequests.filter(pr => pr.merged);
    }
    if (group.kind === 'closed') {
      return closedPullRequests.filter(pr => !pr.merged);
    }

    return [];
  }

  private async fetchOpenPullRequests(): Promise<void> {
    console.log('[Forgejo] Fetching open pull requests...');
    const config = await getForgejoConfig();

    if (!config) {
      this.error = 'No Forgejo configuration found. Please configure instance URL or open a git repository.';
      this.pullRequests = [];
      console.warn('[Forgejo] No config found');
      return;
    }

    console.log('[Forgejo] Using config:', {
      instanceUrl: config.instanceUrl,
      owner: config.owner,
      repo: config.repo,
      hasToken: !!config.token
    });

    try {
      const client = new ForgejoClient(config.instanceUrl, config.token);
      this.pullRequests = await client.getPullRequests(config.owner, config.repo, 'open');
      this.error = null;
      console.log(`[Forgejo] Fetched ${this.pullRequests.length} open pull requests`);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Failed to fetch pull requests';
      this.pullRequests = [];
      console.error('[Forgejo] Error fetching PRs:', error);
      throw error;
    }
  }

  private async fetchClosedPullRequests(): Promise<PullRequestListItem[]> {
    if (this.closedPullRequests) {
      return this.closedPullRequests;
    }
    if (this.closedPullRequestsPromise) {
      return this.closedPullRequestsPromise;
    }

    this.closedPullRequestsPromise = this.fetchClosedPullRequestsUncached();
    try {
      this.closedPullRequests = await this.closedPullRequestsPromise;
      return this.closedPullRequests;
    } finally {
      this.closedPullRequestsPromise = null;
    }
  }

  private async fetchClosedPullRequestsUncached(): Promise<PullRequestListItem[]> {
    console.log('[Forgejo] Fetching closed pull requests...');
    const config = await getForgejoConfig();

    if (!config) {
      throw new Error('No Forgejo configuration found. Please configure instance URL or open a git repository.');
    }

    try {
      const client = new ForgejoClient(config.instanceUrl, config.token);
      const closedPullRequests = await client.getPullRequests(config.owner, config.repo, 'closed');
      console.log(`[Forgejo] Fetched ${closedPullRequests.length} closed pull requests`);
      return closedPullRequests;
    } catch (error) {
      console.error('[Forgejo] Error fetching closed PRs:', error);
      throw error;
    }
  }

  private async fetchClosedPullRequestCount(): Promise<number | null> {
    if (this.closedPullRequestCount !== null) {
      return this.closedPullRequestCount;
    }

    const config = await getForgejoConfig();
    if (!config) {
      return null;
    }

    try {
      const client = new ForgejoClient(config.instanceUrl, config.token);
      this.closedPullRequestCount = await client.getPullRequestCount(config.owner, config.repo, 'closed');
      return this.closedPullRequestCount;
    } catch (error) {
      console.warn('[Forgejo] Could not fetch closed PR count:', error);
      return null;
    }
  }
}
