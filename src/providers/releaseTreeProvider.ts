import * as vscode from 'vscode';
import { ForgejoClient } from '../api/forgejoClient';
import { ForgejoConfig, ForgejoRepositoryConfig, getForgejoConfig, getForgejoRepositoryConfigs } from '../utils/config';
import { type Release } from 'forgejo-ts';

export class ReleaseTreeItem extends vscode.TreeItem {
  constructor(
    public readonly release: Release,
    public readonly owner: string,
    public readonly repo: string
  ) {
    super(release.name || release.tag_name, vscode.TreeItemCollapsibleState.None);

    const status = release.draft ? 'Draft' : release.prerelease ? 'Pre-release' : 'Released';
    this.tooltip = `${release.name || release.tag_name}\nTag: ${release.tag_name}\nStatus: ${status}\n\nClick to open in browser`;
    this.description = release.tag_name;
    this.contextValue = release.draft ? 'releaseDraft' : release.prerelease ? 'releasePrerelease' : 'release';

    if (release.draft) {
      this.iconPath = new vscode.ThemeIcon('edit');
    } else if (release.prerelease) {
      this.iconPath = new vscode.ThemeIcon('beaker');
    } else {
      this.iconPath = new vscode.ThemeIcon('tag');
    }

    this.command = {
      command: 'forgejo.openReleaseInBrowser',
      title: 'Open Release in Browser',
      arguments: [release.html_url]
    };
  }
}

class ReleaseGroupItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly releases: Release[]
  ) {
    const collapsibleState = label === 'Drafts'
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.Expanded;
    super(label, collapsibleState);
    this.description = `${releases.length}`;
    this.contextValue = 'releaseGroup';
  }
}

class ReleaseRepositoryItem extends vscode.TreeItem {
  constructor(public readonly config: ForgejoRepositoryConfig) {
    super(config.label, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = config.rootPath;
    this.tooltip = config.rootPath ? `${config.label}\n${config.rootPath}` : config.label;
    this.contextValue = 'forgejoRepository';
    this.iconPath = new vscode.ThemeIcon('repo');
  }
}

class ReleaseMessageItem extends vscode.TreeItem {
  constructor(
    public readonly message: string,
    public readonly isError = false
  ) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(isError ? 'error' : 'info');
    this.contextValue = isError ? 'error' : 'info';
  }
}

type ReleaseTreeElement = ReleaseRepositoryItem | ReleaseTreeItem | ReleaseGroupItem | ReleaseMessageItem;

export class ReleaseTreeProvider implements vscode.TreeDataProvider<ReleaseTreeElement> {
  private _onDidChangeTreeData: vscode.EventEmitter<ReleaseTreeElement | undefined | null | void> = new vscode.EventEmitter<ReleaseTreeElement | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<ReleaseTreeElement | undefined | null | void> = this._onDidChangeTreeData.event;

  private releases = new Map<string, Release[]>();
  private error: string | null = null;
  private owner = '';
  private repo = '';

  constructor() {
    this.refresh();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getOwner(): string { return this.owner; }
  getRepo(): string { return this.repo; }

  getTreeItem(element: ReleaseTreeElement): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ReleaseTreeElement): Promise<ReleaseTreeElement[]> {
    if (!element) {
      const configs = await getForgejoRepositoryConfigs();
      if (configs.length > 1) {
        return configs.map(config => new ReleaseRepositoryItem(config));
      }

      const config = configs[0] ?? await getForgejoConfig();
      if (!config) {
        return [new ReleaseMessageItem('No Forgejo configuration found. Please configure instance URL or open a git repository.', true)];
      }

      return this.getGroupsForConfig(config);
    } else if (element instanceof ReleaseRepositoryItem) {
      return this.getGroupsForConfig(element.config);
    } else if (element instanceof ReleaseGroupItem) {
      const config = (element as ReleaseGroupItem & { config?: ForgejoConfig }).config;
      return element.releases.map(r => new ReleaseTreeItem(r, config?.owner ?? this.owner, config?.repo ?? this.repo));
    }

    return [];
  }

  private configKey(config: ForgejoConfig): string {
    return `${config.instanceUrl}/${config.owner}/${config.repo}`;
  }

  private async getGroupsForConfig(config: ForgejoConfig): Promise<ReleaseTreeElement[]> {
    try {
      const releases = await this._fetchReleases(config);

      if (this.error) {
        console.error('[Forgejo] Release fetch error:', this.error);
        return [new ReleaseMessageItem(this.error, true)];
      }

      if (releases.length === 0) {
        return [new ReleaseMessageItem('No releases found', false)];
      }

      const published = releases.filter(r => !r.draft && !r.prerelease);
      const prereleases = releases.filter(r => !r.draft && r.prerelease);
      const drafts = releases.filter(r => r.draft);
      const attachConfig = (group: ReleaseGroupItem): ReleaseGroupItem => Object.assign(group, { config });

      const groups: ReleaseGroupItem[] = [];
      if (published.length > 0) groups.push(attachConfig(new ReleaseGroupItem('Released', published)));
      if (prereleases.length > 0) groups.push(attachConfig(new ReleaseGroupItem('Pre-releases', prereleases)));
      if (drafts.length > 0) groups.push(attachConfig(new ReleaseGroupItem('Drafts', drafts)));

      return groups;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Unknown error';
      return [new ReleaseMessageItem(this.error, true)];
    }
  }

  private async _fetchReleases(config: ForgejoConfig): Promise<Release[]> {
    console.log('[Forgejo] Fetching releases...');
    const key = this.configKey(config);

    try {
      const client = new ForgejoClient(config.instanceUrl, config.token);
      const releases = await client.listReleases(config.owner, config.repo);
      this.releases.set(key, releases);
      this.owner = config.owner;
      this.repo = config.repo;
      this.error = null;
      console.log(`[Forgejo] Fetched ${releases.length} releases`);
      return releases;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Failed to fetch releases';
      this.releases.set(key, []);
      console.error('[Forgejo] Error fetching releases:', error);
      throw error;
    }
  }
}
