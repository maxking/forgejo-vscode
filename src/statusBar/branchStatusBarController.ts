import * as vscode from 'vscode';
import type { Repository } from '../types/git';
import type { CommitStatus, PullRequestListItem } from '../models/pullRequest';
import { ForgejoClient } from '../api/forgejoClient';
import { ForgejoConfig, getForgejoConfig } from '../utils/config';
import { getActiveGitRepository, getGitApi } from '../utils/gitUtils';
import { deduplicateCommitStatuses, aggregateCIStatus, selectRepresentativeCommitStatus } from '../utils/commitStatus';
import {
  BranchStatusViewState,
  PullRequestListItemWithHead,
  findPullRequestForBranch,
  mapBranchStatusToPresentation
} from './branchStatusMapping';
import { executeCommand } from '../commands/registry';

const REFRESH_DEBOUNCE_MS = 250;
const CACHE_TTL_MS = 30_000;
const PR_PAGE_LIMIT = 50;
const CI_STATUS_LIMIT = 30;

interface CacheEntry {
  timestamp: number;
  pr?: PullRequestListItemWithHead;
  ciStatuses: CommitStatus[];
}

/**
 * Owns the "current branch's Forgejo status" status bar item: the linked
 * open pull request (if any), its aggregated CI status, and click actions
 * to open the PR, drill into CI details, or create a PR for the branch.
 *
 * Design constraints (see issue #189 acceptance criteria):
 * - `activate()` schedules exactly one debounced, gated, cached initial
 *   refresh so the item populates without waiting for a user action --
 *   it does not fetch synchronously, and every later refresh (active editor
 *   change, Git repository open/close, branch checkout, or a `forgejo.*`
 *   config change) goes through that same debounce + per-branch cache, so
 *   there is exactly one bounded request path, never a fan-out or a poll.
 * - Resolves the *active* repository (via `getActiveGitRepository`, which
 *   prefers the repo owning the active editor over `workspaceFolders[0]`),
 *   so multi-root workspaces reflect whichever repository the user is
 *   actually working in.
 * - A short TTL cache keyed by instance/owner/repo/branch avoids re-fetching
 *   on every debounce-triggered refresh while the user stays on one branch.
 */
