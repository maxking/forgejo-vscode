import * as vscode from 'vscode';
import { ForgejoClient } from '../api/forgejoClient';
import { getForgejoConfigFor } from '../utils/config';

/**
 * Custom URI scheme for PR diff virtual documents.
 *
 * Two self-identifying formats are supported:
 *
 * 1. Instance-aware (versioned, current):
 *    forgejo-pr:/v1/{base64url_instanceUrl}/{owner}/{repo}/{base64url_ref}/{filepath}
 *
 * 2. Legacy no-instance:
 *    forgejo-pr:/{owner}/{repo}/{base64url_ref}/{filepath}
 *
 * The ref (branch/tag/SHA) is base64url-encoded into a single path segment to:
 * 1. Avoid ambiguity with branch names that contain slashes (e.g., feature/branch)
 * 2. Survive VS Code tab serialization, which strips query parameters from custom scheme URIs
 *
 * The instance-aware format is prefixed with a `v1` version marker so it is
 * self-identifying. We must NOT infer the instance-aware format from segment
 * count or by attempting to base64url-decode the first segment: a repository
 * owner whose name happens to be a base64url string that decodes to an
 * HTTP(S) URL (e.g. `aHR0cHM6Ly9naXQuZXhhbXBsZS5jb20`) would otherwise shift
 * every parsed field and break owner/repo/ref/file identity. See issue #225.
 */
export const PR_DIFF_SCHEME = 'forgejo-pr';
export const PR_DIFF_URI_VERSION = 'v1';

export interface ParsedPRFileUri {
  owner: string;
  repo: string;
  ref: string;
  filepath: string;
  instanceUrl?: string;
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, 'base64url').toString();
}

export function parsePRFileUri(uri: vscode.Uri): ParsedPRFileUri {
  const parts = uri.path.split('/').filter(p => p);
  if (parts.length < 4) {
    throw new Error('Invalid PR diff URI format');
  }

  // Self-identifying versioned, instance-aware format:
  //   forgejo-pr:/v1/{base64url_instanceUrl}/{owner}/{repo}/{base64url_ref}/{filepath}
  // The `v1` marker plus a URL-shaped decoded instance segment makes this
  // unambiguous. If parts[0] is `v1` but parts[1] does not decode to an
  // HTTP(S) URL, fall through to the legacy parser: the owner is simply named
  // "v1" in a no-instance URI.
  if (parts[0] === PR_DIFF_URI_VERSION && parts.length >= 6) {
    const candidateInstanceUrl = decodeBase64Url(parts[1]);
    if (/^https?:\/\//i.test(candidateInstanceUrl)) {
      const owner = parts[2];
      const repo = parts[3];
      const ref = decodeBase64Url(parts[4]);
      const filepath = decodeURIComponent(parts.slice(5).join('/'));
      return { owner, repo, ref, filepath, instanceUrl: candidateInstanceUrl };
    }
  }

  // Legacy no-instance format:
  //   forgejo-pr:/{owner}/{repo}/{base64url_ref}/{filepath}
  const owner = parts[0];
  const repo = parts[1];
  const ref = decodeBase64Url(parts[2]);
  const filepath = decodeURIComponent(parts.slice(3).join('/'));

  return { owner, repo, ref, filepath };
}

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

    const { owner, repo, ref, filepath, instanceUrl } = parsePRFileUri(uri);
    if (!ref) {
      console.warn('[Forgejo] Empty ref after decoding in URI:', uri.toString());
      return '// This PR diff tab could not be restored.\n// Please re-open the file from the Pull Requests tree view.';
    }

    console.log('[Forgejo] Fetching file:', { owner, repo, ref, filepath });

    try {
      const config = await getForgejoConfigFor(owner, repo, instanceUrl);
      if (!config) {
        throw new Error('Forgejo configuration not found');
      }

      const client = new ForgejoClient(config.instanceUrl, config.token);
      const content = await client.getFileContents(owner, repo, filepath, ref);

      // Cache the result
      this.cache.set(uri.toString(), content);
      const oldest = this.cache.keys().next();
      if (this.cache.size > 100 && !oldest.done) this.cache.delete(oldest.value);

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
 * Helper to create forgejo-pr URIs.
 *
 * When `instanceUrl` is provided, emits the self-identifying versioned format:
 *   forgejo-pr:/v1/{base64url_instanceUrl}/{owner}/{repo}/{base64url_ref}/{filepath}
 * Otherwise emits the legacy no-instance format:
 *   forgejo-pr:/{owner}/{repo}/{base64url_ref}/{filepath}
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
  // Encode each filepath segment to handle special characters (#, &, spaces, etc.)
  const encodedPath = filepath.split('/').map(encodeURIComponent).join('/');

  if (instanceUrl) {
    const encodedInstanceUrl = Buffer.from(instanceUrl).toString('base64url');
    const path = `/${PR_DIFF_URI_VERSION}/${encodedInstanceUrl}/${owner}/${repo}/${encodedRef}/${encodedPath}`;
    return vscode.Uri.parse(`${PR_DIFF_SCHEME}:${path}`);
  }

  const path = `/${owner}/${repo}/${encodedRef}/${encodedPath}`;
  return vscode.Uri.parse(`${PR_DIFF_SCHEME}:${path}`);
}
