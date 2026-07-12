import * as vscode from 'vscode';
import { ForgejoClient, ForgejoItemQueryOptions, IssuePage, PullRequestPage } from '../api/forgejoClient';
import { PullRequestListItemWithMergeability } from '../models/pullRequest';
import { IssueListItem } from '../models/issue';
import { ForgejoConfig, ForgejoRepositoryConfig, getForgejoRepositoryConfigs } from '../utils/config';
import { IssueTreeItem } from './issueTreeProvider';
import { getPullRequestPresentation } from './pullRequestPresentation';
import { getSavedQueryGroups, isBuiltinSavedQuery, SavedQueryGroup } from '../utils/savedQueries';

const SAVED_QUERY_PAGE_SIZE = 50;

type SavedQueryContentType = 'pullRequests' | 'issues';

function treeIdPart(value: string | number | undefined): string {
  return encodeURIComponent(String(value ?? ''));
}

export class SavedQueryGroupItem extends vscode.TreeItem {
  constructor(public readonly group: SavedQueryGroup) {
    super(group.label, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = isBuiltinSavedQuery(group) ? 'savedQueryBuiltinGroup' : 'savedQueryCustomGroup';
    this.iconPath = new vscode.ThemeIcon(isBuiltinSavedQuery(group) ? group.icon : 'search');
    this.tooltip = isBuiltinSavedQuery(group) ? group.label : `${group.label}\nQuery: ${group.query}`;
    this.id = ['saved-query-group', group.id].map(treeIdPart).join('/');
  }
}

export class SavedQueryRepositoryItem extends vscode.TreeItem {
  constructor(
    public readonly group: SavedQueryGroup,
    public readonly config: ForgejoRepositoryConfig
  ) {
    super(config.label, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = config.rootPath;
    this.tooltip = config.rootPath ? `${config.label}\n${config.rootPath}` : config.label;
    this.contextValue = 'savedQueryRepository';
    this.iconPath = new vscode.ThemeIcon('repo');
    this.id = ['saved-query-repository', group.id, config.instanceUrl, config.owner, config.repo].map(treeIdPart).join('/');
  }
}

export class SavedQuerySectionItem extends vscode.TreeItem {
  constructor(
    public readonly group: SavedQueryGroup,
    public readonly config: ForgejoConfig,
    public readonly contentType: SavedQueryContentType
  ) {
    super(contentType === 'pullRequests' ? 'Pull Requests' : 'Issues', vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'savedQuerySection';
    this.iconPath = new vscode.ThemeIcon(contentType === 'pullRequests' ? 'git-pull-request' : 'issues');
    this.id = ['saved-query-section', group.id, config.instanceUrl, config.owner, config.repo, contentType].map(treeIdPart).join('/');
  }
}

export class SavedQueryLoadMoreItem extends vscode.TreeItem {
  constructor(
    public readonly group: SavedQueryGroup,
    public readonly config: ForgejoConfig,
    public readonly contentType: SavedQueryContentType
  ) {
    super(contentType === 'pullRequests' ? 'Load more pull requests' : 'Load more issues', vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('more');
    this.contextValue = 'savedQueryLoadMore';
    this.id = ['saved-query-load-more', group.id, config.instanceUrl, config.owner, config.repo, contentType].map(treeIdPart).join('/');
    this.command = {
      command: 'forgejo.loadMoreSavedQuery',
      title: 'Load More',
      arguments: [this]
    };
  }
}

class SavedQueryMessageItem extends vscode.TreeItem {
  constructor(
    public readonly message: string,
    public readonly isError = false,
    public readonly idContext?: string
  ) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(isError ? 'error' : 'info');
    this.contextValue = isError ? 'error' : 'info';
    this.id = ['saved-query-message', isError ? 'error' : 'info', idContext ?? '', message].map(treeIdPart).join('/');
  }
}

/**
 * Leaf row for a pull request inside the saved-query dashboard. Deliberately
 * lighter than prTreeProvider's `PRTreeItem`: the dashboard is a triage view,
 * not a second place to browse PR file diffs, so this opens the PR detail
 * webview directly instead of expanding to a file list.
 */
export class SavedQueryPullRequestItem extends vscode.TreeItem {
  constructor(
    public readonly pr: PullRequestListItemWithMergeability,
    public readonly owner: string,
    public readonly repo: string,
    public readonly instanceUrl: string | undefined,
    public readonly treeContext: string
  ) {
    super(`#${pr.number}: ${pr.title}`, vscode.TreeItemCollapsibleState.None);

    const presentation = getPullRequestPresentation(pr);
    this.tooltip = presentation.tooltip;
    this.description = presentation.description;
    this.iconPath = presentation.iconPath;
    this.contextValue = 'savedQueryPullRequest';
    this.id = ['saved-query-pr', instanceUrl ?? '', owner, repo, treeContext, pr.number].map(treeIdPart).join('/');

    this.command = {
      command: 'forgejo.showPrDetails',
      title: 'Show PR Details',
      arguments: [pr, owner, repo, instanceUrl]
    };
  }
}

type SavedQueryTreeElement =
  | SavedQueryGroupItem
  | SavedQueryRepositoryItem
  | SavedQuerySectionItem
  | SavedQueryPullRequestItem
  | IssueTreeItem
  | SavedQueryMessageItem
  | SavedQueryLoadMoreItem;

interface PullRequestPageCache {
  pullRequests: PullRequestListItemWithMergeability[];
  nextPage: number;
  hasMore: boolean;
  inFlightPagePromise?: Promise<PullRequestPageCache>;
}

interface IssuePageCache {
  issues: IssueListItem[];
  nextPage: number;
  hasMore: boolean;
  inFlightPagePromise?: Promise<IssuePageCache>;
}

export class SavedQueryTreeProvider implements vscode.TreeDataProvider<SavedQueryTreeElement> {
  private _onDidChangeTreeData: vscode.EventEmitter<SavedQueryTreeElement | undefined | null | void> = new vscode.EventEmitter<SavedQueryTreeElement | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<SavedQueryTreeElement | undefined | null | void> = this._onDidChangeTreeData.event;

