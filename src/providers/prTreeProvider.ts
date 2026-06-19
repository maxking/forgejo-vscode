import * as vscode from 'vscode';
import { ForgejoClient, ForgejoItemQueryOptions, PullRequestPage } from '../api/forgejoClient';
import { PullRequestListItem, PullRequestFile } from '../models/pullRequest';
import { ForgejoConfig, ForgejoRepositoryConfig, getForgejoConfig, getForgejoConfigFor, getForgejoRepositoryConfigs } from '../utils/config';

const PULL_REQUEST_PAGE_SIZE = 50;

type PRQueryKind = 'assigned' | 'review' | 'created' | 'mentioned';
type PRGroupKind = 'open' | 'draft' | 'merged' | 'closed' | PRQueryKind;
type PRCacheGroupKind = 'open' | 'closed' | PRQueryKind;

const PR_QUERY_ORDER: PRQueryKind[] = ['assigned', 'review', 'created', 'mentioned'];
const PR_QUERY_DEFINITIONS: Record<PRQueryKind, {
  label: string;
  emptyLabel: string;
  filter: keyof Pick<ForgejoItemQueryOptions, 'assignedBy' | 'createdBy' | 'mentionedBy' | 'reviewRequestedBy'>;
  icon: string;
}> = {
  assigned: {
    label: 'Assigned to me',
    emptyLabel: 'assigned to me',
    filter: 'assignedBy',
    icon: 'account'
  },
  review: {
    label: 'Waiting for my review',
    emptyLabel: 'waiting for my review',
    filter: 'reviewRequestedBy',
    icon: 'eye'
  },
  created: {
    label: 'Created by me',
    emptyLabel: 'created by me',
    filter: 'createdBy',
    icon: 'person'
  },
  mentioned: {
    label: 'Mentioned me',
    emptyLabel: 'mentioning me',
    filter: 'mentionedBy',
    icon: 'mention'
  }
};

function treeIdPart(value: string | number | undefined): string {
  return encodeURIComponent(String(value ?? ''));
}

function isPRQueryKind(kind: PRGroupKind): kind is PRQueryKind {
  return kind === 'assigned' || kind === 'review' || kind === 'created' || kind === 'mentioned';
}

export class PRTreeItem extends vscode.TreeItem {
  public files?: PullRequestFile[];
  public filesError?: string;
  public baseRef?: string;
  public headRef?: string;

  constructor(
    public readonly pr: PullRequestListItem,
    public readonly htmlUrl: string,
    public readonly owner: string,
    public readonly repo: string,
    public readonly config?: ForgejoConfig
  ) {
    super(`#${pr.number}: ${pr.title}`, vscode.TreeItemCollapsibleState.Collapsed);

    this.tooltip = `${pr.title}\nby ${pr.user.login}\nState: ${pr.state}${pr.merged ? ' (merged)' : ''}${pr.draft ? ' (draft)' : ''}`;
    this.description = `by ${pr.user.login}`;
    this.contextValue = 'pullRequest';
    this.id = [
      'pr',
      config?.instanceUrl ?? '',
      owner,
      repo,
      pr.number
    ].map(treeIdPart).join('/');

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

export class PRGroupItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly kind: PRGroupKind,
    public readonly pullRequests: PullRequestListItem[] | null,
    public readonly isQueryGroup = false
  ) {
    const collapsibleState = kind === 'closed' || kind === 'merged' || isQueryGroup
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.Expanded;
    super(label, collapsibleState);
    this.description = pullRequests ? `${pullRequests.length}` : undefined;
    this.contextValue = isQueryGroup ? 'prQueryGroup' : 'prGroup';
    if (isQueryGroup && isPRQueryKind(kind)) {
      this.iconPath = new vscode.ThemeIcon(PR_QUERY_DEFINITIONS[kind].icon);
      this.tooltip = `${label} open pull requests`;
    }
  }
}

