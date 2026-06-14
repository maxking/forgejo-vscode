import * as vscode from 'vscode';
import { IssueTreeItem, IssueTreeProvider } from '../../providers/issueTreeProvider';
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

  beforeEach(() => {
    mockClient = {
      getIssues: jest.fn()
    } as any;

    mockGetForgejoConfig = getForgejoConfig as jest.MockedFunction<typeof getForgejoConfig>;
    mockGetForgejoRepositoryConfigs = getForgejoRepositoryConfigs as jest.MockedFunction<typeof getForgejoRepositoryConfigs>;
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    mockGetForgejoRepositoryConfigs.mockResolvedValue([{ ...mockConfig, label: 'test-owner/test-repo' }]);

    (ForgejoClient as jest.MockedClass<typeof ForgejoClient>).mockImplementation(() => mockClient);

    mockClient.getIssues.mockResolvedValue([]);
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
      expect(mockClient.getIssues).not.toHaveBeenCalled();
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
      mockClient.getIssues.mockResolvedValue([]);
      const children = await provider.getChildren();

      expect(children).toHaveLength(1);
      const msg = children[0] as vscode.TreeItem;
      expect(msg.label).toBe('No issues found');
      expect(msg.contextValue).toBe('info');
      expect((msg.iconPath as vscode.ThemeIcon).id).toBe('info');
    });

    test('should group open issues into Open group', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockClient.getIssues.mockResolvedValue([mockOpenIssue]);
      const children = await provider.getChildren();

      expect(children).toHaveLength(1);
      const group = children[0] as vscode.TreeItem;
      expect(group.label).toBe('Open');
      expect(group.description).toBe('1');
    });

    test('should group closed issues into Closed group', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockClient.getIssues.mockResolvedValue([mockClosedIssue]);
      const children = await provider.getChildren();

      expect(children).toHaveLength(1);
      const group = children[0] as vscode.TreeItem;
      expect(group.label).toBe('Closed');
      expect(group.description).toBe('1');
    });

    test('should show both Open and Closed groups', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockClient.getIssues.mockResolvedValue([mockOpenIssue, mockClosedIssue]);
      const children = await provider.getChildren();

      expect(children).toHaveLength(2);
      expect((children[0] as vscode.TreeItem).label).toBe('Open');
      expect((children[1] as vscode.TreeItem).label).toBe('Closed');
    });

    test('should set Open group as Expanded and Closed group as Collapsed', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockClient.getIssues.mockResolvedValue([mockOpenIssue, mockClosedIssue]);
      const children = await provider.getChildren();

      expect(children[0].collapsibleState).toBe(vscode.TreeItemCollapsibleState.Expanded);
      expect(children[1].collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed);
    });

    test('should return IssueTreeItems as children of group', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockClient.getIssues.mockResolvedValue([mockOpenIssue]);

      // Get root groups
      const groups = await provider.getChildren();
      expect(groups).toHaveLength(1);

      // Get children of Open group
      const issueItems = await provider.getChildren(groups[0]);
      expect(issueItems).toHaveLength(1);

      const issueItem = issueItems[0] as IssueTreeItem;
      expect(issueItem).toBeInstanceOf(IssueTreeItem);
      expect(issueItem.label).toBe('#10: Fix login bug');
      expect(issueItem.issue).toBe(mockOpenIssue);
    });

    test('should handle fetch error gracefully', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockClient.getIssues.mockRejectedValue(new Error('Network timeout'));
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
      mockClient.getIssues.mockResolvedValue([mockOpenIssue]);

      const initialGroups = await provider.getChildren();
      expect(initialGroups).toHaveLength(1);
      expect((initialGroups[0] as vscode.TreeItem).label).toBe('Open');
      expect((initialGroups[0] as vscode.TreeItem).description).toBe('1');

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
      mockClient.getIssues.mockResolvedValue([mockOpenIssue, mockNewIssue]);

      // Trigger refresh (as createIssue command does immediately after API call)
      provider.refresh();

      // Next getChildren call should return fresh data with the new issue
      const updatedGroups = await provider.getChildren();
      expect(updatedGroups).toHaveLength(1);
      expect((updatedGroups[0] as vscode.TreeItem).label).toBe('Open');
      expect((updatedGroups[0] as vscode.TreeItem).description).toBe('2');

      const issueItems = await provider.getChildren(updatedGroups[0]);
      expect(issueItems).toHaveLength(2);
      const labels = issueItems.map(item => (item as vscode.TreeItem).label as string);
      expect(labels).toContain('#11: New issue after refresh');
    });
  });

  describe('IssueTreeProvider - getTreeItem', () => {
    test('should return the element as-is', () => {
      const item = new IssueTreeItem(mockOpenIssue, mockOpenIssue.html_url, 'test-owner', 'test-repo');
      expect(provider.getTreeItem(item)).toBe(item);
    });
  });
});