  private prPages = new Map<string, PullRequestPageCache>();
  private issuePages = new Map<string, IssuePageCache>();
  private currentUserLogins = new Map<string, Promise<string | null>>();

  constructor() {
    this.refresh();
  }

  refresh(): void {
    this.prPages.clear();
    this.issuePages.clear();
    this.currentUserLogins.clear();
    this._onDidChangeTreeData.fire();
  }

  async loadMoreSavedQuery(item: SavedQueryLoadMoreItem): Promise<void> {
    try {
      if (item.contentType === 'pullRequests') {
        await this.fetchNextPRPage(item.group, item.config);
      } else {
        await this.fetchNextIssuePage(item.group, item.config);
      }
      this._onDidChangeTreeData.fire();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load more results';
      void vscode.window.showErrorMessage(message);
    }
  }

  getTreeItem(element: SavedQueryTreeElement): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: SavedQueryTreeElement): Promise<SavedQueryTreeElement[]> {
    if (!element) {
      // Synchronous and network-free: groups start collapsed, so nothing is
      // fetched until a group/repository/section actually expands.
      return getSavedQueryGroups().map(group => new SavedQueryGroupItem(group));
    }

    if (element instanceof SavedQueryGroupItem) {
      return this.getRepositoriesOrContent(element.group);
    }

    if (element instanceof SavedQueryRepositoryItem) {
      return this.getContentForConfig(element.group, element.config);
    }

    if (element instanceof SavedQuerySectionItem) {
      return this.getItemsForSection(element.group, element.config, element.contentType);
    }

    return [];
  }

  private async getRepositoriesOrContent(group: SavedQueryGroup): Promise<SavedQueryTreeElement[]> {
    const configs = await getForgejoRepositoryConfigs();
    void vscode.commands.executeCommand('setContext', 'forgejo.multipleRepositories', configs.length > 1);
    if (configs.length === 0) {
      return [new SavedQueryMessageItem('No Forgejo configuration found. Please configure instance URL or open a git repository.', true, group.id)];
    }
    if (configs.length > 1) {
      return configs.map(config => new SavedQueryRepositoryItem(group, config));
    }

    return this.getContentForConfig(group, configs[0]);
  }

