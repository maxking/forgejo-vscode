import * as vscode from 'vscode';
import { ReleaseGroupItem, ReleaseMessageItem, ReleaseRepositoryItem, ReleaseTreeItem, ReleaseTreeProvider } from '../../providers/releaseTreeProvider';
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

    test('uses stable IDs with repository, group, and release identity', () => {
      const release = makeRelease({ id: 42, name: 'Release', tag_name: 'v1.0.0' });
      const item = new ReleaseTreeItem(release, {
        instanceUrl: 'https://git.example.com/',
        owner: 'test-owner',
        repo: 'test-repo',
        rootPath: '/workspace/test-repo'
      }, undefined, 'released');

      expect(item.id).toBe('release-item/https%3A%2F%2Fgit.example.com/test-owner/test-repo/%2Fworkspace%2Ftest-repo/released/42');
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

    test('repository rows have unique stable IDs for duplicate display names', async () => {
      mockGetForgejoRepositoryConfigs.mockResolvedValue([
        { ...mockConfig, instanceUrl: 'https://git.example.com', owner: 'maxking', repo: 'forgejo-vscode', label: 'forgejo-vscode', rootPath: '/workspace/a' },
        { ...mockConfig, instanceUrl: 'https://git.example.com', owner: 'maxking', repo: 'forgejo-vscode', label: 'forgejo-vscode', rootPath: '/workspace/b' }
      ]);

      const children = await provider.getChildren();

      expect(children).toHaveLength(2);
      expect(children[0]).toBeInstanceOf(ReleaseRepositoryItem);
      expect(children[1]).toBeInstanceOf(ReleaseRepositoryItem);
      expect((children[0] as vscode.TreeItem).label).toBe('forgejo-vscode');
      expect((children[1] as vscode.TreeItem).label).toBe('forgejo-vscode');
      expect((children[0] as vscode.TreeItem).id).toBe('release-repository/https%3A%2F%2Fgit.example.com/maxking/forgejo-vscode/%2Fworkspace%2Fa');
      expect((children[1] as vscode.TreeItem).id).toBe('release-repository/https%3A%2F%2Fgit.example.com/maxking/forgejo-vscode/%2Fworkspace%2Fb');
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

	test('reuses releases until an explicit refresh', async () => {
		mockClient.listReleases.mockResolvedValue([makeRelease()]);

		await provider.getChildren();
		await provider.getChildren();
		expect(mockClient.listReleases).toHaveBeenCalledTimes(1);

		provider.refresh();
		await provider.getChildren();
		expect(mockClient.listReleases).toHaveBeenCalledTimes(2);
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

    test('group and release child IDs include repository and group identity for duplicate tags', async () => {
      mockGetForgejoRepositoryConfigs.mockResolvedValue([
        { ...mockConfig, owner: 'owner-a', repo: 'repo', label: 'owner-a/repo', rootPath: '/workspace/repo-a' },
        { ...mockConfig, owner: 'owner-b', repo: 'repo', label: 'owner-b/repo', rootPath: '/workspace/repo-b' },
      ]);
      mockClient.listReleases.mockResolvedValue([
        makeRelease({ id: undefined as any, name: 'Release', tag_name: 'v1.0.0', draft: false, prerelease: false }),
      ]);

      const repositories = await provider.getChildren();
      const firstGroups = await provider.getChildren(repositories[0]);
      const secondGroups = await provider.getChildren(repositories[1]);
      const firstRelease = (await provider.getChildren(firstGroups[0]))[0];
      const secondRelease = (await provider.getChildren(secondGroups[0]))[0];

      expect(firstGroups[0]).toBeInstanceOf(ReleaseGroupItem);
      expect(secondGroups[0]).toBeInstanceOf(ReleaseGroupItem);
      expect((firstGroups[0] as vscode.TreeItem).id).toBe('release-group/https%3A%2F%2Fgit.example.com/owner-a/repo/%2Fworkspace%2Frepo-a/released');
      expect((secondGroups[0] as vscode.TreeItem).id).toBe('release-group/https%3A%2F%2Fgit.example.com/owner-b/repo/%2Fworkspace%2Frepo-b/released');
      expect((firstRelease as vscode.TreeItem).label).toBe('Release');
      expect((secondRelease as vscode.TreeItem).label).toBe('Release');
      expect((firstRelease as vscode.TreeItem).id).toBe('release-item/https%3A%2F%2Fgit.example.com/owner-a/repo/%2Fworkspace%2Frepo-a/released/v1.0.0');
      expect((secondRelease as vscode.TreeItem).id).toBe('release-item/https%3A%2F%2Fgit.example.com/owner-b/repo/%2Fworkspace%2Frepo-b/released/v1.0.0');
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

  describe('ReleaseMessageItem', () => {
    test('uses repository-scoped stable IDs', () => {
      const item = new ReleaseMessageItem('No releases found', false, {
        instanceUrl: 'https://git.example.com/',
        owner: 'owner',
        repo: 'repo',
        rootPath: '/workspace/repo',
      }, 'empty');

      expect(item.id).toBe('release-message/info/https%3A%2F%2Fgit.example.com/owner/repo/%2Fworkspace%2Frepo/empty/No%20releases%20found');
    });
  });
});
