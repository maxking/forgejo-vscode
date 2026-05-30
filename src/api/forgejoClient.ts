/**
 * VS Code extension wrapper around the forgejo-ts client library.
 *
 * Provides backward-compatible constructor (instanceUrl, token) and
 * legacy method names so existing call sites don't need to change.
 */
import {
  ForgejoClient as BaseClient,
  type PullRequest,
  type PullRequestListItem,
  type Issue,
  type IssueListItem,
  type ActionTasksResponse,
  type WorkflowRun,
  type RepositoryInfo,
} from 'forgejo-ts';
import { vscodeLogger } from '../utils/forgejoLoggerAdapter';

export class ForgejoClient extends BaseClient {
  constructor(
    private readonly vscodeInstanceUrl: string,
    private readonly vscodeToken = ''
  ) {
    super({ instanceUrl: vscodeInstanceUrl, token: vscodeToken, logger: vscodeLogger });
  }

  async listUserRepos(query?: string, limit = 10): Promise<RepositoryInfo[]> {
    try {
      if (query) {
        const params = new URLSearchParams({ q: query, limit: String(limit) });
        const data = await this.rawRequest<{ data?: RepositoryInfo[] }>('GET', `/repos/search?${params.toString()}`);
        return data.data ?? [];
      }

      const params = new URLSearchParams({ sort: 'newest', limit: String(limit) });
      return await this.rawRequest<RepositoryInfo[]>('GET', `/user/repos?${params.toString()}`);
    } catch {
      return [];
    }
  }

  // Legacy method aliases for backward compatibility

  async getPullRequests(owner: string, repo: string, state: 'open' | 'closed' | 'all' = 'all'): Promise<PullRequestListItem[]> {
    return this.listPullRequests(owner, repo, state);
  }

  async getPullRequestCount(owner: string, repo: string, state: 'open' | 'closed' | 'all' = 'all'): Promise<number | null> {
    const response = await fetch(`${this.vscodeInstanceUrl}/api/v1/repos/${owner}/${repo}/pulls?state=${state}&page=1&limit=1`, {
      headers: {
        Accept: 'application/json',
        ...(this.vscodeToken ? { Authorization: `token ${this.vscodeToken}` } : {})
      }
    });

    if (!response.ok) {
      return null;
    }

    const totalCount = response.headers.get('x-total-count');
    if (!totalCount) {
      return null;
    }

    const parsedCount = Number.parseInt(totalCount, 10);
    return Number.isNaN(parsedCount) ? null : parsedCount;
  }

  async getPullRequestDetails(owner: string, repo: string, number: number): Promise<PullRequest> {
    return this.getPullRequest(owner, repo, number);
  }

  async getIssues(owner: string, repo: string, state: 'open' | 'closed' | 'all' = 'all'): Promise<IssueListItem[]> {
    return this.listIssues(owner, repo, state);
  }

  async getIssueDetails(owner: string, repo: string, number: number): Promise<Issue> {
    return this.getIssue(owner, repo, number);
  }

  async getWorkflowRuns(owner: string, repo: string, status?: string): Promise<ActionTasksResponse> {
    return this.listWorkflowRuns(owner, repo, status ? { status } : undefined);
  }

  async getWorkflowRunDetails(owner: string, repo: string, runId: number): Promise<WorkflowRun> {
    return this.getWorkflowRun(owner, repo, runId);
  }

  async updateIssueState(owner: string, repo: string, number: number, state: 'open' | 'closed'): Promise<Issue> {
    return this.updateIssue(owner, repo, number, { state });
  }

  async updatePullRequestBody(owner: string, repo: string, number: number, body: string): Promise<PullRequest> {
    return this.updatePullRequest(owner, repo, number, { body });
  }

  async updateIssueBody(owner: string, repo: string, number: number, body: string): Promise<Issue> {
    return this.updateIssue(owner, repo, number, { body });
  }
}
