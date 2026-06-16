import * as vscode from 'vscode';
import { ForgejoClient, IssuePage } from '../api/forgejoClient';
import { IssueListItem } from '../models/issue';
import { ForgejoConfig, ForgejoRepositoryConfig, getForgejoRepositoryConfigs } from '../utils/config';

const ISSUE_PAGE_SIZE = 50;

function treeIdPart(value: string | number | undefined): string {
  return encodeURIComponent(String(value ?? ''));
}

export class IssueTreeItem extends vscode.TreeItem {
  constructor(
    public readonly issue: IssueListItem,
    public readonly htmlUrl: string,
    public readonly owner: string,
    public readonly repo: string,
    public readonly instanceUrl?: string
  ) {
    super(`#${issue.number}: ${issue.title}`, vscode.TreeItemCollapsibleState.None);

    this.tooltip = `${issue.title}\nby ${issue.user.login}\nState: ${issue.state}\nComments: ${issue.comments}\n\nClick to view details`;
    this.description = `by ${issue.user.login}`;
    this.contextValue = 'issue';
    this.id = [
      'issue',
      instanceUrl ?? '',
      owner,
      repo,
      issue.number
    ].map(treeIdPart).join('/');

    if (issue.state === 'closed') {
      this.iconPath = new vscode.ThemeIcon('issue-closed', new vscode.ThemeColor('gitDecoration.deletedResourceForeground'));
    } else {
      this.iconPath = new vscode.ThemeIcon('issues', new vscode.ThemeColor('gitDecoration.addedResourceForeground'));
    }

    this.command = {
      command: 'forgejo.showIssueDetails',
      title: 'Show Issue Details',
      arguments: [issue, owner, repo, instanceUrl]
    };
  }
}

type IssueGroupKind = 'open' | 'closed';

export class IssueGroupItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly kind: IssueGroupKind
  ) {
    const collapsibleState = kind === 'closed'
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.Expanded;
    super(label, collapsibleState);
    this.contextValue = 'issueGroup';
  }
}

export class IssueLoadMoreItem extends vscode.TreeItem {
  constructor(
    public readonly group: IssueGroupItem,
    public readonly config: ForgejoConfig
  ) {
    super('Load more issues', vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('more');
    this.contextValue = 'issueLoadMore';
    this.id = [
      'issue-load-more',
      config.instanceUrl,
      config.owner,
      config.repo,
      group.kind
    ].map(treeIdPart).join('/');
    this.command = {
      command: 'forgejo.loadMoreIssues',
      title: 'Load More Issues',
      arguments: [this]
    };
  }
}

class IssueRepositoryItem extends vscode.TreeItem {
  constructor(public readonly config: ForgejoRepositoryConfig) {
    super(config.label, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = config.rootPath;
    this.tooltip = config.rootPath ? `${config.label}\n${config.rootPath}` : config.label;
    this.contextValue = 'forgejoRepository';
    this.iconPath = new vscode.ThemeIcon('repo');
    this.id = [
      'issue-repository',
      config.instanceUrl,
      config.owner,
      config.repo,
      config.rootPath ?? ''
    ].map(treeIdPart).join('/');
  }
}

class IssueMessageItem extends vscode.TreeItem {
  constructor(
    public readonly message: string,
    public readonly isError = false
  ) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(isError ? 'error' : 'info');
    this.contextValue = isError ? 'error' : 'info';
    this.id = `issue-message/${treeIdPart(isError ? 'error' : 'info')}/${treeIdPart(message)}`;
  }
}

type IssueTreeElement = IssueRepositoryItem | IssueTreeItem | IssueGroupItem | IssueMessageItem | IssueLoadMoreItem;
type IssueState = 'open' | 'closed';

interface IssuePageCache {
  issues: IssueListItem[];
  nextPage: number;
  hasMore: boolean;
  inFlightPagePromise?: Promise<IssuePageCache>;
}

export class IssueTreeProvider implements vscode.TreeDataProvider<IssueTreeElement> {
  private _onDidChangeTreeData: vscode.EventEmitter<IssueTreeElement | undefined | null | void> = new vscode.EventEmitter<IssueTreeElement | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<IssueTreeElement | undefined | null | void> = this._onDidChangeTreeData.event;

  private openIssuePages = new Map<string, IssuePageCache>();
  private closedIssuePages = new Map<string, IssuePageCache>();
  private error: string | null = null;

  constructor() {
    this.refresh();
  }

  refresh(): void {
    this.openIssuePages.clear();
    this.closedIssuePages.clear();
    this._onDidChangeTreeData.fire();
  }

  async loadMoreIssues(item: IssueLoadMoreItem): Promise<void> {
    try {
      await this.fetchNextIssuePage(item.config, item.group.kind);
      this._onDidChangeTreeData.fire();
      this._onDidChangeTreeData.fire(item.group);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load more issues';
      void vscode.window.showErrorMessage(message);
    }
  }

