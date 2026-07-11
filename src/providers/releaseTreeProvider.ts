import * as vscode from 'vscode';
import { ForgejoClient } from '../api/forgejoClient';
import { ForgejoConfig, ForgejoRepositoryConfig, getForgejoRepositoryConfigs } from '../utils/config';
import { type Release } from 'forgejo-ts';

export interface ReleaseRepositoryIdentity {
  instanceUrl?: string;
  owner: string;
  repo: string;
  rootPath?: string;
}

function normalizeInstanceUrl(instanceUrl: string | undefined): string {
  return (instanceUrl ?? '').replace(/\/+$/, '');
}

function treeIdPart(value: string | number | undefined): string {
  return encodeURIComponent(String(value ?? ''));
}

function releaseTreeItemId(parts: (string | number | undefined)[]): string {
  return parts.map(treeIdPart).join('/');
}

function repositoryIdParts(config: ReleaseRepositoryIdentity): (string | undefined)[] {
  return [normalizeInstanceUrl(config.instanceUrl), config.owner, config.repo, config.rootPath];
}

function releaseIdentity(release: Release): string | number {
  const id = (release as { id?: number | string }).id;
  return id ?? release.tag_name;
}

export class ReleaseTreeItem extends vscode.TreeItem {
  public readonly owner: string;
  public readonly repo: string;
  public readonly instanceUrl?: string;
  public readonly rootPath?: string;

  constructor(
    public readonly release: Release,
    configOrOwner: ReleaseRepositoryIdentity | string,
    repo?: string,
    groupId = 'release'
  ) {
    const config = typeof configOrOwner === 'string'
      ? { owner: configOrOwner, repo: repo ?? '' }
      : configOrOwner;
    super(release.name || release.tag_name, vscode.TreeItemCollapsibleState.None);

    this.owner = config.owner;
    this.repo = config.repo;
    this.instanceUrl = config.instanceUrl;
    this.rootPath = config.rootPath;
    const status = release.draft ? 'Draft' : release.prerelease ? 'Pre-release' : 'Released';
    this.tooltip = `${release.name || release.tag_name}\nTag: ${release.tag_name}\nStatus: ${status}\n\nClick to open in browser`;
    this.description = release.tag_name;
    this.contextValue = release.draft ? 'releaseDraft' : release.prerelease ? 'releasePrerelease' : 'release';
    this.id = releaseTreeItemId(['release-item', ...repositoryIdParts(config), groupId, releaseIdentity(release)]);

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

export class ReleaseGroupItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly releases: Release[],
    public readonly config: ForgejoConfig,
    public readonly groupId: string
  ) {
    const collapsibleState = label === 'Drafts'
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.Expanded;
    super(label, collapsibleState);
    this.description = `${releases.length}`;
    this.contextValue = 'releaseGroup';
    this.id = releaseTreeItemId(['release-group', ...repositoryIdParts(config), groupId]);
  }
}

export class ReleaseRepositoryItem extends vscode.TreeItem {
  constructor(public readonly config: ForgejoRepositoryConfig) {
    super(config.label, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = config.rootPath;
    this.tooltip = config.rootPath ? `${config.label}\n${config.rootPath}` : config.label;
    this.contextValue = 'releaseRepository';
    this.iconPath = new vscode.ThemeIcon('repo');
    this.id = releaseTreeItemId(['release-repository', ...repositoryIdParts(config)]);
  }
}

export class ReleaseMessageItem extends vscode.TreeItem {
  constructor(
    public readonly message: string,
    public readonly isError = false,
    config?: ReleaseRepositoryIdentity,
    idContext?: string
  ) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(isError ? 'error' : 'info');
    this.contextValue = isError ? 'error' : 'info';
    this.id = releaseTreeItemId(['release-message', isError ? 'error' : 'info', ...(config ? repositoryIdParts(config) : []), idContext, message]);
  }
}

export class ReleaseLoadMoreItem extends vscode.TreeItem {
  constructor(public readonly config: ForgejoConfig) {
    super('Load more releases', vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('more');
    this.contextValue = 'releaseLoadMore';
    this.id = releaseTreeItemId(['release-load-more', ...repositoryIdParts(config)]);
    this.command = { command: 'forgejo.loadMoreReleases', title: 'Load More Releases', arguments: [this] };
  }
}

export type ReleaseTreeElement = ReleaseRepositoryItem | ReleaseTreeItem | ReleaseGroupItem | ReleaseMessageItem | ReleaseLoadMoreItem;
interface ReleasePageCache { releases: Release[]; nextPage: number; hasMore: boolean; inFlightPagePromise?: Promise<void> }

export class ReleaseTreeProvider implements vscode.TreeDataProvider<ReleaseTreeElement> {
  private _onDidChangeTreeData: vscode.EventEmitter<ReleaseTreeElement | undefined | null | void> = new vscode.EventEmitter<ReleaseTreeElement | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<ReleaseTreeElement | undefined | null | void> = this._onDidChangeTreeData.event;

