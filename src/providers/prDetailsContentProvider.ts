import * as vscode from 'vscode';
import { ForgejoClient } from '../api/forgejoClient';
import { getForgejoConfig } from '../utils/config';
import { getPullRequestMergeability, PullRequest, CommitStatus } from '../models/pullRequest';

/**
 * Custom URI scheme for PR details virtual documents
 * Format: forgejo-pr-details://owner/repo/number
 */
export const PR_DETAILS_SCHEME = 'forgejo-pr-details';

/**
 * Provides virtual document content for PR details overview
 */
export class PRDetailsContentProvider implements vscode.TextDocumentContentProvider {
  private cache = new Map<string, { content: string; timestamp: number }>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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
    console.log('[Forgejo] Providing PR details for:', uri.toString());

    // Check cache first
    const cached = this.cache.get(uri.toString());
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      console.log('[Forgejo] Returning cached PR details');
      return cached.content;
    }

    // Parse URI: forgejo-pr-details://owner/repo/number
    const parts = uri.path.split('/').filter(p => p);
    if (parts.length < 3) {
      throw new Error('Invalid PR details URI format');
    }

    const owner = parts[0];
    const repo = parts[1];
    const pullNumber = parseInt(parts[2], 10);

    if (isNaN(pullNumber)) {
      throw new Error('Invalid PR number in URI');
    }

    console.log('[Forgejo] Fetching PR details:', { owner, repo, pullNumber });

    try {
      const config = await getForgejoConfig();
      if (!config) {
        throw new Error('Forgejo configuration not found');
      }

      const client = new ForgejoClient(config.instanceUrl, config.token);

      // Fetch PR details first (needed for CI status)
      const prDetails = await client.getPullRequestDetails(owner, repo, pullNumber);

      // Fetch CI status using the PR's head SHA
      const commitStatuses = await this.fetchCommitStatuses(client, owner, repo, prDetails.head.sha);

      const content = this.formatPRDetails(prDetails, commitStatuses);

      // Cache the result
      this.cache.set(uri.toString(), { content, timestamp: Date.now() });

      return content;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to fetch PR details';
      console.error('[Forgejo] Error fetching PR details:', error);

      // Return error message as content
      return this.formatError(errorMsg, uri);
    }
  }

  private async fetchCommitStatuses(
    client: ForgejoClient,
    owner: string,
    repo: string,
    sha: string | undefined
  ): Promise<CommitStatus[]> {
    try {
      if (!sha) {
        return [];
      }

      // Fetch commit statuses for the given SHA
      const allStatuses = await client.getCommitStatuses(owner, repo, sha);

      // Deduplicate statuses by context, keeping only the latest per context.
      // The API returns all historical statuses (pending + final) for a SHA,
      // which causes the same CI job to appear multiple times (e.g. "Waiting to run" + "Succeeded").
      return PRDetailsContentProvider.deduplicateStatuses(allStatuses);
    } catch (error) {
      console.log('[Forgejo] Could not fetch commit statuses:', error);
      return [];
    }
  }

  /**
   * Deduplicate commit statuses by context, keeping only the latest entry per context.
   * The Forgejo /statuses/ API returns all historical status updates for a SHA,
   * so each CI job can appear multiple times as it transitions through states.
   * Each status update creates a new record with a new `created_at` timestamp,
   * so we compare by `created_at` to find the most recent per context.
   */
  static deduplicateStatuses(statuses: CommitStatus[]): CommitStatus[] {
    const latestByContext = new Map<string, CommitStatus>();
    for (const status of statuses) {
      const key = status.context;
      const statusDate = new Date(status.created_at).getTime();
      if (isNaN(statusDate)) continue; // Skip entries with invalid dates
      const existing = latestByContext.get(key);
      const existingDate = existing ? new Date(existing.created_at).getTime() : -Infinity;
      if (statusDate > existingDate) {
        latestByContext.set(key, status);
      }
    }
    return Array.from(latestByContext.values());
  }

  private formatPRDetails(pr: PullRequest, statuses: CommitStatus[]): string {
    const statusIcon = this.getStatusIcon(pr);
    const statusText = this.getStatusText(pr);

    let markdown = `# PR #${pr.number}: ${pr.title}\n\n`;

    // Header section
    markdown += `**Status:** ${statusIcon} ${statusText}  \n`;
    markdown += `**Author:** @${pr.user.login}  \n`;
    markdown += `**Created:** ${this.formatDate(pr.created_at)}  \n`;
    markdown += `**Branch:** ${pr.base.ref} ← ${pr.head.ref}  \n`;
    markdown += `**Comments:** ${pr.comments} 💬  \n`;
    const mergeability = getPullRequestMergeability(pr);
    if (mergeability.state !== 'notApplicable') {
      markdown += `**Mergeability:** ${mergeability.label} - ${mergeability.description}  \n`;
    }

    if (pr.merge_commit_sha) {
      markdown += `**Merge Commit:** \`${pr.merge_commit_sha.substring(0, 7)}\`  \n`;
    }

    markdown += '\n---\n\n';

    // Description section
    markdown += '## Description\n\n';
    if (pr.body.trim()) {
      markdown += pr.body;
    } else {
      markdown += '*No description provided*';
    }
    markdown += '\n\n';

    // CI Status section
    if (statuses.length > 0) {
      markdown += '## CI Status\n\n';
      markdown += '| Check | Status | Description |\n';
      markdown += '|-------|--------|-------------|\n';

      for (const status of statuses) {
        const icon = this.getCIStatusIcon(status.status);
        markdown += `| ${status.context} | ${icon} ${status.status} | ${status.description || '-'} |\n`;
      }

      markdown += '\n';
    }

    // Labels section
    if (pr.labels.length > 0) {
      markdown += '## Labels\n\n';
      for (const label of pr.labels) {
        markdown += `• **${label.name}**\n`;
      }
      markdown += '\n';
    }

    return markdown;
  }

  private getStatusIcon(pr: PullRequest): string {
    if (pr.merged) {
      return '🟣';
    } else if (pr.draft) {
      return '⚪';
    } else if (pr.state === 'closed') {
      return '🔴';
    } else {
      return '🟢';
    }
  }

  private getStatusText(pr: PullRequest): string {
    if (pr.merged) {
      return 'Merged';
    } else if (pr.draft) {
      return 'Draft';
    } else if (pr.state === 'closed') {
      return 'Closed';
    } else {
      return 'Open';
    }
  }

  private getCIStatusIcon(status: string): string {
    switch (status) {
      case 'success':
        return '✅';
      case 'failure':
      case 'error':
        return '❌';
      case 'pending':
        return '⏳';
      case 'warning':
        return '⚠️';
      default:
        return '❓';
    }
  }

  private formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  private formatError(errorMsg: string, uri: vscode.Uri): string {
    return `// Error: ${errorMsg}\n// URI: ${uri.toString()}\n\nPlease check your Forgejo configuration and try again.`;
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
 * Helper to create forgejo-pr-details:// URIs
 */
export function createPRDetailsUri(
  owner: string,
  repo: string,
  pullNumber: number
): vscode.Uri {
  return vscode.Uri.parse(`${PR_DETAILS_SCHEME}:/${owner}/${repo}/${pullNumber}`);
}
