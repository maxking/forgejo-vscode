import * as vscode from 'vscode';
import { PRDetailsContentProvider, PR_DETAILS_SCHEME, createPRDetailsUri } from '../../providers/prDetailsContentProvider';
import { ForgejoClient } from '../../api/forgejoClient';
import { getForgejoConfig } from '../../utils/config';
import { mockPRWithRefs } from '../fixtures/prRefs';
import { mockDuplicateStatuses, expectedDeduplicatedContexts } from '../fixtures/commitStatuses';

// Mock dependencies
jest.mock('../../api/forgejoClient');
jest.mock('../../utils/config');

describe('PRDetailsContentProvider', () => {
  let provider: PRDetailsContentProvider;
  let mockClient: jest.Mocked<ForgejoClient>;
  let mockGetForgejoConfig: jest.MockedFunction<typeof getForgejoConfig>;

  const mockConfig = {
    instanceUrl: 'https://git.example.com',
    token: 'test-token',
    owner: 'test-owner',
    repo: 'test-repo'
  };

  beforeEach(() => {
    // Create mock client with new methods
    mockClient = {
      getPullRequestDetails: jest.fn(),
      getCommitStatuses: jest.fn()
    } as any;

    mockGetForgejoConfig = getForgejoConfig as jest.MockedFunction<typeof getForgejoConfig>;
    mockGetForgejoConfig.mockResolvedValue(mockConfig);

    // Mock ForgejoClient constructor
    (ForgejoClient as jest.MockedClass<typeof ForgejoClient>).mockImplementation(() => mockClient);

    // Create provider
    provider = new PRDetailsContentProvider();

    jest.clearAllMocks();
  });

  afterEach(() => {
    provider.dispose();
  });

  describe('provideTextDocumentContent', () => {
    test('should fetch and render PR details successfully', async () => {
      const uri = createPRDetailsUri('owner', 'repo', 42);
      mockClient.getPullRequestDetails.mockResolvedValue(mockPRWithRefs);
      mockClient.getCommitStatuses.mockResolvedValue([]);

      const content = await provider.provideTextDocumentContent(uri);

      expect(content).toContain('# PR #42: Add new feature');
      expect(content).toContain('testuser');
      expect(content).toContain('🟢 Open');
      expect(content).toContain('This PR adds a new feature');
      expect(mockClient.getPullRequestDetails).toHaveBeenCalledWith('owner', 'repo', 42);
    });

    test('should include CI status in output', async () => {
      const uri = createPRDetailsUri('owner', 'repo', 42);
      mockClient.getPullRequestDetails.mockResolvedValue(mockPRWithRefs);
      mockClient.getCommitStatuses.mockResolvedValue([
        {
          id: 1,
          status: 'success',
          context: 'continuous-integration/drone',
          description: 'Build passed',
          target_url: 'https://drone.example.com',
          created_at: '2026-01-01T10:00:00Z',
          updated_at: '2026-01-01T10:05:00Z'
        }
      ]);

      const content = await provider.provideTextDocumentContent(uri);

      expect(content).toContain('## CI Status');
      expect(content).toContain('continuous-integration/drone');
      expect(content).toContain('✅ success');
      expect(content).toContain('Build passed');
    });

    test('should include mergeability for clean open PRs', async () => {
      const uri = createPRDetailsUri('owner', 'repo', 42);
      mockClient.getPullRequestDetails.mockResolvedValue({
        ...mockPRWithRefs,
        mergeable: true
      });
      mockClient.getCommitStatuses.mockResolvedValue([]);

      const content = await provider.provideTextDocumentContent(uri);

      expect(content).toContain('**Mergeability:** Ready to merge - Forgejo reports this pull request can be merged cleanly');
    });

    test('should include conflict status for unmergeable open PRs', async () => {
      const uri = createPRDetailsUri('owner', 'repo', 42);
      mockClient.getPullRequestDetails.mockResolvedValue({
        ...mockPRWithRefs,
        mergeable: false
      });
      mockClient.getCommitStatuses.mockResolvedValue([]);

      const content = await provider.provideTextDocumentContent(uri);

      expect(content).toContain('**Mergeability:** Merge conflicts - Forgejo reports this pull request cannot be merged cleanly');
    });

    test('should include unknown mergeability when Forgejo omits the field', async () => {
      const uri = createPRDetailsUri('owner', 'repo', 42);
      const { mergeable: _mergeable, ...prWithoutMergeable } = mockPRWithRefs;
      mockClient.getPullRequestDetails.mockResolvedValue(prWithoutMergeable as typeof mockPRWithRefs);
      mockClient.getCommitStatuses.mockResolvedValue([]);

      const content = await provider.provideTextDocumentContent(uri);

      expect(content).toContain('**Mergeability:** Mergeability unknown - Forgejo has not reported whether this pull request can be merged');
    });

    test('should include labels in output', async () => {
      const uri = createPRDetailsUri('owner', 'repo', 42);
      mockClient.getPullRequestDetails.mockResolvedValue(mockPRWithRefs);
      mockClient.getCommitStatuses.mockResolvedValue([]);

      const content = await provider.provideTextDocumentContent(uri);

      expect(content).toContain('## Labels');
      expect(content).toContain('enhancement');
      expect(content).toContain('tests-passed');
    });

    test('should cache results and return cached content on second call', async () => {
      const uri = createPRDetailsUri('owner', 'repo', 42);
      mockClient.getPullRequestDetails.mockResolvedValue(mockPRWithRefs);
      mockClient.getCommitStatuses.mockResolvedValue([]);

      // First call - should fetch
      const content1 = await provider.provideTextDocumentContent(uri);
      expect(mockClient.getPullRequestDetails).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      const content2 = await provider.provideTextDocumentContent(uri);
      expect(mockClient.getPullRequestDetails).toHaveBeenCalledTimes(1); // No additional call
      expect(content1).toBe(content2);
    });

    test('should handle PR with no description', async () => {
      const uri = createPRDetailsUri('owner', 'repo', 42);
      mockClient.getPullRequestDetails.mockResolvedValue({
        ...mockPRWithRefs,
        body: ''
      });
      mockClient.getCommitStatuses.mockResolvedValue([]);

      const content = await provider.provideTextDocumentContent(uri);

      expect(content).toContain('*No description provided*');
    });

    test('should handle merged PR', async () => {
      const uri = createPRDetailsUri('owner', 'repo', 42);
      mockClient.getPullRequestDetails.mockResolvedValue({
        ...mockPRWithRefs,
        merged: true,
        state: 'closed',
        merge_commit_sha: 'def789abc123'
      });
      mockClient.getCommitStatuses.mockResolvedValue([]);

      const content = await provider.provideTextDocumentContent(uri);

      expect(content).toContain('🟣 Merged');
      expect(content).toContain('def789a');
    });

    test('should handle draft PR', async () => {
      const uri = createPRDetailsUri('owner', 'repo', 42);
      mockClient.getPullRequestDetails.mockResolvedValue({
        ...mockPRWithRefs,
        draft: true
      });
      mockClient.getCommitStatuses.mockResolvedValue([]);

      const content = await provider.provideTextDocumentContent(uri);

      expect(content).toContain('⚪ Draft');
    });

    test('should handle closed PR', async () => {
      const uri = createPRDetailsUri('owner', 'repo', 42);
      mockClient.getPullRequestDetails.mockResolvedValue({
        ...mockPRWithRefs,
        state: 'closed',
        merged: false
      });
      mockClient.getCommitStatuses.mockResolvedValue([]);

      const content = await provider.provideTextDocumentContent(uri);

      expect(content).toContain('🔴 Closed');
    });

    test('should return error message when config not found', async () => {
      const uri = createPRDetailsUri('owner', 'repo', 42);
      mockGetForgejoConfig.mockResolvedValue(null);

      const content = await provider.provideTextDocumentContent(uri);

      expect(content).toContain('Error: Forgejo configuration not found');
    });

    test('should return error message when API call fails', async () => {
      const uri = createPRDetailsUri('owner', 'repo', 42);
      mockClient.getPullRequestDetails.mockRejectedValue(new Error('HTTP 404: Not Found'));

      const content = await provider.provideTextDocumentContent(uri);

      expect(content).toContain('Error: HTTP 404: Not Found');
    });

    test('should throw error for invalid URI format', async () => {
      const invalidUri = vscode.Uri.parse(`${PR_DETAILS_SCHEME}:/owner/repo`);

      await expect(provider.provideTextDocumentContent(invalidUri)).rejects.toThrow('Invalid PR details URI format');
    });

    test('should throw error for invalid PR number', async () => {
      const invalidUri = vscode.Uri.parse(`${PR_DETAILS_SCHEME}:/owner/repo/invalid`);

      await expect(provider.provideTextDocumentContent(invalidUri)).rejects.toThrow('Invalid PR number in URI');
    });

    test('should still work if commit status fetch fails', async () => {
      const uri = createPRDetailsUri('owner', 'repo', 42);
      mockClient.getPullRequestDetails.mockResolvedValue(mockPRWithRefs);
      mockClient.getCommitStatuses.mockRejectedValue(new Error('Network error'));

      const content = await provider.provideTextDocumentContent(uri);

      expect(content).toContain('# PR #42: Add new feature');
      expect(content).not.toContain('## CI Status'); // Section not shown if no statuses
    });
  });

  describe('clearCache', () => {
    test('should clear specific cache entry', async () => {
      const uri = createPRDetailsUri('owner', 'repo', 42);
      mockClient.getPullRequestDetails.mockResolvedValue(mockPRWithRefs);
      mockClient.getCommitStatuses.mockResolvedValue([]);

      // Populate cache
      await provider.provideTextDocumentContent(uri);
      expect(mockClient.getPullRequestDetails).toHaveBeenCalledTimes(1);

      // Clear cache
      provider.clearCache(uri);

      // Should fetch again
      await provider.provideTextDocumentContent(uri);
      expect(mockClient.getPullRequestDetails).toHaveBeenCalledTimes(2);
    });

    test('should clear all cache entries when no uri specified', async () => {
      const uri1 = createPRDetailsUri('owner', 'repo', 42);
      const uri2 = createPRDetailsUri('owner', 'repo', 43);
      mockClient.getPullRequestDetails.mockResolvedValue(mockPRWithRefs);
      mockClient.getCommitStatuses.mockResolvedValue([]);

      // Populate cache
      await provider.provideTextDocumentContent(uri1);
      await provider.provideTextDocumentContent(uri2);

      // Clear all cache
      provider.clearCache();

      // Should fetch again for both
      await provider.provideTextDocumentContent(uri1);
      await provider.provideTextDocumentContent(uri2);
      expect(mockClient.getPullRequestDetails).toHaveBeenCalledTimes(4);
    });
  });

  describe('refresh', () => {
    test('should fire onDidChange event', async () => {
      const uri = createPRDetailsUri('owner', 'repo', 42);
      const changeHandler = jest.fn();

      provider.onDidChange(changeHandler);
      provider.refresh(uri);

      expect(changeHandler).toHaveBeenCalledWith(uri);
    });

    test('should clear cache for refreshed URI', async () => {
      const uri = createPRDetailsUri('owner', 'repo', 42);
      mockClient.getPullRequestDetails.mockResolvedValue(mockPRWithRefs);
      mockClient.getCommitStatuses.mockResolvedValue([]);

      // Populate cache
      await provider.provideTextDocumentContent(uri);
      expect(mockClient.getPullRequestDetails).toHaveBeenCalledTimes(1);

      // Refresh
      provider.refresh(uri);

      // Should fetch again
      await provider.provideTextDocumentContent(uri);
      expect(mockClient.getPullRequestDetails).toHaveBeenCalledTimes(2);
    });
  });

  describe('createPRDetailsUri', () => {
    test('should create valid URI with owner, repo, and PR number', () => {
      const uri = createPRDetailsUri('owner', 'repo', 42);
      expect(uri.scheme).toBe(PR_DETAILS_SCHEME);
      expect(uri.path).toBe('/owner/repo/42');
    });

    test('should handle special characters in owner and repo names', () => {
      const uri = createPRDetailsUri('org-name', 'repo_name', 123);
      expect(uri.path).toBe('/org-name/repo_name/123');
    });

    test('should handle large PR numbers', () => {
      const uri = createPRDetailsUri('owner', 'repo', 999999);
      expect(uri.path).toBe('/owner/repo/999999');
    });
  });

  describe('deduplicateStatuses', () => {
    test('should deduplicate statuses by context, keeping only the latest per CI job', () => {
      // mockDuplicateStatuses has 12 entries (6 pending + 6 final) for 6 unique CI jobs
      const result = PRDetailsContentProvider.deduplicateStatuses(mockDuplicateStatuses);

      expect(result).toHaveLength(6);
      const contexts = result.map(s => s.context).sort();
      expect(contexts).toEqual(expectedDeduplicatedContexts.slice().sort());
    });

    test('should keep the latest (final) status, not the initial pending status', () => {
      const result = PRDetailsContentProvider.deduplicateStatuses(mockDuplicateStatuses);

      // No status should be "pending" since all jobs have later final statuses
      const pendingStatuses = result.filter(s => s.status === 'pending');
      expect(pendingStatuses).toHaveLength(0);

      // The smoke-test-vsix job should show as failure (not pending)
      const smokeTest = result.find(s => s.context === 'Test / smoke-test-vsix (pull_request)');
      expect(smokeTest).toBeDefined();
      expect(smokeTest!.status).toBe('failure');
      expect(smokeTest!.description).toBe('Failing after 0s');
    });

    test('should return empty array for empty input', () => {
      expect(PRDetailsContentProvider.deduplicateStatuses([])).toEqual([]);
    });

    test('should return statuses unchanged when there are no duplicates', () => {
      const uniqueStatuses = [
        mockDuplicateStatuses[0], // id 12, success
        mockDuplicateStatuses[5], // id 7, failure - different context
      ];
      const result = PRDetailsContentProvider.deduplicateStatuses(uniqueStatuses);
      expect(result).toHaveLength(2);
    });

    test('should render only 6 CI rows when given 12 duplicate statuses from the API', async () => {
      const uri = createPRDetailsUri('owner', 'repo', 98);
      mockClient.getPullRequestDetails.mockResolvedValue(mockPRWithRefs);
      mockClient.getCommitStatuses.mockResolvedValue(mockDuplicateStatuses);

      const content = await provider.provideTextDocumentContent(uri);

      // Should show CI Status section
      expect(content).toContain('## CI Status');

      // Count the number of table rows (each CI job gets one row)
      // Table rows start with "| " and are not the header/separator rows
      const tableRows = content.split('\n').filter(line =>
        line.startsWith('| ') && !line.startsWith('| Check') && !line.startsWith('|---')
      );
      expect(tableRows).toHaveLength(6);

      // Should NOT contain any "Waiting to run" entries (all were superseded)
      expect(content).not.toContain('Waiting to run');
    });

    test('should handle unsorted input and still keep the latest status', () => {
      // Shuffle: put pending entries first, then final entries (reversed from API order)
      const unsorted = [
        ...mockDuplicateStatuses.slice(6),  // pending entries first
        ...mockDuplicateStatuses.slice(0, 6) // final entries second
      ];
      const result = PRDetailsContentProvider.deduplicateStatuses(unsorted);

      expect(result).toHaveLength(6);
      // All final statuses should win over pending regardless of input order
      const pendingStatuses = result.filter(s => s.status === 'pending');
      expect(pendingStatuses).toHaveLength(0);
    });

    test('should keep first entry when statuses have identical timestamps', () => {
      const statuses = [
        { ...mockDuplicateStatuses[0], id: 100, status: 'success' as const, context: 'ci/build', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
        { ...mockDuplicateStatuses[0], id: 101, status: 'failure' as const, context: 'ci/build', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
      ];
      const result = PRDetailsContentProvider.deduplicateStatuses(statuses);

      expect(result).toHaveLength(1);
      expect(result[0].context).toBe('ci/build');
      // First entry wins when timestamps are equal (> not >=)
      expect(result[0].id).toBe(100);
    });

    test('should skip statuses with invalid created_at dates', () => {
      const statuses = [
        { ...mockDuplicateStatuses[0], context: 'ci/valid', created_at: '2026-01-01T00:00:00Z' },
        { ...mockDuplicateStatuses[0], context: 'ci/invalid', created_at: 'not-a-date' },
      ];
      const result = PRDetailsContentProvider.deduplicateStatuses(statuses);

      expect(result).toHaveLength(1);
      expect(result[0].context).toBe('ci/valid');
    });
  });

  describe('dispose', () => {
    test('should clear cache on dispose', async () => {
      const uri = createPRDetailsUri('owner', 'repo', 42);
      mockClient.getPullRequestDetails.mockResolvedValue(mockPRWithRefs);
      mockClient.getCommitStatuses.mockResolvedValue([]);

      // Populate cache
      await provider.provideTextDocumentContent(uri);

      // Dispose
      provider.dispose();

      // Recreate provider (simulating fresh instance)
      provider = new PRDetailsContentProvider();

      // Should fetch again since cache was cleared
      await provider.provideTextDocumentContent(uri);
      expect(mockClient.getPullRequestDetails).toHaveBeenCalledTimes(2);
    });
  });
});