  private getContentForConfig(group: SavedQueryGroup, config: ForgejoConfig): SavedQueryTreeElement[] {
    if (group.target === 'both') {
      return [
        new SavedQuerySectionItem(group, config, 'pullRequests'),
        new SavedQuerySectionItem(group, config, 'issues')
      ];
    }

    return [new SavedQuerySectionItem(group, config, group.target)];
  }

  private async getItemsForSection(
    group: SavedQueryGroup,
    config: ForgejoConfig,
    contentType: SavedQueryContentType
  ): Promise<SavedQueryTreeElement[]> {
    const idContext = `${group.id}/${config.instanceUrl}/${config.owner}/${config.repo}/${contentType}`;

    try {
      if (this.groupRequiresAuth(group)) {
        const login = await this.getCurrentUserLogin(config);
        if (!login) {
          return [new SavedQueryMessageItem('Configure an authentication token to use this saved query.', false, idContext)];
        }
      }

      if (contentType === 'pullRequests') {
        const cache = await this.ensurePRPage(group, config);
        const children: SavedQueryTreeElement[] = cache.pullRequests.map(pr =>
          new SavedQueryPullRequestItem(pr, config.owner, config.repo, config.instanceUrl, group.id)
        );
        if (children.length === 0 && !cache.hasMore) {
          return [new SavedQueryMessageItem(`No ${this.emptyLabel(group)} pull requests found`, false, idContext)];
        }
        if (cache.hasMore) {
          children.push(new SavedQueryLoadMoreItem(group, config, contentType));
        }
        return children;
      }

      const cache = await this.ensureIssuePage(group, config);
      const children: SavedQueryTreeElement[] = cache.issues.map(issue =>
        new IssueTreeItem(issue, issue.html_url, config.owner, config.repo, config.instanceUrl, group.id, config)
      );
      if (children.length === 0 && !cache.hasMore) {
        return [new SavedQueryMessageItem(`No ${this.emptyLabel(group)} issues found`, false, idContext)];
      }
      if (cache.hasMore) {
        children.push(new SavedQueryLoadMoreItem(group, config, contentType));
      }
      return children;
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : `Failed to fetch ${contentType === 'pullRequests' ? 'pull requests' : 'issues'}`;
      return [new SavedQueryMessageItem(message, true, idContext)];
    }
  }

  private groupRequiresAuth(group: SavedQueryGroup): boolean {
    return isBuiltinSavedQuery(group) ? group.requiresAuth : false;
  }

  private emptyLabel(group: SavedQueryGroup): string {
    return isBuiltinSavedQuery(group) ? group.emptyLabel : group.label.toLowerCase();
  }

  private cacheKey(group: SavedQueryGroup, config: ForgejoConfig): string {
    return `${group.id}::${config.instanceUrl}/${config.owner}/${config.repo}`;
  }

  private getPRCache(group: SavedQueryGroup, config: ForgejoConfig): PullRequestPageCache {
    const key = this.cacheKey(group, config);
    const cached = this.prPages.get(key);
    if (cached) {
      return cached;
    }

    const created: PullRequestPageCache = { pullRequests: [], nextPage: 1, hasMore: true };
    this.prPages.set(key, created);
    return created;
  }

  private getIssueCache(group: SavedQueryGroup, config: ForgejoConfig): IssuePageCache {
    const key = this.cacheKey(group, config);
    const cached = this.issuePages.get(key);
    if (cached) {
      return cached;
    }

    const created: IssuePageCache = { issues: [], nextPage: 1, hasMore: true };
    this.issuePages.set(key, created);
    return created;
  }

  private async ensurePRPage(group: SavedQueryGroup, config: ForgejoConfig): Promise<PullRequestPageCache> {
    const cache = this.getPRCache(group, config);
    if (cache.pullRequests.length > 0 || !cache.hasMore) {
      return cache;
    }

    return this.fetchNextPRPage(group, config);
  }