export class PRLoadMoreItem extends vscode.TreeItem {
  constructor(
    public readonly group: PRGroupItem,
    public readonly config: ForgejoConfig
  ) {
    super('Load more pull requests', vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('more');
    this.contextValue = 'prLoadMore';
    this.id = [
      'pr-load-more',
      config.instanceUrl,
      config.owner,
      config.repo,
      group.kind,
      group.id ?? ''
    ].map(treeIdPart).join('/');
    this.command = {
      command: 'forgejo.loadMorePullRequests',
      title: 'Load More Pull Requests',
      arguments: [this]
    };
  }
}

export class PRQueryRootItem extends vscode.TreeItem {
  constructor(public readonly config: ForgejoConfig) {
    super('My Queries', vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'prQueryRoot';
    this.iconPath = new vscode.ThemeIcon('filter');
    this.id = [
      'pr-query-root',
      config.instanceUrl,
      config.owner,
      config.repo
    ].map(treeIdPart).join('/');
  }
}

export class PRRepositoryItem extends vscode.TreeItem {
  constructor(public readonly config: ForgejoRepositoryConfig) {
    super(config.label, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = config.rootPath;
    this.tooltip = config.rootPath ? `${config.label}\n${config.rootPath}` : config.label;
    this.contextValue = 'forgejoPrRepository';
    this.iconPath = new vscode.ThemeIcon('repo');
    this.id = [
      'pr-repository',
      config.instanceUrl,
      config.owner,
      config.repo,
      config.rootPath ?? ''
    ].map(treeIdPart).join('/');
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
    this.id = `pr-message/${treeIdPart(isError ? 'error' : 'info')}/${treeIdPart(message)}`;
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
    public readonly headRef: string,
    public readonly instanceUrl?: string
  ) {
    super(file.filename, vscode.TreeItemCollapsibleState.None);

    this.description = `+${file.additions} -${file.deletions}`;
    this.tooltip = `${file.filename}\nStatus: ${file.status}\n+${file.additions} -${file.deletions}`;
    this.contextValue = 'prFile';
    this.id = [
      'pr-file',
      instanceUrl ?? '',
      owner,
      repo,
      pr.number,
      file.filename
    ].map(treeIdPart).join('/');

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
      arguments: [this.file, this.pr, this.owner, this.repo, this.baseRef, this.headRef, this.instanceUrl]
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
    this.id = 'pr-loading';
  }
}

/**
 * Overview item for PR details
 */
export class PROverviewItem extends vscode.TreeItem {
  constructor(
    public readonly pr: PullRequestListItem,
    public readonly owner: string,
    public readonly repo: string,
    public readonly instanceUrl?: string
  ) {
    super('Overview', vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('info');
    this.contextValue = 'prOverview';
    this.id = [
      'pr-overview',
      instanceUrl ?? '',
      owner,
      repo,
      pr.number
    ].map(treeIdPart).join('/');
    this.command = {
      command: 'forgejo.showPrDetails',
      title: 'Show PR Details',
      arguments: [pr, owner, repo, instanceUrl]
    };
  }
}

type PRTreeElement = PRRepositoryItem | PRQueryRootItem | PRTreeItem | PRGroupItem | PRMessageItem | PRFileItem | PRLoadingItem | PROverviewItem | PRLoadMoreItem;

type PullRequestListState = 'open' | 'closed';

interface PullRequestPageCache {
  pullRequests: PullRequestListItem[];
  nextPage: number;
  hasMore: boolean;
  inFlightPagePromise?: Promise<PullRequestPageCache>;
}

export class PRTreeProvider implements vscode.TreeDataProvider<PRTreeElement> {
  private _onDidChangeTreeData: vscode.EventEmitter<PRTreeElement | undefined | null | void> = new vscode.EventEmitter<PRTreeElement | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<PRTreeElement | undefined | null | void> = this._onDidChangeTreeData.event;

  private pullRequestPages = new Map<string, PullRequestPageCache>();
  private hasClosedPullRequests = new Map<string, boolean | null>();
  private currentUserLogins = new Map<string, Promise<string | null>>();
  private error: string | null = null;
  private searchQuery: string | null = null;

  constructor() {
    this.refresh();
  }

  refresh(): void {
    this.pullRequestPages.clear();
    this.hasClosedPullRequests.clear();
    this.currentUserLogins.clear();
    this._onDidChangeTreeData.fire();
  }

  refreshRepository(repositoryItem: PRRepositoryItem): void {
    const keyPrefix = this.configKeyPrefix(repositoryItem.config);
    for (const key of this.pullRequestPages.keys()) {
      if (key.startsWith(keyPrefix)) {
        this.pullRequestPages.delete(key);
      }
    }
    for (const key of this.hasClosedPullRequests.keys()) {
      if (key.startsWith(keyPrefix)) {
        this.hasClosedPullRequests.delete(key);
      }
    }
    this._onDidChangeTreeData.fire(repositoryItem);
  }

  getSearchQuery(): string | null {
    return this.searchQuery;
  }

