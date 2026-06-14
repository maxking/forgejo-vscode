import * as vscode from 'vscode';
import { PRDiffContentProvider, createPRFileUri, PR_DIFF_SCHEME } from '../../providers/prDiffContentProvider';
import { ForgejoClient } from '../../api/forgejoClient';
import { getForgejoConfig, getForgejoConfigFor } from '../../utils/config';
import { mockPlainTextContent, mockModifiedContent } from '../fixtures/fileContents';

// Mock dependencies
jest.mock('../../api/forgejoClient');
jest.mock('../../utils/config');

describe('PRDiffContentProvider', () => {
  let provider: PRDiffContentProvider;
  let mockClient: jest.Mocked<ForgejoClient>;
  let mockGetForgejoConfig: jest.MockedFunction<typeof getForgejoConfig>;
  let mockGetForgejoConfigFor: jest.MockedFunction<typeof getForgejoConfigFor>;

  beforeEach(() => {
    provider = new PRDiffContentProvider();
    mockClient = {
      getFileContents: jest.fn()
    } as any;
    mockGetForgejoConfig = getForgejoConfig as jest.MockedFunction<typeof getForgejoConfig>;
    mockGetForgejoConfigFor = getForgejoConfigFor as jest.MockedFunction<typeof getForgejoConfigFor>;

    // Reset mocks
    jest.clearAllMocks();
    mockGetForgejoConfigFor.mockImplementation(() => mockGetForgejoConfig());

    // Mock ForgejoClient constructor
    (ForgejoClient as jest.MockedClass<typeof ForgejoClient>).mockImplementation(() => mockClient);
  });

  describe('URI Parsing', () => {
    test('should parse valid URI with simple filepath', async () => {
      const uri = createPRFileUri('owner', 'repo', 'main', 'src/file.ts');
      mockGetForgejoConfig.mockResolvedValue({
        instanceUrl: 'https://git.example.com',
        owner: 'owner',
        repo: 'repo',
        token: 'test-token'
      });
      mockClient.getFileContents.mockResolvedValue(mockPlainTextContent);

      await provider.provideTextDocumentContent(uri);

      expect(mockClient.getFileContents).toHaveBeenCalledWith('owner', 'repo', 'src/file.ts', 'main');
    });

    test('should parse valid URI with nested filepath', async () => {
      const uri = createPRFileUri('owner', 'repo', 'feature-branch', 'src/deep/nested/path/file.ts');
      mockGetForgejoConfig.mockResolvedValue({
        instanceUrl: 'https://git.example.com',
        owner: 'owner',
        repo: 'repo',
        token: 'test-token'
      });
      mockClient.getFileContents.mockResolvedValue(mockPlainTextContent);

      await provider.provideTextDocumentContent(uri);

      expect(mockClient.getFileContents).toHaveBeenCalledWith('owner', 'repo', 'src/deep/nested/path/file.ts', 'feature-branch');
    });

    test('should handle URI with special characters in filepath', async () => {
      const uri = createPRFileUri('owner', 'repo', 'main', 'src/file with spaces.ts');
      mockGetForgejoConfig.mockResolvedValue({
        instanceUrl: 'https://git.example.com',
        owner: 'owner',
        repo: 'repo',
        token: 'test-token'
      });
      mockClient.getFileContents.mockResolvedValue(mockPlainTextContent);

      await provider.provideTextDocumentContent(uri);

      expect(mockClient.getFileContents).toHaveBeenCalledWith('owner', 'repo', 'src/file with spaces.ts', 'main');
    });

    test('should throw error for invalid URI with too few parts', async () => {
      const uri = vscode.Uri.parse('forgejo-pr:/owner/repo/file.ts');

      await expect(provider.provideTextDocumentContent(uri)).rejects.toThrow('Invalid PR diff URI format');
    });

    test('should throw error for invalid URI with only owner and repo', async () => {
      const uri = vscode.Uri.parse('forgejo-pr:/owner/repo');

      await expect(provider.provideTextDocumentContent(uri)).rejects.toThrow('Invalid PR diff URI format');
    });

    test('should throw error for invalid URI with only three parts', async () => {
      const uri = vscode.Uri.parse('forgejo-pr:/owner/repo/somesegment');

      await expect(provider.provideTextDocumentContent(uri)).rejects.toThrow('Invalid PR diff URI format');
    });

    test('should correctly round-trip branch with slashes via base64url encoding', async () => {
      const uri = createPRFileUri('maxking', 'forgejo-vscode', 'feat/auto-publish-workflow', 'research/marketing-analysis.md');
      mockGetForgejoConfig.mockResolvedValue({
        instanceUrl: 'https://codeberg.org',
        owner: 'maxking',
        repo: 'forgejo-vscode',
        token: 'test-token'
      });
      mockClient.getFileContents.mockResolvedValue(mockPlainTextContent);

      await provider.provideTextDocumentContent(uri);

      expect(mockClient.getFileContents).toHaveBeenCalledWith(
        'maxking',
        'forgejo-vscode',
        'research/marketing-analysis.md',
        'feat/auto-publish-workflow'
      );
    });

    test('should correctly round-trip branch with slashes and simple filepath via createPRFileUri', async () => {
      const uri = createPRFileUri('maxking', 'forgejo-vscode', 'feat/auto-publish-workflow', 'research/marketing-analysis.md');
      mockGetForgejoConfig.mockResolvedValue({
        instanceUrl: 'https://codeberg.org',
        owner: 'maxking',
        repo: 'forgejo-vscode',
        token: 'test-token'
      });
      mockClient.getFileContents.mockResolvedValue(mockPlainTextContent);

      await provider.provideTextDocumentContent(uri);

      expect(mockClient.getFileContents).toHaveBeenCalledWith(
        'maxking',
        'forgejo-vscode',
        'research/marketing-analysis.md',
        'feat/auto-publish-workflow'
      );
    });
  });

  describe('Content Fetching', () => {
    test('should fetch and return file content successfully', async () => {
      const uri = createPRFileUri('owner', 'repo', 'main', 'src/file.ts');
      mockGetForgejoConfig.mockResolvedValue({
        instanceUrl: 'https://git.example.com',
        owner: 'owner',
        repo: 'repo',
        token: 'test-token'
      });
      mockClient.getFileContents.mockResolvedValue(mockPlainTextContent);

      const content = await provider.provideTextDocumentContent(uri);

      expect(content).toBe(mockPlainTextContent);
      expect(mockClient.getFileContents).toHaveBeenCalledTimes(1);
    });

    test('should use cached content on second request', async () => {
      const uri = createPRFileUri('owner', 'repo', 'main', 'src/file.ts');
      mockGetForgejoConfig.mockResolvedValue({
        instanceUrl: 'https://git.example.com',
        owner: 'owner',
        repo: 'repo',
        token: 'test-token'
      });
      mockClient.getFileContents.mockResolvedValue(mockPlainTextContent);

      const content1 = await provider.provideTextDocumentContent(uri);
      expect(content1).toBe(mockPlainTextContent);
      expect(mockClient.getFileContents).toHaveBeenCalledTimes(1);

      const content2 = await provider.provideTextDocumentContent(uri);
      expect(content2).toBe(mockPlainTextContent);
      expect(mockClient.getFileContents).toHaveBeenCalledTimes(1);
    });

    test('should return error message when config is missing', async () => {
      const uri = createPRFileUri('owner', 'repo', 'main', 'src/file.ts');
      mockGetForgejoConfig.mockResolvedValue(null);

      const content = await provider.provideTextDocumentContent(uri);

      expect(content).toContain('// Error: Forgejo configuration not found');
      expect(content).toContain('// URI:');
      expect(mockClient.getFileContents).not.toHaveBeenCalled();
    });

    test('should return error message when API call fails', async () => {
      const uri = createPRFileUri('owner', 'repo', 'main', 'src/file.ts');
      mockGetForgejoConfig.mockResolvedValue({
        instanceUrl: 'https://git.example.com',
        owner: 'owner',
        repo: 'repo',
        token: 'test-token'
      });
      mockClient.getFileContents.mockRejectedValue(new Error('HTTP 404: Not Found'));

      const content = await provider.provideTextDocumentContent(uri);

      expect(content).toContain('// Error: HTTP 404: Not Found');
      expect(content).toContain('// URI:');
    });

    test('should handle network errors gracefully', async () => {
      const uri = createPRFileUri('owner', 'repo', 'main', 'src/file.ts');
      mockGetForgejoConfig.mockResolvedValue({
        instanceUrl: 'https://git.example.com',
        owner: 'owner',
        repo: 'repo',
        token: 'test-token'
      });
      mockClient.getFileContents.mockRejectedValue(new Error('Network error'));

      const content = await provider.provideTextDocumentContent(uri);

      expect(content).toContain('// Error: Network error');
    });
  });

  describe('Caching', () => {
    test('should cache content after successful fetch', async () => {
      const uri = createPRFileUri('owner', 'repo', 'main', 'src/file.ts');
      mockGetForgejoConfig.mockResolvedValue({
        instanceUrl: 'https://git.example.com',
        owner: 'owner',
        repo: 'repo',
        token: 'test-token'
      });
      mockClient.getFileContents.mockResolvedValue(mockPlainTextContent);

      await provider.provideTextDocumentContent(uri);
      mockClient.getFileContents.mockResolvedValue(mockModifiedContent);

      const content = await provider.provideTextDocumentContent(uri);
      expect(content).toBe(mockPlainTextContent);
    });

    test('should clear cache for specific URI', async () => {
      const uri = createPRFileUri('owner', 'repo', 'main', 'src/file.ts');
      mockGetForgejoConfig.mockResolvedValue({
        instanceUrl: 'https://git.example.com',
        owner: 'owner',
        repo: 'repo',
        token: 'test-token'
      });
      mockClient.getFileContents.mockResolvedValue(mockPlainTextContent);

      await provider.provideTextDocumentContent(uri);
      provider.clearCache(uri);

      mockClient.getFileContents.mockResolvedValue(mockModifiedContent);
      const content = await provider.provideTextDocumentContent(uri);
      expect(content).toBe(mockModifiedContent);
      expect(mockClient.getFileContents).toHaveBeenCalledTimes(2);
    });

    test('should clear all cache when called without URI', async () => {
      const uri1 = createPRFileUri('owner', 'repo', 'main', 'src/file1.ts');
      const uri2 = createPRFileUri('owner', 'repo', 'main', 'src/file2.ts');
      mockGetForgejoConfig.mockResolvedValue({
        instanceUrl: 'https://git.example.com',
        owner: 'owner',
        repo: 'repo',
        token: 'test-token'
      });
      mockClient.getFileContents.mockResolvedValue(mockPlainTextContent);

      await provider.provideTextDocumentContent(uri1);
      await provider.provideTextDocumentContent(uri2);
      expect(mockClient.getFileContents).toHaveBeenCalledTimes(2);

      provider.clearCache();

      mockClient.getFileContents.mockResolvedValue(mockModifiedContent);
      await provider.provideTextDocumentContent(uri1);
      await provider.provideTextDocumentContent(uri2);
      expect(mockClient.getFileContents).toHaveBeenCalledTimes(4);
    });
  });

  describe('Refresh', () => {
    test('should clear cache and fire change event', async () => {
      const uri = createPRFileUri('owner', 'repo', 'main', 'src/file.ts');
      mockGetForgejoConfig.mockResolvedValue({
        instanceUrl: 'https://git.example.com',
        owner: 'owner',
        repo: 'repo',
        token: 'test-token'
      });
      mockClient.getFileContents.mockResolvedValue(mockPlainTextContent);

      let eventFired = false;
      let eventUri: vscode.Uri | undefined;
      provider.onDidChange((uri) => {
        eventFired = true;
        eventUri = uri;
      });

      await provider.provideTextDocumentContent(uri);
      provider.refresh(uri);

      expect(eventFired).toBe(true);
      expect(eventUri).toBe(uri);

      mockClient.getFileContents.mockResolvedValue(mockModifiedContent);
      const content = await provider.provideTextDocumentContent(uri);
      expect(content).toBe(mockModifiedContent);
      expect(mockClient.getFileContents).toHaveBeenCalledTimes(2);
    });

    test('should fire change event even if content was not cached', () => {
      const uri = createPRFileUri('owner', 'repo', 'main', 'src/file.ts');

      let eventFired = false;
      provider.onDidChange(() => {
        eventFired = true;
      });

      provider.refresh(uri);

      expect(eventFired).toBe(true);
    });
  });

  describe('createPRFileUri Helper Function', () => {
    test('should create valid URI for simple filepath', () => {
      const uri = createPRFileUri('owner', 'repo', 'main', 'src/file.ts');
      const encodedRef = Buffer.from('main').toString('base64url');

      expect(uri.scheme).toBe(PR_DIFF_SCHEME);
      expect(uri.path).toBe(`/owner/repo/${encodedRef}/src/file.ts`);
      expect(uri.query).toBe('');
    });

    test('should encode special characters in filepath', () => {
      const uri = createPRFileUri('owner', 'repo', 'main', 'src/file with spaces.ts');

      expect(uri.path).toContain('file%20with%20spaces.ts');
      expect(uri.toString()).toContain('file%20with%20spaces.ts');
    });

    test('should handle branch names with slashes via base64url encoding in path', () => {
      const uri = createPRFileUri('owner', 'repo', 'feature/branch', 'src/deep/nested/path/file.ts');
      const encodedRef = Buffer.from('feature/branch').toString('base64url');

      // Ref is in path as base64url, not as query parameter
      expect(uri.path).toBe(`/owner/repo/${encodedRef}/src/deep/nested/path/file.ts`);
      expect(uri.query).toBe('');
      // No slashes from the branch name leak into the path
      expect(uri.path).not.toContain('feature/branch');
    });
  });

  describe('Branch names with slashes (Issue #17)', () => {
    test('should correctly parse URI when branch name contains slashes', async () => {
      const uri = createPRFileUri('maxking', 'forgejo-vscode', 'feature/issue-detail-view', 'src/__tests__/fixtures/commitStatuses.ts');
      mockGetForgejoConfig.mockResolvedValue({
        instanceUrl: 'https://git.example.com',
        owner: 'maxking',
        repo: 'forgejo-vscode',
        token: 'test-token'
      });
      mockClient.getFileContents.mockResolvedValue(mockPlainTextContent);

      await provider.provideTextDocumentContent(uri);

      expect(mockClient.getFileContents).toHaveBeenCalledWith(
        'maxking',
        'forgejo-vscode',
        'src/__tests__/fixtures/commitStatuses.ts',
        'feature/issue-detail-view'
      );
    });

    test('should correctly parse URI with deeply nested branch name', async () => {
      const uri = createPRFileUri('owner', 'repo', 'feature/2024/january/new-feature', 'src/utils/config.ts');
      mockGetForgejoConfig.mockResolvedValue({
        instanceUrl: 'https://git.example.com',
        owner: 'owner',
        repo: 'repo',
        token: 'test-token'
      });
      mockClient.getFileContents.mockResolvedValue(mockPlainTextContent);

      await provider.provideTextDocumentContent(uri);

      expect(mockClient.getFileContents).toHaveBeenCalledWith(
        'owner',
        'repo',
        'src/utils/config.ts',
        'feature/2024/january/new-feature'
      );
    });
  });
});
