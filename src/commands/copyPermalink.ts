import * as path from 'path';
import * as vscode from 'vscode';
import type { Repository } from '../types/git';
import { activateGitExtension } from '../utils/gitExtension';
import { getForgejoConfig } from '../utils/config';
import { logError, logInfo } from '../utils/logger';

export interface PermalinkLineRange {
  start: number;
  end: number;
}

function encodePath(filepath: string): string {
  return filepath.split('/').map(encodeURIComponent).join('/');
}

/**
 * Builds a Forgejo permalink URL pinned to a specific commit, matching the
 * `{instance}/{owner}/{repo}/src/commit/{sha}/{path}#L{start}-L{end}` format
 * (single-line selections use `#L{n}` with no range).
 */
export function buildPermalinkUrl(
  instanceUrl: string,
  owner: string,
  repo: string,
  commitSha: string,
  relativePath: string,
  range?: PermalinkLineRange
): string {
  const encodedPath = encodePath(relativePath);
  const base = `${instanceUrl}/${owner}/${repo}/src/commit/${commitSha}/${encodedPath}`;

  if (!range) {
    return base;
  }

  const anchor = range.start === range.end ? `L${range.start}` : `L${range.start}-L${range.end}`;
  return `${base}#${anchor}`;
}

function toRepoRelativePath(repository: Repository, fileUri: vscode.Uri): string {
  const relative = path.relative(repository.rootUri.fsPath, fileUri.fsPath);
  return relative.split(path.sep).join('/');
}

/**
 * Converts an editor selection to a 1-indexed inclusive line range for the
 * permalink anchor, or `undefined` for an empty (cursor-only) selection.
 *
 * VS Code reports a trailing empty line in `selection.end` when a user drags
 * to column 0 of the line after their intended selection; that line is
 * excluded from the reported range since the user did not select any of its
 * content.
 */
function selectionLineRange(selection: vscode.Selection): PermalinkLineRange | undefined {
  if (selection.isEmpty) {
    return undefined;
  }

  const startLine = selection.start.line + 1;
  const endLineExclusive = selection.end.line + 1;
  const endLine = selection.end.character === 0 && endLineExclusive > startLine
    ? endLineExclusive - 1
    : endLineExclusive;

  return { start: startLine, end: endLine };
}

async function getGitApi() {
  const gitExtension = await activateGitExtension();
  if (!gitExtension?.enabled) {
    return undefined;
  }

  return gitExtension.getAPI(1);
}

function isFileDirty(repository: Repository, fileUri: vscode.Uri): boolean {
  const changeLists = [
    repository.state.indexChanges,
    repository.state.workingTreeChanges,
    repository.state.mergeChanges
  ];

  return changeLists.some(changes => changes?.some(change => change.uri.fsPath === fileUri.fsPath) ?? false);
}

export async function copyPermalinkCommand(): Promise<void> {
  try {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file') {
      void vscode.window.showWarningMessage('Open a file to copy a Forgejo permalink.');
      return;
    }

    const document = editor.document;
    const config = await getForgejoConfig(document.uri);
    if (!config) {
      void vscode.window.showWarningMessage('This file is not part of a configured Forgejo repository.');
      return;
    }

    const git = await getGitApi();
    const repository = git?.getRepository(document.uri);
    if (!repository) {
      void vscode.window.showWarningMessage('Could not find a local Git repository for this file.');
      return;
    }

    const commitSha = repository.state.HEAD?.commit;
    if (!commitSha) {
      void vscode.window.showWarningMessage('Could not determine the current commit for this repository.');
      return;
    }

    const relativePath = toRepoRelativePath(repository, document.uri);
    const range = selectionLineRange(editor.selection);
    const url = buildPermalinkUrl(config.instanceUrl, config.owner, config.repo, commitSha, relativePath, range);

    await vscode.env.clipboard.writeText(url);

    const notes: string[] = [];
    if (isFileDirty(repository, document.uri)) {
      notes.push('this file has uncommitted changes not reflected at that commit');
    }
    if (!repository.state.HEAD.upstream) {
      notes.push('the current branch has no upstream — push before sharing so the link resolves');
    }
    const suffix = notes.length > 0 ? ` (note: ${notes.join('; ')})` : '';

    logInfo(`Copied Forgejo permalink: ${url}`);
    void vscode.window.showInformationMessage(`Copied Forgejo permalink to clipboard${suffix}.`);
  } catch (error) {
    logError('Error copying Forgejo permalink:', error);
    void vscode.window.showErrorMessage(
      `Failed to copy Forgejo permalink: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