  private async fetchNextPRPage(group: SavedQueryGroup, config: ForgejoConfig): Promise<PullRequestPageCache> {
    const cache = this.getPRCache(group, config);
    if (!cache.hasMore) {
      return cache;
    }
    if (cache.inFlightPagePromise) {
      return cache.inFlightPagePromise;
    }

    const promise = this.fetchPRPageUncached(group, config, cache.nextPage).then(page => {
      this.appendUniquePullRequests(cache, page.items);
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

  private appendUniquePullRequests(cache: PullRequestPageCache, pullRequests: PullRequestListItemWithMergeability[]): void {
    const seenNumbers = new Set(cache.pullRequests.map(pr => pr.number));
    for (const pullRequest of pullRequests) {
      if (seenNumbers.has(pullRequest.number)) {
        continue;
      }
      seenNumbers.add(pullRequest.number);
      cache.pullRequests.push(pullRequest);
    }
  }

  private async fetchPRPageUncached(group: SavedQueryGroup, config: ForgejoConfig, page: number): Promise<PullRequestPage> {
    console.log(`[Forgejo] Fetching saved query "${group.label}" pull requests page ${page} for ${config.owner}/${config.repo}...`);
    const client = new ForgejoClient(config.instanceUrl, config.token);
    const queryOptions = await this.buildQueryOptions(group, config);
    const result = await client.getPullRequestsPage(config.owner, config.repo, 'open', page, SAVED_QUERY_PAGE_SIZE, queryOptions);
    console.log(`[Forgejo] Fetched ${result.items.length} pull requests for saved query "${group.label}" page ${page}`);
    return result;
  }

  private async ensureIssuePage(group: SavedQueryGroup, config: ForgejoConfig): Promise<IssuePageCache> {
    const cache = this.getIssueCache(group, config);
    if (cache.issues.length > 0 || !cache.hasMore) {
      return cache;
    }

    return this.fetchNextIssuePage(group, config);
  }

  private async fetchNextIssuePage(group: SavedQueryGroup, config: ForgejoConfig): Promise<IssuePageCache> {
    const cache = this.getIssueCache(group, config);
    if (!cache.hasMore) {
      return cache;
    }
    if (cache.inFlightPagePromise) {
      return cache.inFlightPagePromise;
    }

    const promise = this.fetchIssuePageUncached(group, config, cache.nextPage).then(page => {
      this.appendUniqueIssues(cache, page.items);
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

  private appendUniqueIssues(cache: IssuePageCache, issues: IssueListItem[]): void {
    const seenNumbers = new Set(cache.issues.map(issue => issue.number));
    for (const issue of issues) {
      if (seenNumbers.has(issue.number)) {
        continue;
      }
      seenNumbers.add(issue.number);
      cache.issues.push(issue);
    }
  }

  private async fetchIssuePageUncached(group: SavedQueryGroup, config: ForgejoConfig, page: number): Promise<IssuePage> {
    console.log(`[Forgejo] Fetching saved query "${group.label}" issues page ${page} for ${config.owner}/${config.repo}...`);
    const client = new ForgejoClient(config.instanceUrl, config.token);
    const queryOptions = await this.buildQueryOptions(group, config);
    const result = await client.getIssuesPage(config.owner, config.repo, 'open', page, SAVED_QUERY_PAGE_SIZE, queryOptions);
    console.log(`[Forgejo] Fetched ${result.items.length} issues for saved query "${group.label}" page ${page}`);
    return result;
  }

  /**
   * Built-ins with a `filterField` are user-scoped (assigned/created/mentioned/review);
   * `recentlyUpdated` and custom free-text queries are not, so they run without a login.
   */
  private async buildQueryOptions(group: SavedQueryGroup, config: ForgejoConfig): Promise<ForgejoItemQueryOptions> {
    if (isBuiltinSavedQuery(group)) {
      if (group.filterField) {
        const login = await this.getCurrentUserLogin(config);
        return login ? { [group.filterField]: login } as ForgejoItemQueryOptions : {};
      }
      return group.sort ? { sort: group.sort } : {};
    }

    return { query: group.query };
  }

  private async getCurrentUserLogin(config: ForgejoConfig): Promise<string | null> {
    if (!config.token) {
      return null;
    }

    const key = `${config.instanceUrl}\0${config.token}`;
    const cached = this.currentUserLogins.get(key);
    if (cached) {
      return cached;
    }

    const promise = new ForgejoClient(config.instanceUrl, config.token).getAuthenticatedUserLogin();
    this.currentUserLogins.set(key, promise);
    return promise;
  }
}