export class BranchStatusBarController implements vscode.Disposable {
  private readonly statusBarItem: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];
  private repositorySubscription: vscode.Disposable | undefined;
  private activeRepository: Repository | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly cache = new Map<string, CacheEntry>();

  /**
   * Monotonically increasing token identifying the latest refresh. Each
   * `refresh()` claims the next value up-front; any result that resolves after
   * a newer refresh has started finds its token stale and bails out instead of
   * overwriting the status bar with data for a branch/repo the user has left.
   */
  private refreshSequence = 0;

  private currentState: BranchStatusViewState = { kind: 'no-repo' };
  private currentConfig: ForgejoConfig | undefined;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.statusBarItem.hide();
  }

  /**
   * Registers listeners and pushes this controller into `context.subscriptions`,
   * then schedules one debounced initial refresh so the item populates without
   * waiting for a user action. This does not fetch synchronously: the refresh
   * still goes through the same ~250ms debounce, gating (disabled/no-repo/
   * no-config all bail out before any network call), and TTL cache as every
   * other trigger, so activation never causes an unbounded or unconditional
   * network request -- just this one bounded, cached refresh.
   */
  activate(context: vscode.ExtensionContext): void {
    this.disposables.push(
      this.statusBarItem,
      vscode.window.onDidChangeActiveTextEditor(() => this.scheduleRefresh()),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('forgejo')) {
          this.scheduleRefresh();
        }
      })
    );

    const git = getGitApi();
    if (git) {
      this.disposables.push(
        git.onDidOpenRepository(() => this.scheduleRefresh()),
        git.onDidCloseRepository(() => this.scheduleRefresh())
      );
    }

    context.subscriptions.push(this);
    this.scheduleRefresh();
  }

  dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    this.repositorySubscription?.dispose();
    this.repositorySubscription = undefined;
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
    this.cache.clear();
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh();
    }, REFRESH_DEBOUNCE_MS);
  }

  private isEnabled(): boolean {
    return vscode.workspace.getConfiguration('forgejo').get<boolean>('statusBar.enabled', true);
  }

  private syncRepositorySubscription(repository: Repository | null): void {
    if (repository === (this.activeRepository ?? null)) {
      return;
    }
    this.repositorySubscription?.dispose();
    this.repositorySubscription = undefined;
    this.activeRepository = repository ?? undefined;
    if (repository) {
      this.repositorySubscription = repository.state.onDidChange(() => this.scheduleRefresh());
    }
  }

  private setState(state: BranchStatusViewState, config?: ForgejoConfig): void {
    this.currentState = state;
    this.currentConfig = config;

    const presentation = mapBranchStatusToPresentation(state);
    if (!presentation.text) {
      this.statusBarItem.hide();
      return;
    }
    this.statusBarItem.text = presentation.text;
    this.statusBarItem.tooltip = presentation.tooltip;
    this.statusBarItem.command = presentation.command;
    this.statusBarItem.show();
  }

  /**
   * Recompute and apply the status bar presentation for the active repository.
   * Exposed (not just private) so tests and the debounce timer share one path.
   */
  async refresh(): Promise<void> {
    const seq = ++this.refreshSequence;

    if (!this.isEnabled()) {
      this.setState({ kind: 'disabled' });
      return;
    }

    const repository = getActiveGitRepository();
    this.syncRepositorySubscription(repository);

    if (!repository) {
      this.setState({ kind: 'no-repo' });
      return;
    }

    const branchName = repository.state.HEAD?.name;
    if (!branchName) {
      this.setState({ kind: 'no-repo' });
      return;
    }

    const config = await getForgejoConfig(repository.rootUri);
    if (seq !== this.refreshSequence) {
      return;
    }
    if (!config) {
      this.setState({ kind: 'no-config' });
      return;
    }

    const cacheKey = `${config.instanceUrl}|${config.owner}|${config.repo}|${branchName}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      this.applyResolvedData(branchName, cached, config);
      return;
    }

    this.setState({ kind: 'loading', branchName }, config);

    try {
      const client = new ForgejoClient(config.instanceUrl, config.token);
      const prPage = await client.getPullRequestsPage(config.owner, config.repo, 'open', 1, PR_PAGE_LIMIT);
      const pr = findPullRequestForBranch(
        prPage.items as PullRequestListItemWithHead[],
        branchName,
        `${config.owner}/${config.repo}`
      );

      let ciStatuses: CommitStatus[] = [];
      if (pr) {
        const statusPage = await client.getCommitStatusesPage(config.owner, config.repo, pr.head.sha, {
          page: 1,
          limit: CI_STATUS_LIMIT
        });
        ciStatuses = deduplicateCommitStatuses(statusPage.items);
      }

      const entry: CacheEntry = { timestamp: Date.now(), pr, ciStatuses };
      this.cache.set(cacheKey, entry);
      if (seq !== this.refreshSequence) {
        return;
      }
      this.applyResolvedData(branchName, entry, config);
    } catch (error) {
      console.error('[Forgejo] Status bar: failed to refresh branch status:', error);
      if (seq !== this.refreshSequence) {
        return;
      }
      this.setState(
        {
          kind: 'error',
          branchName,
          message: error instanceof Error ? error.message : 'Unknown error'
        },
        config
      );
    }
  }

  private applyResolvedData(branchName: string, entry: CacheEntry, config: ForgejoConfig): void {
    if (!entry.pr) {
      this.setState({ kind: 'no-pr', branchName }, config);
      return;
    }
    this.setState(
      {
        kind: 'has-pr',
        branchName,
        pr: entry.pr,
        ciStatuses: entry.ciStatuses,
        ciStatus: aggregateCIStatus(entry.ciStatuses)
      },
      config
    );
  }

  /**
   * Handler for the `forgejo.statusBar.action` command (the status bar item's
   * click target). Acts on the already-resolved state -- never triggers a
   * new network fetch.
   */
  async handleClick(): Promise<void> {
    const state = this.currentState;
    const config = this.currentConfig;

    if (state.kind === 'no-pr') {
      await executeCommand('forgejo.createPullRequest');
      return;
    }

    if (state.kind !== 'has-pr' || !config) {
      return;
    }

    const prArg: PullRequestListItem = state.pr;

    if (state.ciStatuses.length === 0) {
      await executeCommand('forgejo.showPrDetails', prArg, config.owner, config.repo, config.instanceUrl);
      return;
    }

    const picked = await vscode.window.showQuickPick(
      [
        { label: '$(git-pull-request) Open Pull Request Details', action: 'pr' as const },
        { label: '$(checklist) Open CI Details', action: 'ci' as const }
      ],
      { title: `Forgejo: PR #${state.pr.number}` }
    );

    if (!picked) {
      return;
    }

    if (picked.action === 'pr') {
      await executeCommand('forgejo.showPrDetails', prArg, config.owner, config.repo, config.instanceUrl);
      return;
    }

    const representative = selectRepresentativeCommitStatus(state.ciStatuses);
    if (representative) {
      await executeCommand('forgejo.viewCIStatusLogs', representative, config.owner, config.repo, config.instanceUrl);
    }
  }
}
