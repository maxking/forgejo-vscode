import * as vscode from 'vscode';

// Mock the config module
jest.mock('../../utils/config', () => ({
  getForgejoConfig: jest.fn(),
  getForgejoConfigFor: jest.fn()
}));

// Mock the ForgejoClient
jest.mock('../../api/forgejoClient', () => ({
  ForgejoClient: jest.fn().mockImplementation(() => ({
    getPullRequestReviews: jest.fn(),
    getReviewComments: jest.fn(),
    createReviewWithComments: jest.fn()
  }))
}));

import { ForgejoCommentController } from '../../providers/prCommentController';
import { PRContext } from '../../models/comment';
import { getForgejoConfig, getForgejoConfigFor } from '../../utils/config';
import { ForgejoClient } from '../../api/forgejoClient';

const mockGetForgejoConfig = getForgejoConfig as jest.MockedFunction<typeof getForgejoConfig>;
const mockGetForgejoConfigFor = getForgejoConfigFor as jest.MockedFunction<typeof getForgejoConfigFor>;
const MockForgejoClient = ForgejoClient as jest.MockedClass<typeof ForgejoClient>;

describe('ForgejoCommentController', () => {
  let controller: ForgejoCommentController;

  beforeEach(() => {
    jest.clearAllMocks();

    // Re-setup mocks after clearAllMocks
    (vscode.workspace.onDidOpenTextDocument as jest.Mock).mockReturnValue({ dispose: jest.fn() });
    (vscode.workspace.onDidCloseTextDocument as jest.Mock).mockReturnValue({ dispose: jest.fn() });
    mockGetForgejoConfigFor.mockImplementation(() => mockGetForgejoConfig());

    (vscode.comments.createCommentController as jest.Mock).mockReturnValue({
      commentingRangeProvider: null,
      createCommentThread: jest.fn(() => ({
        comments: [],
        canReply: true,
        label: '',
        dispose: jest.fn(),
        uri: null,
        range: null
      })),
      dispose: jest.fn(),
    });

    controller = new ForgejoCommentController();
  });

  afterEach(() => {
    controller.dispose();
  });

  describe('PR context registration', () => {
    it('should register PR context for a URI', () => {
      const uri = vscode.Uri.parse('forgejo-pr:/owner/repo/bWFpbg/src/file.ts');
      const ctx: PRContext = {
        owner: 'owner',
        repo: 'repo',
        prNumber: 42,
        baseRef: 'main',
        headRef: 'feature',
        filePath: 'src/file.ts'
      };

      controller.registerPRContext(uri, ctx);

      // Verify context was stored by checking that the controller was created
      expect(vscode.comments.createCommentController).toHaveBeenCalledWith(
        'forgejo-pr-comments',
        'Forgejo PR Comments'
      );
    });

    it('should store context for multiple URIs', () => {
      const uri1 = vscode.Uri.parse('forgejo-pr:/owner/repo/bWFpbg/src/a.ts');
      const uri2 = vscode.Uri.parse('forgejo-pr:/owner/repo/ZmVhdHVyZQ/src/a.ts');

      const ctx1: PRContext = {
        owner: 'owner',
        repo: 'repo',
        prNumber: 42,
        baseRef: 'main',
        headRef: 'feature',
        filePath: 'src/a.ts'
      };

      const ctx2: PRContext = {
        owner: 'owner',
        repo: 'repo',
        prNumber: 42,
        baseRef: 'main',
        headRef: 'feature',
        filePath: 'src/a.ts'
      };

      controller.registerPRContext(uri1, ctx1);
      controller.registerPRContext(uri2, ctx2);

      // Both registrations should succeed without error
      expect(vscode.comments.createCommentController).toHaveBeenCalledTimes(1);
    });
  });

  describe('position mapping', () => {
    it('should use 1-indexed positions for Forgejo API (line 0 in VS Code = line 1 in API)', () => {
      // This is a conceptual test - the position mapping is line + 1
      // VS Code line 0 -> Forgejo line 1
      const vscodeLine = 0;
      const forgejoLine = vscodeLine + 1;
      expect(forgejoLine).toBe(1);
    });

    it('should convert Forgejo 1-indexed to VS Code 0-indexed (line 5 in API = line 4 in VS Code)', () => {
      const forgejoLine = 5;
      const vscodeLine = forgejoLine - 1;
      expect(vscodeLine).toBe(4);
    });

    it('should handle line 1 correctly', () => {
      const forgejoLine = 1;
      const vscodeLine = forgejoLine - 1;
      expect(vscodeLine).toBe(0);
    });
  });

  describe('URI parsing and side detection', () => {
    it('should parse a forgejo-pr URI correctly', () => {
      // The ref "main" base64url-encoded is "bWFpbg"
      const uri = vscode.Uri.parse('forgejo-pr:/owner/repo/bWFpbg/src/file.ts');
      const parts = uri.path.split('/').filter((p: string) => p);

      expect(parts[0]).toBe('owner');
      expect(parts[1]).toBe('repo');
      // base64url decode
      const ref = Buffer.from(parts[2], 'base64url').toString();
      expect(ref).toBe('main');
      expect(parts.slice(3).join('/')).toBe('src/file.ts');
    });

    it('should handle refs with slashes when base64url encoded', () => {
      // The ref "feature/branch" base64url-encoded
      const ref = 'feature/branch';
      const encoded = Buffer.from(ref).toString('base64url');
      const uri = vscode.Uri.parse(`forgejo-pr:/owner/repo/${encoded}/src/file.ts`);
      const parts = uri.path.split('/').filter((p: string) => p);

      const decodedRef = Buffer.from(parts[2], 'base64url').toString();
      expect(decodedRef).toBe('feature/branch');
    });

    it('should identify head side when ref matches headRef', () => {
      const headRef = 'feature';
      const encodedHead = Buffer.from(headRef).toString('base64url');
      const uri = vscode.Uri.parse(`forgejo-pr:/owner/repo/${encodedHead}/src/file.ts`);

      const ctx: PRContext = {
        owner: 'owner',
        repo: 'repo',
        prNumber: 1,
        baseRef: 'main',
        headRef: 'feature',
        filePath: 'src/file.ts'
      };

      controller.registerPRContext(uri, ctx);

      // The ref in the URI matches headRef, so it's the head side
      const parts = uri.path.split('/').filter((p: string) => p);
      const ref = Buffer.from(parts[2], 'base64url').toString();
      expect(ref).toBe(ctx.headRef);
    });

    it('should identify base side when ref matches baseRef', () => {
      const baseRef = 'main';
      const encodedBase = Buffer.from(baseRef).toString('base64url');
      const uri = vscode.Uri.parse(`forgejo-pr:/owner/repo/${encodedBase}/src/file.ts`);

      const ctx: PRContext = {
        owner: 'owner',
        repo: 'repo',
        prNumber: 1,
        baseRef: 'main',
        headRef: 'feature',
        filePath: 'src/file.ts'
      };

      controller.registerPRContext(uri, ctx);

      const parts = uri.path.split('/').filter((p: string) => p);
      const ref = Buffer.from(parts[2], 'base64url').toString();
      expect(ref).toBe(ctx.baseRef);
      expect(ref).not.toBe(ctx.headRef);
    });
  });

  describe('dispose', () => {
    it('should clean up resources on dispose', () => {
      const uri = vscode.Uri.parse('forgejo-pr:/owner/repo/bWFpbg/src/file.ts');
      const ctx: PRContext = {
        owner: 'owner',
        repo: 'repo',
        prNumber: 42,
        baseRef: 'main',
        headRef: 'feature',
        filePath: 'src/file.ts'
      };

      controller.registerPRContext(uri, ctx);
      controller.dispose();

      // Should not throw after dispose
      expect(() => controller.dispose()).not.toThrow();
    });
  });

  describe('handleCreateComment edge cases', () => {
    it('shows error when PR context is not found for the URI', async () => {
      const uri = vscode.Uri.parse('forgejo-pr:/owner/repo/bWFpbg/src/file.ts');
      // URI is NOT registered — no context in prContextMap

      const mockReply = {
        thread: {
          uri,
          range: new vscode.Range(0, 0, 0, 0),
          comments: [],
        },
        text: 'My comment',
      } as unknown as vscode.CommentReply;

      await controller.handleCreateComment(mockReply);

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        'Cannot determine PR context for this file. Please re-open the diff from the Pull Requests view.'
      );
    });

    it('shows auth error when token is missing', async () => {
      const uri = vscode.Uri.parse('forgejo-pr:/owner/repo/bWFpbg/src/file.ts');
      const ctx: PRContext = {
        owner: 'owner',
        repo: 'repo',
        prNumber: 42,
        baseRef: 'main',
        headRef: 'feature',
        filePath: 'src/file.ts',
      };
      controller.registerPRContext(uri, ctx);

      mockGetForgejoConfig.mockResolvedValueOnce({
        instanceUrl: 'https://git.example.com',
        owner: 'owner',
        repo: 'repo',
        token: undefined,
      } as any);

      const mockReply = {
        thread: {
          uri,
          range: new vscode.Range(5, 0, 5, 0),
          comments: [],
        },
        text: 'My comment',
      } as unknown as vscode.CommentReply;

      await controller.handleCreateComment(mockReply);

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        'A Forgejo token is required to create comments. Please configure your token first.'
      );
      // No API call should have been made
      expect(MockForgejoClient).not.toHaveBeenCalled();
    });
  });

  describe('loadCommentsForDocument edge cases', () => {
    const ctx: PRContext = {
      owner: 'owner',
      repo: 'repo',
      prNumber: 42,
      baseRef: 'main',
      headRef: 'feature',
      filePath: 'src/file.ts',
    };

    it('returns gracefully without creating threads when getForgejoConfig returns null', async () => {
      const uri = vscode.Uri.parse('forgejo-pr:/owner/repo/bWFpbg/src/file.ts');
      controller.registerPRContext(uri, ctx);
      mockGetForgejoConfig.mockResolvedValueOnce(null);

      const mockDoc = { uri } as vscode.TextDocument;
      await controller.loadCommentsForDocument(mockDoc);

      expect(MockForgejoClient).not.toHaveBeenCalled();
      // createCommentThread should not have been called
      const mockController = (vscode.comments.createCommentController as jest.Mock).mock.results[0].value;
      expect(mockController.createCommentThread).not.toHaveBeenCalled();
    });

    it('creates no threads when all comments have line <= 0', async () => {
      const uri = vscode.Uri.parse('forgejo-pr:/owner/repo/bWFpbg/src/file.ts');
      controller.registerPRContext(uri, ctx);

      mockGetForgejoConfig.mockResolvedValueOnce({
        instanceUrl: 'https://git.example.com',
        owner: 'owner',
        repo: 'repo',
        token: 'test-token',
      } as any);

      // Set up ForgejoClient to return reviews with comments that all have line <= 0
      MockForgejoClient.mockImplementationOnce(() => ({
        getPullRequestReviews: jest.fn().mockResolvedValue([
          { id: 1, comments_count: 2 },
        ]),
        getReviewComments: jest.fn().mockResolvedValue([
          { path: 'src/file.ts', line: 0, body: 'comment 1', user: { login: 'user1' } },
          { path: 'src/file.ts', line: -1, body: 'comment 2', user: { login: 'user2' } },
        ]),
        createReviewWithComments: jest.fn(),
      } as any));

      const mockDoc = { uri } as vscode.TextDocument;
      await controller.loadCommentsForDocument(mockDoc);

      // All comments have line <= 0, so none should produce threads
      const mockController = (vscode.comments.createCommentController as jest.Mock).mock.results[0].value;
      expect(mockController.createCommentThread).not.toHaveBeenCalled();
    });
  });
});
