import * as vscode from 'vscode';
import { ForgejoClient } from '../api/forgejoClient';
import { getForgejoConfigFor } from '../utils/config';
import { PRContext, PullReview, ReviewComment } from '../models/comment';
import { parsePRFileUri, PR_DIFF_SCHEME } from './prDiffContentProvider';

/**
 * Manages inline PR comments using the VS Code Comment Controller API.
 *
 * When a PR diff is opened via the `forgejo-pr:` scheme, this controller:
 * - Shows the gutter "+" icon for adding new comments
 * - Loads existing review comments from the Forgejo API
 * - Creates new inline comments via the Forgejo review API
 */
export class ForgejoCommentController implements vscode.Disposable {
  private controller: vscode.CommentController;
  private prContextMap = new Map<string, PRContext>();
  private threads = new Map<string, vscode.CommentThread[]>();
  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.controller = vscode.comments.createCommentController(
      'forgejo-pr-comments',
      'Forgejo PR Comments'
    );

    // Only allow commenting on forgejo-pr: scheme documents
    this.controller.commentingRangeProvider = {
      provideCommentingRanges: (document: vscode.TextDocument): vscode.Range[] => {
        if (document.uri.scheme !== PR_DIFF_SCHEME) {
          return [];
        }
        // Allow commenting on every line
        const lineCount = document.lineCount;
        return [new vscode.Range(0, 0, lineCount - 1, 0)];
      }
    };

    this.disposables.push(this.controller);

