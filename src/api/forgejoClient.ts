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

export interface PullRequestPage {
  items: PullRequestListItem[];
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface IssuePage {
  items: IssueListItem[];
  page: number;
  limit: number;
  hasMore: boolean;
}

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

  async getPullRequestsPage(
    owner: string,
    repo: string,
    state: 'open' | 'closed' | 'all' = 'all',
    page = 1,
    limit = 50,
    query?: string
  ): Promise<PullRequestPage> {
    const trimmedQuery = query?.trim();
    const result = trimmedQuery
      ? await this.searchPullRequestsPage(owner, repo, {
        state,
        page,
        limit,
        query: trimmedQuery
      })
      : await this.listPullRequestsPage(owner, repo, { state, page, limit });
    return {
      items: result.items,
      page: result.page,
      limit: result.limit,
      hasMore: result.hasMore
    };
  }

  async hasPullRequests(owner: string, repo: string, state: 'open' | 'closed' | 'all' = 'all'): Promise<boolean> {
    const page = await this.getPullRequestsPage(owner, repo, state, 1, 1);
    return page.items.length > 0;
  }

  async getPullRequestCount(owner: string, repo: string, state: 'open' | 'closed' | 'all' = 'all'): Promise<number | null> {
    try {
      const result = await this.listPullRequestsPage(owner, repo, { state, page: 1, limit: 1 });
      return result.totalCount;
    } catch {
      return null;
    }
  }

  async getPullRequestDetails(owner: string, repo: string, number: number): Promise<PullRequest> {
    return this.getPullRequest(owner, repo, number);
  }

  async getIssues(owner: string, repo: string, state: 'open' | 'closed' | 'all' = 'all'): Promise<IssueListItem[]> {
    return this.listIssues(owner, repo, state);
  }

  async getIssuesPage(
    owner: string,
    repo: string,
    state: 'open' | 'closed' | 'all' = 'all',
    page = 1,
    limit = 50,
    query?: string
  ): Promise<IssuePage> {
    const trimmedQuery = query?.trim();
    const result = await this.listIssuesPage(owner, repo, {
      state,
      page,
      limit,
      ...(trimmedQuery ? { query: trimmedQuery } : {})
    });
    return {
      items: result.items.filter(item => !item.pull_request),
      page: result.page,
      limit: result.limit,
      hasMore: result.hasMore
    };
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
