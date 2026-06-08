import * as vscode from 'vscode';
import { ForgejoClient } from '../api/forgejoClient';
import { getForgejoConfig, getForgejoConfigFor } from '../utils/config';

/**
 * Custom URI scheme for PR diff virtual documents
 * Format: forgejo-pr:/{owner}/{repo}/{base64url_ref}/{filepath}
 *
 * The ref (branch/tag/SHA) is base64url-encoded into a path segment to:
 * 1. Avoid ambiguity with branch names that contain slashes (e.g., feature/branch)
 * 2. Survive VS Code tab serialization, which strips query parameters from custom scheme URIs
 */
export const PR_DIFF_SCHEME = 'forgejo-pr';

/**
 * Provides virtual document content for PR diffs
 */
export class PRDiffContentProvider implements vscode.TextDocumentContentProvider {
  private cache = new Map<string, string>();
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;
  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.disposables.push(this._onDidChange);
  }

  dispose(): void {
    for (const d of this.disposables) { d.dispose(); }
    this.disposables = [];
    this.cache.clear();
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    console.log('[Forgejo] Providing content for:', uri.toString());

    // Check cache first
    const cached = this.cache.get(uri.toString());
    if (cached) {
      console.log('[Forgejo] Returning cached content');
      return cached;
    }

    // Parse URI:
    // - New format: forgejo-pr:/{base64url_instance}/{owner}/{repo}/{base64url_ref}/{filepath}
    // - Legacy format: forgejo-pr:/{owner}/{repo}/{base64url_ref}/{filepath}
    const parts = uri.path.split('/').filter(p => p);
    if (parts.length < 4) {
      throw new Error('Invalid PR diff URI format');
    }

    const hasInstanceSegment = parts.length >= 5;
    const encodedInstanceUrl = hasInstanceSegment ? parts[0] : undefined;
    const owner = hasInstanceSegment ? parts[1] : parts[0];
    const repo = hasInstanceSegment ? parts[2] : parts[1];
    const encodedRef = hasInstanceSegment ? parts[3] : parts[2];
    const filepath = decodeURIComponent(parts.slice(hasInstanceSegment ? 4 : 3).join('/'));
    const instanceUrl = encodedInstanceUrl ? Buffer.from(encodedInstanceUrl, 'base64url').toString() : undefined;

    // Decode base64url-encoded ref
    const ref = Buffer.from(encodedRef, 'base64url').toString();
    if (!ref) {
      console.warn('[Forgejo] Empty ref after decoding in URI:', uri.toString());
      return '// This PR diff tab could not be restored.\n// Please re-open the file from the Pull Requests tree view.';
    }

    console.log('[Forgejo] Fetching file:', { owner, repo, ref, filepath });

    try {
      const config = await getForgejoConfigFor(owner, repo, instanceUrl) ?? await getForgejoConfig();
      if (!config) {
        throw new Error('Forgejo configuration not found');
      }

      const client = new ForgejoClient(config.instanceUrl, config.token);
      const content = await client.getFileContents(owner, repo, filepath, ref);

      // Cache the result
      this.cache.set(uri.toString(), content);

      return content;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to fetch file content';
      console.error('[Forgejo] Error fetching file content:', error);

      // Return error message as content
      return `// Error: ${errorMsg}\n// URI: ${uri.toString()}`;
    }
  }

  clearCache(uri?: vscode.Uri): void {
    if (uri) {
      this.cache.delete(uri.toString());
    } else {
      this.cache.clear();
    }
  }

  refresh(uri: vscode.Uri): void {
    this.clearCache(uri);
    this._onDidChange.fire(uri);
  }
}

/**
 * Helper to create forgejo-pr:// URIs
 */
export function createPRFileUri(
  owner: string,
  repo: string,
  ref: string,
  filepath: string,
  instanceUrl?: string
): vscode.Uri {
  // Base64url-encode the ref and instance URL so each is a single path segment
  // and survives VS Code tab serialization (which strips query parameters).
  const encodedRef = Buffer.from(ref).toString('base64url');
  const encodedInstanceUrl = instanceUrl ? `${Buffer.from(instanceUrl).toString('base64url')}/` : '';
  // Encode each filepath segment to handle special characters (#, &, spaces, etc.)
  const encodedPath = filepath.split('/').map(encodeURIComponent).join('/');
  const path = `/${encodedInstanceUrl}${owner}/${repo}/${encodedRef}/${encodedPath}`;
  return vscode.Uri.parse(`${PR_DIFF_SCHEME}:${path}`);
}
