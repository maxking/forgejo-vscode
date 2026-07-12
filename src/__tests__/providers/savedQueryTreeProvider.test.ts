import * as vscode from 'vscode';
import {
  SavedQueryGroupItem,
  SavedQueryLoadMoreItem,
  SavedQueryPullRequestItem,
  SavedQueryRepositoryItem,
  SavedQuerySectionItem,
  SavedQueryTreeProvider
} from '../../providers/savedQueryTreeProvider';
import { IssueTreeItem } from '../../providers/issueTreeProvider';
import { ForgejoClient } from '../../api/forgejoClient';
import { getForgejoRepositoryConfigs } from '../../utils/config';
import { BUILTIN_SAVED_QUERIES } from '../../utils/savedQueries';
import { PullRequestListItem } from '../../models/pullRequest';
import { IssueListItem } from '../../models/issue';

jest.mock('../../api/forgejoClient');
jest.mock('../../utils/config');

describe('SavedQueryTreeProvider', () => {
  let provider: SavedQueryTreeProvider;
  let mockClient: jest.Mocked<ForgejoClient>;
  let mockGetForgejoRepositoryConfigs: jest.MockedFunction<typeof getForgejoRepositoryConfigs>;

  const configA = {
    instanceUrl: 'https://git.example.com',
    owner: 'owner-a',
    repo: 'repo-a',
    token: 'test-token',
    label: 'owner-a/repo-a'
  };

  const configB = {
    instanceUrl: 'https://git.example.com',
    owner: 'owner-b',
    repo: 'repo-b',
    token: 'test-token',
    label: 'owner-b/repo-b'
  };

  const mockPR: PullRequestListItem = {
    number: 7,
    title: 'Fix bug',
    state: 'open',
    user: { login: 'alice' },
    html_url: 'https://git.example.com/owner-a/repo-a/pulls/7',
    created_at: '2026-01-01T00:00:00Z',
    merged: false,
    draft: false,
    comments: 0
  };

  const mockIssue: IssueListItem = {
    number: 9,
    title: 'Investigate crash',
    state: 'open',
    user: { login: 'bob' },
    html_url: 'https://git.example.com/owner-a/repo-a/issues/9',
    created_at: '2026-01-01T00:00:00Z',
    comments: 1
  };

  const emptyPRPage = { items: [] as PullRequestListItem[], page: 1, limit: 50, hasMore: false };
  const emptyIssuePage = { items: [] as IssueListItem[], page: 1, limit: 50, hasMore: false };

  const reviewGroup = BUILTIN_SAVED_QUERIES.find(group => group.kind === 'review')!;
  const assignedGroup = BUILTIN_SAVED_QUERIES.find(group => group.kind === 'assigned')!;
  const recentlyUpdatedGroup = BUILTIN_SAVED_QUERIES.find(group => group.kind === 'recentlyUpdated')!;

  beforeEach(() => {
    mockClient = {
      getPullRequestsPage: jest.fn().mockResolvedValue(emptyPRPage),
      getIssuesPage: jest.fn().mockResolvedValue(emptyIssuePage),
      getAuthenticatedUserLogin: jest.fn().mockResolvedValue('alice')
    } as any;

    (ForgejoClient as jest.MockedClass<typeof ForgejoClient>).mockImplementation(() => mockClient);

    mockGetForgejoRepositoryConfigs = getForgejoRepositoryConfigs as jest.MockedFunction<typeof getForgejoRepositoryConfigs>;
    mockGetForgejoRepositoryConfigs.mockResolvedValue([configA]);

    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn((_key: string, defaultValue: unknown) => defaultValue),
      update: jest.fn()
    });

    provider = new SavedQueryTreeProvider();
  });

  test('root lists all five built-in groups without making any network calls', async () => {
    const children = await provider.getChildren();

    expect(children).toHaveLength(5);
    expect(children.map(child => (child as SavedQueryGroupItem).group.label)).toEqual([
      'Waiting for my review',
      'Assigned to me',
      'Created by me',
      'Mentioned me',
      'Recently updated'
    ]);
    expect(mockGetForgejoRepositoryConfigs).not.toHaveBeenCalled();
    expect(mockClient.getPullRequestsPage).not.toHaveBeenCalled();
    expect(mockClient.getIssuesPage).not.toHaveBeenCalled();
  });

  describe('single-repository workspace', () => {
    test('a pullRequests-only group skips repository nesting and goes straight to a section', async () => {
      const groupItem = new SavedQueryGroupItem(reviewGroup);
      const children = await provider.getChildren(groupItem);

      expect(children).toHaveLength(1);
      expect(children[0]).toBeInstanceOf(SavedQuerySectionItem);
      expect((children[0] as SavedQuerySectionItem).contentType).toBe('pullRequests');
    });

    test('a "both" group renders separate Pull Requests and Issues sections', async () => {
      const groupItem = new SavedQueryGroupItem(assignedGroup);
      const children = await provider.getChildren(groupItem);

      expect(children).toHaveLength(2);
      expect((children[0] as SavedQuerySectionItem).contentType).toBe('pullRequests');
      expect((children[1] as SavedQuerySectionItem).contentType).toBe('issues');
    });
  });

  describe('multi-repository fan-out', () => {
    test('expands to one repository item per configured repo', async () => {
      mockGetForgejoRepositoryConfigs.mockResolvedValue([configA, configB]);
      const groupItem = new SavedQueryGroupItem(assignedGroup);

      const children = await provider.getChildren(groupItem);

      expect(children).toHaveLength(2);
      expect(children.every(child => child instanceof SavedQueryRepositoryItem)).toBe(true);
      expect((children[0] as SavedQueryRepositoryItem).config).toEqual(configA);
      expect((children[1] as SavedQueryRepositoryItem).config).toEqual(configB);
    });

    test('a repository item fans back out to sections for its own config', async () => {
      mockGetForgejoRepositoryConfigs.mockResolvedValue([configA, configB]);
      const repoItem = new SavedQueryRepositoryItem(assignedGroup, configB);

      const children = await provider.getChildren(repoItem);

      expect(children).toHaveLength(2);
      expect((children[0] as SavedQuerySectionItem).config).toEqual(configB);
    });
  });

  describe('empty state', () => {
    test('shows an empty-state message when a page resolves with zero items', async () => {
      const section = new SavedQuerySectionItem(assignedGroup, configA, 'pullRequests');
      const children = await provider.getChildren(section);

      expect(children).toHaveLength(1);
      expect(children[0].contextValue).toBe('info');
      expect((children[0] as any).message).toContain('No assigned to me pull requests found');
    });
  });

  describe('error state', () => {
    test('shows an error message when the API call rejects, without throwing', async () => {
      mockClient.getPullRequestsPage.mockRejectedValueOnce(new Error('Network unreachable'));
      const section = new SavedQuerySectionItem(assignedGroup, configA, 'pullRequests');

      const children = await provider.getChildren(section);

      expect(children).toHaveLength(1);
      expect(children[0].contextValue).toBe('error');
      expect((children[0] as any).message).toBe('Network unreachable');
    });
  });

  describe('unauthenticated state', () => {
    test('prompts for auth on a user-scoped group when no login is available', async () => {
      mockClient.getAuthenticatedUserLogin.mockResolvedValueOnce(null);
      const section = new SavedQuerySectionItem(assignedGroup, configA, 'pullRequests');

      const children = await provider.getChildren(section);

      expect(children).toHaveLength(1);
      expect(children[0].contextValue).toBe('info');
      expect((children[0] as any).message).toContain('Configure an authentication token');
      expect(mockClient.getPullRequestsPage).not.toHaveBeenCalled();
    });

    test('"Recently updated" does not require authentication', async () => {
      mockClient.getAuthenticatedUserLogin.mockResolvedValue(null);
      mockClient.getPullRequestsPage.mockResolvedValueOnce({ items: [mockPR], page: 1, limit: 50, hasMore: false });
      const section = new SavedQuerySectionItem(recentlyUpdatedGroup, configA, 'pullRequests');

      const children = await provider.getChildren(section);

      expect(children).toHaveLength(1);
      expect(children[0]).toBeInstanceOf(SavedQueryPullRequestItem);
      expect(mockClient.getPullRequestsPage).toHaveBeenCalledWith(
        'owner-a', 'repo-a', 'open', 1, 50, { sort: 'recentupdate' }
      );
    });
  });

  describe('items and load-more', () => {
    test('renders pull request rows and a load-more row when another page is available', async () => {
      mockClient.getPullRequestsPage.mockResolvedValueOnce({ items: [mockPR], page: 1, limit: 50, hasMore: true });
      const section = new SavedQuerySectionItem(assignedGroup, configA, 'pullRequests');

      const children = await provider.getChildren(section);

      expect(children).toHaveLength(2);
      expect(children[0]).toBeInstanceOf(SavedQueryPullRequestItem);
      expect(children[1]).toBeInstanceOf(SavedQueryLoadMoreItem);
      expect(mockClient.getPullRequestsPage).toHaveBeenCalledWith(
        'owner-a', 'repo-a', 'open', 1, 50, { assignedBy: 'alice' }
      );
    });

    test('renders a pull request row with the shared presentation and a showPrDetails command', async () => {
      mockClient.getPullRequestsPage.mockResolvedValueOnce({
        items: [{ ...mockPR, mergeable: false }],
        page: 1,
        limit: 50,
        hasMore: false
      });
      const section = new SavedQuerySectionItem(assignedGroup, configA, 'pullRequests');

      const children = await provider.getChildren(section);
      const prItem = children[0] as SavedQueryPullRequestItem;

      // Same conflicting-state icon prTreeProvider's PRTreeItem would show,
      // since both rows are built from the shared pullRequestPresentation helper.
      expect(prItem.iconPath).toEqual(new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground')));
      expect(prItem.description).toBe('by alice - Merge conflicts');
      expect(prItem.command).toEqual({
        command: 'forgejo.showPrDetails',
        title: 'Show PR Details',
        arguments: [{ ...mockPR, mergeable: false }, 'owner-a', 'repo-a', 'https://git.example.com']
      });
    });

    test('renders issue rows using the shared IssueTreeItem', async () => {
      mockClient.getIssuesPage.mockResolvedValueOnce({ items: [mockIssue], page: 1, limit: 50, hasMore: false });
      const section = new SavedQuerySectionItem(assignedGroup, configA, 'issues');

      const children = await provider.getChildren(section);

      expect(children).toHaveLength(1);
      expect(children[0]).toBeInstanceOf(IssueTreeItem);
    });

    test('loadMoreSavedQuery fetches the next page and dedups an item repeated across pages', async () => {
      // Page 2 deliberately repeats #7 from page 1 (overlapping paged results,
      // as can happen with live data shifting between requests) so this test
      // actually exercises appendUniquePullRequests instead of just appending.
      mockClient.getPullRequestsPage
        .mockResolvedValueOnce({ items: [mockPR], page: 1, limit: 50, hasMore: true })
        .mockResolvedValueOnce({ items: [{ ...mockPR, number: 7 }, { ...mockPR, number: 8 }], page: 2, limit: 50, hasMore: false });
      const section = new SavedQuerySectionItem(assignedGroup, configA, 'pullRequests');

      const firstPage = await provider.getChildren(section);
      expect(firstPage).toHaveLength(2);

      const loadMoreItem = firstPage[1] as SavedQueryLoadMoreItem;
      await provider.loadMoreSavedQuery(loadMoreItem);

      const secondPage = await provider.getChildren(section);
      expect(secondPage).toHaveLength(2);
      expect((secondPage[0] as SavedQueryPullRequestItem).pr.number).toBe(7);
      expect((secondPage[1] as SavedQueryPullRequestItem).pr.number).toBe(8);
      expect(mockClient.getPullRequestsPage).toHaveBeenCalledTimes(2);
    });

    test('loadMoreSavedQuery dedups an issue repeated across pages', async () => {
      mockClient.getIssuesPage
        .mockResolvedValueOnce({ items: [mockIssue], page: 1, limit: 50, hasMore: true })
        .mockResolvedValueOnce({ items: [{ ...mockIssue, number: 9 }, { ...mockIssue, number: 10 }], page: 2, limit: 50, hasMore: false });
      const section = new SavedQuerySectionItem(assignedGroup, configA, 'issues');

      const firstPage = await provider.getChildren(section);
      expect(firstPage).toHaveLength(2);

      const loadMoreItem = firstPage[1] as SavedQueryLoadMoreItem;
      await provider.loadMoreSavedQuery(loadMoreItem);

      const secondPage = await provider.getChildren(section);
      expect(secondPage).toHaveLength(2);
      expect((secondPage[0] as IssueTreeItem).issue.number).toBe(9);
      expect((secondPage[1] as IssueTreeItem).issue.number).toBe(10);
      expect(mockClient.getIssuesPage).toHaveBeenCalledTimes(2);
    });

    test('concurrent expansions of the same section reuse the in-flight request instead of double-fetching', async () => {
      // Uses "Recently updated" (no auth pre-check) so both calls reach the
      // page-cache dedup logic before either awaits, exercising the same
      // in-flight-promise guard that shows a "loading" tree while pending.
      mockClient.getPullRequestsPage.mockImplementationOnce(() => new Promise(resolve => {
        setTimeout(() => resolve({ items: [mockPR], page: 1, limit: 50, hasMore: false }), 0);
      }));
      const section = new SavedQuerySectionItem(recentlyUpdatedGroup, configA, 'pullRequests');

      const [firstResult, secondResult] = await Promise.all([
        provider.getChildren(section),
        provider.getChildren(section)
      ]);

      expect(mockClient.getPullRequestsPage).toHaveBeenCalledTimes(1);
      expect(firstResult).toEqual(secondResult);
    });
  });

  describe('custom saved queries', () => {
    test('a custom query group appears after the built-ins and searches with its free-text query', async () => {
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
        get: jest.fn(() => [
          { id: 'custom-1', label: 'Needs triage', target: 'issues', query: 'label:needs-triage' }
        ]),
        update: jest.fn()
      });

      const rootChildren = await provider.getChildren();
      expect(rootChildren).toHaveLength(6);
      const customGroupItem = rootChildren[5] as SavedQueryGroupItem;
      expect(customGroupItem.group.label).toBe('Needs triage');
      expect(customGroupItem.contextValue).toBe('savedQueryCustomGroup');

      mockClient.getIssuesPage.mockResolvedValueOnce({ items: [mockIssue], page: 1, limit: 50, hasMore: false });
      const section = new SavedQuerySectionItem(customGroupItem.group, configA, 'issues');
      const children = await provider.getChildren(section);

      expect(children).toHaveLength(1);
      expect(mockClient.getIssuesPage).toHaveBeenCalledWith(
        'owner-a', 'repo-a', 'open', 1, 50, { query: 'label:needs-triage' }
      );
    });
  });
});
