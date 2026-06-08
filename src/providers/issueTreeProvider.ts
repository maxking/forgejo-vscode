import * as vscode from 'vscode';
import { ForgejoClient } from '../api/forgejoClient';
import { IssueListItem } from '../models/issue';
import { ForgejoConfig, ForgejoRepositoryConfig, getForgejoRepositoryConfigs } from '../utils/config';

export class IssueTreeItem extends vscode.TreeItem {
  constructor(
    public readonly issue: IssueListItem,
    public readonly htmlUrl: string,
    public readonly owner: string,
    public readonly repo: string
  ) {
    super(`#${issue.number}: ${issue.title}`, vscode.TreeItemCollapsibleState.None);

    this.tooltip = `${issue.title}\nby ${issue.user.login}\nState: ${issue.state}\nComments: ${issue.comments}\n\nClick to view details`;
    this.description = `by ${issue.user.login}`;
    this.contextValue = 'issue';

    // Set icon based on state
    if (issue.state === 'closed') {
      this.iconPath = new vscode.ThemeIcon('issue-closed', new vscode.ThemeColor('gitDecoration.deletedResourceForeground'));
    } else {
      this.iconPath = new vscode.ThemeIcon('issues', new vscode.ThemeColor('gitDecoration.addedResourceForeground'));
    }

    // Make clickable - opens issue detail view
    this.command = {
      command: 'forgejo.showIssueDetails',
      title: 'Show Issue Details',
      arguments: [issue, owner, repo]
    };
  }
}

class IssueGroupItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly issues: IssueListItem[]
  ) {
    const collapsibleState = label === 'Closed'
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.Expanded;
    super(label, collapsibleState);
    this.description = `${issues.length}`;
    this.contextValue = 'issueGroup';
  }
}

class IssueRepositoryItem extends vscode.TreeItem {
  constructor(public readonly config: ForgejoRepositoryConfig) {
    super(config.label, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = config.rootPath;
    this.tooltip = config.rootPath ? `${config.label}\n${config.rootPath}` : config.label;
    this.contextValue = 'forgejoRepository';
    this.iconPath = new vscode.ThemeIcon('repo');
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
  }
}

type IssueTreeElement = IssueRepositoryItem | IssueTreeItem | IssueGroupItem | IssueMessageItem;

export class IssueTreeProvider implements vscode.TreeDataProvider<IssueTreeElement> {
  private _onDidChangeTreeData: vscode.EventEmitter<IssueTreeElement | undefined | null | void> = new vscode.EventEmitter<IssueTreeElement | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<IssueTreeElement | undefined | null | void> = this._onDidChangeTreeData.event;

  private issues = new Map<string, IssueListItem[]>();
  private error: string | null = null;
  private owner = '';
  private repo = '';

  constructor() {
    this.refresh();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
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
      // Show issues in this group
      const config = (element as IssueGroupItem & { config?: ForgejoConfig }).config;
      return element.issues.map(issue => new IssueTreeItem(issue, issue.html_url, config?.owner ?? this.owner, config?.repo ?? this.repo));
    } else if (element instanceof IssueMessageItem) {
      // Message items have no children
      return [];
    }

    return [];
  }

  private configKey(config: ForgejoConfig): string {
    return `${config.instanceUrl}/${config.owner}/${config.repo}`;
  }

  private async getGroupsForConfig(config: ForgejoConfig): Promise<IssueTreeElement[]> {
    try {
      const issues = await this.fetchIssues(config);

      if (this.error) {
        console.error('Forgejo Issue fetch error:', this.error);
        return [new IssueMessageItem(this.error, true)];
      }

      if (issues.length === 0) {
        return [new IssueMessageItem('No issues found', false)];
      }

      const openIssues = issues.filter(issue => issue.state === 'open');
      const closedIssues = issues.filter(issue => issue.state === 'closed');
      const groups: IssueGroupItem[] = [];
      const attachConfig = (group: IssueGroupItem): IssueGroupItem => Object.assign(group, { config });

      if (openIssues.length > 0) {
        groups.push(attachConfig(new IssueGroupItem('Open', openIssues)));
      }
      if (closedIssues.length > 0) {
        groups.push(attachConfig(new IssueGroupItem('Closed', closedIssues)));
      }

      return groups;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Unknown error';
      return [new IssueMessageItem(this.error, true)];
    }
  }

  private async fetchIssues(config: ForgejoConfig): Promise<IssueListItem[]> {
    console.log('[Forgejo] Fetching issues...');
    const key = this.configKey(config);

    console.log('[Forgejo] Using config:', {
      instanceUrl: config.instanceUrl,
      owner: config.owner,
      repo: config.repo,
      hasToken: !!config.token
    });

    try {
      const client = new ForgejoClient(config.instanceUrl, config.token);
      const issues = await client.getIssues(config.owner, config.repo, 'all');
      this.issues.set(key, issues);
      this.owner = config.owner;
      this.repo = config.repo;
      this.error = null;
      console.log(`[Forgejo] Fetched ${issues.length} issues`);
      return issues;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Failed to fetch issues';
      this.issues.set(key, []);
      console.error('[Forgejo] Error fetching issues:', error);
      throw error;
    }
  }
}
