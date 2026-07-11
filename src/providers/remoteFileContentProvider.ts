import * as vscode from 'vscode';
import { ForgejoClient, RepositoryContentEntry } from '../api/forgejoClient';
import { getForgejoConfigFor } from '../utils/config';

export const REMOTE_FILE_SCHEME = 'forgejo-remote';
export const REMOTE_FILE_URI_VERSION = 'v1';
export const MAX_REMOTE_FILE_BYTES = 1024 * 1024;

export interface ParsedRemoteFileUri {
  instanceUrl: string;
  owner: string;
  repo: string;
  ref: string;
  filepath: string;
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value).toString('base64url');
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, 'base64url').toString();
}

function encodePath(filepath: string): string {
  return filepath.split('/').map(encodeURIComponent).join('/');
}

function decodePath(parts: string[]): string {
  return decodeURIComponent(parts.join('/'));
}

export function createRemoteFileUri(
  instanceUrl: string,
  owner: string,
  repo: string,
  ref: string,
  filepath: string
): vscode.Uri {
  const encodedInstanceUrl = encodeBase64Url(instanceUrl);
  const encodedRef = encodeBase64Url(ref);
  const encodedPath = encodePath(filepath);
  return vscode.Uri.parse(`${REMOTE_FILE_SCHEME}:/${REMOTE_FILE_URI_VERSION}/${encodedInstanceUrl}/${owner}/${repo}/${encodedRef}/${encodedPath}`);
}

export function parseRemoteFileUri(uri: vscode.Uri): ParsedRemoteFileUri {
  const parts = uri.path.split('/').filter(Boolean);
  if (parts.length < 6 || parts[0] !== REMOTE_FILE_URI_VERSION) {
    throw new Error('Invalid remote file URI format');
  }

  const instanceUrl = decodeBase64Url(parts[1]);
  if (!/^https?:\/\//i.test(instanceUrl)) {
    throw new Error('Invalid remote file URI instance');
  }

  const owner = parts[2];
  const repo = parts[3];
  const ref = decodeBase64Url(parts[4]);
  const filepath = decodePath(parts.slice(5));
  if (!owner || !repo || !ref || !filepath) {
    throw new Error('Invalid remote file URI format');
  }

  return { instanceUrl, owner, repo, ref, filepath };
}

function isProbablyBinary(buffer: Buffer): boolean {
  if (buffer.includes(0)) {
    return true;
  }

  const sampleSize = Math.min(buffer.length, 8000);
  if (sampleSize === 0) {
    return false;
  }

  let suspicious = 0;
  for (let index = 0; index < sampleSize; index += 1) {
    const value = buffer[index];
    const isAllowedControl = value === 9 || value === 10 || value === 13;
    if (value < 32 && !isAllowedControl) {
      suspicious += 1;
    }
  }

  return suspicious / sampleSize > 0.02;
}

function fileMessage(message: string, uri: vscode.Uri): string {
  return `// ${message}\n// URI: ${uri.toString()}`;
}

function decodedBase64ByteLength(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
}

export function decodeRemoteFileContent(entry: RepositoryContentEntry, uri: vscode.Uri): string {
  if (entry.type !== 'file') {
    return fileMessage('Remote path is not a file.', uri);
  }

  if (entry.size !== undefined && entry.size > MAX_REMOTE_FILE_BYTES) {
    return fileMessage(`Remote file is too large to preview (${entry.size} bytes).`, uri);
  }

  if (typeof entry.content !== 'string') {
    return fileMessage('Remote file content is not available from the server.', uri);
  }

  if (entry.encoding === 'base64') {
    const normalizedContent = entry.content.replace(/\s/g, '');
    const decodedLength = decodedBase64ByteLength(normalizedContent);
    if (decodedLength > MAX_REMOTE_FILE_BYTES) {
      return fileMessage(`Remote file is too large to preview (${decodedLength} bytes).`, uri);
    }
    const buffer = Buffer.from(normalizedContent, 'base64');
    if (buffer.length > MAX_REMOTE_FILE_BYTES) {
      return fileMessage(`Remote file is too large to preview (${buffer.length} bytes).`, uri);
    }
    if (isProbablyBinary(buffer)) {
      return fileMessage('Remote file appears to be binary and cannot be previewed as text.', uri);
    }
    return buffer.toString('utf8');
  }

  if (entry.content.length > MAX_REMOTE_FILE_BYTES) {
    return fileMessage(`Remote file is too large to preview (${entry.content.length} bytes).`, uri);
  }

  return entry.content;
}

export class RemoteFileContentProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  dispose(): void {
    this._onDidChange.dispose();
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const { instanceUrl, owner, repo, ref, filepath } = parseRemoteFileUri(uri);
    try {
      const config = await getForgejoConfigFor(owner, repo, instanceUrl);
      const client = new ForgejoClient(instanceUrl, config?.token ?? '');
      const entry = await client.getRepositoryContents(owner, repo, filepath, { ref });
      if (Array.isArray(entry)) {
        return fileMessage('Remote path is a directory.', uri);
      }

      const content = decodeRemoteFileContent(entry, uri);
      return content;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch remote file';
      console.error('[Forgejo] Error fetching remote file:', error);
      return fileMessage(`Error: ${message}`, uri);
    }
  }

  clearCache(uri?: vscode.Uri): void {
	void uri;
  }

  refresh(uri: vscode.Uri): void {
    this.clearCache(uri);
    this._onDidChange.fire(uri);
  }
}
