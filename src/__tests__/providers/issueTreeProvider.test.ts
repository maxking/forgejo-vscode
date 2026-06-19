import * as vscode from 'vscode';
import { IssueLoadMoreItem, IssueTreeItem, IssueTreeProvider } from '../../providers/issueTreeProvider';
import { ForgejoClient } from '../../api/forgejoClient';
import { getForgejoConfig, getForgejoRepositoryConfigs } from '../../utils/config';
import { IssueListItem } from '../../models/issue';

// Mock dependencies
jest.mock('../../api/forgejoClient');
jest.mock('../../utils/config');

describe('IssueTreeProvider', () => {
  let provider: IssueTreeProvider;
  let mockClient: jest.Mocked<ForgejoClient>;
  let mockGetForgejoConfig: jest.MockedFunction<typeof getForgejoConfig>;
  let mockGetForgejoRepositoryConfigs: jest.MockedFunction<typeof getForgejoRepositoryConfigs>;

  const mockConfig = {
    instanceUrl: 'https://git.example.com',
    owner: 'test-owner',
    repo: 'test-repo',
    token: 'test-token'
  };

  const mockOpenIssue: IssueListItem = {
    number: 10,
    title: 'Fix login bug',
    state: 'open',
    user: { login: 'alice' },
    html_url: 'https://git.example.com/test-owner/test-repo/issues/10',
    created_at: '2026-01-15T00:00:00Z',
    comments: 3
  };

  const mockClosedIssue: IssueListItem = {
    number: 5,
    title: 'Update README',
    state: 'closed',
    user: { login: 'bob' },
    html_url: 'https://git.example.com/test-owner/test-repo/issues/5',
    created_at: '2026-01-10T00:00:00Z',
    comments: 0
  };

  const page = (items: IssueListItem[], pageNumber = 1, hasMore = false) => ({
    items,
    page: pageNumber,
    limit: 50,
    hasMore
  });

  function mockIssuePages(openIssues: IssueListItem[], closedIssues: IssueListItem[], openHasMore = false, closedHasMore = false): void {
    mockClient.getIssuesPage.mockImplementation((_owner, _repo, state, pageNumber = 1) => {
      if (state === 'open') {
        return Promise.resolve(page(openIssues, pageNumber, openHasMore));
      }
      if (state === 'closed') {
        return Promise.resolve(page(closedIssues, pageNumber, closedHasMore));
      }
      return Promise.resolve(page([...openIssues, ...closedIssues], pageNumber, openHasMore || closedHasMore));
    });
  }

  beforeEach(() => {
    mockClient = {
      getIssuesPage: jest.fn(),
      getAuthenticatedUserLogin: jest.fn()
    } as any;

    mockGetForgejoConfig = getForgejoConfig as jest.MockedFunction<typeof getForgejoConfig>;
    mockGetForgejoRepositoryConfigs = getForgejoRepositoryConfigs as jest.MockedFunction<typeof getForgejoRepositoryConfigs>;
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    mockGetForgejoRepositoryConfigs.mockResolvedValue([{ ...mockConfig, label: 'test-owner/test-repo' }]);

    (ForgejoClient as jest.MockedClass<typeof ForgejoClient>).mockImplementation(() => mockClient);

    mockIssuePages([], []);
    mockClient.getAuthenticatedUserLogin.mockResolvedValue('alice');
    provider = new IssueTreeProvider();

    jest.clearAllMocks();
  });

  describe('IssueTreeItem', () => {
    test('should create with correct label "#N: title"', () => {
      const item = new IssueTreeItem(mockOpenIssue, mockOpenIssue.html_url, 'test-owner', 'test-repo');
      expect(item.label).toBe('#10: Fix login bug');
    });

    test('should set tooltip with issue info', () => {
      const item = new IssueTreeItem(mockOpenIssue, mockOpenIssue.html_url, 'test-owner', 'test-repo');
      expect(item.tooltip).toContain('Fix login bug');
      expect(item.tooltip).toContain('alice');
      expect(item.tooltip).toContain('open');
      expect(item.tooltip).toContain('3');
      expect(item.tooltip).toContain('Click to view details');
    });

    test('should set description to "by username"', () => {
      const item = new IssueTreeItem(mockOpenIssue, mockOpenIssue.html_url, 'test-owner', 'test-repo');
      expect(item.description).toBe('by alice');
    });

    test('should set contextValue to "issue"', () => {
      const item = new IssueTreeItem(mockOpenIssue, mockOpenIssue.html_url, 'test-owner', 'test-repo');
      expect(item.contextValue).toBe('issue');
    });

    test('should include group context in provider-rendered issue item ids', () => {
      const openItem = new IssueTreeItem(mockOpenIssue, mockOpenIssue.html_url, 'test-owner', 'test-repo', 'https://git.example.com', 'open');
      const assignedItem = new IssueTreeItem(mockOpenIssue, mockOpenIssue.html_url, 'test-owner', 'test-repo', 'https://git.example.com', 'assigned');

      expect(openItem.id).toBe('issue/https%3A%2F%2Fgit.example.com/test-owner/test-repo/open/10');
      expect(assignedItem.id).toBe('issue/https%3A%2F%2Fgit.example.com/test-owner/test-repo/assigned/10');
    });

    test('should set open icon for open issues', () => {
      const item = new IssueTreeItem(mockOpenIssue, mockOpenIssue.html_url, 'test-owner', 'test-repo');
      expect(item.iconPath).toBeInstanceOf(vscode.ThemeIcon);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('issues');
      expect(icon.color).toBeInstanceOf(vscode.ThemeColor);
      expect((icon.color as vscode.ThemeColor).id).toBe('gitDecoration.addedResourceForeground');
    });

    test('should set closed icon for closed issues', () => {
      const item = new IssueTreeItem(mockClosedIssue, mockClosedIssue.html_url, 'test-owner', 'test-repo');
      expect(item.iconPath).toBeInstanceOf(vscode.ThemeIcon);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('issue-closed');
      expect(icon.color).toBeInstanceOf(vscode.ThemeColor);
      expect((icon.color as vscode.ThemeColor).id).toBe('gitDecoration.deletedResourceForeground');
    });

    test('should set command to forgejo.showIssueDetails', () => {
      const item = new IssueTreeItem(mockOpenIssue, mockOpenIssue.html_url, 'test-owner', 'test-repo');
      expect(item.command).toEqual({
        command: 'forgejo.showIssueDetails',
        title: 'Show Issue Details',
        arguments: [mockOpenIssue, 'test-owner', 'test-repo']
      });
    });
  });

  describe('IssueTreeProvider - getChildren', () => {
    test('should group multiple detected repositories by owner and repo at the root', async () => {
      mockGetForgejoRepositoryConfigs.mockResolvedValue([
        { ...mockConfig, owner: 'maxking', repo: 'forgejo-vscode', label: 'maxking/forgejo-vscode' },
        { ...mockConfig, owner: 'forgejo', repo: 'forgejo', label: 'forgejo/forgejo' }
      ]);

      const children = await provider.getChildren();

      expect(children.map(child => String((child as vscode.TreeItem).label))).toEqual([
        'maxking/forgejo-vscode',
        'forgejo/forgejo'
      ]);
      expect(mockClient.getIssuesPage).not.toHaveBeenCalled();
    });

    test('should return error message when no config', async () => {
      mockGetForgejoConfig.mockResolvedValue(null as any);
      mockGetForgejoRepositoryConfigs.mockResolvedValue([]);
      const children = await provider.getChildren();

      expect(children).toHaveLength(1);
      const msg = children[0] as vscode.TreeItem;
      expect(msg.label).toBe('No Forgejo configuration found. Please configure instance URL or open a git repository.');
      expect(msg.contextValue).toBe('error');
      expect(msg.iconPath).toBeInstanceOf(vscode.ThemeIcon);
      expect((msg.iconPath as vscode.ThemeIcon).id).toBe('error');
    });

    test('should return "No issues found" when empty', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockIssuePages([], []);
      const children = await provider.getChildren();

      expect(children).toHaveLength(2);
      expect((children[0] as vscode.TreeItem).label).toBe('My Queries');
      const msg = children[1] as vscode.TreeItem;
      expect(msg.label).toBe('No issues found');
      expect(msg.contextValue).toBe('info');
      expect((msg.iconPath as vscode.ThemeIcon).id).toBe('info');
    });

    test('should group open issues into Open group', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockIssuePages([mockOpenIssue], []);
      const children = await provider.getChildren();

      const group = children.find(child => (child as vscode.TreeItem).label === 'Open') as vscode.TreeItem;
      expect(group.label).toBe('Open');
      expect(group.description).toBe('1');
    });

    test('should group closed issues into Closed group', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockIssuePages([], [mockClosedIssue]);
      const children = await provider.getChildren();

      const group = children.find(child => (child as vscode.TreeItem).label === 'Closed') as vscode.TreeItem;
      expect(group.label).toBe('Closed');
      expect(group.description).toBe('1');
    });

    test('should show both Open and Closed groups', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockIssuePages([mockOpenIssue], [mockClosedIssue]);
      const children = await provider.getChildren();

      expect(children.map(child => (child as vscode.TreeItem).label)).toEqual(['My Queries', 'Open', 'Closed']);
    });

    test('should set Open group as Expanded and Closed group as Collapsed', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockIssuePages([mockOpenIssue], [mockClosedIssue]);
      const children = await provider.getChildren();
      const openGroup = children.find(child => (child as vscode.TreeItem).label === 'Open') as vscode.TreeItem;
      const closedGroup = children.find(child => (child as vscode.TreeItem).label === 'Closed') as vscode.TreeItem;

      expect(openGroup.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Expanded);
      expect(closedGroup.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed);
    });

    test('should return IssueTreeItems as children of group', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockIssuePages([mockOpenIssue], []);

      // Get root groups
      const groups = await provider.getChildren();
      const openGroup = groups.find(group => (group as vscode.TreeItem).label === 'Open');

      // Get children of Open group
      const issueItems = await provider.getChildren(openGroup);
      expect(issueItems).toHaveLength(1);

      const issueItem = issueItems[0] as IssueTreeItem;
      expect(issueItem).toBeInstanceOf(IssueTreeItem);
      expect(issueItem.label).toBe('#10: Fix login bug');
      expect(issueItem.issue).toBe(mockOpenIssue);
    });

    test('should handle fetch error gracefully', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockClient.getIssuesPage.mockRejectedValue(new Error('Network timeout'));
      const children = await provider.getChildren();

      expect(children).toHaveLength(1);
      const msg = children[0] as vscode.TreeItem;
      expect(msg.label).toBe('Network timeout');
      expect(msg.contextValue).toBe('error');
    });
  });

  describe('IssueTreeProvider - refresh', () => {
    test('should fire onDidChangeTreeData event', () => {
      const listener = jest.fn();
      provider.onDidChangeTreeData(listener);
      provider.refresh();
      expect(listener).toHaveBeenCalled();
    });

    test('should fetch fresh issues on next getChildren call after refresh', async () => {
      // Initial state: 1 open issue
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockIssuePages([mockOpenIssue], []);

      const initialGroups = await provider.getChildren();
      const initialOpenGroup = initialGroups.find(group => (group as vscode.TreeItem).label === 'Open') as vscode.TreeItem;
      expect(initialOpenGroup.label).toBe('Open');
      expect(initialOpenGroup.description).toBe('1');

      // New issue added (simulates server state after createIssue)
      const mockNewIssue: IssueListItem = {
        number: 11,
        title: 'New issue after refresh',
        state: 'open',
        user: { login: 'carol' },
        html_url: 'https://git.example.com/test-owner/test-repo/issues/11',
        created_at: '2026-02-20T00:00:00Z',
        comments: 0
      };
      mockIssuePages([mockOpenIssue, mockNewIssue], []);

      // Trigger refresh (as createIssue command does immediately after API call)
      provider.refresh();

      // Next getChildren call should return fresh data with the new issue
      const updatedGroups = await provider.getChildren();
      const updatedOpenGroup = updatedGroups.find(group => (group as vscode.TreeItem).label === 'Open');
      expect((updatedOpenGroup as vscode.TreeItem).label).toBe('Open');
      expect((updatedOpenGroup as vscode.TreeItem).description).toBe('2');

      const issueItems = await provider.getChildren(updatedOpenGroup);
      expect(issueItems).toHaveLength(2);
      const labels = issueItems.map(item => (item as vscode.TreeItem).label as string);
      expect(labels).toContain('#11: New issue after refresh');
    });

    test('should fetch open and closed issues one page at a time', async () => {
      mockIssuePages([mockOpenIssue], [mockClosedIssue]);

      await provider.getChildren();

      expect(mockClient.getIssuesPage).toHaveBeenCalledWith('test-owner', 'test-repo', 'open', 1, 50);
      expect(mockClient.getIssuesPage).toHaveBeenCalledWith('test-owner', 'test-repo', 'closed', 1, 50);
      expect(mockClient.getIssuesPage).not.toHaveBeenCalledWith('test-owner', 'test-repo', 'all');
    });

    test('should add a load more item when more issue pages are available', async () => {
      mockIssuePages([mockOpenIssue], [], true);

      const groups = await provider.getChildren();
      const openGroup = groups.find(group => (group as vscode.TreeItem).label === 'Open');
      const issueItems = await provider.getChildren(openGroup);

      expect((openGroup as vscode.TreeItem).description).toBe('1+');
      expect(issueItems.some(item => item instanceof IssueLoadMoreItem)).toBe(true);
    });

    test('should show an empty message with load more when current page has no issues but more pages exist', async () => {
      mockIssuePages([], [], true);

      const groups = await provider.getChildren();
      const openGroup = groups.find(group => (group as vscode.TreeItem).label === 'Open');
      const issueItems = await provider.getChildren(openGroup);

      expect((issueItems[0] as vscode.TreeItem).label).toBe('No open issues found');
      expect(issueItems.some(item => item instanceof IssueLoadMoreItem)).toBe(true);
    });

    test('should load the next issue page through the load more item', async () => {
      const secondIssue: IssueListItem = {
        ...mockOpenIssue,
        number: 11,
        title: 'Second issue',
        html_url: 'https://git.example.com/test-owner/test-repo/issues/11'
      };
      mockClient.getIssuesPage.mockImplementation((_owner, _repo, state, pageNumber = 1) => {
        if (state === 'closed') {
          return Promise.resolve(page([], pageNumber, false));
        }
        return Promise.resolve(pageNumber === 1
          ? page([mockOpenIssue], 1, true)
          : page([secondIssue], 2, false));
      });

      const groups = await provider.getChildren();
      const openGroup = groups.find(group => (group as vscode.TreeItem).label === 'Open');
      const initialItems = await provider.getChildren(openGroup);
      const loadMoreItem = initialItems.find(item => item instanceof IssueLoadMoreItem) as IssueLoadMoreItem;

      await provider.loadMoreIssues(loadMoreItem);
      const loadedItems = await provider.getChildren(openGroup);

      expect(mockClient.getIssuesPage).toHaveBeenCalledWith('test-owner', 'test-repo', 'open', 2, 50);
      expect(loadedItems.filter(item => item instanceof IssueTreeItem).map(item => (item as IssueTreeItem).issue.number)).toEqual([10, 11]);
      expect(loadedItems.some(item => item instanceof IssueLoadMoreItem)).toBe(false);
    });

    test('should expose built-in query groups without fetching them at the root', async () => {
      mockIssuePages([], []);

      const children = await provider.getChildren();
      const queryRoot = children.find(child => (child as vscode.TreeItem).label === 'My Queries');
      const queryGroups = await provider.getChildren(queryRoot);

      expect(queryGroups.map(group => String((group as vscode.TreeItem).label))).toEqual([
        'Assigned to me',
        'Created by me',
        'Mentioned me'
      ]);
      expect(mockClient.getAuthenticatedUserLogin).not.toHaveBeenCalled();
    });

    test.each([
      ['Assigned to me', { assignedBy: 'alice' }],
      ['Created by me', { createdBy: 'alice' }],
      ['Mentioned me', { mentionedBy: 'alice' }]
    ])('should fetch issue query group "%s" for the authenticated user', async (label, expectedOptions) => {
      const queryIssue: IssueListItem = { ...mockOpenIssue, number: 77, title: `${label} issue` };
      mockClient.getIssuesPage
        .mockResolvedValueOnce(page([]))
        .mockResolvedValueOnce(page([]))
        .mockResolvedValueOnce(page([queryIssue]));

      const children = await provider.getChildren();
      const queryRoot = children.find(child => (child as vscode.TreeItem).label === 'My Queries');
      const queryGroups = await provider.getChildren(queryRoot);
      const queryGroup = queryGroups.find(group => (group as vscode.TreeItem).label === label);
      const queryItems = await provider.getChildren(queryGroup);

      expect(mockClient.getAuthenticatedUserLogin).toHaveBeenCalledTimes(1);
      expect(mockClient.getIssuesPage).toHaveBeenLastCalledWith('test-owner', 'test-repo', 'open', 1, 50, expectedOptions);
      expect(queryItems.filter(item => item instanceof IssueTreeItem).map(item => (item as IssueTreeItem).issue.number)).toEqual([77]);
    });

    test('should render different ids when the same issue appears in Open and Assigned to me', async () => {
      mockClient.getIssuesPage
        .mockResolvedValueOnce(page([mockOpenIssue]))
        .mockResolvedValueOnce(page([]))
        .mockResolvedValueOnce(page([mockOpenIssue]));

      const children = await provider.getChildren();
      const openGroup = children.find(child => (child as vscode.TreeItem).label === 'Open');
      const openItems = await provider.getChildren(openGroup);
      const queryRoot = children.find(child => (child as vscode.TreeItem).label === 'My Queries');
      const queryGroups = await provider.getChildren(queryRoot);
      const assignedGroup = queryGroups.find(group => (group as vscode.TreeItem).label === 'Assigned to me');
      const assignedItems = await provider.getChildren(assignedGroup);
      const openIssueItem = openItems.find(item => item instanceof IssueTreeItem) as IssueTreeItem;
      const assignedIssueItem = assignedItems.find(item => item instanceof IssueTreeItem) as IssueTreeItem;

      expect(openIssueItem.issue.number).toBe(assignedIssueItem.issue.number);
      expect(openIssueItem.id).toBe('issue/https%3A%2F%2Fgit.example.com/test-owner/test-repo/open/10');
      expect(assignedIssueItem.id).toBe('issue/https%3A%2F%2Fgit.example.com/test-owner/test-repo/assigned/10');
      expect(openIssueItem.id).not.toBe(assignedIssueItem.id);
    });

    test('should include active search text when fetching issue query groups', async () => {
      const queryIssue: IssueListItem = { ...mockOpenIssue, number: 78, title: 'Assigned search result' };
      provider.setSearchQuery('  bug  ');
      mockClient.getIssuesPage
        .mockResolvedValueOnce(page([]))
        .mockResolvedValueOnce(page([]))
        .mockResolvedValueOnce(page([queryIssue]));

      const children = await provider.getChildren();
      const queryRoot = children.find(child => (child as vscode.TreeItem).label === 'My Queries');
      const queryGroups = await provider.getChildren(queryRoot);
      const assignedGroup = queryGroups.find(group => (group as vscode.TreeItem).label === 'Assigned to me');
      await provider.getChildren(assignedGroup);

      expect(mockClient.getIssuesPage).toHaveBeenLastCalledWith('test-owner', 'test-repo', 'open', 1, 50, {
        query: 'bug',
        assignedBy: 'alice'
      });
    });

    test('should explain that issue query groups require authentication when no token is configured', async () => {
      mockGetForgejoRepositoryConfigs.mockResolvedValue([{ ...mockConfig, token: '', label: 'test-owner/test-repo' }]);
      mockIssuePages([], []);

      const children = await provider.getChildren();
      const queryRoot = children.find(child => (child as vscode.TreeItem).label === 'My Queries');
      const queryGroups = await provider.getChildren(queryRoot);
      const assignedGroup = queryGroups.find(group => (group as vscode.TreeItem).label === 'Assigned to me');
      const queryItems = await provider.getChildren(assignedGroup);

      expect((queryItems[0] as vscode.TreeItem).label).toBe('Configure an authentication token to use issue query views.');
      expect(mockClient.getAuthenticatedUserLogin).not.toHaveBeenCalled();
    });

    test('should use distinct ids for repeated issue query authentication messages', async () => {
      mockGetForgejoRepositoryConfigs.mockResolvedValue([{ ...mockConfig, token: '', label: 'test-owner/test-repo' }]);
      mockIssuePages([], []);

      const children = await provider.getChildren();
      const queryRoot = children.find(child => (child as vscode.TreeItem).label === 'My Queries');
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

    test('should pass the active search query when fetching issue groups', async () => {
      const searchedIssue: IssueListItem = {
        ...mockOpenIssue,
        number: 12,
        title: 'Fix searched issue',
        html_url: 'https://git.example.com/test-owner/test-repo/issues/12'
      };
      provider.setSearchQuery('  searched issue  ');
      mockClient.getIssuesPage.mockImplementation((_owner, _repo, state, pageNumber = 1, limit = 50, _queryOrOptions?: unknown) => {
        if (state === 'closed') {
          return Promise.resolve(page([], pageNumber, false));
        }
        return Promise.resolve({ ...page([searchedIssue], pageNumber, false), limit });
      });

      const groups = await provider.getChildren();
      const openGroup = groups.find(group => (group as vscode.TreeItem).label === 'Open');
      const issueItems = await provider.getChildren(openGroup);

      expect(mockClient.getIssuesPage).toHaveBeenCalledWith('test-owner', 'test-repo', 'open', 1, 50, 'searched issue');
      expect(mockClient.getIssuesPage).toHaveBeenCalledWith('test-owner', 'test-repo', 'closed', 1, 50, 'searched issue');
      expect(issueItems.filter(item => item instanceof IssueTreeItem).map(item => (item as IssueTreeItem).issue.number)).toEqual([12]);
      expect((openGroup as vscode.TreeItem).id).toBe('issue-group/https%3A%2F%2Fgit.example.com/test-owner/test-repo/open/searched%20issue');
    });

    test('should fall back to unfiltered issue listing for blank search queries', async () => {
      provider.setSearchQuery('   ');
      mockIssuePages([mockOpenIssue], []);

      await provider.getChildren();

      expect(provider.getSearchQuery()).toBeNull();
      expect(mockClient.getIssuesPage).toHaveBeenCalledWith('test-owner', 'test-repo', 'open', 1, 50);
      expect(mockClient.getIssuesPage).toHaveBeenCalledWith('test-owner', 'test-repo', 'closed', 1, 50);
      expect(mockClient.getIssuesPage).not.toHaveBeenCalledWith('test-owner', 'test-repo', 'open', 1, 50, expect.any(String));
    });

    test('should load more issue search results with the active query', async () => {
      const secondIssue: IssueListItem = {
        ...mockOpenIssue,
        number: 11,
        title: 'Second search issue',
        html_url: 'https://git.example.com/test-owner/test-repo/issues/11'
      };
      provider.setSearchQuery('login');
      mockClient.getIssuesPage.mockImplementation((_owner, _repo, state, pageNumber = 1, limit = 50, _queryOrOptions?: unknown) => {
        if (state === 'closed') {
          return Promise.resolve({ ...page([], pageNumber, false), limit });
        }
        return Promise.resolve(pageNumber === 1
          ? { ...page([mockOpenIssue], 1, true), limit }
          : { ...page([secondIssue], 2, false), limit });
      });

      const groups = await provider.getChildren();
      const openGroup = groups.find(group => (group as vscode.TreeItem).label === 'Open');
      const initialItems = await provider.getChildren(openGroup);
      const loadMoreItem = initialItems.find(item => item instanceof IssueLoadMoreItem) as IssueLoadMoreItem;

      await provider.loadMoreIssues(loadMoreItem);
      const loadedItems = await provider.getChildren(openGroup);

      expect(mockClient.getIssuesPage).toHaveBeenCalledWith('test-owner', 'test-repo', 'open', 1, 50, 'login');
      expect(mockClient.getIssuesPage).toHaveBeenCalledWith('test-owner', 'test-repo', 'open', 2, 50, 'login');
      expect(loadedItems.filter(item => item instanceof IssueTreeItem).map(item => (item as IssueTreeItem).issue.number)).toEqual([10, 11]);
      expect(loadedItems.some(item => item instanceof IssueLoadMoreItem)).toBe(false);
    });
  });

  describe('IssueTreeProvider - getTreeItem', () => {
    test('should return the element as-is', () => {
      const item = new IssueTreeItem(mockOpenIssue, mockOpenIssue.html_url, 'test-owner', 'test-repo');
      expect(provider.getTreeItem(item)).toBe(item);
    });
  });
});