  private releases = new Map<string, ReleasePageCache>();
  private error: string | null = null;
  private owner = '';
  private repo = '';

  constructor() {
    this.refresh();
  }

  refresh(): void {
    this.releases.clear();
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
      if (configs.length === 0) {
        return [new ReleaseMessageItem('No Forgejo configuration found. Please configure instance URL or open a git repository.', true, undefined, 'no-config')];
      }
      if (configs.length > 1) {
        return configs.map(config => new ReleaseRepositoryItem(config));
      }

      return this.getGroupsForConfig(configs[0]);
    } else if (element instanceof ReleaseRepositoryItem) {
      return this.getGroupsForConfig(element.config);
    } else if (element instanceof ReleaseGroupItem) {
      return element.releases.map(r => new ReleaseTreeItem(r, element.config, undefined, element.groupId));
    }

    return [];
  }

  private configKey(config: ForgejoConfig): string {
    return `${config.instanceUrl}/${config.owner}/${config.repo}`;
  }

  private async getGroupsForConfig(config: ForgejoConfig): Promise<ReleaseTreeElement[]> {
    try {
      const releases = await this._fetchReleases(config);

      if (releases.length === 0) {
        return [new ReleaseMessageItem('No releases found', false, config, 'empty')];
      }

      const published = releases.filter(r => !r.draft && !r.prerelease);
      const prereleases = releases.filter(r => !r.draft && r.prerelease);
      const drafts = releases.filter(r => r.draft);

      const groups: ReleaseTreeElement[] = [];
      if (published.length > 0) groups.push(new ReleaseGroupItem('Released', published, config, 'released'));
      if (prereleases.length > 0) groups.push(new ReleaseGroupItem('Pre-releases', prereleases, config, 'prereleases'));
      if (drafts.length > 0) groups.push(new ReleaseGroupItem('Drafts', drafts, config, 'drafts'));
      if (this.releases.get(this.configKey(config))?.hasMore) groups.push(new ReleaseLoadMoreItem(config));

      return groups;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Unknown error';
      return [new ReleaseMessageItem(this.error, true, config, 'fetch-error')];
    }
  }

  private async _fetchReleases(config: ForgejoConfig): Promise<Release[]> {
    console.log('[Forgejo] Fetching releases...');
    const key = this.configKey(config);
    const cached = this.releases.get(key);
    if (cached) {
      return cached.releases;
    }

    try {
      const client = new ForgejoClient(config.instanceUrl, config.token);
      const page = typeof client.listReleasesPage === 'function'
        ? await client.listReleasesPage(config.owner, config.repo, { page: 1, limit: 50 })
        : { items: await client.listReleases(config.owner, config.repo), hasMore: false };
      const releases = page.items;
      this.releases.set(key, { releases, nextPage: 2, hasMore: page.hasMore });
      this.owner = config.owner;
      this.repo = config.repo;
      this.error = null;
      console.log(`[Forgejo] Fetched ${releases.length} releases`);
      return releases;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Failed to fetch releases';
      this.releases.delete(key);
      console.error('[Forgejo] Error fetching releases:', error);
      throw error;
    }
  }

  async loadMoreReleases(item: ReleaseLoadMoreItem): Promise<void> {
    const cache = this.releases.get(this.configKey(item.config));
    if (!cache?.hasMore) return;
    if (cache.inFlightPagePromise) return cache.inFlightPagePromise;
    const requestedPage = cache.nextPage;
    cache.inFlightPagePromise = (async () => {
      try {
        const page = await new ForgejoClient(item.config.instanceUrl, item.config.token)
          .listReleasesPage(item.config.owner, item.config.repo, { page: requestedPage, limit: 50 });
        const seen = new Set(cache.releases.map(release => String(releaseIdentity(release))));
        for (const release of page.items) {
          const key = String(releaseIdentity(release));
          if (!seen.has(key)) { seen.add(key); cache.releases.push(release); }
        }
        cache.nextPage = requestedPage + 1;
        cache.hasMore = page.hasMore;
        this._onDidChangeTreeData.fire();
      } catch (error) {
        void vscode.window.showErrorMessage(`Failed to load more releases: ${error instanceof Error ? error.message : 'Unknown error'}`);
      } finally {
        cache.inFlightPagePromise = undefined;
      }
    })();
    return cache.inFlightPagePromise;
  }
}