  getTreeItem(element: IssueTreeElement): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: IssueTreeElement): Promise<IssueTreeElement[]> {
    if (!element) {
      const configs = await getForgejoRepositoryConfigs();
      if (configs.length === 0) {
        return [new IssueMessageItem('No Forgejo configuration found. Please configure instance URL or open a git repository.', true)];
      }
      if (configs.length > 1) {
        return configs.map(config => new IssueRepositoryItem(config));
      }

      return this.getGroupsForConfig(configs[0]);
    } else if (element instanceof IssueRepositoryItem) {
      return this.getGroupsForConfig(element.config);
    } else if (element instanceof IssueGroupItem) {
      const config = (element as IssueGroupItem & { config?: ForgejoConfig }).config;
      if (!config) {
        return [];
      }

      const issues = await this.getIssuesForGroup(element, config);
      element.description = this.groupDescription(element, config, issues.length);
      const children: IssueTreeElement[] = issues.length === 0
        ? [new IssueMessageItem(`No ${element.label.toLowerCase()} issues found`, false)]
        : issues.map(issue =>
          new IssueTreeItem(issue, issue.html_url, config.owner, config.repo, config.instanceUrl)
        );
      if (this.canLoadMoreIssues(element, config)) {
        children.push(new IssueLoadMoreItem(element, config));
      }
      return children;
    } else if (element instanceof IssueMessageItem || element instanceof IssueLoadMoreItem) {
      return [];
    }

    return [];
  }

  private configKey(config: ForgejoConfig): string {
    return `${config.instanceUrl}/${config.owner}/${config.repo}`;
  }

  private groupId(config: ForgejoConfig, group: IssueGroupItem): string {
    return [
      'issue-group',
      config.instanceUrl,
      config.owner,
      config.repo,
      group.kind
    ].map(treeIdPart).join('/');
  }

  private async getGroupsForConfig(config: ForgejoConfig): Promise<IssueTreeElement[]> {
    try {
      const [openCache, closedCache] = await Promise.all([
        this.ensureIssuePage(config, 'open'),
        this.ensureIssuePage(config, 'closed')
      ]);
      const groups: IssueGroupItem[] = [];
      const attachConfig = (group: IssueGroupItem): IssueGroupItem => {
        group.id = this.groupId(config, group);
        return Object.assign(group, { config });
      };

      if (openCache.issues.length > 0 || openCache.hasMore) {
        const group = attachConfig(new IssueGroupItem('Open', 'open'));
        group.description = this.groupDescription(group, config, openCache.issues.length);
        groups.push(group);
      }
      if (closedCache.issues.length > 0 || closedCache.hasMore) {
        const group = attachConfig(new IssueGroupItem('Closed', 'closed'));
        group.description = this.groupDescription(group, config, closedCache.issues.length);
        groups.push(group);
      }

      if (groups.length === 0) {
        return [new IssueMessageItem('No issues found', false)];
      }

      return groups;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Unknown error';
      return [new IssueMessageItem(this.error, true)];
    }
  }

  private async getIssuesForGroup(group: IssueGroupItem, config: ForgejoConfig): Promise<IssueListItem[]> {
    return (await this.ensureIssuePage(config, group.kind)).issues;
  }

  private groupDescription(group: IssueGroupItem, config: ForgejoConfig, count: number): string {
    return this.canLoadMoreIssues(group, config) ? `${count}+` : `${count}`;
  }

  private canLoadMoreIssues(group: IssueGroupItem, config: ForgejoConfig): boolean {
    return this.getIssueCache(config, group.kind).hasMore;
  }

  private getIssueCache(config: ForgejoConfig, state: IssueState): IssuePageCache {
    const key = this.configKey(config);
    const cacheMap = state === 'open' ? this.openIssuePages : this.closedIssuePages;
    const cached = cacheMap.get(key);
    if (cached) {
      return cached;
    }

    const created: IssuePageCache = {
      issues: [],
      nextPage: 1,
      hasMore: true
    };
    cacheMap.set(key, created);
    return created;
  }

  private async ensureIssuePage(config: ForgejoConfig, state: IssueState): Promise<IssuePageCache> {
    const cache = this.getIssueCache(config, state);
    if (cache.issues.length > 0 || !cache.hasMore) {
      return cache;
    }

    return this.fetchNextIssuePage(config, state);
  }

  private async fetchNextIssuePage(config: ForgejoConfig, state: IssueState): Promise<IssuePageCache> {
    const cache = this.getIssueCache(config, state);
    if (!cache.hasMore) {
      return cache;
    }
    if (cache.inFlightPagePromise) {
      return cache.inFlightPagePromise;
    }

    const promise = this.fetchIssuesPageUncached(config, state, cache.nextPage).then(page => {
      cache.issues.push(...page.items);
      cache.nextPage = page.page + 1;
      cache.hasMore = page.hasMore;
      return cache;
    });
    cache.inFlightPagePromise = promise;
    try {
      return await promise;
    } finally {
      cache.inFlightPagePromise = undefined;
    }
  }

  private async fetchIssuesPageUncached(config: ForgejoConfig, state: IssueState, page: number): Promise<IssuePage> {
    console.log(`[Forgejo] Fetching ${state} issues page ${page}...`);
    try {
      const client = new ForgejoClient(config.instanceUrl, config.token);
      const issues = await client.getIssuesPage(config.owner, config.repo, state, page, ISSUE_PAGE_SIZE);
      this.error = null;
      console.log(`[Forgejo] Fetched ${issues.items.length} ${state} issues from page ${page}`);
      return issues;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Failed to fetch issues';
      console.error(`[Forgejo] Error fetching ${state} issues page ${page}:`, error);
      throw error;
    }
  }
}