  setSearchQuery(query: string | undefined): void {
    const trimmedQuery = query?.trim();
    const normalizedQuery = trimmedQuery === '' ? null : (trimmedQuery ?? null);
    if (normalizedQuery === this.searchQuery) {
      return;
    }

    this.searchQuery = normalizedQuery;
    this.refresh();
  }

  async loadMorePullRequests(item: PRLoadMoreItem): Promise<void> {
    try {
      await this.fetchNextPullRequestPage(item.config, item.group.kind);
      this._onDidChangeTreeData.fire();
      this._onDidChangeTreeData.fire(item.group);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load more pull requests';
      void vscode.window.showErrorMessage(message);
    }
  }

  getTreeItem(element: PRTreeElement): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: PRTreeElement): Promise<PRTreeElement[]> {
    if (!element) {
      const configs = await getForgejoRepositoryConfigs();
      void vscode.commands.executeCommand('setContext', 'forgejo.multipleRepositories', configs.length > 1);
      if (configs.length === 0) {
        return [new PRMessageItem('No Forgejo configuration found. Please configure instance URL or open a git repository.', true)];
      }
      if (configs.length > 1) {
        return configs.map(config => new PRRepositoryItem(config));
      }

      return this.getGroupsForConfig(configs[0]);
    } else if (element instanceof PRRepositoryItem) {
      return this.getGroupsForConfig(element.config);
    } else if (element instanceof PRQueryRootItem) {
      return this.getQueryGroupsForConfig(element.config);
    } else if (element instanceof PRGroupItem) {
      // Show PRs in this group. Closed-state groups lazy-load on expansion.
      const config = (element as PRGroupItem & { config?: ForgejoConfig }).config ?? await getForgejoConfig();
      if (!config) {
        return [];
      }

      try {
        const unavailableMessage = await this.queryUnavailableMessage(element, config);
        if (unavailableMessage) {
          return [new PRMessageItem(unavailableMessage, false)];
        }

        const pullRequests = await this.getPullRequestsForGroup(element, config);
        element.description = this.groupDescription(element, config, pullRequests.length);
        if (pullRequests.length === 0) {
          const children: PRTreeElement[] = [new PRMessageItem(`No ${this.emptyDescriptionForGroup(element)} pull requests found`, false)];
          if (this.canLoadMorePullRequests(element, config)) {
            children.push(new PRLoadMoreItem(element, config));
          }
          return children;
        }
        const children: PRTreeElement[] = pullRequests.map(pr => new PRTreeItem(pr, pr.html_url, config.owner, config.repo, config));
        if (this.canLoadMorePullRequests(element, config)) {
          children.push(new PRLoadMoreItem(element, config));
        }
        return children;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to fetch pull requests';
        return [new PRMessageItem(message, true)];
      }
    } else if (element instanceof PRTreeItem) {
      // Fetch and show files for this PR
      return this.getPRFiles(element);
    } else if (element instanceof PRMessageItem || element instanceof PRLoadingItem || element instanceof PRLoadMoreItem) {
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
    const overviewItem = new PROverviewItem(prItem.pr, prItem.owner, prItem.repo, prItem.config?.instanceUrl);

    // Return cached files if available
    if (prItem.files && prItem.baseRef && prItem.headRef) {
      const baseRef = prItem.baseRef;
      const headRef = prItem.headRef;
      const fileItems = prItem.files.map(file =>
        new PRFileItem(file, prItem.pr, prItem.owner, prItem.repo, baseRef, headRef, prItem.config?.instanceUrl)
      );
      return [overviewItem, ...fileItems];
    }

    // Return error if previous fetch failed
    if (prItem.filesError) {
      return [overviewItem, new PRMessageItem(prItem.filesError, true)];
    }

    // Fetch files from API
    try {
      const config = prItem.config ?? await getForgejoConfigFor(prItem.owner, prItem.repo) ?? await getForgejoConfig();
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
        new PRFileItem(file, prItem.pr, prItem.owner, prItem.repo, refs.base, refs.head, config.instanceUrl)
      );
      return [overviewItem, ...fileItems];
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to fetch files';
      prItem.filesError = errorMsg;
      console.error(`[Forgejo] Error fetching files for PR #${prItem.pr.number}:`, error);
      return [overviewItem, new PRMessageItem(errorMsg, true)];
    }
  }

  private configKeyPrefix(config: ForgejoConfig): string {
    return `${config.instanceUrl}/${config.owner}/${config.repo}`;
  }

