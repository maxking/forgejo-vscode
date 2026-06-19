import { ForgejoClient } from '../../api/forgejoClient';
import {
  mockFileContentsResponseBase64,
  mockFileContentsResponsePlain,
  mockPlainTextContent,
  mockFileContentsSpecialChars
} from '../fixtures/fileContents';
import { mockAllFileTypes } from '../fixtures/prFiles';
import { mockPRWithRefs, mockPRWithBugfixRefs, mockPRWithMissingRefs } from '../fixtures/prRefs';
import { mockAllStatuses, mockEmptyStatuses } from '../fixtures/commitStatuses';
import { mockComments, mockReviews, mockCommits, mockTimeline } from '../fixtures/prActivities';
import {
  mockActionTasksResponse,
  mockEmptyActionTasksResponse,
  mockWorkflowRunDetails,
  mockWorkflowJobsResponse,
  mockEmptyWorkflowJobsResponse,
  mockWorkflowLogs
} from '../fixtures/workflowRuns';

describe('ForgejoClient', () => {
  let client: ForgejoClient;
  let mockFetch: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    client = new ForgejoClient('https://git.example.com', 'test-token');
    mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
    mockFetch.mockClear();
  });

  describe('getPullRequestCount', () => {
    test('should read pull request count from page metadata', async () => {
      const listPageSpy = jest.spyOn(client, 'listPullRequestsPage').mockResolvedValueOnce({
        items: [],
        page: 1,
        limit: 1,
        hasMore: true,
        totalCount: 123
      });

      const count = await client.getPullRequestCount('owner', 'repo', 'closed');

      expect(count).toBe(123);
      expect(listPageSpy).toHaveBeenCalledWith('owner', 'repo', { state: 'closed', page: 1, limit: 1 });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('should return null when page metadata omits total count', async () => {
      jest.spyOn(client, 'listPullRequestsPage').mockResolvedValueOnce({
        items: [],
        page: 1,
        limit: 1,
        hasMore: false,
        totalCount: null
      });

      await expect(client.getPullRequestCount('owner', 'repo', 'closed')).resolves.toBeNull();
    });

    test('should return null when count probe fails', async () => {
      jest.spyOn(client, 'listPullRequestsPage').mockRejectedValueOnce(new Error('Not Found'));

      await expect(client.getPullRequestCount('owner', 'repo', 'closed')).resolves.toBeNull();
    });
  });

  describe('search pagination wrappers', () => {
    test('getPullRequestsPage should use forgejo-ts searchPullRequestsPage for nonblank queries', async () => {
      const pullRequest = {
        number: 42,
        title: 'Searchable PR',
        state: 'open',
        user: { login: 'alice' },
        html_url: 'https://git.example.com/owner/repo/pulls/42',
        created_at: '2026-01-01T00:00:00Z',
        merged: false,
        draft: false,
        comments: 0
      };
      const searchSpy = jest.spyOn(client, 'searchPullRequestsPage').mockResolvedValue({
        items: [pullRequest],
        page: 2,
        limit: 25,
        hasMore: true,
        totalCount: null
      } as any);

      const result = await client.getPullRequestsPage('owner', 'repo', 'open', 2, 25, '  searchable  ');

      expect(searchSpy).toHaveBeenCalledWith('owner', 'repo', {
        state: 'open',
        page: 2,
        limit: 25,
        query: 'searchable'
      });
      expect(result).toEqual({
        items: [pullRequest],
        page: 2,
        limit: 25,
        hasMore: true
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('getIssuesPage should use forgejo-ts listIssuesPage for nonblank queries', async () => {
      const issue = {
        number: 10,
        title: 'Searchable issue',
        state: 'open',
        user: { login: 'alice' },
        html_url: 'https://git.example.com/owner/repo/issues/10',
        created_at: '2026-01-01T00:00:00Z',
        comments: 0
      };
      const searchSpy = jest.spyOn(client, 'listIssuesPage').mockResolvedValue({
        items: [issue],
        page: 3,
        limit: 10,
        hasMore: false,
        totalCount: null
      } as any);

      const result = await client.getIssuesPage('owner', 'repo', 'closed', 3, 10, '  crash  ');

      expect(searchSpy).toHaveBeenCalledWith('owner', 'repo', {
        state: 'closed',
        page: 3,
        limit: 10,
        query: 'crash'
      });
      expect(result).toEqual({
        items: [issue],
        page: 3,
        limit: 10,
        hasMore: false
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('getIssuesPage should pass structured user query filters to forgejo-ts', async () => {
      const issue = {
        number: 11,
        title: 'Assigned issue',
        state: 'open',
        user: { login: 'alice' },
        html_url: 'https://git.example.com/owner/repo/issues/11',
        created_at: '2026-01-01T00:00:00Z',
        comments: 0
      };
      const listSpy = jest.spyOn(client, 'listIssuesPage').mockResolvedValue({
        items: [issue],
        page: 1,
        limit: 20,
        hasMore: false,
        totalCount: null
      } as any);

      const result = await client.getIssuesPage('owner', 'repo', 'open', 1, 20, {
        query: '  crash  ',
        assignedBy: 'alice',
        createdBy: 'bob',
        mentionedBy: 'carol'
      });

      expect(listSpy).toHaveBeenCalledWith('owner', 'repo', {
        state: 'open',
        page: 1,
        limit: 20,
        query: 'crash',
        assignedBy: 'alice',
        createdBy: 'bob',
        mentionedBy: 'carol'
      });
      expect(result.items).toEqual([issue]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('getPullRequestsPage should use repository issue search for user query filters', async () => {
      const pullRequest = {
        number: 12,
        title: 'Assigned PR',
        state: 'open',
        user: { login: 'alice' },
        html_url: 'https://git.example.com/owner/repo/pulls/12',
        created_at: '2026-01-01T00:00:00Z',
        merged: false,
        draft: false,
        comments: 0
      };
      const rawSpy = jest.spyOn(client, 'rawRequest').mockResolvedValue([
        {
          number: 12,
          pull_request: { url: 'https://git.example.com/api/v1/repos/owner/repo/pulls/12' }
        }
      ] as any);
      const detailSpy = jest.spyOn(client, 'getPullRequest').mockResolvedValue(pullRequest as any);

      const result = await client.getPullRequestsPage('owner', 'repo', 'open', 2, 25, {
        query: '  mine  ',
        assignedBy: 'alice',
        createdBy: 'bob',
        mentionedBy: 'carol'
      });

      expect(rawSpy).toHaveBeenCalledWith(
        'GET',
        '/repos/owner/repo/issues?state=open&type=pulls&q=mine&created_by=bob&assigned_by=alice&mentioned_by=carol&page=2&limit=25'
      );
      expect(detailSpy).toHaveBeenCalledWith('owner', 'repo', 12);
      expect(result).toEqual({
        items: [pullRequest],
        page: 2,
        limit: 25,
        hasMore: false
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('getPullRequestsPage should use authenticated review-requested search and filter to the repo', async () => {
      const pullRequest = {
        number: 12,
        title: 'Review requested PR',
        state: 'open',
        user: { login: 'alice' },
        html_url: 'https://git.example.com/owner/repo/pulls/12',
        created_at: '2026-01-01T00:00:00Z',
        merged: false,
        draft: false,
        comments: 0
      };
      const rawSpy = jest.spyOn(client, 'rawRequest').mockResolvedValue([
        {
          number: 12,
          repository: { full_name: 'owner/repo' },
          pull_request: { url: 'https://git.example.com/api/v1/repos/owner/repo/pulls/12' }
        },
        {
          number: 99,
          repository: { full_name: 'owner/other-repo' },
          pull_request: { url: 'https://git.example.com/api/v1/repos/owner/other-repo/pulls/99' }
        }
      ] as any);
      const detailSpy = jest.spyOn(client, 'getPullRequest').mockResolvedValue(pullRequest as any);

      const result = await client.getPullRequestsPage('owner', 'repo', 'open', 2, 25, {
        query: '  review  ',
        reviewRequestedBy: 'alice'
      });

      expect(rawSpy).toHaveBeenCalledWith(
        'GET',
        '/repos/issues/search?state=open&type=pulls&q=review&review_requested=true&owner=owner&page=2&limit=25'
      );
      expect(detailSpy).toHaveBeenCalledTimes(1);
      expect(detailSpy).toHaveBeenCalledWith('owner', 'repo', 12);
      expect(result).toEqual({
        items: [pullRequest],
        page: 2,
        limit: 25,
        hasMore: false
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('getAuthenticatedUserLogin should read the current API user login', async () => {
      const rawSpy = jest.spyOn(client, 'rawRequest').mockResolvedValue({ login: 'alice' } as any);

      await expect(client.getAuthenticatedUserLogin()).resolves.toBe('alice');

      expect(rawSpy).toHaveBeenCalledWith('GET', '/user');
    });
  });

  describe('getPullRequestFiles', () => {
    test('should fetch pull request files successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockAllFileTypes
      } as unknown as Response);

      const files = await client.getPullRequestFiles('owner', 'repo', 42);

      expect(files).toEqual(mockAllFileTypes);
      expect(files).toHaveLength(mockAllFileTypes.length);
    });

    test('should handle empty file array', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => []
      } as unknown as Response);

      const files = await client.getPullRequestFiles('owner', 'repo', 42);

      expect(files).toEqual([]);
      expect(files.length).toBe(0);
    });

    test('should throw error for 404 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => ''
      } as unknown as Response);

      await expect(client.getPullRequestFiles('owner', 'repo', 99999))
        .rejects
        .toThrow('HTTP 404: Not Found');
    });

    test('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network timeout'));

      await expect(client.getPullRequestFiles('owner', 'repo', 42))
        .rejects
        .toThrow();
    });
  });

  describe('getFileContents', () => {
    test('should decode base64 content correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockFileContentsResponseBase64
      } as unknown as Response);

      const content = await client.getFileContents('owner', 'repo', 'src/file.ts', 'main');

      expect(content).toBe(mockPlainTextContent);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://git.example.com/api/v1/repos/owner/repo/contents/src/file.ts?ref=main',
        expect.any(Object)
      );
    });

    test('should return plain text content when encoding is not base64', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockFileContentsResponsePlain
      } as unknown as Response);

      const content = await client.getFileContents('owner', 'repo', 'src/file.ts', 'main');

      expect(content).toBe(mockPlainTextContent);
    });

    test('should throw error for 404 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => ''
      } as unknown as Response);

      await expect(client.getFileContents('owner', 'repo', 'nonexistent.ts', 'main'))
        .rejects
        .toThrow('HTTP 404: Not Found');
    });

    test('should URL encode filepath correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockFileContentsSpecialChars
      } as unknown as Response);

      await client.getFileContents('owner', 'repo', 'src/file with spaces.ts', 'main');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('contents/src/file%20with%20spaces.ts'),
        expect.any(Object)
      );
    });

    test('should pass ref parameter correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockFileContentsResponseBase64
      } as unknown as Response);

      await client.getFileContents('owner', 'repo', 'src/file.ts', 'feature/branch-name');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://git.example.com/api/v1/repos/owner/repo/contents/src/file.ts?ref=feature%2Fbranch-name',
        expect.any(Object)
      );
    });
  });

  describe('getPullRequestRefs', () => {
    test('should extract base and head refs from PR details', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockPRWithRefs
      } as unknown as Response);

      const refs = await client.getPullRequestRefs('owner', 'repo', 42);

      expect(refs).toEqual({
        base: 'main',
        head: 'feature/new-feature'
      });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://git.example.com/api/v1/repos/owner/repo/pulls/42',
        expect.any(Object)
      );
    });

    test('should handle different branch names', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockPRWithBugfixRefs
      } as unknown as Response);

      const refs = await client.getPullRequestRefs('owner', 'repo', 43);

      expect(refs).toEqual({
        base: 'develop',
        head: 'bugfix/fix-issue-123'
      });
    });

    test('should return empty strings when refs are missing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockPRWithMissingRefs
      } as unknown as Response);

      const refs = await client.getPullRequestRefs('owner', 'repo', 44);

      expect(refs).toEqual({
        base: '',
        head: ''
      });
    });
  });

  describe('Authentication', () => {
    test('should include auth token in headers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => []
      } as unknown as Response);

      await client.getPullRequestFiles('owner', 'repo', 42);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'token test-token'
          })
        })
      );
    });

    test('should work without token', async () => {
      const clientWithoutToken = new ForgejoClient('https://git.example.com');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => []
      } as unknown as Response);

      await clientWithoutToken.getPullRequestFiles('owner', 'repo', 42);

      const callArgs = mockFetch.mock.calls[0];
      const headers = callArgs[1]?.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
    });
  });

  describe('Error Handling', () => {
    test('should handle malformed JSON response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => {
          throw new Error('Invalid JSON');
        }
      } as unknown as Response);

      await expect(client.getPullRequestFiles('owner', 'repo', 42))
        .rejects
        .toThrow();
    });

    test('should handle HTTP 500 errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => ''
      } as unknown as Response);

      await expect(client.getFileContents('owner', 'repo', 'file.ts', 'main'))
        .rejects
        .toThrow('HTTP 500: Internal Server Error');
    });

    test('should handle HTTP 401 unauthorized', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => ''
      } as unknown as Response);

      await expect(client.getPullRequestRefs('owner', 'repo', 42))
        .rejects
        .toThrow('HTTP 401: Unauthorized');
    });
  });

  describe('Output behavior', () => {
    test('should return pull request files for a valid request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => []
      } as unknown as Response);

      const files = await client.getPullRequestFiles('test-owner', 'test-repo', 123);

      expect(files).toEqual([]);
    });

    test('should return decoded file contents for a nested path', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => mockFileContentsResponseBase64
      } as unknown as Response);

      const content = await client.getFileContents('test-owner', 'test-repo', 'path/to/file.ts', 'test-branch');

      expect(content).toBe(mockPlainTextContent);
    });

    test('should return pull request refs for a valid request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => mockPRWithRefs
      } as unknown as Response);

      const refs = await client.getPullRequestRefs('test-owner', 'test-repo', 456);

      expect(refs).toEqual({
        base: 'main',
        head: 'feature/new-feature'
      });
    });
  });

  describe('getCommitStatuses', () => {
    test('should fetch commit statuses successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockAllStatuses
      } as unknown as Response);

      const statuses = await client.getCommitStatuses('owner', 'repo', 'abc123');

      expect(statuses).toEqual(mockAllStatuses);
      expect(statuses).toHaveLength(mockAllStatuses.length);
    });

    test('should handle empty statuses array', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockEmptyStatuses
      } as unknown as Response);

      const statuses = await client.getCommitStatuses('owner', 'repo', 'abc123');

      expect(statuses).toEqual([]);
    });

    test('should throw error for 404 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => ''
      } as unknown as Response);

      await expect(client.getCommitStatuses('owner', 'repo', 'unknown-sha'))
        .rejects
        .toThrow('HTTP 404: Not Found');
    });
  });

  describe('getIssueComments', () => {
    test('should fetch comments successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockComments
      } as unknown as Response);

      const comments = await client.getIssueComments('owner', 'repo', 42);

      expect(comments).toEqual(mockComments);
      expect(comments).toHaveLength(mockComments.length);
    });

    test('should handle empty comments array', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => []
      } as unknown as Response);

      const comments = await client.getIssueComments('owner', 'repo', 42);

      expect(comments).toEqual([]);
    });

    test('should throw error for 404 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => ''
      } as unknown as Response);

      await expect(client.getIssueComments('owner', 'repo', 99999))
        .rejects
        .toThrow('HTTP 404: Not Found');
    });
  });

  describe('getPullRequestReviews', () => {
    test('should fetch reviews successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockReviews
      } as unknown as Response);

      const reviews = await client.getPullRequestReviews('owner', 'repo', 42);

      expect(reviews).toEqual(mockReviews);
      expect(reviews).toHaveLength(mockReviews.length);
    });

    test('should handle empty reviews array', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => []
      } as unknown as Response);

      const reviews = await client.getPullRequestReviews('owner', 'repo', 42);

      expect(reviews).toEqual([]);
    });
  });

  describe('getPullRequestCommits', () => {
    test('should fetch commits successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockCommits
      } as unknown as Response);

      const commits = await client.getPullRequestCommits('owner', 'repo', 42);

      expect(commits).toEqual(mockCommits);
      expect(commits).toHaveLength(mockCommits.length);
    });

    test('should handle empty commits array', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => []
      } as unknown as Response);

      const commits = await client.getPullRequestCommits('owner', 'repo', 42);

      expect(commits).toEqual([]);
    });
  });

  describe('getIssueTimeline', () => {
    test('should fetch timeline events successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockTimeline
      } as unknown as Response);

      const timeline = await client.getIssueTimeline('owner', 'repo', 42);

      expect(timeline).toEqual(mockTimeline);
      expect(timeline).toHaveLength(mockTimeline.length);
    });

    test('should handle empty timeline array', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => []
      } as unknown as Response);

      const timeline = await client.getIssueTimeline('owner', 'repo', 42);

      expect(timeline).toEqual([]);
    });
  });

  describe('mergePullRequest', () => {
    test('should merge PR with merge strategy', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: async () => ({}),
        headers: { get: () => '' }
      } as unknown as Response);

      await client.mergePullRequest('owner', 'repo', 42, 'merge');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://git.example.com/api/v1/repos/owner/repo/pulls/42/merge',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ Do: 'merge', delete_branch_after_merge: false })
        })
      );
    });

    test('should merge PR with squash strategy', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: async () => ({}),
        headers: { get: () => '' }
      } as unknown as Response);

      await client.mergePullRequest('owner', 'repo', 42, 'squash');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ Do: 'squash', delete_branch_after_merge: false })
        })
      );
    });

    test('should merge PR with rebase strategy', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: async () => ({}),
        headers: { get: () => '' }
      } as unknown as Response);

      await client.mergePullRequest('owner', 'repo', 42, 'rebase');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ Do: 'rebase', delete_branch_after_merge: false })
        })
      );
    });

    test('should handle delete branch after merge option', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: async () => ({}),
        headers: { get: () => '' }
      } as unknown as Response);

      await client.mergePullRequest('owner', 'repo', 42, 'merge', true);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ Do: 'merge', delete_branch_after_merge: true })
        })
      );
    });

    test('should handle 405 merge not allowed', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 405,
        statusText: 'Method Not Allowed',
        text: async () => 'Not mergeable'
      } as unknown as Response);

      await expect(client.mergePullRequest('owner', 'repo', 42, 'merge'))
        .rejects
        .toThrow('Merge not allowed - PR may not be mergeable');
    });

    test('should handle 409 merge conflict', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        text: async () => 'Merge conflict'
      } as unknown as Response);

      await expect(client.mergePullRequest('owner', 'repo', 42, 'merge'))
        .rejects
        .toThrow('Merge conflict - PR has conflicts that must be resolved');
    });
  });

  describe('closePullRequest', () => {
    test('should close PR successfully', async () => {
      const closedPR = { ...mockPRWithRefs, state: 'closed' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => closedPR,
        headers: { get: () => 'application/json' }
      } as unknown as Response);

      const result = await client.closePullRequest('owner', 'repo', 42);

      expect(result.state).toBe('closed');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://git.example.com/api/v1/repos/owner/repo/pulls/42',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ state: 'closed' })
        })
      );
    });

    test('should handle errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: async () => 'Permission denied'
      } as unknown as Response);

      await expect(client.closePullRequest('owner', 'repo', 42))
        .rejects
        .toThrow('HTTP 403: Forbidden');
    });
  });

  describe('createComment', () => {
    test('should create comment successfully', async () => {
      const newComment = { id: 100, body: 'Test comment' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => newComment
      } as unknown as Response);

      const result = await client.createComment('owner', 'repo', 42, 'Test comment');

      expect(result).toEqual(newComment);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://git.example.com/api/v1/repos/owner/repo/issues/42/comments',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ body: 'Test comment' })
        })
      );
    });

    test('should handle authentication errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => 'Invalid token'
      } as unknown as Response);

      await expect(client.createComment('owner', 'repo', 42, 'Test'))
        .rejects
        .toThrow('HTTP 401: Unauthorized');
    });

    test('should handle validation errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        text: async () => 'Body cannot be empty'
      } as unknown as Response);

      await expect(client.createComment('owner', 'repo', 42, ''))
        .rejects
        .toThrow('HTTP 422: Unprocessable Entity');
    });
  });

  describe('createReview', () => {
    test('should create APPROVE review', async () => {
      const newReview = { id: 200, state: 'APPROVED', body: 'LGTM!' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => newReview
      } as unknown as Response);

      const result = await client.createReview('owner', 'repo', 42, 'APPROVE', 'LGTM!');

      expect(result).toEqual(newReview);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://git.example.com/api/v1/repos/owner/repo/pulls/42/reviews',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ event: 'APPROVE', body: 'LGTM!' })
        })
      );
    });

    test('should create REQUEST_CHANGES review', async () => {
      const newReview = { id: 201, state: 'CHANGES_REQUESTED', body: 'Please fix' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => newReview
      } as unknown as Response);

      const result = await client.createReview('owner', 'repo', 42, 'REQUEST_CHANGES', 'Please fix');

      expect(result).toEqual(newReview);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ event: 'REQUEST_CHANGES', body: 'Please fix' })
        })
      );
    });

    test('should create COMMENT review', async () => {
      const newReview = { id: 202, state: 'COMMENTED', body: 'Observation' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => newReview
      } as unknown as Response);

      const result = await client.createReview('owner', 'repo', 42, 'COMMENT', 'Observation');

      expect(result).toEqual(newReview);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ event: 'COMMENT', body: 'Observation' })
        })
      );
    });

    test('should handle authentication errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => 'Invalid token'
      } as unknown as Response);

      await expect(client.createReview('owner', 'repo', 42, 'APPROVE', 'LGTM'))
        .rejects
        .toThrow('HTTP 401: Unauthorized');
    });
  });

  describe('updateIssueState', () => {
    test('should close issue successfully', async () => {
      const closedIssue = { id: 1, number: 42, state: 'closed', title: 'Test Issue' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => closedIssue
      } as unknown as Response);

      const result = await client.updateIssueState('owner', 'repo', 42, 'closed');

      expect(result.state).toBe('closed');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://git.example.com/api/v1/repos/owner/repo/issues/42',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ state: 'closed' })
        })
      );
    });

    test('should reopen issue successfully', async () => {
      const openIssue = { id: 1, number: 42, state: 'open', title: 'Test Issue' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => openIssue
      } as unknown as Response);

      const result = await client.updateIssueState('owner', 'repo', 42, 'open');

      expect(result.state).toBe('open');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://git.example.com/api/v1/repos/owner/repo/issues/42',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ state: 'open' })
        })
      );
    });

    test('should handle errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: async () => 'Permission denied'
      } as unknown as Response);

      await expect(client.updateIssueState('owner', 'repo', 42, 'closed'))
        .rejects
        .toThrow('HTTP 403: Forbidden');
    });
  });

  // ==================== Actions API Tests ====================

  describe('getWorkflowRuns', () => {
    test('should fetch workflow runs successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockActionTasksResponse
      } as unknown as Response);

      const result = await client.getWorkflowRuns('owner', 'repo');

      expect(result).toEqual(mockActionTasksResponse);
      expect(result.workflow_runs.length).toBe(4);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://git.example.com/api/v1/repos/owner/repo/actions/tasks?page=1&limit=50',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'token test-token'
          })
        })
      );
    });

    test('should filter by status when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockActionTasksResponse
      } as unknown as Response);

      await client.getWorkflowRuns('owner', 'repo', 'success');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://git.example.com/api/v1/repos/owner/repo/actions/tasks?status=success&page=1&limit=50',
        expect.any(Object)
      );
    });

    test('should handle empty workflow runs', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockEmptyActionTasksResponse
      } as unknown as Response);

      const result = await client.getWorkflowRuns('owner', 'repo');

      expect(result.workflow_runs).toEqual([]);
      expect(result.total_count).toBe(0);
    });

    test('should handle 404 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => ''
      } as unknown as Response);

      await expect(client.getWorkflowRuns('owner', 'repo'))
        .rejects
        .toThrow('HTTP 404: Not Found');
    });
  });

  describe('getWorkflowRunDetails', () => {
    test('should fetch workflow run details successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockWorkflowRunDetails
      } as unknown as Response);

      const result = await client.getWorkflowRunDetails('owner', 'repo', 123);

      expect(result).toEqual(mockWorkflowRunDetails);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://git.example.com/api/v1/repos/owner/repo/actions/runs/123',
        expect.any(Object)
      );
    });

    test('should handle 404 for non-existent run', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => ''
      } as unknown as Response);

      await expect(client.getWorkflowRunDetails('owner', 'repo', 99999))
        .rejects
        .toThrow('HTTP 404: Not Found');
    });
  });

  describe('getWorkflowJobs', () => {
    test('should fetch workflow jobs successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockWorkflowJobsResponse
      } as unknown as Response);

      const result = await client.getWorkflowJobs('owner', 'repo', 123);

      expect(result).toEqual(mockWorkflowJobsResponse);
      expect(result.jobs.length).toBe(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://git.example.com/api/v1/repos/owner/repo/actions/runs/123/jobs',
        expect.any(Object)
      );
    });

    test('should handle empty jobs', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockEmptyWorkflowJobsResponse
      } as unknown as Response);

      const result = await client.getWorkflowJobs('owner', 'repo', 123);

      expect(result.jobs).toEqual([]);
    });

    test('should handle 404 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => ''
      } as unknown as Response);

      await expect(client.getWorkflowJobs('owner', 'repo', 99999))
        .rejects
        .toThrow('HTTP 404: Not Found');
    });
  });

  describe('getWorkflowLogs', () => {
    test('should fetch workflow logs successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => mockWorkflowLogs
      } as unknown as Response);

      const result = await client.getWorkflowLogs('owner', 'repo', 42, 0);

      expect(result).toBe(mockWorkflowLogs);
      // Logs use web endpoint, not API endpoint
      expect(mockFetch).toHaveBeenCalledWith(
        'https://git.example.com/owner/repo/actions/runs/42/jobs/0/logs',
        expect.objectContaining({
          method: 'GET'
        })
      );
    });

    test('should default to job index 0', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => mockWorkflowLogs
      } as unknown as Response);

      await client.getWorkflowLogs('owner', 'repo', 42);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://git.example.com/owner/repo/actions/runs/42/jobs/0/logs',
        expect.any(Object)
      );
    });

    test('should handle different job indices', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => mockWorkflowLogs
      } as unknown as Response);

      await client.getWorkflowLogs('owner', 'repo', 42, 2);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://git.example.com/owner/repo/actions/runs/42/jobs/2/logs',
        expect.any(Object)
      );
    });

    test('should prefer stable job refs when available', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => mockWorkflowLogs
      } as unknown as Response);

      await client.getWorkflowLogs('owner', 'repo', 42, {
        jobId: 201,
        jobHtmlUrl: 'https://git.example.com/owner/repo/actions/runs/42/jobs/201'
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://git.example.com/owner/repo/actions/runs/42/jobs/201/logs',
        expect.any(Object)
      );
    });

    test('should handle 404 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      } as unknown as Response);

      await expect(client.getWorkflowLogs('owner', 'repo', 99999, 0))
        .rejects
        .toThrow('HTTP 404: Not Found');
    });

    test('should include auth token when available', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => mockWorkflowLogs
      } as unknown as Response);

      await client.getWorkflowLogs('owner', 'repo', 42, 0);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'token test-token'
          })
        })
      );
    });
  });

  describe('rerunWorkflow', () => {
    test('should trigger workflow rerun successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201
      } as unknown as Response);

      await expect(client.rerunWorkflow('owner', 'repo', 123))
        .resolves
        .toBeUndefined();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://git.example.com/api/v1/repos/owner/repo/actions/runs/123/rerun',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'token test-token'
          })
        })
      );
    });

    test('should handle 404 for non-existent run', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'Run not found'
      } as unknown as Response);

      await expect(client.rerunWorkflow('owner', 'repo', 99999))
        .rejects
        .toThrow('HTTP 404: Not Found');
    });

    test('should handle 403 forbidden', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: async () => 'Permission denied'
      } as unknown as Response);

      await expect(client.rerunWorkflow('owner', 'repo', 123))
        .rejects
        .toThrow('HTTP 403: Forbidden');
    });
  });

  // ==================== Pagination Tests ====================

  describe('Pagination', () => {
    function generateMockPRs(count: number, startId: number = 1): any[] {
      return Array.from({ length: count }, (_, i) => ({
        number: startId + i,
        title: `PR #${startId + i}`,
        state: 'open',
        user: { login: 'testuser' },
        html_url: `https://git.example.com/owner/repo/pulls/${startId + i}`,
        created_at: '2024-01-01T00:00:00Z'
      }));
    }

    function generateMockIssueItems(count: number, prCount: number, startId: number = 1): any[] {
      return Array.from({ length: count }, (_, i) => ({
        number: startId + i,
        title: `Item #${startId + i}`,
        state: 'open',
        user: { login: 'testuser' },
        html_url: `https://git.example.com/owner/repo/issues/${startId + i}`,
        created_at: '2024-01-01T00:00:00Z',
        comments: 0,
        ...(i < prCount ? { pull_request: { url: `https://git.example.com/api/v1/repos/owner/repo/pulls/${startId + i}` } } : {})
      }));
    }

    test('getPullRequests should fetch multiple pages when first page is full', async () => {
      const page1 = generateMockPRs(50, 1);
      const page2 = generateMockPRs(25, 51);
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => page1 } as unknown as Response);
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => page2 } as unknown as Response);
      const result = await client.getPullRequests('owner', 'repo', 'all');
      expect(result.length).toBe(75);
      expect(result[0].number).toBe(1);
      expect(result[74].number).toBe(75);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('page=1&limit=50'), expect.any(Object));
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('page=2&limit=50'), expect.any(Object));
    });

    test('getPullRequests should stop after single page when fewer than limit items', async () => {
      const page1 = generateMockPRs(10, 1);
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => page1 } as unknown as Response);
      const result = await client.getPullRequests('owner', 'repo', 'open');
      expect(result.length).toBe(10);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test('getPullRequests should handle empty first page', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] } as unknown as Response);
      const result = await client.getPullRequests('owner', 'repo', 'all');
      expect(result.length).toBe(0);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test('getPullRequestsPage should delegate to the forgejo-ts page API', async () => {
      const page3 = generateMockPRs(50, 101);
      const listPageSpy = jest.spyOn(client, 'listPullRequestsPage').mockResolvedValueOnce({
        items: page3,
        page: 3,
        limit: 50,
        hasMore: true,
        totalCount: 151
      });

      const result = await client.getPullRequestsPage('owner', 'repo', 'closed', 3, 50);

      expect(result.items).toEqual(page3);
      expect(result.page).toBe(3);
      expect(result.limit).toBe(50);
      expect(result.hasMore).toBe(true);
      expect(listPageSpy).toHaveBeenCalledWith('owner', 'repo', { state: 'closed', page: 3, limit: 50 });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('hasPullRequests should use a one-item page probe', async () => {
      const page1 = generateMockPRs(1, 1);
      const getPageSpy = jest.spyOn(client, 'getPullRequestsPage').mockResolvedValueOnce({
        items: page1,
        page: 1,
        limit: 1,
        hasMore: true
      });

      await expect(client.hasPullRequests('owner', 'repo', 'closed')).resolves.toBe(true);

      expect(getPageSpy).toHaveBeenCalledWith('owner', 'repo', 'closed', 1, 1);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('hasPullRequests should return false for an empty probe', async () => {
      jest.spyOn(client, 'getPullRequestsPage').mockResolvedValueOnce({
        items: [],
        page: 1,
        limit: 1,
        hasMore: false
      });

      await expect(client.hasPullRequests('owner', 'repo', 'closed')).resolves.toBe(false);
    });

    test('getIssues should fetch all pages and still filter out PRs', async () => {
      const page1 = generateMockIssueItems(50, 10, 1);
      const page2 = generateMockIssueItems(20, 5, 51);
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => page1 } as unknown as Response);
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => page2 } as unknown as Response);
      const result = await client.getIssues('owner', 'repo', 'all');
      expect(result.length).toBe(55);
      expect(result.every(item => !item.pull_request)).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    test('getIssuesPage should delegate to the forgejo-ts page API and filter out PRs', async () => {
      const page4 = generateMockIssueItems(50, 10, 151);
      const listPageSpy = jest.spyOn(client, 'listIssuesPage').mockResolvedValueOnce({
        items: page4,
        page: 4,
        limit: 50,
        hasMore: true,
        totalCount: 200
      });

      const result = await client.getIssuesPage('owner', 'repo', 'open', 4, 50);

      expect(result.items).toHaveLength(40);
      expect(result.items.every(item => !item.pull_request)).toBe(true);
      expect(result.page).toBe(4);
      expect(result.limit).toBe(50);
      expect(result.hasMore).toBe(true);
      expect(listPageSpy).toHaveBeenCalledWith('owner', 'repo', { state: 'open', page: 4, limit: 50 });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('getWorkflowRuns should fetch multiple pages', async () => {
      const page1Runs = Array.from({ length: 50 }, (_, i) => ({ ...mockActionTasksResponse.workflow_runs[0], id: i + 1, run_number: i + 1 }));
      const page2Runs = Array.from({ length: 10 }, (_, i) => ({ ...mockActionTasksResponse.workflow_runs[0], id: i + 51, run_number: i + 51 }));
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ total_count: 60, workflow_runs: page1Runs }) } as unknown as Response);
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ total_count: 60, workflow_runs: page2Runs }) } as unknown as Response);
      const result = await client.getWorkflowRuns('owner', 'repo');
      expect(result.workflow_runs.length).toBe(60);
      expect(result.total_count).toBe(60);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    test('getWorkflowRuns should handle empty first page', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ total_count: 0, workflow_runs: [] }) } as unknown as Response);
      const result = await client.getWorkflowRuns('owner', 'repo');
      expect(result.workflow_runs.length).toBe(0);
      expect(result.total_count).toBe(0);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test('getWorkflowRuns with status filter should paginate correctly', async () => {
      const page1Runs = Array.from({ length: 50 }, (_, i) => ({ ...mockActionTasksResponse.workflow_runs[0], id: i + 1, run_number: i + 1 }));
      const page2Runs = Array.from({ length: 5 }, (_, i) => ({ ...mockActionTasksResponse.workflow_runs[0], id: i + 51, run_number: i + 51 }));
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ total_count: 55, workflow_runs: page1Runs }) } as unknown as Response);
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ total_count: 55, workflow_runs: page2Runs }) } as unknown as Response);
      const result = await client.getWorkflowRuns('owner', 'repo', 'success');
      expect(result.workflow_runs.length).toBe(55);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('status=success'), expect.any(Object));
    });
  });

  describe('createIssue', () => {
    const mockCreatedIssue = {
      id: 42,
      number: 42,
      title: 'Test Issue',
      body: 'Test body',
      state: 'open',
      user: { login: 'testuser', avatar_url: 'https://example.com/avatar.png' },
      labels: [],
      assignees: [],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      closed_at: null,
      html_url: 'https://git.example.com/owner/repo/issues/42',
      comments: 0
    };

    test('should create issue with title and body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => mockCreatedIssue
      } as unknown as Response);

      const result = await client.createIssue('owner', 'repo', 'Test Issue', 'Test body');

      expect(result).toEqual(mockCreatedIssue);
      expect(result.number).toBe(42);
      expect(result.title).toBe('Test Issue');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://git.example.com/api/v1/repos/owner/repo/issues',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ title: 'Test Issue', body: 'Test body' })
        })
      );
    });

    test('should create issue with title only (no body)', async () => {
      const issueWithoutBody = { ...mockCreatedIssue, body: '' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => issueWithoutBody
      } as unknown as Response);

      const result = await client.createIssue('owner', 'repo', 'Title Only Issue');

      expect(result).toEqual(issueWithoutBody);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://git.example.com/api/v1/repos/owner/repo/issues',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ title: 'Title Only Issue' })
        })
      );
    });

    test('should create issue with labels, assignees, milestone, and due date', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => mockCreatedIssue
      } as unknown as Response);

      const result = await client.createIssue('owner', 'repo', 'Test Issue', 'Test body', {
        labels: [1, 2],
        assignees: ['alice', 'bob'],
        milestone: 7,
        due_date: '2026-07-10T00:00:00Z'
      });

      expect(result).toEqual(mockCreatedIssue);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://git.example.com/api/v1/repos/owner/repo/issues',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            title: 'Test Issue',
            body: 'Test body',
            labels: [1, 2],
            assignees: ['alice', 'bob'],
            milestone: 7,
            due_date: '2026-07-10T00:00:00Z'
          })
        })
      );
    });

    test('should include authentication header when token is set', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => mockCreatedIssue
      } as unknown as Response);

      await client.createIssue('owner', 'repo', 'Test Issue', 'Test body');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'token test-token'
          })
        })
      );
    });

    test('should handle 401 unauthorized error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => 'Invalid token'
      } as unknown as Response);

      await expect(client.createIssue('owner', 'repo', 'Test Issue'))
        .rejects
        .toThrow('HTTP 401: Unauthorized');
    });

    test('should handle 500 server error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Server error'
      } as unknown as Response);

      await expect(client.createIssue('owner', 'repo', 'Test Issue'))
        .rejects
        .toThrow('HTTP 500: Internal Server Error');
    });

    test('should handle network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network timeout'));

      await expect(client.createIssue('owner', 'repo', 'Test Issue'))
        .rejects
        .toThrow();
    });
  });

  describe('createPullRequest', () => {
    const mockCreatedPR = {
      id: 100,
      number: 100,
      title: 'Test PR',
      body: 'Test body',
      state: 'open',
      user: { login: 'testuser', avatar_url: 'https://example.com/avatar.png' },
      html_url: 'https://git.example.com/owner/repo/pulls/100',
      head: { ref: 'feature-branch', sha: 'abc123', repo: { full_name: 'owner/repo' } },
      base: { ref: 'main' },
      mergeable: true,
      merged: false,
      merge_commit_sha: null,
      draft: false,
      comments: 0,
      labels: [],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z'
    };

    test('should create PR with title, head, base, and body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => mockCreatedPR
      } as unknown as Response);

      const result = await client.createPullRequest('owner', 'repo', 'Test PR', 'feature-branch', 'main', 'Test body');

      expect(result).toEqual(mockCreatedPR);
      expect(result.number).toBe(100);
      expect(result.title).toBe('Test PR');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://git.example.com/api/v1/repos/owner/repo/pulls',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ title: 'Test PR', head: 'feature-branch', base: 'main', body: 'Test body' })
        })
      );
    });

    test('should create PR without body', async () => {
      const prWithoutBody = { ...mockCreatedPR, body: '' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => prWithoutBody
      } as unknown as Response);

      const result = await client.createPullRequest('owner', 'repo', 'Test PR', 'feature-branch', 'main');

      expect(result).toEqual(prWithoutBody);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://git.example.com/api/v1/repos/owner/repo/pulls',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ title: 'Test PR', head: 'feature-branch', base: 'main' })
        })
      );
    });

    test('should handle 401 unauthorized', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => 'Invalid token'
      } as unknown as Response);

      await expect(client.createPullRequest('owner', 'repo', 'Test PR', 'feature-branch', 'main'))
        .rejects
        .toThrow('HTTP 401: Unauthorized');
    });

    test('should handle 409 conflict (PR already exists)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        text: async () => 'pull request already exists'
      } as unknown as Response);

      await expect(client.createPullRequest('owner', 'repo', 'Test PR', 'feature-branch', 'main'))
        .rejects
        .toThrow('A pull request already exists for this branch');
    });

    test('should handle 422 validation error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        text: async () => 'head branch does not exist'
      } as unknown as Response);

      await expect(client.createPullRequest('owner', 'repo', 'Test PR', 'nonexistent-branch', 'main'))
        .rejects
        .toThrow('head branch does not exist');
    });
  });

});
