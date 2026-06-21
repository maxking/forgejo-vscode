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
  type RepositoryBranch,
  type RepositoryContentEntry,
} from 'forgejo-ts';
import { vscodeLogger } from '../utils/forgejoLoggerAdapter';
import type { PullRequestListItemWithMergeability } from '../models/pullRequest';

export interface CreateIssueOptions {
  labels?: number[];
  assignees?: string[];
  milestone?: number;
  due_date?: string;
}

export interface PullRequestPage {
  items: PullRequestListItemWithMergeability[];
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

export interface ForgejoStopwatch {
  created?: string;
  duration?: string;
  issue_index: number;
  issue_title?: string;
  repo_name: string;
  repo_owner_name: string;
  seconds?: number;
}

export interface ForgejoTrackedTime {
  id: number;
  created?: string;
  time: number;
  user_name?: string;
  issue_id?: number;
  user_id?: number;
}

export interface ForgejoItemQueryOptions {
  query?: string;
  createdBy?: string;
  assignedBy?: string;
  mentionedBy?: string;
  reviewRequestedBy?: string;
}

export type { RepositoryBranch, RepositoryContentEntry };

interface ForgejoUserResponse {
  login?: string;
  username?: string;
}

interface ForgejoIssueSearchItem extends IssueListItem {
  repository?: {
    full_name?: string;
    name?: string;
    owner?: {
      login?: string;
      username?: string;
    };
  };
  repository_url?: string;
}

const PULL_REQUEST_DETAIL_BATCH_SIZE = 5;

function trimmedValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeQueryOptions(queryOrOptions?: string | ForgejoItemQueryOptions): ForgejoItemQueryOptions {
  if (typeof queryOrOptions === 'string') {
    return { query: trimmedValue(queryOrOptions) };
  }

  return {
    ...queryOrOptions,
    query: trimmedValue(queryOrOptions?.query),
    createdBy: trimmedValue(queryOrOptions?.createdBy),
    assignedBy: trimmedValue(queryOrOptions?.assignedBy),
    mentionedBy: trimmedValue(queryOrOptions?.mentionedBy),
    reviewRequestedBy: trimmedValue(queryOrOptions?.reviewRequestedBy)
  };
}

function hasRepositoryIssueSearchFilter(options: ForgejoItemQueryOptions): boolean {
  return Boolean(options.createdBy ?? options.assignedBy ?? options.mentionedBy);
}

function appendQueryParam(params: URLSearchParams, key: string, value: string | undefined): void {
  if (value) {
    params.set(key, value);
  }
}

function repoIssuePath(owner: string, repo: string, number: number): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${encodeURIComponent(String(number))}`;
}

async function mapInBatches<T, U>(
  items: T[],
  batchSize: number,
  mapper: (item: T) => Promise<U>
): Promise<U[]> {
  const results: U[] = [];
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    results.push(...await Promise.all(batch.map(mapper)));
  }
  return results;
}

function matchesRepositoryPath(value: string | undefined, owner: string, repo: string): boolean {
  return value?.toLowerCase() === `${owner}/${repo}`.toLowerCase();
}

function issueSearchItemMatchesRepository(item: ForgejoIssueSearchItem, owner: string, repo: string): boolean {
  if (matchesRepositoryPath(item.repository?.full_name, owner, repo)) {
    return true;
  }

  if (
    item.repository?.name?.toLowerCase() === repo.toLowerCase()
    && (item.repository.owner?.login?.toLowerCase() === owner.toLowerCase()
      || item.repository.owner?.username?.toLowerCase() === owner.toLowerCase())
  ) {
    return true;
  }

  const repositoryApiPath = `/repos/${owner}/${repo}`.toLowerCase();
  if (item.repository_url?.toLowerCase().endsWith(repositoryApiPath)) {
    return true;
  }

  const pullRequestApiPath = `/repos/${owner}/${repo}/pulls/`.toLowerCase();
  return item.pull_request?.url.toLowerCase().includes(pullRequestApiPath) ?? false;
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
    queryOrOptions?: string | ForgejoItemQueryOptions
  ): Promise<PullRequestPage> {
    const options = normalizeQueryOptions(queryOrOptions);
    const result = options.reviewRequestedBy
      ? await this.searchReviewRequestedPullRequestsPage(owner, repo, state, page, limit, options)
      : hasRepositoryIssueSearchFilter(options)
      ? await this.searchPullRequestsByIssueFiltersPage(owner, repo, state, page, limit, options)
      : options.query
      ? await this.searchPullRequestsPage(owner, repo, {
        state,
        page,
        limit,
        query: options.query
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
    queryOrOptions?: string | ForgejoItemQueryOptions
  ): Promise<IssuePage> {
    const options = normalizeQueryOptions(queryOrOptions);
    const result = await this.listIssuesPage(owner, repo, {
      state,
      page,
      limit,
      ...(options.query ? { query: options.query } : {}),
      ...(options.createdBy ? { createdBy: options.createdBy } : {}),
      ...(options.assignedBy ? { assignedBy: options.assignedBy } : {}),
      ...(options.mentionedBy ? { mentionedBy: options.mentionedBy } : {})
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

  async getUserStopwatches(page = 1, limit = 50): Promise<ForgejoStopwatch[]> {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    return this.rawRequest<ForgejoStopwatch[]>('GET', `/user/stopwatches?${params.toString()}`);
  }

  async startIssueStopwatch(owner: string, repo: string, number: number): Promise<void> {
    await this.rawRequest<void>('POST', `${repoIssuePath(owner, repo, number)}/stopwatch/start`);
  }

  async stopIssueStopwatch(owner: string, repo: string, number: number): Promise<void> {
    await this.rawRequest<void>('POST', `${repoIssuePath(owner, repo, number)}/stopwatch/stop`);
  }

  async deleteIssueStopwatch(owner: string, repo: string, number: number): Promise<void> {
    await this.rawRequest<void>('DELETE', `${repoIssuePath(owner, repo, number)}/stopwatch/delete`);
  }

  async getIssueTrackedTimes(owner: string, repo: string, number: number, page = 1, limit = 50): Promise<ForgejoTrackedTime[]> {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    return this.rawRequest<ForgejoTrackedTime[]>('GET', `${repoIssuePath(owner, repo, number)}/times?${params.toString()}`);
  }

  async addIssueTrackedTime(owner: string, repo: string, number: number, seconds: number): Promise<ForgejoTrackedTime> {
    return this.rawRequest<ForgejoTrackedTime>('POST', `${repoIssuePath(owner, repo, number)}/times`, { time: seconds });
  }

  async createIssue(owner: string, repo: string, title: string, body?: string, options?: CreateIssueOptions): Promise<Issue> {
    const payload: Record<string, unknown> = {
      title,
      ...(body ? { body } : {}),
      ...(options?.labels?.length ? { labels: options.labels } : {}),
      ...(options?.assignees?.length ? { assignees: options.assignees } : {}),
      ...(options?.milestone !== undefined ? { milestone: options.milestone } : {}),
      ...(options?.due_date ? { due_date: options.due_date } : {})
    };

    return this.rawRequest<Issue>('POST', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`, payload);
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

  async getAuthenticatedUserLogin(): Promise<string | null> {
    const user = await this.rawRequest<ForgejoUserResponse>('GET', '/user');
    return trimmedValue(user.login) ?? trimmedValue(user.username) ?? null;
  }

  private async searchPullRequestsByIssueFiltersPage(
    owner: string,
    repo: string,
    state: 'open' | 'closed' | 'all',
    page: number,
    limit: number,
    options: ForgejoItemQueryOptions
  ): Promise<PullRequestPage> {
    const params = new URLSearchParams({
      state,
      type: 'pulls'
    });
    appendQueryParam(params, 'q', options.query);
    appendQueryParam(params, 'created_by', options.createdBy);
    appendQueryParam(params, 'assigned_by', options.assignedBy);
    appendQueryParam(params, 'mentioned_by', options.mentionedBy);
    params.set('page', String(page));
    params.set('limit', String(limit));

    const matches = await this.rawRequest<IssueListItem[]>('GET', `/repos/${owner}/${repo}/issues?${params.toString()}`);
    const pullRequestNumbers = matches
      .filter(item => item.pull_request)
      .map(item => item.number);
    const items = await mapInBatches(
      pullRequestNumbers,
      PULL_REQUEST_DETAIL_BATCH_SIZE,
      number => this.getPullRequest(owner, repo, number)
    );

    return {
      items,
      page,
      limit,
      hasMore: matches.length === limit
    };
  }

  private async searchReviewRequestedPullRequestsPage(
    owner: string,
    repo: string,
    state: 'open' | 'closed' | 'all',
    page: number,
    limit: number,
    options: ForgejoItemQueryOptions
  ): Promise<PullRequestPage> {
    const params = new URLSearchParams({
      state,
      type: 'pulls'
    });
    appendQueryParam(params, 'q', options.query);
    params.set('review_requested', 'true');
    params.set('owner', owner);
    params.set('page', String(page));
    params.set('limit', String(limit));

    const matches = await this.rawRequest<ForgejoIssueSearchItem[]>('GET', `/repos/issues/search?${params.toString()}`);
    const pullRequestNumbers = matches
      .filter(item => item.pull_request && issueSearchItemMatchesRepository(item, owner, repo))
      .map(item => item.number);
    const items = await mapInBatches(
      pullRequestNumbers,
      PULL_REQUEST_DETAIL_BATCH_SIZE,
      number => this.getPullRequest(owner, repo, number)
    );

    return {
      items,
      page,
      limit,
      hasMore: matches.length === limit
    };
  }
}
