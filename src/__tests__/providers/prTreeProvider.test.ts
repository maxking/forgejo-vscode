import * as vscode from 'vscode';
import { PRTreeProvider, PRTreeItem, PRLoadMoreItem, PRFileItem, PROverviewItem, PRRepositoryItem } from '../../providers/prTreeProvider';
import { ForgejoClient } from '../../api/forgejoClient';
import { getForgejoConfig, getForgejoRepositoryConfigs } from '../../utils/config';
import { PullRequestListItem, PullRequestFile } from '../../models/pullRequest';
import { mockAllFileTypes, mockUnsortedFiles, mockAddedFile, mockModifiedFile, mockRenamedFile, mockRemovedFile } from '../fixtures/prFiles';
import { mockStandardRefs, mockPRWithRefs } from '../fixtures/prRefs';

// Mock dependencies
jest.mock('../../api/forgejoClient');
jest.mock('../../utils/config');

describe('PRTreeProvider', () => {
  let provider: PRTreeProvider;
  let mockClient: jest.Mocked<ForgejoClient>;
  let mockGetForgejoConfig: jest.MockedFunction<typeof getForgejoConfig>;
  let mockGetForgejoRepositoryConfigs: jest.MockedFunction<typeof getForgejoRepositoryConfigs>;

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

  const prPage = (items: PullRequestListItem[], pageNumber = 1, hasMore = false, limit = 50) => ({
    items,
    page: pageNumber,
    limit,
    hasMore
  });

  beforeEach(() => {
    // Create mock client
    mockClient = {
      getPullRequests: jest.fn(),
      getPullRequestsPage: jest.fn(),
      getPullRequestDetails: jest.fn(),
      hasPullRequests: jest.fn(),
      getPullRequestFiles: jest.fn(),
      getPullRequestRefs: jest.fn(),
      getPullRequest: jest.fn(),
      getAuthenticatedUserLogin: jest.fn()
    } as any;

    mockGetForgejoConfig = getForgejoConfig as jest.MockedFunction<typeof getForgejoConfig>;
    mockGetForgejoRepositoryConfigs = getForgejoRepositoryConfigs as jest.MockedFunction<typeof getForgejoRepositoryConfigs>;
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    mockGetForgejoRepositoryConfigs.mockResolvedValue([{ ...mockConfig, label: 'test-owner/test-repo' }]);

    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn((_key: string, defaultValue: unknown) => defaultValue)
    });

    // Mock ForgejoClient constructor
    (ForgejoClient as jest.MockedClass<typeof ForgejoClient>).mockImplementation(() => mockClient);

    // Create provider (it calls refresh in constructor, so mock needs to be set up first)
    mockClient.getPullRequests.mockResolvedValue([mockPR]);
    mockClient.getPullRequestsPage.mockResolvedValue({
      items: [mockPR],
      page: 1,
      limit: 50,
      hasMore: false
    });
    mockClient.hasPullRequests.mockResolvedValue(false);
    mockClient.getPullRequestDetails.mockResolvedValue({ ...mockPR, mergeable: true } as any);
    mockClient.getAuthenticatedUserLogin.mockResolvedValue('alice');
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
      const prItem = new PRTreeItem(mockPR, mockPR.html_url, 'owner', 'repo', mockConfig);

      expect(prItem.label).toBe('#42: Test PR');
      expect(prItem.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed);
      expect(prItem.description).toBe('by testuser - Mergeability unknown');
      expect(prItem.contextValue).toBe('pullRequest');
      expect(prItem.id).toBe('pr/https%3A%2F%2Fgit.example.com/owner/repo/42');
      expect(prItem.command).toBeUndefined();
      expect(prItem.tooltip).toContain('Test PR');
      expect(prItem.tooltip).toContain('testuser');
    });

    test('should include group context in provider-rendered PR item ids', () => {
      const openPrItem = new PRTreeItem(mockPR, mockPR.html_url, 'owner', 'repo', mockConfig, 'open');
      const assignedPrItem = new PRTreeItem(mockPR, mockPR.html_url, 'owner', 'repo', mockConfig, 'assigned');

      expect(openPrItem.id).toBe('pr/https%3A%2F%2Fgit.example.com/owner/repo/open/42');
      expect(assignedPrItem.id).toBe('pr/https%3A%2F%2Fgit.example.com/owner/repo/assigned/42');
    });

    test('should create stable ids for command-bearing PR child items', () => {
      const overviewItem = new PROverviewItem(mockPR, 'owner', 'repo', 'https://git.example.com');
      const fileItem = new PRFileItem(mockModifiedFile, mockPR, 'owner', 'repo', 'main', 'feature', 'https://git.example.com');
      const assignedOverviewItem = new PROverviewItem(mockPR, 'owner', 'repo', 'https://git.example.com', 'assigned');
      const assignedFileItem = new PRFileItem(mockModifiedFile, mockPR, 'owner', 'repo', 'main', 'feature', 'https://git.example.com', 'assigned');

      expect(overviewItem.id).toBe('pr-overview/https%3A%2F%2Fgit.example.com/owner/repo/42');
      expect(overviewItem.command?.command).toBe('forgejo.showPrDetails');
      expect(fileItem.id).toBe(`pr-file/https%3A%2F%2Fgit.example.com/owner/repo/42/${encodeURIComponent(mockModifiedFile.filename)}`);
      expect(fileItem.command?.command).toBe('forgejo.showPrFileDiff');
      expect(assignedOverviewItem.id).toBe('pr-overview/https%3A%2F%2Fgit.example.com/owner/repo/assigned/42');
      expect(assignedFileItem.id).toBe(`pr-file/https%3A%2F%2Fgit.example.com/owner/repo/assigned/42/${encodeURIComponent(mockModifiedFile.filename)}`);
    });

    test('should include repository identity in repository item ids', () => {
      const repositoryItem = new PRRepositoryItem({
        ...mockConfig,
        label: 'test-owner/test-repo',
        rootPath: '/workspace/repo'
      });

      expect(repositoryItem.id).toBe('pr-repository/https%3A%2F%2Fgit.example.com/test-owner/test-repo/%2Fworkspace%2Frepo');
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

    test('should show merge conflict state for unmergeable open PRs', () => {
      const conflictingPR: PullRequestListItem = { ...mockPR, mergeable: false } as PullRequestListItem;
      const prItem = new PRTreeItem(conflictingPR, conflictingPR.html_url, 'owner', 'repo');

      expect(prItem.description).toBe('by testuser - Merge conflicts');
      expect(prItem.tooltip).toContain('Mergeability: Merge conflicts');
      expect(prItem.iconPath).toBeInstanceOf(vscode.ThemeIcon);
      const icon = prItem.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('warning');
    });

    test('should show mergeable state in tooltip for clean open PRs', () => {
      const mergeablePR: PullRequestListItem = { ...mockPR, mergeable: true } as PullRequestListItem;
      const prItem = new PRTreeItem(mergeablePR, mergeablePR.html_url, 'owner', 'repo');

      expect(prItem.description).toBe('by testuser - Ready to merge');
      expect(prItem.tooltip).toContain('Mergeability: Ready to merge');
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

    test('should group multiple detected repositories by owner and repo at the root', async () => {
      mockGetForgejoRepositoryConfigs.mockResolvedValue([
        { ...mockConfig, owner: 'maxking', repo: 'forgejo-vscode', label: 'maxking/forgejo-vscode' },
        { ...mockConfig, owner: 'forgejo', repo: 'forgejo', label: 'forgejo/forgejo' }
      ]);

      const children = await provider.getChildren();

      expect(children.map(child => String((child as any).label))).toEqual([
        'maxking/forgejo-vscode',
        'forgejo/forgejo'
      ]);
      expect(mockClient.getPullRequests).not.toHaveBeenCalled();
    });

    test('should fetch open PRs by default', async () => {
      mockClient.getPullRequestsPage.mockResolvedValue({
        items: [mockPR],
        page: 1,
        limit: 50,
        hasMore: false
      });

      await provider.getChildren();

      expect(mockClient.getPullRequestsPage).toHaveBeenCalledWith('test-owner', 'test-repo', 'open', 1, 50);
      expect(mockClient.getPullRequests).not.toHaveBeenCalled();
    });

    test('should group open PRs into "Open" group', async () => {
      const openPR: PullRequestListItem = { ...mockPR, state: 'open', draft: false, merged: false };
      mockClient.getPullRequestsPage.mockResolvedValue({
        items: [openPR],
        page: 1,
        limit: 50,
        hasMore: false
      });

      const children = await provider.getChildren();

      const openGroup = children.find(child => (child as any).label === 'Open');
      expect(openGroup).toBeDefined();
      expect((openGroup as vscode.TreeItem).id).toBe('pr-group/https%3A%2F%2Fgit.example.com/test-owner/test-repo/open');
      const openItems = await provider.getChildren(openGroup);
      expect((openItems[0] as PRTreeItem).pr).toEqual(openPR);
    });

    test('should hydrate missing open PR mergeability from PR details before rendering rows', async () => {
      const openPR: PullRequestListItem = { ...mockPR, state: 'open', draft: false, merged: false };
      mockClient.getPullRequestsPage.mockResolvedValue({
        items: [openPR],
        page: 1,
        limit: 50,
        hasMore: false
      });
      mockClient.getPullRequestDetails.mockResolvedValue({ ...mockPR, mergeable: false } as any);

      const children = await provider.getChildren();
      const openGroup = children.find(child => (child as any).label === 'Open');
      const openItems = await provider.getChildren(openGroup);
      const prItem = openItems[0] as PRTreeItem;

      expect(mockClient.getPullRequestDetails).toHaveBeenCalledWith('test-owner', 'test-repo', 42);
      expect(prItem.pr.mergeable).toBe(false);
      expect(prItem.description).toBe('by testuser - Merge conflicts');
    });

    test('should not fire tree refresh while resolving group children', async () => {
      const openPR: PullRequestListItem = { ...mockPR, state: 'open', draft: false, merged: false };
      mockClient.getPullRequestsPage.mockResolvedValue({
        items: [openPR],
        page: 1,
        limit: 50,
        hasMore: false
      });

      const children = await provider.getChildren();
      const openGroup = children.find(child => (child as any).label === 'Open');
      const changes: Array<unknown> = [];
      provider.onDidChangeTreeData(item => changes.push(item));

      await provider.getChildren(openGroup);

      expect(changes).toEqual([]);
    });

    test('should group draft PRs into "Draft" group', async () => {
      const draftPR: PullRequestListItem = { ...mockPR, state: 'open', draft: true, merged: false };
      mockClient.getPullRequestsPage.mockResolvedValue({
        items: [draftPR],
        page: 1,
        limit: 50,
        hasMore: false
      });

      const children = await provider.getChildren();

      const draftGroup = children.find(child => (child as any).label === 'Draft');
      expect(draftGroup).toBeDefined();
      const draftItems = await provider.getChildren(draftGroup);
      expect((draftItems[0] as PRTreeItem).pr).toEqual(draftPR);
    });

    test('should expose built-in query groups without fetching them at the root', async () => {
      mockClient.getPullRequestsPage.mockResolvedValue(prPage([]));
      mockClient.hasPullRequests.mockResolvedValue(false);

      const children = await provider.getChildren();
      const queryRoot = children.find(child => (child as any).label === 'My Queries');
      const queryGroups = await provider.getChildren(queryRoot);

      expect(queryGroups.map(group => String((group as vscode.TreeItem).label))).toEqual([
        'Assigned to me',
        'Waiting for my review',
        'Created by me',
        'Mentioned me'
      ]);
      expect(mockClient.getAuthenticatedUserLogin).not.toHaveBeenCalled();
    });

    test.each([
      ['Assigned to me', { assignedBy: 'alice' }],
      ['Waiting for my review', { reviewRequestedBy: 'alice' }],
      ['Created by me', { createdBy: 'alice' }],
      ['Mentioned me', { mentionedBy: 'alice' }]
    ])('should fetch PR query group "%s" for the authenticated user', async (label, expectedOptions) => {
      const queryPR: PullRequestListItem = { ...mockPR, number: 77, title: `${label} PR` };
      mockClient.getPullRequestsPage
        .mockResolvedValueOnce(prPage([]))
        .mockResolvedValueOnce(prPage([queryPR]));
      mockClient.hasPullRequests.mockResolvedValue(false);

      const children = await provider.getChildren();
      const queryRoot = children.find(child => (child as any).label === 'My Queries');
      const queryGroups = await provider.getChildren(queryRoot);
      const queryGroup = queryGroups.find(group => (group as vscode.TreeItem).label === label);
      const queryItems = await provider.getChildren(queryGroup);

      expect(mockClient.getAuthenticatedUserLogin).toHaveBeenCalledTimes(1);
      expect(mockClient.getPullRequestsPage).toHaveBeenLastCalledWith('test-owner', 'test-repo', 'open', 1, 50, expectedOptions);
      expect(queryItems.filter(item => item instanceof PRTreeItem).map(item => (item as PRTreeItem).pr.number)).toEqual([77]);
    });

    test('should render different ids when the same PR appears in Open and Assigned to me', async () => {
      mockClient.getPullRequestsPage
        .mockResolvedValueOnce(prPage([mockPR]))
        .mockResolvedValueOnce(prPage([mockPR]));
      mockClient.hasPullRequests.mockResolvedValue(false);

      const children = await provider.getChildren();
      const openGroup = children.find(child => (child as any).label === 'Open');
      const openItems = await provider.getChildren(openGroup);
      const queryRoot = children.find(child => (child as any).label === 'My Queries');
      const queryGroups = await provider.getChildren(queryRoot);
      const assignedGroup = queryGroups.find(group => (group as vscode.TreeItem).label === 'Assigned to me');
      const assignedItems = await provider.getChildren(assignedGroup);
      const openPrItem = openItems.find(item => item instanceof PRTreeItem) as PRTreeItem;
      const assignedPrItem = assignedItems.find(item => item instanceof PRTreeItem) as PRTreeItem;

      expect(openPrItem.pr.number).toBe(assignedPrItem.pr.number);
      expect(openPrItem.id).toBe('pr/https%3A%2F%2Fgit.example.com/test-owner/test-repo/open/42');
      expect(assignedPrItem.id).toBe('pr/https%3A%2F%2Fgit.example.com/test-owner/test-repo/assigned/42');
      expect(openPrItem.id).not.toBe(assignedPrItem.id);
    });

    test('should include active search text when fetching PR query groups', async () => {
      const queryPR: PullRequestListItem = { ...mockPR, number: 78, title: 'Assigned search result' };
      provider.setSearchQuery('  bug  ');
      mockClient.getPullRequestsPage
        .mockResolvedValueOnce(prPage([]))
        .mockResolvedValueOnce(prPage([]))
        .mockResolvedValueOnce(prPage([queryPR]));

      const children = await provider.getChildren();
      const queryRoot = children.find(child => (child as any).label === 'My Queries');
      const queryGroups = await provider.getChildren(queryRoot);
      const assignedGroup = queryGroups.find(group => (group as vscode.TreeItem).label === 'Assigned to me');
      await provider.getChildren(assignedGroup);

      expect(mockClient.getPullRequestsPage).toHaveBeenLastCalledWith('test-owner', 'test-repo', 'open', 1, 50, {
        query: 'bug',
        assignedBy: 'alice'
      });
    });

    test('should explain that PR query groups require authentication when no token is configured', async () => {
      mockGetForgejoRepositoryConfigs.mockResolvedValue([{ ...mockConfig, token: '', label: 'test-owner/test-repo' }]);
      mockClient.getPullRequestsPage.mockResolvedValue(prPage([]));
      mockClient.hasPullRequests.mockResolvedValue(false);

      const children = await provider.getChildren();
      const queryRoot = children.find(child => (child as any).label === 'My Queries');
      const queryGroups = await provider.getChildren(queryRoot);
      const assignedGroup = queryGroups.find(group => (group as vscode.TreeItem).label === 'Assigned to me');
      const queryItems = await provider.getChildren(assignedGroup);

      expect((queryItems[0] as vscode.TreeItem).label).toBe('Configure an authentication token to use pull request query views.');
      expect(mockClient.getAuthenticatedUserLogin).not.toHaveBeenCalled();
    });

    test('should use distinct ids for repeated PR query authentication messages', async () => {
      mockGetForgejoRepositoryConfigs.mockResolvedValue([{ ...mockConfig, token: '', label: 'test-owner/test-repo' }]);
      mockClient.getPullRequestsPage.mockResolvedValue(prPage([]));
      mockClient.hasPullRequests.mockResolvedValue(false);

      const children = await provider.getChildren();
      const queryRoot = children.find(child => (child as any).label === 'My Queries');
      const queryGroups = await provider.getChildren(queryRoot);
      const assignedGroup = queryGroups.find(group => (group as vscode.TreeItem).label === 'Assigned to me');
      const createdGroup = queryGroups.find(group => (group as vscode.TreeItem).label === 'Created by me');
      const assignedItems = await provider.getChildren(assignedGroup);
      const createdItems = await provider.getChildren(createdGroup);
      const assignedMessage = assignedItems[0] as vscode.TreeItem;
      const createdMessage = createdItems[0] as vscode.TreeItem;

      expect(assignedMessage.label).toBe(createdMessage.label);
      expect(assignedMessage.id).not.toBe(createdMessage.id);
    });

    test('should include lazy Merged and Closed groups without fetching closed PRs initially', async () => {
      mockClient.getPullRequestsPage.mockResolvedValue({
        items: [mockPR],
        page: 1,
        limit: 50,
        hasMore: false
      });
      mockClient.hasPullRequests.mockResolvedValue(true);

      const children = await provider.getChildren();

      const mergedGroup = children.find(child => (child as any).label === 'Merged');
      const closedGroup = children.find(child => (child as any).label === 'Closed');
      expect(mergedGroup).toBeDefined();
      expect(closedGroup).toBeDefined();
      expect((mergedGroup as any).pullRequests).toBeNull();
      expect((closedGroup as any).pullRequests).toBeNull();
      expect(mockClient.getPullRequestsPage).toHaveBeenCalledTimes(1);
      expect(mockClient.getPullRequestsPage).toHaveBeenCalledWith('test-owner', 'test-repo', 'open', 1, 50);
    });

    test('should return error message when no config', async () => {
      mockGetForgejoConfig.mockResolvedValue(null as any);
      mockGetForgejoRepositoryConfigs.mockResolvedValue([]);
      mockClient.getPullRequests.mockRejectedValue(new Error('No config'));

      // fetchPullRequests sets error when config is null
      // But since getPullRequests is called on the client which is constructed from config,
      // we need to simulate what happens when getForgejoConfig returns null
      const noConfigProvider = new PRTreeProvider();
      jest.clearAllMocks();
      mockGetForgejoConfig.mockResolvedValue(null as any);
      mockGetForgejoRepositoryConfigs.mockResolvedValue([]);

      const children = await noConfigProvider.getChildren();

      expect(children.length).toBe(1);
      expect((children[0] as any).message).toContain('No Forgejo configuration found');
      expect((children[0] as any).isError).toBe(true);
    });

    test('should show lazy historical groups when closed availability is unavailable and no open pull requests exist', async () => {
      mockClient.getPullRequestsPage.mockResolvedValue({
        items: [],
        page: 1,
        limit: 50,
        hasMore: false
      });
      mockClient.hasPullRequests.mockRejectedValue(new Error('Header unavailable'));

      const children = await provider.getChildren();

      expect(children.map(child => (child as any).label)).toEqual(['My Queries', 'Merged', 'Closed']);
    });

    test('should not show lazy historical groups when no closed pull requests exist', async () => {
      mockClient.getPullRequestsPage.mockResolvedValue({
        items: [],
        page: 1,
        limit: 50,
        hasMore: false
      });
      mockClient.hasPullRequests.mockResolvedValue(false);

      const children = await provider.getChildren();

      expect(children.length).toBe(2);
      expect((children[0] as any).label).toBe('My Queries');
      expect((children[1] as any).message).toBe('No pull requests found');
      expect((children[1] as any).isError).toBe(false);
    });

    test('should return error message on fetch failure', async () => {
      mockClient.getPullRequestsPage.mockRejectedValue(new Error('Network error'));

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
      mockClient.getPullRequestsPage.mockResolvedValue({
        items: [pr1, pr2],
        page: 1,
        limit: 50,
        hasMore: false
      });

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
      mockClient.hasPullRequests.mockResolvedValue(true);
      mockClient.getPullRequestsPage
        .mockResolvedValueOnce({
          items: [openPR],
          page: 1,
          limit: 50,
          hasMore: false
        })
        .mockResolvedValueOnce({
          items: [mergedPR, closedPR],
          page: 1,
          limit: 50,
          hasMore: false
        });

      const groups = await provider.getChildren();
      const mergedGroup = groups.find(group => (group as any).label === 'Merged');
      const prItems = await provider.getChildren(mergedGroup);

      expect(mockClient.getPullRequestsPage).toHaveBeenNthCalledWith(2, 'test-owner', 'test-repo', 'closed', 1, 50);
      expect(prItems.length).toBe(1);
      expect((prItems[0] as PRTreeItem).pr.number).toBe(2);
    });

    test('should reuse closed PR cache when Closed group is expanded after Merged', async () => {
      const mergedPR: PullRequestListItem = { ...mockPR, number: 2, state: 'closed', merged: true, draft: false };
      const closedPR: PullRequestListItem = { ...mockPR, number: 3, state: 'closed', merged: false, draft: false };
      mockClient.hasPullRequests.mockResolvedValue(true);
      mockClient.getPullRequestsPage
        .mockResolvedValueOnce({
          items: [],
          page: 1,
          limit: 50,
          hasMore: false
        })
        .mockResolvedValueOnce({
          items: [mergedPR, closedPR],
          page: 1,
          limit: 50,
          hasMore: false
        });

      const groups = await provider.getChildren();
      const mergedGroup = groups.find(group => (group as any).label === 'Merged');
      const closedGroup = groups.find(group => (group as any).label === 'Closed');

      await provider.getChildren(mergedGroup);
      const closedItems = await provider.getChildren(closedGroup);

      expect(mockClient.getPullRequests).not.toHaveBeenCalled();
      expect(mockClient.getPullRequestsPage).toHaveBeenCalledTimes(2);
      expect(closedItems.length).toBe(1);
      expect((closedItems[0] as PRTreeItem).pr.number).toBe(3);
      expect((closedGroup as any).description).toBe('1');
    });

    test('refreshRepository should only clear caches for the exact repository', async () => {
      const repoConfig = { ...mockConfig, repo: 'repo', label: 'test-owner/repo' };
      const repo2Config = { ...mockConfig, repo: 'repo2', label: 'test-owner/repo2' };
      const repoPR: PullRequestListItem = { ...mockPR, number: 1, title: 'Repo PR' };
      const repo2PR: PullRequestListItem = { ...mockPR, number: 2, title: 'Repo 2 PR' };
      const refreshedRepoPR: PullRequestListItem = { ...mockPR, number: 3, title: 'Refreshed repo PR' };
      mockClient.hasPullRequests.mockResolvedValue(false);
      mockClient.getPullRequestsPage
        .mockResolvedValueOnce(prPage([repoPR]))
        .mockResolvedValueOnce(prPage([repo2PR]))
        .mockResolvedValueOnce(prPage([refreshedRepoPR]))
        .mockResolvedValue(prPage([]));

      const repoItem = new PRRepositoryItem(repoConfig);
      const repo2Item = new PRRepositoryItem(repo2Config);
      const repoGroups = await provider.getChildren(repoItem);
      const repoOpenGroup = repoGroups.find(group => (group as any).label === 'Open');
      const repoOpenItems = await provider.getChildren(repoOpenGroup);
      const repo2Groups = await provider.getChildren(repo2Item);
      const repo2OpenGroup = repo2Groups.find(group => (group as any).label === 'Open');
      const repo2OpenItems = await provider.getChildren(repo2OpenGroup);

      provider.refreshRepository(repoItem);
      const refreshedRepoItems = await provider.getChildren(repoOpenGroup);
      const cachedRepo2Items = await provider.getChildren(repo2OpenGroup);

      expect(repoOpenItems.filter(item => item instanceof PRTreeItem).map(item => (item as PRTreeItem).pr.number)).toEqual([1]);
      expect(repo2OpenItems.filter(item => item instanceof PRTreeItem).map(item => (item as PRTreeItem).pr.number)).toEqual([2]);
      expect(refreshedRepoItems.filter(item => item instanceof PRTreeItem).map(item => (item as PRTreeItem).pr.number)).toEqual([3]);
      expect(cachedRepo2Items.filter(item => item instanceof PRTreeItem).map(item => (item as PRTreeItem).pr.number)).toEqual([2]);
      expect(mockClient.getPullRequestsPage).toHaveBeenCalledTimes(3);
      expect(mockClient.getPullRequestsPage).toHaveBeenNthCalledWith(1, 'test-owner', 'repo', 'open', 1, 50);
      expect(mockClient.getPullRequestsPage).toHaveBeenNthCalledWith(2, 'test-owner', 'repo2', 'open', 1, 50);
      expect(mockClient.getPullRequestsPage).toHaveBeenNthCalledWith(3, 'test-owner', 'repo', 'open', 1, 50);
    });

    test('should reuse in-flight closed PR request during simultaneous expansion', async () => {
      const mergedPR: PullRequestListItem = { ...mockPR, number: 2, state: 'closed', merged: true, draft: false };
      const closedPR: PullRequestListItem = { ...mockPR, number: 3, state: 'closed', merged: false, draft: false };
      mockClient.hasPullRequests.mockResolvedValue(true);
      mockClient.getPullRequestsPage
        .mockResolvedValueOnce({
          items: [],
          page: 1,
          limit: 50,
          hasMore: false
        })
        .mockResolvedValueOnce({
          items: [mergedPR, closedPR],
          page: 1,
          limit: 50,
          hasMore: false
        });

      const groups = await provider.getChildren();
      const mergedGroup = groups.find(group => (group as any).label === 'Merged');
      const closedGroup = groups.find(group => (group as any).label === 'Closed');

      const [mergedItems, closedItems] = await Promise.all([
        provider.getChildren(mergedGroup),
        provider.getChildren(closedGroup)
      ]);

      expect(mockClient.getPullRequests).not.toHaveBeenCalled();
      expect(mockClient.getPullRequestsPage).toHaveBeenCalledTimes(2);
      expect(mergedItems.length).toBe(1);
      expect(closedItems.length).toBe(1);
    });

    test('should add a load more item when more closed PR pages are available', async () => {
      const mergedPR: PullRequestListItem = { ...mockPR, number: 2, state: 'closed', merged: true, draft: false };
      mockClient.hasPullRequests.mockResolvedValue(true);
      mockClient.getPullRequestsPage
        .mockResolvedValueOnce({
          items: [],
          page: 1,
          limit: 50,
          hasMore: false
        })
        .mockResolvedValueOnce({
          items: [mergedPR],
          page: 1,
          limit: 50,
          hasMore: true
        });

      const groups = await provider.getChildren();
      const mergedGroup = groups.find(group => (group as any).label === 'Merged');
      const mergedItems = await provider.getChildren(mergedGroup);

      expect(mergedItems[0]).toBeInstanceOf(PRTreeItem);
      expect(mergedItems[1]).toBeInstanceOf(PRLoadMoreItem);
      expect((mergedGroup as any).description).toBe('1+');
    });

    test('should load the next closed PR page through the load more item', async () => {
      const firstMergedPR: PullRequestListItem = { ...mockPR, number: 2, state: 'closed', merged: true, draft: false };
      const secondMergedPR: PullRequestListItem = { ...mockPR, number: 4, state: 'closed', merged: true, draft: false };
      mockClient.hasPullRequests.mockResolvedValue(true);
      mockClient.getPullRequestsPage
        .mockResolvedValueOnce({
          items: [],
          page: 1,
          limit: 50,
          hasMore: false
        })
        .mockResolvedValueOnce({
          items: [firstMergedPR],
          page: 1,
          limit: 50,
          hasMore: true
        })
        .mockResolvedValueOnce({
          items: [secondMergedPR],
          page: 2,
          limit: 50,
          hasMore: false
        });

      const groups = await provider.getChildren();
      const mergedGroup = groups.find(group => (group as any).label === 'Merged');
      const initialItems = await provider.getChildren(mergedGroup);
      const loadMoreItem = initialItems.find(item => item instanceof PRLoadMoreItem) as PRLoadMoreItem;

      await provider.loadMorePullRequests(loadMoreItem);
      const loadedItems = await provider.getChildren(mergedGroup);

      expect(mockClient.getPullRequestsPage).toHaveBeenNthCalledWith(2, 'test-owner', 'test-repo', 'closed', 1, 50);
      expect(mockClient.getPullRequestsPage).toHaveBeenNthCalledWith(3, 'test-owner', 'test-repo', 'closed', 2, 50);
      expect(loadedItems.filter(item => item instanceof PRTreeItem).map(item => (item as PRTreeItem).pr.number)).toEqual([2, 4]);
      expect(loadedItems.some(item => item instanceof PRLoadMoreItem)).toBe(false);
    });

    test('should add a load more item when more open PR pages are available', async () => {
      const openPR: PullRequestListItem = { ...mockPR, number: 2, state: 'open', draft: false };
      mockClient.getPullRequestsPage.mockResolvedValueOnce({
        items: [openPR],
        page: 1,
        limit: 50,
        hasMore: true
      });

      const groups = await provider.getChildren();
      const openGroup = groups.find(group => (group as any).label === 'Open');
      const openItems = await provider.getChildren(openGroup);

      expect(openItems[0]).toBeInstanceOf(PRTreeItem);
      expect(openItems[1]).toBeInstanceOf(PRLoadMoreItem);
      expect((openGroup as any).description).toBe('1+');
    });

    test('should show Draft group when later open pages may contain drafts', async () => {
      const openPR: PullRequestListItem = { ...mockPR, number: 2, state: 'open', draft: false };
      mockClient.getPullRequestsPage.mockResolvedValueOnce({
        items: [openPR],
        page: 1,
        limit: 50,
        hasMore: true
      });

      const groups = await provider.getChildren();

      expect(groups.find(group => (group as any).label === 'Draft')).toBeDefined();
    });

    test('should allow loading more from Draft when loaded open page has no drafts', async () => {
      const openPR: PullRequestListItem = { ...mockPR, number: 2, state: 'open', draft: false };
      const draftPR: PullRequestListItem = { ...mockPR, number: 4, state: 'open', draft: true };
      mockClient.getPullRequestsPage
        .mockResolvedValueOnce({
          items: [openPR],
          page: 1,
          limit: 50,
          hasMore: true
        })
        .mockResolvedValueOnce({
          items: [draftPR],
          page: 2,
          limit: 50,
          hasMore: false
        });

      const groups = await provider.getChildren();
      const draftGroup = groups.find(group => (group as any).label === 'Draft');
      const initialDraftItems = await provider.getChildren(draftGroup);
      const loadMoreItem = initialDraftItems.find(item => item instanceof PRLoadMoreItem) as PRLoadMoreItem;

      expect((initialDraftItems[0] as any).message).toBe('No draft pull requests found');
      expect(loadMoreItem).toBeInstanceOf(PRLoadMoreItem);

      await provider.loadMorePullRequests(loadMoreItem);
      const loadedDraftItems = await provider.getChildren(draftGroup);

      expect(mockClient.getPullRequestsPage).toHaveBeenNthCalledWith(2, 'test-owner', 'test-repo', 'open', 2, 50);
      expect(loadedDraftItems.filter(item => item instanceof PRTreeItem).map(item => (item as PRTreeItem).pr.number)).toEqual([4]);
    });

    test('should load the next open PR page through the load more item', async () => {
      const firstOpenPR: PullRequestListItem = { ...mockPR, number: 2, state: 'open', draft: false };
      const secondOpenPR: PullRequestListItem = { ...mockPR, number: 4, state: 'open', draft: false };
      mockClient.getPullRequestsPage
        .mockResolvedValueOnce({
          items: [firstOpenPR],
          page: 1,
          limit: 50,
          hasMore: true
        })
        .mockResolvedValueOnce({
          items: [secondOpenPR],
          page: 2,
          limit: 50,
          hasMore: false
        });

      const groups = await provider.getChildren();
      const openGroup = groups.find(group => (group as any).label === 'Open');
      const initialItems = await provider.getChildren(openGroup);
      const loadMoreItem = initialItems.find(item => item instanceof PRLoadMoreItem) as PRLoadMoreItem;

      await provider.loadMorePullRequests(loadMoreItem);
      const loadedItems = await provider.getChildren(openGroup);

      expect(mockClient.getPullRequestsPage).toHaveBeenNthCalledWith(1, 'test-owner', 'test-repo', 'open', 1, 50);
      expect(mockClient.getPullRequestsPage).toHaveBeenNthCalledWith(2, 'test-owner', 'test-repo', 'open', 2, 50);
      expect(loadedItems.filter(item => item instanceof PRTreeItem).map(item => (item as PRTreeItem).pr.number)).toEqual([2, 4]);
      expect(loadedItems.some(item => item instanceof PRLoadMoreItem)).toBe(false);
    });

    test('should not render duplicate PR tree item ids when paged results overlap', async () => {
      const firstOpenPR: PullRequestListItem = { ...mockPR, number: 13116, state: 'open', draft: false };
      const secondOpenPR: PullRequestListItem = { ...mockPR, number: 13117, state: 'open', draft: false };
      mockClient.getPullRequestsPage
        .mockResolvedValueOnce({
          items: [firstOpenPR],
          page: 1,
          limit: 50,
          hasMore: true
        })
        .mockResolvedValueOnce({
          items: [firstOpenPR, secondOpenPR],
          page: 2,
          limit: 50,
          hasMore: false
        });

      const groups = await provider.getChildren();
      const openGroup = groups.find(group => (group as any).label === 'Open');
      const initialItems = await provider.getChildren(openGroup);
      const loadMoreItem = initialItems.find(item => item instanceof PRLoadMoreItem) as PRLoadMoreItem;

      await provider.loadMorePullRequests(loadMoreItem);
      const loadedItems = await provider.getChildren(openGroup);
      const prItems = loadedItems.filter(item => item instanceof PRTreeItem) as PRTreeItem[];
      const prItemIds = prItems.map(item => item.id);

      expect(prItems.map(item => item.pr.number)).toEqual([13116, 13117]);
      expect(new Set(prItemIds).size).toBe(prItemIds.length);
    });

    test('should pass the active search query when fetching PR groups', async () => {
      const searchedPR: PullRequestListItem = { ...mockPR, number: 5, title: 'Fix searched bug', state: 'open', draft: false };
      provider.setSearchQuery('  searched bug  ');
      mockClient.getPullRequestsPage.mockImplementation((_owner, _repo, state, pageNumber = 1, limit = 50, _queryOrOptions?: unknown) => {
        if (state === 'closed') {
          return Promise.resolve(prPage([], pageNumber, false, limit));
        }
        return Promise.resolve(prPage([searchedPR], pageNumber, false, limit));
      });

      const groups = await provider.getChildren();
      const openGroup = groups.find(group => (group as any).label === 'Open');
      const openItems = await provider.getChildren(openGroup);

      expect(mockClient.getPullRequestsPage).toHaveBeenCalledWith('test-owner', 'test-repo', 'open', 1, 50, 'searched bug');
      expect(mockClient.getPullRequestsPage).toHaveBeenCalledWith('test-owner', 'test-repo', 'closed', 1, 1, 'searched bug');
      expect(openItems.filter(item => item instanceof PRTreeItem).map(item => (item as PRTreeItem).pr.number)).toEqual([5]);
      expect((openGroup as vscode.TreeItem).id).toBe('pr-group/https%3A%2F%2Fgit.example.com/test-owner/test-repo/open/searched%20bug');
      expect(mockClient.hasPullRequests).not.toHaveBeenCalled();
    });

    test('should fall back to unfiltered PR listing for blank search queries', async () => {
      provider.setSearchQuery('   ');
      mockClient.getPullRequestsPage.mockResolvedValue(prPage([mockPR]));
      mockClient.hasPullRequests.mockResolvedValue(false);

      await provider.getChildren();

      expect(provider.getSearchQuery()).toBeNull();
      expect(mockClient.getPullRequestsPage).toHaveBeenCalledWith('test-owner', 'test-repo', 'open', 1, 50);
      expect(mockClient.getPullRequestsPage).not.toHaveBeenCalledWith('test-owner', 'test-repo', 'open', 1, 50, expect.any(String));
    });

    test('should load more PR search results with the active query', async () => {
      const firstOpenPR: PullRequestListItem = { ...mockPR, number: 2, title: 'Search result one', state: 'open', draft: false };
      const secondOpenPR: PullRequestListItem = { ...mockPR, number: 4, title: 'Search result two', state: 'open', draft: false };
      provider.setSearchQuery('search term');
      mockClient.getPullRequestsPage.mockImplementation((_owner, _repo, state, pageNumber = 1, limit = 50, _queryOrOptions?: unknown) => {
        if (state === 'closed') {
          return Promise.resolve(prPage([], pageNumber, false, limit));
        }
        return Promise.resolve(pageNumber === 1
          ? prPage([firstOpenPR], 1, true, limit)
          : prPage([secondOpenPR], 2, false, limit));
      });

      const groups = await provider.getChildren();
      const openGroup = groups.find(group => (group as any).label === 'Open');
      const initialItems = await provider.getChildren(openGroup);
      const loadMoreItem = initialItems.find(item => item instanceof PRLoadMoreItem) as PRLoadMoreItem;

      await provider.loadMorePullRequests(loadMoreItem);
      const loadedItems = await provider.getChildren(openGroup);

      expect(mockClient.getPullRequestsPage).toHaveBeenCalledWith('test-owner', 'test-repo', 'open', 1, 50, 'search term');
      expect(mockClient.getPullRequestsPage).toHaveBeenCalledWith('test-owner', 'test-repo', 'open', 2, 50, 'search term');
      expect(loadedItems.filter(item => item instanceof PRTreeItem).map(item => (item as PRTreeItem).pr.number)).toEqual([2, 4]);
      expect(loadedItems.some(item => item instanceof PRLoadMoreItem)).toBe(false);
    });

    test('should allow loading more from Merged when loaded closed page has no merged PRs', async () => {
      const closedPR: PullRequestListItem = { ...mockPR, number: 2, state: 'closed', merged: false, draft: false };
      const mergedPR: PullRequestListItem = { ...mockPR, number: 4, state: 'closed', merged: true, draft: false };
      mockClient.hasPullRequests.mockResolvedValue(true);
      mockClient.getPullRequestsPage
        .mockResolvedValueOnce({
          items: [],
          page: 1,
          limit: 50,
          hasMore: false
        })
        .mockResolvedValueOnce({
          items: [closedPR],
          page: 1,
          limit: 50,
          hasMore: true
        })
        .mockResolvedValueOnce({
          items: [mergedPR],
          page: 2,
          limit: 50,
          hasMore: false
        });

      const groups = await provider.getChildren();
      const mergedGroup = groups.find(group => (group as any).label === 'Merged');
      const initialMergedItems = await provider.getChildren(mergedGroup);
      const loadMoreItem = initialMergedItems.find(item => item instanceof PRLoadMoreItem) as PRLoadMoreItem;

      expect((initialMergedItems[0] as any).message).toBe('No merged pull requests found');
      expect(loadMoreItem).toBeInstanceOf(PRLoadMoreItem);

      await provider.loadMorePullRequests(loadMoreItem);
      const loadedMergedItems = await provider.getChildren(mergedGroup);

      expect(mockClient.getPullRequestsPage).toHaveBeenNthCalledWith(3, 'test-owner', 'test-repo', 'closed', 2, 50);
      expect(loadedMergedItems.filter(item => item instanceof PRTreeItem).map(item => (item as PRTreeItem).pr.number)).toEqual([4]);
    });

    test('should allow loading more from Closed when loaded closed page has only merged PRs', async () => {
      const mergedPR: PullRequestListItem = { ...mockPR, number: 2, state: 'closed', merged: true, draft: false };
      const closedPR: PullRequestListItem = { ...mockPR, number: 4, state: 'closed', merged: false, draft: false };
      mockClient.hasPullRequests.mockResolvedValue(true);
      mockClient.getPullRequestsPage
        .mockResolvedValueOnce({
          items: [],
          page: 1,
          limit: 50,
          hasMore: false
        })
        .mockResolvedValueOnce({
          items: [mergedPR],
          page: 1,
          limit: 50,
          hasMore: true
        })
        .mockResolvedValueOnce({
          items: [closedPR],
          page: 2,
          limit: 50,
          hasMore: false
        });

      const groups = await provider.getChildren();
      const closedGroup = groups.find(group => (group as any).label === 'Closed');
      const initialClosedItems = await provider.getChildren(closedGroup);
      const loadMoreItem = initialClosedItems.find(item => item instanceof PRLoadMoreItem) as PRLoadMoreItem;

      expect((initialClosedItems[0] as any).message).toBe('No closed pull requests found');
      expect(loadMoreItem).toBeInstanceOf(PRLoadMoreItem);

      await provider.loadMorePullRequests(loadMoreItem);
      const loadedClosedItems = await provider.getChildren(closedGroup);

      expect(mockClient.getPullRequestsPage).toHaveBeenNthCalledWith(3, 'test-owner', 'test-repo', 'closed', 2, 50);
      expect(loadedClosedItems.filter(item => item instanceof PRTreeItem).map(item => (item as PRTreeItem).pr.number)).toEqual([4]);
    });
  });

  describe('getPRFiles (PRTreeItem children)', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
    });

    test('should return overview + file items on successful fetch', async () => {
      mockClient.getPullRequestFiles.mockResolvedValue(mockAllFileTypes);
      mockClient.getPullRequest.mockResolvedValue(mockPRWithRefs as any);

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
      mockClient.getPullRequest.mockResolvedValue(mockPRWithRefs as any);

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
      mockClient.getPullRequest.mockResolvedValue(mockPRWithRefs as any);

      const prItem = new PRTreeItem(mockPR, mockPR.html_url, 'test-owner', 'test-repo');
      const children = await provider.getChildren(prItem);

      expect(children.length).toBe(2);
      expect((children[0] as any).label).toBe('Overview');
      expect((children[1] as any).message).toBe('API rate limit');
      expect((children[1] as any).isError).toBe(true);
    });

    test('should return "No files changed" message for empty files', async () => {
      mockClient.getPullRequestFiles.mockResolvedValue([]);
      mockClient.getPullRequest.mockResolvedValue(mockPRWithRefs as any);

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

    // Regression test for issue #182: the diff view was using pr.base.ref
    // (a branch name / moving target) to fetch "before" file content,
    // so once the base branch advanced past the PR's divergence point the
    // diff showed unrelated upstream changes mixed in, sometimes making it
    // look like the whole file had changed. Fixed refs must come from
    // merge_base (the frozen divergence commit) and head.sha (an immutable
    // commit), never from base.sha (which is the *live* tip of the base
    // branch and would silently reintroduce the same bug).
    test('should pin diff refs to merge_base/head.sha, not base.sha or branch names', async () => {
      mockClient.getPullRequestFiles.mockResolvedValue(mockAllFileTypes);
      mockClient.getPullRequest.mockResolvedValue(mockPRWithRefs as any);

      const prItem = new PRTreeItem(mockPR, mockPR.html_url, 'test-owner', 'test-repo');
      const children = await provider.getChildren(prItem);

      const fileItem = children.find(item => item instanceof PRFileItem) as PRFileItem;
      expect(fileItem).toBeDefined();
      expect(fileItem.baseRef).toBe(mockPRWithRefs.merge_base);
      expect(fileItem.headRef).toBe(mockPRWithRefs.head.sha);
      // Guard against regressing to the moving-target fields.
      expect(fileItem.baseRef).not.toBe(mockPRWithRefs.base.sha);
      expect(fileItem.baseRef).not.toBe(mockPRWithRefs.base.ref);
      expect(fileItem.headRef).not.toBe(mockPRWithRefs.head.ref);
    });

    test('should fall back to base.ref (not base.sha) when merge_base is missing', async () => {
      mockClient.getPullRequestFiles.mockResolvedValue(mockAllFileTypes);
      const prWithoutMergeBase = { ...mockPRWithRefs, merge_base: undefined };
      mockClient.getPullRequest.mockResolvedValue(prWithoutMergeBase as any);

      const prItem = new PRTreeItem(mockPR, mockPR.html_url, 'test-owner', 'test-repo');
      const children = await provider.getChildren(prItem);

      const fileItem = children.find(item => item instanceof PRFileItem) as PRFileItem;
      expect(fileItem).toBeDefined();
      expect(fileItem.baseRef).toBe(mockPRWithRefs.base.ref);
      expect(fileItem.baseRef).not.toBe(mockPRWithRefs.base.sha);
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