  private configKey(config: ForgejoConfig, groupKind: PRGroupKind): string {
    return `${this.configKeyPrefix(config)}?group=${this.cacheGroupForKind(groupKind)}&search=${encodeURIComponent(this.searchQuery ?? '')}`;
  }

  private groupId(config: ForgejoConfig, group: PRGroupItem): string {
    const parts = [
      'pr-group',
      config.instanceUrl,
      config.owner,
      config.repo,
      group.kind
    ];
    if (this.searchQuery) {
      parts.push(this.searchQuery);
    }
    return parts.map(treeIdPart).join('/');
  }

  private async getGroupsForConfig(config: ForgejoConfig): Promise<PRTreeElement[]> {
    try {
      const openPullRequestCache = await this.ensurePullRequestPage(config, 'open');
      const pullRequests = openPullRequestCache.pullRequests;

      const openPRs = pullRequests.filter(pr => pr.state === 'open' && !pr.draft);
      const draftPRs = pullRequests.filter(pr => pr.draft);
      const groups: PRTreeElement[] = [new PRQueryRootItem(config)];

      if (openPRs.length > 0 || openPullRequestCache.hasMore) {
        groups.push(this.attachConfig(config, new PRGroupItem('Open', 'open', null)));
      }
      if (draftPRs.length > 0 || openPullRequestCache.hasMore) {
        groups.push(this.attachConfig(config, new PRGroupItem('Draft', 'draft', null)));
      }

      const hasClosedPullRequests = await this.fetchHasClosedPullRequests(config);
      if (hasClosedPullRequests === null || hasClosedPullRequests) {
        groups.push(this.attachConfig(config, new PRGroupItem('Merged', 'merged', null)));
        groups.push(this.attachConfig(config, new PRGroupItem('Closed', 'closed', null)));
      }

      if (groups.length === 1) {
        groups.push(new PRMessageItem('No pull requests found', false));
      }

      return groups;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Unknown error';
      return [new PRMessageItem(this.error, true)];
    }
  }

  private getQueryGroupsForConfig(config: ForgejoConfig): PRGroupItem[] {
    return PR_QUERY_ORDER.map(kind => this.attachConfig(
      config,
      new PRGroupItem(PR_QUERY_DEFINITIONS[kind].label, kind, null, true)
    ));
  }

  private attachConfig(config: ForgejoConfig, group: PRGroupItem): PRGroupItem {
    group.id = this.groupId(config, group);
    return Object.assign(group, { config });
  }

  private async getPullRequestsForGroup(group: PRGroupItem, config: ForgejoConfig): Promise<PullRequestListItem[]> {
    if (group.pullRequests) {
      return group.pullRequests;
    }

    const pullRequests = (await this.ensurePullRequestPage(config, group.kind)).pullRequests;
    if (isPRQueryKind(group.kind)) {
      return pullRequests;
    }

    switch (group.kind) {
      case 'open':
        return pullRequests.filter(pr => pr.state === 'open' && !pr.draft);
      case 'draft':
        return pullRequests.filter(pr => pr.draft);
      case 'merged':
        return pullRequests.filter(pr => pr.merged);
      case 'closed':
        return pullRequests.filter(pr => !pr.merged);
    }
  }

  private groupDescription(group: PRGroupItem, config: ForgejoConfig, count: number): string {
    return this.canLoadMorePullRequests(group, config) ? `${count}+` : `${count}`;
  }

  private canLoadMorePullRequests(group: PRGroupItem, config: ForgejoConfig): boolean {
    return this.getPullRequestCache(config, group.kind).hasMore;
  }

  private stateForGroup(groupKind: PRGroupKind): PullRequestListState {
    return groupKind === 'merged' || groupKind === 'closed' ? 'closed' : 'open';
  }

  private cacheGroupForKind(groupKind: PRGroupKind): PRCacheGroupKind {
    if (isPRQueryKind(groupKind)) {
      return groupKind;
    }
    return this.stateForGroup(groupKind);
  }

  private getPullRequestCache(config: ForgejoConfig, groupKind: PRGroupKind): PullRequestPageCache {
    const key = this.configKey(config, groupKind);
    const cached = this.pullRequestPages.get(key);
    if (cached) {
      return cached;
    }

    const created: PullRequestPageCache = {
      pullRequests: [],
      nextPage: 1,
      hasMore: true
    };
    this.pullRequestPages.set(key, created);
    return created;
  }

