import * as vscode from 'vscode';
import { ForgejoClient, ForgejoItemQueryOptions, IssuePage } from '../api/forgejoClient';
import { IssueListItem } from '../models/issue';
import { ForgejoConfig, ForgejoRepositoryConfig, getForgejoRepositoryConfigs } from '../utils/config';

const ISSUE_PAGE_SIZE = 50;

type IssueQueryKind = 'assigned' | 'created' | 'mentioned';
type IssueGroupKind = 'open' | 'closed' | IssueQueryKind;

const ISSUE_QUERY_ORDER: IssueQueryKind[] = ['assigned', 'created', 'mentioned'];
const ISSUE_QUERY_DEFINITIONS: Record<IssueQueryKind, {
  label: string;
  emptyLabel: string;
  filter: keyof Pick<ForgejoItemQueryOptions, 'assignedBy' | 'createdBy' | 'mentionedBy'>;
  icon: string;
}> = {
  assigned: {
    label: 'Assigned to me',
    emptyLabel: 'assigned to me',
    filter: 'assignedBy',
    icon: 'account'
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

function isIssueQueryKind(kind: IssueGroupKind): kind is IssueQueryKind {
  return kind === 'assigned' || kind === 'created' || kind === 'mentioned';
}

function issueItemIdParts(instanceUrl: string | undefined, owner: string, repo: string, issueNumber: number, treeContext?: string): (string | number | undefined)[] {
  const parts: (string | number | undefined)[] = ['issue', instanceUrl ?? '', owner, repo];
  if (treeContext) {
    parts.push(treeContext);
  }
  parts.push(issueNumber);
  return parts;
}

export class IssueTreeItem extends vscode.TreeItem {
  constructor(
    public readonly issue: IssueListItem,
    public readonly htmlUrl: string,
    public readonly owner: string,
    public readonly repo: string,
    public readonly instanceUrl?: string,
    public readonly treeContext?: string,
    public readonly config?: ForgejoConfig & { rootPath?: string }
  ) {
    super(`#${issue.number}: ${issue.title}`, vscode.TreeItemCollapsibleState.None);

    this.tooltip = `${issue.title}\nby ${issue.user.login}\nState: ${issue.state}\nComments: ${issue.comments}\n\nClick to view details`;
    this.description = `by ${issue.user.login}`;
    this.contextValue = 'issue';
    this.id = issueItemIdParts(instanceUrl, owner, repo, issue.number, treeContext).map(treeIdPart).join('/');

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

export class IssueGroupItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly kind: IssueGroupKind,
    public readonly isQueryGroup = false
  ) {
    const collapsibleState = kind === 'closed' || isQueryGroup
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.Expanded;
    super(label, collapsibleState);
    this.contextValue = isQueryGroup ? 'issueQueryGroup' : 'issueGroup';
    if (isQueryGroup && isIssueQueryKind(kind)) {
      this.iconPath = new vscode.ThemeIcon(ISSUE_QUERY_DEFINITIONS[kind].icon);
      this.tooltip = `${label} open issues`;
    }
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
      group.kind,
      group.id ?? ''
    ].map(treeIdPart).join('/');
    this.command = {
      command: 'forgejo.loadMoreIssues',
      title: 'Load More Issues',
      arguments: [this]
    };
  }
}

class IssueQueryRootItem extends vscode.TreeItem {
  constructor(public readonly config: ForgejoConfig) {
    super('My Queries', vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'issueQueryRoot';
    this.iconPath = new vscode.ThemeIcon('filter');
    this.id = [
      'issue-query-root',
      config.instanceUrl,
      config.owner,
      config.repo
    ].map(treeIdPart).join('/');
  }
}

export class IssueRepositoryItem extends vscode.TreeItem {
  constructor(public readonly config: ForgejoRepositoryConfig) {
    super(config.label, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = config.rootPath;
    this.tooltip = config.rootPath ? `${config.label}\n${config.rootPath}` : config.label;
    this.contextValue = 'forgejoIssueRepository';
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
    public readonly isError = false,
    public readonly idContext?: string
  ) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(isError ? 'error' : 'info');
    this.contextValue = isError ? 'error' : 'info';
    this.id = [
      'issue-message',
      isError ? 'error' : 'info',
      idContext ?? '',
      message
    ].map(treeIdPart).join('/');
  }
}

type IssueTreeElement = IssueRepositoryItem | IssueQueryRootItem | IssueTreeItem | IssueGroupItem | IssueMessageItem | IssueLoadMoreItem;
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

  private issuePages = new Map<string, IssuePageCache>();
  private currentUserLogins = new Map<string, Promise<string | null>>();
  private error: string | null = null;
  private searchQuery: string | null = null;

  constructor() {
    this.refresh();
  }

  refresh(): void {
    this.issuePages.clear();
    this.currentUserLogins.clear();
    this._onDidChangeTreeData.fire();
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
      void vscode.commands.executeCommand('setContext', 'forgejo.multipleRepositories', configs.length > 1);
      if (configs.length === 0) {
        return [new IssueMessageItem('No Forgejo configuration found. Please configure instance URL or open a git repository.', true)];
      }
      if (configs.length > 1) {
        return configs.map(config => new IssueRepositoryItem(config));
      }

      return this.getGroupsForConfig(configs[0]);
    } else if (element instanceof IssueRepositoryItem) {
      return this.getGroupsForConfig(element.config);
    } else if (element instanceof IssueQueryRootItem) {
      return this.getQueryGroupsForConfig(element.config);
    } else if (element instanceof IssueGroupItem) {
      const config = (element as IssueGroupItem & { config?: ForgejoConfig }).config;
      if (!config) {
        return [];
      }

      try {
        const unavailableMessage = await this.queryUnavailableMessage(element, config);
        if (unavailableMessage) {
          return [new IssueMessageItem(unavailableMessage, false, element.id ?? element.kind)];
        }

        const issues = await this.getIssuesForGroup(element, config);
        element.description = this.groupDescription(element, config, issues.length);
        const children: IssueTreeElement[] = issues.length === 0
          ? [new IssueMessageItem(`No ${this.emptyDescriptionForGroup(element)} issues found`, false, element.id ?? element.kind)]
          : issues.map(issue =>
            new IssueTreeItem(issue, issue.html_url, config.owner, config.repo, config.instanceUrl, element.kind, config)
          );
        if (this.canLoadMoreIssues(element, config)) {
          children.push(new IssueLoadMoreItem(element, config));
        }
        return children;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to fetch issues';
        return [new IssueMessageItem(message, true, element.id ?? element.kind)];
      }
    } else if (element instanceof IssueMessageItem || element instanceof IssueLoadMoreItem) {
      return [];
    }

    return [];
  }

  private configKey(config: ForgejoConfig, groupKind: IssueGroupKind): string {
    return `${config.instanceUrl}/${config.owner}/${config.repo}?group=${groupKind}&search=${encodeURIComponent(this.searchQuery ?? '')}`;
  }

  private groupId(config: ForgejoConfig, group: IssueGroupItem): string {
    const parts = [
      'issue-group',
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

  private async getGroupsForConfig(config: ForgejoConfig): Promise<IssueTreeElement[]> {
    try {
      const [openCache, closedCache] = await Promise.all([
        this.ensureIssuePage(config, 'open'),
        this.ensureIssuePage(config, 'closed')
      ]);
      const groups: IssueTreeElement[] = [new IssueQueryRootItem(config)];

      if (openCache.issues.length > 0 || openCache.hasMore) {
        const group = this.attachConfig(config, new IssueGroupItem('Open', 'open'));
        group.description = this.groupDescription(group, config, openCache.issues.length);
        groups.push(group);
      }
      if (closedCache.issues.length > 0 || closedCache.hasMore) {
        const group = this.attachConfig(config, new IssueGroupItem('Closed', 'closed'));
        group.description = this.groupDescription(group, config, closedCache.issues.length);
        groups.push(group);
      }

      if (groups.length === 1) {
        groups.push(new IssueMessageItem('No issues found', false));
      }

      return groups;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Unknown error';
      return [new IssueMessageItem(this.error, true)];
    }
  }

  private getQueryGroupsForConfig(config: ForgejoConfig): IssueGroupItem[] {
    return ISSUE_QUERY_ORDER.map(kind => this.attachConfig(
      config,
      new IssueGroupItem(ISSUE_QUERY_DEFINITIONS[kind].label, kind, true)
    ));
  }

  private attachConfig(config: ForgejoConfig, group: IssueGroupItem): IssueGroupItem {
    group.id = this.groupId(config, group);
    return Object.assign(group, { config });
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

  private getIssueCache(config: ForgejoConfig, groupKind: IssueGroupKind): IssuePageCache {
    const key = this.configKey(config, groupKind);
    const cached = this.issuePages.get(key);
    if (cached) {
      return cached;
    }

    const created: IssuePageCache = {
      issues: [],
      nextPage: 1,
      hasMore: true
    };
    this.issuePages.set(key, created);
    return created;
  }

  private async ensureIssuePage(config: ForgejoConfig, groupKind: IssueGroupKind): Promise<IssuePageCache> {
    const cache = this.getIssueCache(config, groupKind);
    if (cache.issues.length > 0 || !cache.hasMore) {
      return cache;
    }

    return this.fetchNextIssuePage(config, groupKind);
  }

  private async fetchNextIssuePage(config: ForgejoConfig, groupKind: IssueGroupKind): Promise<IssuePageCache> {
    const cache = this.getIssueCache(config, groupKind);
    if (!cache.hasMore) {
      return cache;
    }
    if (cache.inFlightPagePromise) {
      return cache.inFlightPagePromise;
    }

    const promise = this.fetchIssuesPageUncached(config, groupKind, cache.nextPage).then(page => {
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

  private async fetchIssuesPageUncached(config: ForgejoConfig, groupKind: IssueGroupKind, page: number): Promise<IssuePage> {
    const state = this.stateForGroup(groupKind);
    console.log(`[Forgejo] Fetching ${state} issues page ${page}...`);
    try {
      const client = new ForgejoClient(config.instanceUrl, config.token);
      const queryOptions = await this.queryOptionsForGroup(config, groupKind);
      const issues = queryOptions
        ? await client.getIssuesPage(config.owner, config.repo, state, page, ISSUE_PAGE_SIZE, queryOptions)
        : this.searchQuery
        ? await client.getIssuesPage(config.owner, config.repo, state, page, ISSUE_PAGE_SIZE, this.searchQuery)
        : await client.getIssuesPage(config.owner, config.repo, state, page, ISSUE_PAGE_SIZE);
      this.error = null;
      console.log(`[Forgejo] Fetched ${issues.items.length} ${state} issues from page ${page}`);
      return issues;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Failed to fetch issues';
      console.error(`[Forgejo] Error fetching ${state} issues page ${page}:`, error);
      throw error;
    }
  }

  private stateForGroup(groupKind: IssueGroupKind): IssueState {
    return groupKind === 'closed' ? 'closed' : 'open';
  }

  private emptyDescriptionForGroup(group: IssueGroupItem): string {
    return isIssueQueryKind(group.kind)
      ? ISSUE_QUERY_DEFINITIONS[group.kind].emptyLabel
      : group.label.toLowerCase();
  }

  private async queryUnavailableMessage(group: IssueGroupItem, config: ForgejoConfig): Promise<string | null> {
    if (!isIssueQueryKind(group.kind)) {
      return null;
    }

    const login = await this.getCurrentUserLogin(config);
    return login ? null : 'Configure an authentication token to use issue query views.';
  }

  private async queryOptionsForGroup(config: ForgejoConfig, groupKind: IssueGroupKind): Promise<ForgejoItemQueryOptions | null> {
    const baseOptions: ForgejoItemQueryOptions = this.searchQuery ? { query: this.searchQuery } : {};
    if (!isIssueQueryKind(groupKind)) {
      return null;
    }

    const login = await this.getCurrentUserLogin(config);
    if (!login) {
      return null;
    }

    const definition = ISSUE_QUERY_DEFINITIONS[groupKind];
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
