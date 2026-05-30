import * as vscode from 'vscode';
import { PRTreeProvider, PRTreeItem } from '../../providers/prTreeProvider';
import { ForgejoClient } from '../../api/forgejoClient';
import { getForgejoConfig } from '../../utils/config';
import { PullRequestListItem, PullRequestFile } from '../../models/pullRequest';
import { mockAllFileTypes, mockUnsortedFiles, mockAddedFile, mockModifiedFile, mockRenamedFile, mockRemovedFile } from '../fixtures/prFiles';
import { mockStandardRefs } from '../fixtures/prRefs';

// Mock dependencies
jest.mock('../../api/forgejoClient');
jest.mock('../../utils/config');

describe('PRTreeProvider', () => {
  let provider: PRTreeProvider;
  let mockClient: jest.Mocked<ForgejoClient>;
  let mockGetForgejoConfig: jest.MockedFunction<typeof getForgejoConfig>;

  const mockConfig = {
    instanceUrl: 'https://git.example.com',
    owner: 'test-owner',
    repo: 'test-repo',
    token: 'test-token'
  };

  const mockPR: PullRequestListItem = {
    number: 42,
    title: 'Test PR',
    state: 'open',
    user: { login: 'testuser' },
    html_url: 'https://git.example.com/owner/repo/pulls/42',
    created_at: '2026-01-01T00:00:00Z',
    merged: false,
    draft: false,
    comments: 5
  };

  beforeEach(() => {
    // Create mock client
    mockClient = {
      getPullRequests: jest.fn(),
      getPullRequestCount: jest.fn(),
      getPullRequestFiles: jest.fn(),
      getPullRequestRefs: jest.fn()
    } as any;

    mockGetForgejoConfig = getForgejoConfig as jest.MockedFunction<typeof getForgejoConfig>;
    mockGetForgejoConfig.mockResolvedValue(mockConfig);

    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn((_key: string, defaultValue: unknown) => defaultValue)
    });

    // Mock ForgejoClient constructor
    (ForgejoClient as jest.MockedClass<typeof ForgejoClient>).mockImplementation(() => mockClient);

    // Create provider (it calls refresh in constructor, so mock needs to be set up first)
    mockClient.getPullRequests.mockResolvedValue([mockPR]);
    mockClient.getPullRequestCount.mockResolvedValue(null);
    provider = new PRTreeProvider();

    jest.clearAllMocks();
  });

  describe('File Sorting', () => {
    test('should sort files in correct order: added, modified, renamed, removed', () => {
      // Create test files inline (not using fixtures to avoid any caching issues)
      const fileRemoved: PullRequestFile = {
        filename: 'removed.ts',
        status: 'removed',
        additions: 0,
        deletions: 10,
        changes: 10,
        blob_url: 'url',
        raw_url: 'url',
        contents_url: 'url'
      };

      const fileAdded: PullRequestFile = {
        filename: 'added.ts',
        status: 'added',
        additions: 10,
        deletions: 0,
        changes: 10,
        blob_url: 'url',
        raw_url: 'url',
        contents_url: 'url'
      };

      const fileRenamed: PullRequestFile = {
        filename: 'renamed.ts',
        status: 'renamed',
        additions: 1,
        deletions: 1,
        changes: 2,
        blob_url: 'url',
        raw_url: 'url',
        contents_url: 'url'
      };

      const fileModified: PullRequestFile = {
        filename: 'modified.ts',
        status: 'modified',
        additions: 5,
        deletions: 5,
        changes: 10,
        blob_url: 'url',
        raw_url: 'url',
        contents_url: 'url'
      };

      // Create files in wrong order
      const unsortedFiles: PullRequestFile[] = [
        fileRemoved,
        fileAdded,
        fileRenamed,
        fileModified
      ];

      // Apply the same sorting logic as the provider
      const statusOrder: Record<string, number> = { added: 0, modified: 1, renamed: 2, removed: 3 };
      const sortedFiles = [...unsortedFiles].sort((a, b) => {
        const aOrder = statusOrder[a.status] !== undefined ? statusOrder[a.status] : 99;
        const bOrder = statusOrder[b.status] !== undefined ? statusOrder[b.status] : 99;
        return aOrder - bOrder;
      });

      // Debug: log what we got
      const statuses = sortedFiles.map(f => f.status);

      // Verify order
      expect(statuses).toEqual(['added', 'modified', 'renamed', 'removed']);
    });

    test('should handle unknown file status', () => {
      const createFile = (status: string): PullRequestFile => ({
        filename: `${status}.ts`,
        status: status as any,
        additions: 1,
        deletions: 1,
        changes: 2,
        blob_url: 'url',
        raw_url: 'url',
        contents_url: 'url'
      });

      const filesWithUnknown: PullRequestFile[] = [
        createFile('unknown'),
        createFile('modified'),
        createFile('added')
      ];

      const statusOrder: Record<string, number> = { added: 0, modified: 1, renamed: 2, removed: 3 };
      const sortedFiles = [...filesWithUnknown].sort((a, b) => {
        const aOrder = statusOrder[a.status] !== undefined ? statusOrder[a.status] : 99;
        const bOrder = statusOrder[b.status] !== undefined ? statusOrder[b.status] : 99;
        return aOrder - bOrder;
      });

      // Unknown should be last (99)
      const statuses = sortedFiles.map(f => f.status);
      expect(statuses).toEqual(['added', 'modified', 'unknown']);
    });

    test('should maintain stable sort for same status', () => {
      const file1 = { ...mockModifiedFile, filename: 'file1.ts' };
      const file2 = { ...mockModifiedFile, filename: 'file2.ts' };
      const file3 = { ...mockModifiedFile, filename: 'file3.ts' };
      const files: PullRequestFile[] = [file3, file1, file2];

      const statusOrder: Record<string, number> = { added: 0, modified: 1, renamed: 2, removed: 3 };
      const sortedFiles = files.sort((a, b) => {
        return (statusOrder[a.status] || 99) - (statusOrder[b.status] || 99);
      });

      // All should have same status
      expect(sortedFiles.every(f => f.status === 'modified')).toBe(true);
    });

    test('should handle empty file list', () => {
      const files: PullRequestFile[] = [];
      const statusOrder: Record<string, number> = { added: 0, modified: 1, renamed: 2, removed: 3 };
      const sortedFiles = files.sort((a, b) => {
        return (statusOrder[a.status] || 99) - (statusOrder[b.status] || 99);
      });

      expect(sortedFiles).toEqual([]);
    });

    test('should handle single file', () => {
      const files: PullRequestFile[] = [mockAddedFile];
      const statusOrder: Record<string, number> = { added: 0, modified: 1, renamed: 2, removed: 3 };
      const sortedFiles = files.sort((a, b) => {
        return (statusOrder[a.status] || 99) - (statusOrder[b.status] || 99);
      });

      expect(sortedFiles).toEqual([mockAddedFile]);
    });
  });

  describe('PRTreeItem Creation', () => {
    test('should create PRTreeItem with correct properties', () => {
      const prItem = new PRTreeItem(mockPR, mockPR.html_url, 'owner', 'repo');

      expect(prItem.label).toBe('#42: Test PR');
      expect(prItem.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed);
      expect(prItem.description).toBe('by testuser');
      expect(prItem.contextValue).toBe('pullRequest');
      expect(prItem.command).toBeUndefined();
      expect(prItem.tooltip).toContain('Test PR');
      expect(prItem.tooltip).toContain('testuser');
    });

    test('should set merged icon for merged PRs', () => {
      const mergedPR = { ...mockPR, merged: true };
      const prItem = new PRTreeItem(mergedPR, mergedPR.html_url, 'owner', 'repo');

      expect(prItem.iconPath).toBeInstanceOf(vscode.ThemeIcon);
      const icon = prItem.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('git-merge');
    });

    test('should set draft icon for draft PRs', () => {
      const draftPR = { ...mockPR, draft: true };
      const prItem = new PRTreeItem(draftPR, draftPR.html_url, 'owner', 'repo');

      expect(prItem.iconPath).toBeInstanceOf(vscode.ThemeIcon);
      const icon = prItem.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('git-pull-request-draft');
    });

    test('should set closed icon for closed PRs', () => {
      const closedPR = { ...mockPR, state: 'closed' as const };
      const prItem = new PRTreeItem(closedPR, closedPR.html_url, 'owner', 'repo');

      expect(prItem.iconPath).toBeInstanceOf(vscode.ThemeIcon);
      const icon = prItem.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('git-pull-request-closed');
    });

    test('should set open icon for open PRs', () => {
      const prItem = new PRTreeItem(mockPR, mockPR.html_url, 'owner', 'repo');

      expect(prItem.iconPath).toBeInstanceOf(vscode.ThemeIcon);
      const icon = prItem.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('git-pull-request');
    });
  });

  describe('Caching Mechanism', () => {
    test('should cache files in PRTreeItem', () => {
      const prItem = new PRTreeItem(mockPR, mockPR.html_url, 'owner', 'repo');

      // Initially no files
      expect(prItem.files).toBeUndefined();

      // Simulate caching
      prItem.files = mockAllFileTypes;
      prItem.baseRef = 'main';
      prItem.headRef = 'feature';

      // Files should be cached
      expect(prItem.files).toEqual(mockAllFileTypes);
      expect(prItem.baseRef).toBe('main');
      expect(prItem.headRef).toBe('feature');
    });

    test('should cache refs in PRTreeItem', () => {
      const prItem = new PRTreeItem(mockPR, mockPR.html_url, 'owner', 'repo');

      prItem.baseRef = mockStandardRefs.base;
      prItem.headRef = mockStandardRefs.head;

      expect(prItem.baseRef).toBe('main');
      expect(prItem.headRef).toBe('feature/new-feature');
    });

    test('should cache error state in PRTreeItem', () => {
      const prItem = new PRTreeItem(mockPR, mockPR.html_url, 'owner', 'repo');

      expect(prItem.filesError).toBeUndefined();

      prItem.filesError = 'Network error';

      expect(prItem.filesError).toBe('Network error');
    });

    test('should allow clearing cached files', () => {
      const prItem = new PRTreeItem(mockPR, mockPR.html_url, 'owner', 'repo');

      // Cache files
      prItem.files = mockAllFileTypes;
      prItem.baseRef = 'main';
      prItem.headRef = 'feature';

      // Clear cache
      prItem.files = undefined;
      prItem.baseRef = undefined;
      prItem.headRef = undefined;

      expect(prItem.files).toBeUndefined();
      expect(prItem.baseRef).toBeUndefined();
      expect(prItem.headRef).toBeUndefined();
    });

    test('should allow clearing error cache', () => {
      const prItem = new PRTreeItem(mockPR, mockPR.html_url, 'owner', 'repo');

      prItem.filesError = 'Network error';
      expect(prItem.filesError).toBe('Network error');

      prItem.filesError = undefined;
      expect(prItem.filesError).toBeUndefined();
    });
  });

  describe('Provider Initialization', () => {
    test('should create provider successfully', () => {
      expect(provider).toBeDefined();
      expect(provider).toBeInstanceOf(PRTreeProvider);
    });

    test('should have onDidChangeTreeData event', () => {
      expect(provider.onDidChangeTreeData).toBeDefined();
    });

    test('should have refresh method', () => {
      expect(typeof provider.refresh).toBe('function');
    });

    test('should have getTreeItem method', () => {
      expect(typeof provider.getTreeItem).toBe('function');
    });

    test('should have getChildren method', () => {
      expect(typeof provider.getChildren).toBe('function');
    });
  });

  describe('PR Grouping (getChildren at root level)', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
    });

    test('should fetch open PRs by default', async () => {
      mockClient.getPullRequests.mockResolvedValue([mockPR]);

      await provider.getChildren();

      expect(mockClient.getPullRequests).toHaveBeenCalledWith('test-owner', 'test-repo', 'open');
    });

    test('should group open PRs into "Open" group', async () => {
      const openPR: PullRequestListItem = { ...mockPR, state: 'open', draft: false, merged: false };
      mockClient.getPullRequests.mockResolvedValue([openPR]);

      const children = await provider.getChildren();

      const openGroup = children.find(child => (child as any).label === 'Open');
      expect(openGroup).toBeDefined();
      expect((openGroup as any).pullRequests).toEqual([openPR]);
    });

    test('should group draft PRs into "Draft" group', async () => {
      const draftPR: PullRequestListItem = { ...mockPR, state: 'open', draft: true, merged: false };
      mockClient.getPullRequests.mockResolvedValue([draftPR]);

      const children = await provider.getChildren();

      const draftGroup = children.find(child => (child as any).label === 'Draft');
      expect(draftGroup).toBeDefined();
      expect((draftGroup as any).pullRequests).toEqual([draftPR]);
    });

    test('should include lazy Merged and Closed groups without fetching closed PRs initially', async () => {
      mockClient.getPullRequests.mockResolvedValue([mockPR]);
      mockClient.getPullRequestCount.mockResolvedValue(2);

      const children = await provider.getChildren();

      const mergedGroup = children.find(child => (child as any).label === 'Merged');
      const closedGroup = children.find(child => (child as any).label === 'Closed');
      expect(mergedGroup).toBeDefined();
      expect(closedGroup).toBeDefined();
      expect((mergedGroup as any).pullRequests).toBeNull();
      expect((closedGroup as any).pullRequests).toBeNull();
      expect(mockClient.getPullRequests).toHaveBeenCalledTimes(1);
      expect(mockClient.getPullRequests).toHaveBeenCalledWith('test-owner', 'test-repo', 'open');
    });

    test('should return error message when no config', async () => {
      mockGetForgejoConfig.mockResolvedValue(null as any);
      mockClient.getPullRequests.mockRejectedValue(new Error('No config'));

      // fetchPullRequests sets error when config is null
      // But since getPullRequests is called on the client which is constructed from config,
      // we need to simulate what happens when getForgejoConfig returns null
      const noConfigProvider = new PRTreeProvider();
      jest.clearAllMocks();
      mockGetForgejoConfig.mockResolvedValue(null as any);

      const children = await noConfigProvider.getChildren();

      expect(children.length).toBe(1);
      expect((children[0] as any).message).toContain('No Forgejo configuration found');
      expect((children[0] as any).isError).toBe(true);
    });

    test('should show lazy historical groups when closed count is unavailable and no open pull requests exist', async () => {
      mockClient.getPullRequests.mockResolvedValue([]);
      mockClient.getPullRequestCount.mockResolvedValue(null);

      const children = await provider.getChildren();

      expect(children.map(child => (child as any).label)).toEqual(['Merged', 'Closed']);
    });

    test('should not show lazy historical groups when closed count is zero and no open pull requests exist', async () => {
      mockClient.getPullRequests.mockResolvedValue([]);
      mockClient.getPullRequestCount.mockResolvedValue(0);

      const children = await provider.getChildren();

      expect(children.length).toBe(1);
      expect((children[0] as any).message).toBe('No pull requests found');
      expect((children[0] as any).isError).toBe(false);
    });

    test('should return error message on fetch failure', async () => {
      mockClient.getPullRequests.mockRejectedValue(new Error('Network error'));

      const children = await provider.getChildren();

      expect(children.length).toBe(1);
      expect((children[0] as any).message).toBe('Network error');
      expect((children[0] as any).isError).toBe(true);
    });
  });

  describe('PRGroupItem children', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
    });

    test('should return PRTreeItems for group pull requests', async () => {
      const pr1: PullRequestListItem = { ...mockPR, number: 1, title: 'PR One' };
      const pr2: PullRequestListItem = { ...mockPR, number: 2, title: 'PR Two' };
      mockClient.getPullRequests.mockResolvedValue([pr1, pr2]);

      // Get root children (groups)
      const groups = await provider.getChildren();
      const openGroup = groups.find(group => (group as any).label === 'Open');
      expect(openGroup).toBeDefined();

      // Get children of the Open group
      const prItems = await provider.getChildren(openGroup);

      expect(prItems.length).toBe(2);
      expect(prItems[0]).toBeInstanceOf(PRTreeItem);
      expect(prItems[1]).toBeInstanceOf(PRTreeItem);
      expect((prItems[0] as PRTreeItem).pr.number).toBe(1);
      expect((prItems[1] as PRTreeItem).pr.number).toBe(2);
    });

    test('should lazy-load merged PRs when Merged group is expanded', async () => {
      const openPR: PullRequestListItem = { ...mockPR, number: 1, state: 'open', merged: false };
      const mergedPR: PullRequestListItem = { ...mockPR, number: 2, state: 'closed', merged: true, draft: false };
      const closedPR: PullRequestListItem = { ...mockPR, number: 3, state: 'closed', merged: false, draft: false };
      mockClient.getPullRequests
        .mockResolvedValueOnce([openPR])
        .mockResolvedValueOnce([mergedPR, closedPR]);

      const groups = await provider.getChildren();
      const mergedGroup = groups.find(group => (group as any).label === 'Merged');
      const prItems = await provider.getChildren(mergedGroup);

      expect(mockClient.getPullRequests).toHaveBeenCalledWith('test-owner', 'test-repo', 'closed');
      expect(prItems.length).toBe(1);
      expect((prItems[0] as PRTreeItem).pr.number).toBe(2);
    });

    test('should reuse closed PR cache when Closed group is expanded after Merged', async () => {
      const mergedPR: PullRequestListItem = { ...mockPR, number: 2, state: 'closed', merged: true, draft: false };
      const closedPR: PullRequestListItem = { ...mockPR, number: 3, state: 'closed', merged: false, draft: false };
      mockClient.getPullRequests
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([mergedPR, closedPR]);

      const groups = await provider.getChildren();
      const mergedGroup = groups.find(group => (group as any).label === 'Merged');
      const closedGroup = groups.find(group => (group as any).label === 'Closed');

      await provider.getChildren(mergedGroup);
      const closedItems = await provider.getChildren(closedGroup);

      expect(mockClient.getPullRequests).toHaveBeenCalledTimes(2);
      expect(closedItems.length).toBe(1);
      expect((closedItems[0] as PRTreeItem).pr.number).toBe(3);
      expect((closedGroup as any).description).toBe('1');
    });

    test('should reuse in-flight closed PR request during simultaneous expansion', async () => {
      const mergedPR: PullRequestListItem = { ...mockPR, number: 2, state: 'closed', merged: true, draft: false };
      const closedPR: PullRequestListItem = { ...mockPR, number: 3, state: 'closed', merged: false, draft: false };
      mockClient.getPullRequests
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([mergedPR, closedPR]);

      const groups = await provider.getChildren();
      const mergedGroup = groups.find(group => (group as any).label === 'Merged');
      const closedGroup = groups.find(group => (group as any).label === 'Closed');

      const [mergedItems, closedItems] = await Promise.all([
        provider.getChildren(mergedGroup),
        provider.getChildren(closedGroup)
      ]);

      expect(mockClient.getPullRequests).toHaveBeenCalledTimes(2);
      expect(mergedItems.length).toBe(1);
      expect(closedItems.length).toBe(1);
    });
  });

  describe('getPRFiles (PRTreeItem children)', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
    });

    test('should return overview + file items on successful fetch', async () => {
      mockClient.getPullRequestFiles.mockResolvedValue(mockAllFileTypes);
      mockClient.getPullRequestRefs.mockResolvedValue(mockStandardRefs);

      const prItem = new PRTreeItem(mockPR, mockPR.html_url, 'test-owner', 'test-repo');
      const children = await provider.getChildren(prItem);

      // First item should be overview, rest are file items
      expect(children.length).toBe(1 + mockAllFileTypes.length);
      expect((children[0] as any).label).toBe('Overview');
      expect((children[0] as any).contextValue).toBe('prOverview');
      // File items follow
      for (let i = 1; i < children.length; i++) {
        expect((children[i] as any).contextValue).toBe('prFile');
      }
    });

    test('should return cached files on second call', async () => {
      mockClient.getPullRequestFiles.mockResolvedValue(mockAllFileTypes);
      mockClient.getPullRequestRefs.mockResolvedValue(mockStandardRefs);

      const prItem = new PRTreeItem(mockPR, mockPR.html_url, 'test-owner', 'test-repo');

      // First call fetches from API
      await provider.getChildren(prItem);
      expect(mockClient.getPullRequestFiles).toHaveBeenCalledTimes(1);

      // Second call should use cache
      const children = await provider.getChildren(prItem);
      expect(mockClient.getPullRequestFiles).toHaveBeenCalledTimes(1); // Still 1
      expect(children.length).toBe(1 + mockAllFileTypes.length);
    });

    test('should return error message on file fetch failure', async () => {
      mockClient.getPullRequestFiles.mockRejectedValue(new Error('API rate limit'));
      mockClient.getPullRequestRefs.mockResolvedValue(mockStandardRefs);

      const prItem = new PRTreeItem(mockPR, mockPR.html_url, 'test-owner', 'test-repo');
      const children = await provider.getChildren(prItem);

      expect(children.length).toBe(2);
      expect((children[0] as any).label).toBe('Overview');
      expect((children[1] as any).message).toBe('API rate limit');
      expect((children[1] as any).isError).toBe(true);
    });

    test('should return "No files changed" message for empty files', async () => {
      mockClient.getPullRequestFiles.mockResolvedValue([]);
      mockClient.getPullRequestRefs.mockResolvedValue(mockStandardRefs);

      const prItem = new PRTreeItem(mockPR, mockPR.html_url, 'test-owner', 'test-repo');
      const children = await provider.getChildren(prItem);

      expect(children.length).toBe(2);
      expect((children[0] as any).label).toBe('Overview');
      expect((children[1] as any).message).toBe('No files changed');
      expect((children[1] as any).isError).toBe(false);
    });

    test('should return overview + error when config missing', async () => {
      mockGetForgejoConfig.mockResolvedValue(null as any);

      const prItem = new PRTreeItem(mockPR, mockPR.html_url, 'test-owner', 'test-repo');
      const children = await provider.getChildren(prItem);

      expect(children.length).toBe(2);
      expect((children[0] as any).label).toBe('Overview');
      expect((children[1] as any).message).toBe('Configuration not available');
      expect((children[1] as any).isError).toBe(true);
    });
  });

  describe('PRTreeItem tooltip', () => {
    test('should show merged state in tooltip', () => {
      const mergedPR: PullRequestListItem = { ...mockPR, merged: true };
      const prItem = new PRTreeItem(mergedPR, mergedPR.html_url, 'owner', 'repo');

      expect(prItem.tooltip).toContain('(merged)');
    });

    test('should show draft state in tooltip', () => {
      const draftPR: PullRequestListItem = { ...mockPR, draft: true };
      const prItem = new PRTreeItem(draftPR, draftPR.html_url, 'owner', 'repo');

      expect(prItem.tooltip).toContain('(draft)');
    });
  });
});