  private async ensurePullRequestPage(config: ForgejoConfig, groupKind: PRGroupKind): Promise<PullRequestPageCache> {
    const cache = this.getPullRequestCache(config, groupKind);
    if (cache.pullRequests.length > 0 || !cache.hasMore) {
      return cache;
    }

    return this.fetchNextPullRequestPage(config, groupKind);
  }

  private async fetchNextPullRequestPage(config: ForgejoConfig, groupKind: PRGroupKind): Promise<PullRequestPageCache> {
    const cache = this.getPullRequestCache(config, groupKind);
    if (!cache.hasMore) {
      return cache;
    }
    if (cache.inFlightPagePromise) {
      return cache.inFlightPagePromise;
    }

    const promise = this.fetchPullRequestsPageUncached(config, groupKind, cache.nextPage).then(page => {
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

  private appendUniquePullRequests(cache: PullRequestPageCache, pullRequests: PullRequestListItem[]): void {
    const seenNumbers = new Set(cache.pullRequests.map(pr => pr.number));
    for (const pullRequest of pullRequests) {
      if (seenNumbers.has(pullRequest.number)) {
        continue;
      }
      seenNumbers.add(pullRequest.number);
      cache.pullRequests.push(pullRequest);
    }
  }

  private async fetchPullRequestsPageUncached(config: ForgejoConfig, groupKind: PRGroupKind, page: number): Promise<PullRequestPage> {
    const state = this.stateForGroup(groupKind);
    console.log(`[Forgejo] Fetching ${state} pull requests page ${page}...`);

    try {
      const client = new ForgejoClient(config.instanceUrl, config.token);
      const queryOptions = await this.queryOptionsForGroup(config, groupKind);
      const pullRequests = queryOptions
        ? await client.getPullRequestsPage(config.owner, config.repo, state, page, PULL_REQUEST_PAGE_SIZE, queryOptions)
        : this.searchQuery
        ? await client.getPullRequestsPage(config.owner, config.repo, state, page, PULL_REQUEST_PAGE_SIZE, this.searchQuery)
        : await client.getPullRequestsPage(config.owner, config.repo, state, page, PULL_REQUEST_PAGE_SIZE);
      this.error = null;
      console.log(`[Forgejo] Fetched ${pullRequests.items.length} ${state} pull requests from page ${page}`);
      return pullRequests;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Failed to fetch pull requests';
      console.error(`[Forgejo] Error fetching ${state} PR page ${page}:`, error);
      throw error;
    }
  }

  private async fetchHasClosedPullRequests(config: ForgejoConfig): Promise<boolean | null> {
    const key = this.configKey(config, 'closed');
    if (this.hasClosedPullRequests.has(key)) {
      return this.hasClosedPullRequests.get(key) ?? null;
    }

    try {
      const client = new ForgejoClient(config.instanceUrl, config.token);
      const hasClosed = this.searchQuery
        ? (await client.getPullRequestsPage(config.owner, config.repo, 'closed', 1, 1, this.searchQuery)).items.length > 0
        : await client.hasPullRequests(config.owner, config.repo, 'closed');
      this.hasClosedPullRequests.set(key, hasClosed);
      return hasClosed;
    } catch (error) {
      console.warn('[Forgejo] Could not check for closed PRs:', error);
      return null;
    }
  }

  private emptyDescriptionForGroup(group: PRGroupItem): string {
    return isPRQueryKind(group.kind)
      ? PR_QUERY_DEFINITIONS[group.kind].emptyLabel
      : group.label.toLowerCase();
  }

  private async queryUnavailableMessage(group: PRGroupItem, config: ForgejoConfig): Promise<string | null> {
    if (!isPRQueryKind(group.kind)) {
      return null;
    }

    const login = await this.getCurrentUserLogin(config);
    return login ? null : 'Configure an authentication token to use pull request query views.';
  }

  private async queryOptionsForGroup(config: ForgejoConfig, groupKind: PRGroupKind): Promise<ForgejoItemQueryOptions | null> {
    const baseOptions: ForgejoItemQueryOptions = this.searchQuery ? { query: this.searchQuery } : {};
    if (!isPRQueryKind(groupKind)) {
      return null;
    }

    const login = await this.getCurrentUserLogin(config);
    if (!login) {
      return null;
    }

    const definition = PR_QUERY_DEFINITIONS[groupKind];
    return {
      ...baseOptions,
      [definition.filter]: login
    };
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