    // Listen for document opens to load existing comments
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((doc) => {
        if (doc.uri.scheme === PR_DIFF_SCHEME) {
          void this.loadCommentsForDocument(doc);
        }
      })
    );

    // Clean up threads when documents close
    this.disposables.push(
      vscode.workspace.onDidCloseTextDocument((doc) => {
        const key = doc.uri.toString();
        const docThreads = this.threads.get(key);
        if (docThreads) {
          docThreads.forEach(t => t.dispose());
          this.threads.delete(key);
        }
      })
    );

    console.log('[Forgejo] Comment controller initialized');
  }

  /**
   * Register PR context for a URI so we know which PR a document belongs to.
   */
  registerPRContext(uri: vscode.Uri, context: PRContext): void {
    this.prContextMap.set(uri.toString(), context);
  }

  /**
   * Parse a forgejo-pr: URI to extract the ref used.
   * URI format:
   * - forgejo-pr:/{owner}/{repo}/{base64url_ref}/{filepath}
   * - forgejo-pr:/{base64url_instance}/{owner}/{repo}/{base64url_ref}/{filepath}
   */
  private parseUri(uri: vscode.Uri): { owner: string; repo: string; ref: string; filePath: string } | undefined {
    try {
      const parsed = parsePRFileUri(uri);
      return { owner: parsed.owner, repo: parsed.repo, ref: parsed.ref, filePath: parsed.filepath };
    } catch {
      return undefined;
    }
  }

  /**
   * Determine whether this URI represents the base (old) or head (new) side of the diff.
   */
  private isHeadSide(uri: vscode.Uri): boolean {
    const parsed = this.parseUri(uri);
    if (!parsed) {
      return true; // default to head
    }

    const ctx = this.prContextMap.get(uri.toString());
    if (!ctx) {
      return true;
    }

    return parsed.ref === ctx.headRef;
  }

  /**
   * Load existing review comments for a document from the Forgejo API.
   */
  async loadCommentsForDocument(document: vscode.TextDocument): Promise<void> {
    const uriKey = document.uri.toString();
    const ctx = this.prContextMap.get(uriKey);
    if (!ctx) {
      return;
    }

    try {
      const config = await getForgejoConfigFor(ctx.owner, ctx.repo, ctx.instanceUrl);
      if (!config) {
        return;
      }

      const client = new ForgejoClient(config.instanceUrl, config.token);

      // Fetch all reviews for this PR
      const reviews: PullReview[] = await client.getPullRequestReviews(
        ctx.owner,
        ctx.repo,
        ctx.prNumber
      );

      // For each review that has comments, fetch them
      const allComments: ReviewComment[] = [];
      for (const review of reviews) {
        if (review.comments_count && review.comments_count > 0) {
          const comments: ReviewComment[] = await client.getReviewComments(
            ctx.owner,
            ctx.repo,
            ctx.prNumber,
            review.id
          );
          allComments.push(...comments);
        }
      }

      // Filter comments for the current file path
      const fileComments = allComments.filter(c => c.path === ctx.filePath);

      if (fileComments.length === 0) {
        return;
      }

      // Clean up any existing threads for this document
      const existingThreads = this.threads.get(uriKey);
      if (existingThreads) {
        existingThreads.forEach(t => t.dispose());
      }

      const headSide = this.isHeadSide(document.uri);
      // Group comments by the line number for this side of the diff. Forgejo's
      // generic `line` value is not sufficient for modified-file split diffs.
      const commentsByLine = new Map<number, ReviewComment[]>();
      for (const comment of fileComments) {
		const positioned = comment as ReviewComment & { old_position?: number; new_position?: number };
		const line = headSide ? positioned.new_position : positioned.old_position;
		if (typeof line !== 'number') {
			continue;
		}
        if (line <= 0) {
          continue;
        }
        const existing = commentsByLine.get(line) ?? [];
        existing.push(comment);
        commentsByLine.set(line, existing);
      }

      // Create comment threads
      const newThreads: vscode.CommentThread[] = [];
      for (const [line, comments] of commentsByLine) {
        // Forgejo lines are 1-indexed, VS Code is 0-indexed
        const range = new vscode.Range(line - 1, 0, line - 1, 0);

        const vscodeComments: vscode.Comment[] = comments.map(c => ({
          body: new vscode.MarkdownString(c.body),
          author: { name: c.user.login },
          mode: vscode.CommentMode.Preview
        }));

        const thread = this.controller.createCommentThread(
          document.uri,
          range,
          vscodeComments
        );
        thread.canReply = true;
        thread.label = `Review comment`;
        newThreads.push(thread);
      }

      this.threads.set(uriKey, newThreads);
      console.log(`[Forgejo] Loaded ${fileComments.length} review comments for ${ctx.filePath}`);
    } catch (error) {
      console.error('[Forgejo] Error loading review comments:', error);
    }
  }

  /**
   * Handle creating a new inline comment (called when user submits from gutter).
   */
  async handleCreateComment(reply: vscode.CommentReply): Promise<void> {
    const uri = reply.thread.uri;
    const ctx = this.prContextMap.get(uri.toString());

    if (!ctx) {
      void vscode.window.showErrorMessage('Cannot determine PR context for this file. Please re-open the diff from the Pull Requests view.');
      return;
    }

    const config = await getForgejoConfigFor(ctx.owner, ctx.repo, ctx.instanceUrl);
    if (!config) {
      void vscode.window.showErrorMessage('Forgejo configuration not found.');
      return;
    }

    if (!config.token) {
      void vscode.window.showErrorMessage('A Forgejo token is required to create comments. Please configure your token first.');
      return;
    }

    // VS Code lines are 0-indexed, Forgejo API is 1-indexed
    const range = reply.thread.range;
    if (!range) {
      void vscode.window.showErrorMessage('Cannot determine line position for this comment.');
      return;
    }
    const line = range.start.line + 1;

    // Determine if this is on the head (new) or base (old) side
    const isHead = this.isHeadSide(uri);

    try {
      const client = new ForgejoClient(config.instanceUrl, config.token);

      const commentPayload: {
        body: string;
        path: string;
        new_position: number;
        old_position?: number;
      } = {
        body: reply.text,
        path: ctx.filePath,
        new_position: isHead ? line : 0,
      };

      if (!isHead) {
        commentPayload.old_position = line;
      }

      await client.createReviewWithComments(
        ctx.owner,
        ctx.repo,
        ctx.prNumber,
        {
          event: 'COMMENT',
          comments: [commentPayload],
        }
      );

      // Add the comment to the thread in the UI
      const newComment: vscode.Comment = {
        body: new vscode.MarkdownString(reply.text),
        author: { name: 'You' },
        mode: vscode.CommentMode.Preview,
      };

      reply.thread.comments = [...reply.thread.comments, newComment];

      console.log(`[Forgejo] Created inline comment on ${ctx.filePath}:${line}`);
    } catch (error) {
      console.error('[Forgejo] Error creating inline comment:', error);
      void vscode.window.showErrorMessage(
        `Failed to create comment: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  dispose(): void {
    // Dispose all threads
    for (const docThreads of this.threads.values()) {
      docThreads.forEach(t => t.dispose());
    }
    this.threads.clear();
    this.prContextMap.clear();

    this.disposables.forEach(d => void d.dispose());
    this.disposables = [];
  }
}
