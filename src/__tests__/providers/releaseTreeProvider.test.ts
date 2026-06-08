import * as vscode from 'vscode';
import { ReleaseTreeItem, ReleaseTreeProvider } from '../../providers/releaseTreeProvider';
import { ForgejoClient } from '../../api/forgejoClient';
import { getForgejoConfig, getForgejoRepositoryConfigs } from '../../utils/config';
import { type Release } from 'forgejo-ts';

// Mock dependencies
jest.mock('../../api/forgejoClient');
jest.mock('../../utils/config');

const makeRelease = (overrides: Partial<Release> = {}): Release => ({
  id: 1,
  tag_name: 'v1.0.0',
  name: 'Release v1.0.0',
  draft: false,
  prerelease: false,
  body: '',
  html_url: 'https://git.example.com/owner/repo/releases/tag/v1.0.0',
  tarball_url: 'https://git.example.com/owner/repo/archive/v1.0.0.tar.gz',
  zipball_url: 'https://git.example.com/owner/repo/archive/v1.0.0.zip',
  created_at: '2025-01-01T00:00:00Z',
  published_at: '2025-01-01T00:00:00Z',
  author: { login: 'user' } as any,
  assets: [],
  ...overrides,
});

describe('ReleaseTreeProvider', () => {
  let provider: ReleaseTreeProvider;
  let mockClient: jest.Mocked<ForgejoClient>;
  let mockGetForgejoConfig: jest.MockedFunction<typeof getForgejoConfig>;
  let mockGetForgejoRepositoryConfigs: jest.MockedFunction<typeof getForgejoRepositoryConfigs>;

  const mockConfig = {
    instanceUrl: 'https://git.example.com',
    owner: 'test-owner',
    repo: 'test-repo',
    token: 'test-token',
  };

  beforeEach(() => {
    mockClient = {
      listReleases: jest.fn(),
    } as any;

    mockGetForgejoConfig = getForgejoConfig as jest.MockedFunction<typeof getForgejoConfig>;
    mockGetForgejoRepositoryConfigs = getForgejoRepositoryConfigs as jest.MockedFunction<typeof getForgejoRepositoryConfigs>;
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    mockGetForgejoRepositoryConfigs.mockResolvedValue([{ ...mockConfig, label: 'test-owner/test-repo' }]);

    (ForgejoClient as jest.MockedClass<typeof ForgejoClient>).mockImplementation(() => mockClient);

    // Default: return empty list so constructor refresh doesn't blow up
    mockClient.listReleases.mockResolvedValue([]);

    provider = new ReleaseTreeProvider();

    jest.clearAllMocks();
  });

  describe('ReleaseTreeItem', () => {
    const owner = 'test-owner';
    const repo = 'test-repo';

    test('uses release name as label', () => {
      const release = makeRelease({ name: 'My Release', tag_name: 'v1.0.0' });
      const item = new ReleaseTreeItem(release, owner, repo);
      expect(item.label).toBe('My Release');
    });

    test('falls back to tag_name when name is missing', () => {
      const release = makeRelease({ name: undefined, tag_name: 'v2.0.0' });
      const item = new ReleaseTreeItem(release, owner, repo);
      expect(item.label).toBe('v2.0.0');
    });

    test('shows tag_name as description', () => {
      const release = makeRelease({ tag_name: 'v1.0.0' });
      const item = new ReleaseTreeItem(release, owner, repo);
      expect(item.description).toBe('v1.0.0');
    });

    test('contextValue is "release" for published release', () => {
      const release = makeRelease({ draft: false, prerelease: false });
      const item = new ReleaseTreeItem(release, owner, repo);
      expect(item.contextValue).toBe('release');
    });

    test('contextValue is "releaseDraft" for draft', () => {
      const release = makeRelease({ draft: true, prerelease: false });
      const item = new ReleaseTreeItem(release, owner, repo);
      expect(item.contextValue).toBe('releaseDraft');
    });

    test('contextValue is "releasePrerelease" for pre-release', () => {
      const release = makeRelease({ draft: false, prerelease: true });
      const item = new ReleaseTreeItem(release, owner, repo);
      expect(item.contextValue).toBe('releasePrerelease');
    });

    test('uses "tag" icon for published release', () => {
      const release = makeRelease({ draft: false, prerelease: false });
      const item = new ReleaseTreeItem(release, owner, repo);
      expect((item.iconPath as vscode.ThemeIcon).id).toBe('tag');
    });

    test('uses "edit" icon for draft', () => {
      const release = makeRelease({ draft: true });
      const item = new ReleaseTreeItem(release, owner, repo);
      expect((item.iconPath as vscode.ThemeIcon).id).toBe('edit');
    });

    test('uses "beaker" icon for pre-release', () => {
      const release = makeRelease({ draft: false, prerelease: true });
      const item = new ReleaseTreeItem(release, owner, repo);
      expect((item.iconPath as vscode.ThemeIcon).id).toBe('beaker');
    });

    test('tooltip includes status "Released" for published release', () => {
      const release = makeRelease({ draft: false, prerelease: false, name: 'v1', tag_name: 'v1.0.0' });
      const item = new ReleaseTreeItem(release, owner, repo);
      expect(item.tooltip).toContain('Released');
    });

    test('tooltip includes status "Draft" for draft', () => {
      const release = makeRelease({ draft: true, name: 'v1', tag_name: 'v1.0.0' });
      const item = new ReleaseTreeItem(release, owner, repo);
      expect(item.tooltip).toContain('Draft');
    });

    test('tooltip includes status "Pre-release" for pre-release', () => {
      const release = makeRelease({ prerelease: true, name: 'v1', tag_name: 'v1.0.0' });
      const item = new ReleaseTreeItem(release, owner, repo);
      expect(item.tooltip).toContain('Pre-release');
    });

    test('command opens release in browser', () => {
      const url = 'https://git.example.com/owner/repo/releases/tag/v1.0.0';
      const release = makeRelease({ html_url: url });
      const item = new ReleaseTreeItem(release, owner, repo);
      expect(item.command?.command).toBe('forgejo.openReleaseInBrowser');
      expect(item.command?.arguments).toEqual([url]);
    });
  });

  describe('getChildren (root level)', () => {
    test('groups multiple detected repositories by owner and repo at the root', async () => {
      mockGetForgejoRepositoryConfigs.mockResolvedValue([
        { ...mockConfig, owner: 'maxking', repo: 'forgejo-vscode', label: 'maxking/forgejo-vscode' },
        { ...mockConfig, owner: 'forgejo', repo: 'forgejo', label: 'forgejo/forgejo' }
      ]);

      const children = await provider.getChildren();

      expect(children.map(child => String((child as vscode.TreeItem).label))).toEqual([
        'maxking/forgejo-vscode',
        'forgejo/forgejo'
      ]);
      expect(mockClient.listReleases).not.toHaveBeenCalled();
    });

    test('returns error message when no config', async () => {
      mockGetForgejoConfig.mockResolvedValue(null);
      mockGetForgejoRepositoryConfigs.mockResolvedValue([]);
      const children = await provider.getChildren();
      expect(children).toHaveLength(1);
      expect((children[0] as any).label).toContain('No Forgejo configuration');
    });

    test('returns "No releases found" message when list is empty', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockClient.listReleases.mockResolvedValue([]);
      const children = await provider.getChildren();
      expect(children).toHaveLength(1);
      expect((children[0] as any).label).toBe('No releases found');
    });

    test('groups published releases under "Released"', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockClient.listReleases.mockResolvedValue([
        makeRelease({ id: 1, draft: false, prerelease: false }),
      ]);
      const children = await provider.getChildren();
      expect(children.some((c: any) => c.label === 'Released')).toBe(true);
    });

    test('groups pre-releases under "Pre-releases"', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockClient.listReleases.mockResolvedValue([
        makeRelease({ id: 2, draft: false, prerelease: true }),
      ]);
      const children = await provider.getChildren();
      expect(children.some((c: any) => c.label === 'Pre-releases')).toBe(true);
    });

    test('groups draft releases under "Drafts"', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockClient.listReleases.mockResolvedValue([
        makeRelease({ id: 3, draft: true }),
      ]);
      const children = await provider.getChildren();
      expect(children.some((c: any) => c.label === 'Drafts')).toBe(true);
    });

    test('groups release with draft=true and prerelease=true under Drafts, not Pre-releases', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockClient.listReleases.mockResolvedValue([
        makeRelease({ id: 4, draft: true, prerelease: true, name: 'v1.0-beta', tag_name: 'v1.0-beta' }),
      ]);
      const children = await provider.getChildren();
      const labels = children.map((c: any) => c.label);
      expect(labels).toContain('Drafts');
      expect(labels).not.toContain('Pre-releases');
    });

    test('shows only relevant groups', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockClient.listReleases.mockResolvedValue([
        makeRelease({ id: 1, draft: false, prerelease: false }),
        makeRelease({ id: 2, draft: false, prerelease: true }),
      ]);
      const children = await provider.getChildren();
      expect(children).toHaveLength(2);
      const labels = children.map((c: any) => c.label);
      expect(labels).toContain('Released');
      expect(labels).toContain('Pre-releases');
      expect(labels).not.toContain('Drafts');
    });

    test('returns error item on API failure', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockClient.listReleases.mockRejectedValue(new Error('Network error'));
      const children = await provider.getChildren();
      expect(children).toHaveLength(1);
      expect((children[0] as any).contextValue).toBe('error');
    });

    test('stores owner and repo from config', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockClient.listReleases.mockResolvedValue([]);
      await provider.getChildren();
      expect(provider.getOwner()).toBe('test-owner');
      expect(provider.getRepo()).toBe('test-repo');
    });
  });

  describe('getChildren (group level)', () => {
    test('returns ReleaseTreeItems for group children', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      const releases = [
        makeRelease({ id: 1, name: 'v1', tag_name: 'v1.0.0', draft: false, prerelease: false }),
        makeRelease({ id: 2, name: 'v2', tag_name: 'v2.0.0', draft: false, prerelease: false }),
      ];
      mockClient.listReleases.mockResolvedValue(releases);

      const groups = await provider.getChildren();
      const releasedGroup = groups.find((c: any) => c.label === 'Released') as any;
      expect(releasedGroup).toBeDefined();

      const items = await provider.getChildren(releasedGroup);
      expect(items).toHaveLength(2);
      expect(items[0]).toBeInstanceOf(ReleaseTreeItem);
      expect(items[1]).toBeInstanceOf(ReleaseTreeItem);
    });
  });

  describe('getTreeItem', () => {
    test('returns the element itself', () => {
      const release = makeRelease();
      const item = new ReleaseTreeItem(release, 'owner', 'repo');
      expect(provider.getTreeItem(item)).toBe(item);
    });
  });

  describe('refresh', () => {
    test('fires onDidChangeTreeData event', () => {
      const listener = jest.fn();
      provider.onDidChangeTreeData(listener);
      provider.refresh();
      expect(listener).toHaveBeenCalled();
    });
  });
});
