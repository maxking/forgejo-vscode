import * as vscode from 'vscode';
import { ForgejoClient } from '../../api/forgejoClient';
import { getForgejoConfigFor } from '../../utils/config';
import { PullRequest, CommitStatus } from '../../models/pullRequest';
import { executeCommand } from '../../commands/registry';
import { openWorkflowFileForCIStatus, viewCIStatusLogs } from '../../commands/ciNavigation';
import { logDebug, logInfo, logError } from '../../utils/logger';
import { getTimelineEventName, type TimelineActivity } from '../shared/helpers';
import { activateGitExtension } from '../../utils/gitExtension';
import { repositoryMatchesConfig } from '../../utils/gitRepositoryMatch';
import type { Repository } from '../../types/git';
import { execFile } from 'child_process';

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'checkout' }
  | { type: 'refresh' }
  | { type: 'merge'; strategy: string }
  | { type: 'revert'; commitSha: string }
  | { type: 'addComment'; body: string }
  | { type: 'addReview'; state: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'; body: string }
  | { type: 'openInBrowser' }
  | { type: 'viewCommit'; sha: string }
  | { type: 'viewFile'; filename: string }
  | { type: 'updateBody'; body: string }
  | { type: 'openCIStatus'; url: string }
  | { type: 'viewCIStatusLogs'; status: CommitStatus }
  | { type: 'openCIWorkflowFile'; status: CommitStatus };

export type ExtensionMessage =
  | { type: 'update'; data: PRDetailViewData }
  | { type: 'loading'; show: boolean }
  | { type: 'error'; message: string }
  | { type: 'theme'; theme: 'light' | 'dark' | 'high-contrast' }
  | { type: 'actionComplete'; action: string; success: boolean }
  | { type: 'bodyUpdated'; body: string };

export interface PRActivity {
  type: 'comment' | 'review' | 'commit' | 'timeline';
  id?: number;
  created_at?: string;
  submitted_at?: string;
  committed_at?: string;
  user?: {
    login: string;
    avatar_url?: string;
  };
  body?: string;
  state?: string;
  sha?: string;
  message?: string;
  event?: string;
  commit_id?: string;
  commit_sha?: string;
  commit_url?: string;
  commit_message?: string;
  ref?: string;
  branch?: string;
  old_ref?: string;
  new_ref?: string;
  old_branch?: string;
  new_branch?: string;
  html_url?: string;
}

type PRTimelineApiActivity = Omit<PRActivity, 'type' | 'event'> & TimelineActivity;

interface PRCommitApiActivity {
  id?: number;
  sha?: string;
  message?: string;
  committed_at?: string;
  created_at?: string;
  html_url?: string;
  url?: string;
  user?: {
    login?: string;
    avatar_url?: string;
  } | null;
  author?: {
    login?: string;
    avatar_url?: string;
  } | null;
  committer?: {
    login?: string;
    avatar_url?: string;
  } | null;
  commit?: {
    message?: string;
    author?: {
      name?: string;
      email?: string;
      date?: string;
    } | null;
  } | null;
}

function normalizeCommitActivity(commit: PRCommitApiActivity): PRActivity {
  const author = commit.author ?? commit.user ?? commit.committer;
  const fallbackAuthor = commit.commit?.author;
  const login = author?.login ?? fallbackAuthor?.name ?? fallbackAuthor?.email;
  const message = commit.commit?.message ?? commit.message;

  return {
    type: 'commit',
    id: commit.id,
    sha: commit.sha,
    message: message?.split('\n')[0] ?? commit.message,
    committed_at: commit.commit?.author?.date ?? commit.committed_at ?? commit.created_at,
    user: login
      ? {
          login,
          avatar_url: author?.avatar_url
        }
      : undefined,
    html_url: commit.html_url ?? commit.url
  };
}

export interface PRDetailViewData {
  pr: PullRequest;
  activities: PRActivity[];
  statuses: CommitStatus[];
  owner: string;
  repo: string;
  instanceUrl?: string;
  historyTruncated: boolean;
}

interface PanelState {
  panel: vscode.WebviewPanel;
  owner: string;
  repo: string;
  number: number;
  instanceUrl?: string;
  isReady: boolean;
  pendingData?: PRDetailViewData | null;
  pendingError?: string | null;
  requestVersion?: number;
}

export class PRDetailWebviewProvider {
  public static readonly viewType = 'forgejo.prDetail';
  private _panels = new Map<string, PanelState>();

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public async showPRDetails(owner: string, repo: string, number: number, instanceUrl?: string): Promise<void> {
    logInfo('Showing PR details in webview:', { owner, repo, number, instanceUrl });

    const panelKey = `${instanceUrl ?? ''}/${owner}/${repo}/${String(number)}`;

    if (this._panels.has(panelKey)) {
      const state = this._panels.get(panelKey);
      if (state) {
        state.panel.reveal(vscode.ViewColumn.One);
        await this._loadPRData(panelKey);
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      PRDetailWebviewProvider.viewType,
      `PR #${String(number)}: ${owner}/${repo}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this._extensionUri]
      }
    );

    const state: PanelState = {
      panel,
      owner,
      repo,
      number,
      instanceUrl,
      isReady: false,
      pendingData: null,
      pendingError: null,
      requestVersion: 0
    };
    this._panels.set(panelKey, state);

    panel.webview.html = this._getHtmlForWebview(panel.webview);

    panel.webview.onDidReceiveMessage(
      (message: unknown) => {
        void this._handleMessage(message as WebviewMessage, panelKey);
      },
      undefined,
      []
    );

    panel.onDidDispose(() => {
      logInfo('Webview panel disposed:', panelKey);
      this._panels.delete(panelKey);
    }, undefined, []);

    void this._fetchPRData(panelKey);
  }

  private async _fetchPRData(panelKey: string): Promise<void> {
    const state = this._panels.get(panelKey);
    if (!state) return;

    const { panel, owner, repo, number } = state;
    const requestVersion = state.requestVersion = (state.requestVersion ?? 0) + 1;
    logInfo('_fetchPRData starting:', { panelKey, isReady: state.isReady });

    try {
      const config = await this._getConfig(owner, repo, state.instanceUrl);

      const client = new ForgejoClient(config.instanceUrl, config.token);
      logInfo('Fetching PR details from API...');
      const prDetails = await client.getPullRequestDetails(owner, repo, number);
      logInfo('PR details fetched:', { title: prDetails.title });
      const pageClient = client as Partial<ForgejoClient>;

      const [activityResult, statusPage] = await Promise.all([
        this._fetchActivities(client, owner, repo, number),
        prDetails.head.sha && typeof pageClient.getCommitStatusesPage === 'function'
          ? pageClient.getCommitStatusesPage.call(client, owner, repo, prDetails.head.sha, { page: 1, limit: 50 })
          : prDetails.head.sha
          ? client.getCommitStatuses(owner, repo, prDetails.head.sha).then(items => ({ items, hasMore: false }))
          : Promise.resolve({ items: [], hasMore: false })
      ]);
      const activities = activityResult.items;
      const allStatuses = statusPage.items;

      // Deduplicate statuses by context, keeping only the latest per context.
      // The API returns all historical statuses (pending + final) for a SHA.
      // Each status update creates a new record with a new created_at timestamp.
      const latestByContext = new Map<string, typeof allStatuses[0]>();
      for (const status of allStatuses) {
        const key = status.context;
        const statusDate = new Date(status.created_at).getTime();
        if (isNaN(statusDate)) continue;
        const existing = latestByContext.get(key);
        const existingDate = existing ? new Date(existing.created_at).getTime() : -Infinity;
        if (statusDate > existingDate) {
          latestByContext.set(key, status);
        }
      }
      const statuses = Array.from(latestByContext.values());
      if (requestVersion !== state.requestVersion) return;
      logInfo('Activities and statuses fetched:', { activities: activities.length, statuses: statuses.length, raw: allStatuses.length });

      state.pendingData = { pr: prDetails, activities, statuses, owner, repo, instanceUrl: state.instanceUrl, historyTruncated: activityResult.truncated || statusPage.hasMore };
      state.pendingError = null;
      logInfo('pendingData set, isReady:', state.isReady);

      if (state.isReady) {
        logInfo('Webview is ready, sending data...');
        this._sendDataToPanel(panelKey);
      } else {
        logInfo('Webview not ready yet, data will be sent when ready');
      }
    } catch (error) {
      if (requestVersion !== state.requestVersion) return;
      logError('Failed to fetch PR data:', error);
      const message = error instanceof Error ? error.message : 'Failed to load PR details';
      if (state.isReady) {
        void panel.webview.postMessage({
          type: 'error',
          message
        });
      } else {
        state.pendingError = message;
      }
    }
  }

  private _sendDataToPanel(panelKey: string): void {
    const state = this._panels.get(panelKey);
    if (!state?.pendingData) {
      logInfo('_sendDataToPanel: no state or pendingData');
      return;
    }

    const { panel } = state;
    logInfo('Posting messages to webview:', { prTitle: state.pendingData.pr.title });
    void panel.webview.postMessage({ type: 'theme', theme: this._getThemeName(vscode.window.activeColorTheme.kind) });
    void panel.webview.postMessage({ type: 'loading', show: true });
    void panel.webview.postMessage({ type: 'update', data: state.pendingData });
    void panel.webview.postMessage({ type: 'loading', show: false });
    logInfo('All messages posted to webview');
  }

  private async _loadPRData(panelKey: string): Promise<void> {
    await this._fetchPRData(panelKey);
  }

  private async _getConfig(owner: string, repo: string, instanceUrl?: string) {
    const config = await getForgejoConfigFor(owner, repo, instanceUrl);
    if (!config) {
      throw new Error('Forgejo configuration not found');
    }
    return config;
  }

  private async _fetchActivities(client: ForgejoClient, owner: string, repo: string, number: number): Promise<{ items: PRActivity[]; truncated: boolean }> {
    const activities: PRActivity[] = [];
    const pageClient = client as Partial<ForgejoClient>;
    const firstPage = async <T>(paged: (() => Promise<{ items: T[]; hasMore: boolean }>) | undefined, legacy: () => Promise<T[]>): Promise<{ items: T[]; hasMore: boolean }> =>
      typeof paged === 'function' ? paged() : legacy().then(items => ({ items, hasMore: false }));
    const [comments, reviews, commits, timeline] = await Promise.all([
      firstPage(pageClient.getIssueCommentsPage?.bind(client, owner, repo, number, { page: 1, limit: 50 }), () => client.getIssueComments(owner, repo, number)).catch(e => { logDebug('Could not fetch comments:', e); return { items: [], hasMore: false }; }),
      firstPage(pageClient.getPullRequestReviewsPage?.bind(client, owner, repo, number, { page: 1, limit: 50 }), () => client.getPullRequestReviews(owner, repo, number)).catch(e => { logDebug('Could not fetch reviews:', e); return { items: [], hasMore: false }; }),
      firstPage(pageClient.getPullRequestCommitsPage?.bind(client, owner, repo, number, { page: 1, limit: 50 }), () => client.getPullRequestCommits(owner, repo, number)).catch(e => { logDebug('Could not fetch commits:', e); return { items: [], hasMore: false }; }),
      firstPage(pageClient.getIssueTimelinePage?.bind(client, owner, repo, number, { page: 1, limit: 50 }), () => client.getIssueTimeline(owner, repo, number)).catch(e => { logDebug('Could not fetch timeline:', e); return { items: [], hasMore: false }; })
    ]);
      activities.push(...(comments.items as PRActivity[]).map((c) => ({ ...c, type: 'comment' as const })));
      activities.push(...(reviews.items as PRActivity[]).map((r) => ({ ...r, type: 'review' as const })));
      activities.push(...(commits.items as PRCommitApiActivity[]).map(normalizeCommitActivity));
      activities.push(...(timeline.items as PRTimelineApiActivity[]).flatMap((t): PRActivity[] => {
        const event = getTimelineEventName(t);
        if (!event || event === 'comment' || event === 'commented') {
          return [];
        }
        return [{ ...t, event, type: 'timeline' as const }];
      }));
    const items = activities.sort((a, b) => {
      const dateA = new Date(a.created_at ?? a.submitted_at ?? a.committed_at ?? 0);
      const dateB = new Date(b.created_at ?? b.submitted_at ?? b.committed_at ?? 0);
      return dateB.getTime() - dateA.getTime();
    });
    return { items, truncated: comments.hasMore || reviews.hasMore || commits.hasMore || timeline.hasMore };
  }

  private async _handleMessage(message: WebviewMessage, panelKey: string): Promise<void> {
    logDebug('Received message from webview:', message.type);
    const state = this._panels.get(panelKey);
    if (!state) return;

    const { panel, owner, repo, number, instanceUrl } = state;

    switch (message.type) {
      case 'ready':
        logInfo('Webview ready message received, pendingData exists:', !!state.pendingData);
        state.isReady = true;
        if (state.pendingError) {
          void panel.webview.postMessage({ type: 'error', message: state.pendingError });
          state.pendingError = null;
        } else if (state.pendingData) {
          logInfo('Sending pending data to webview...');
          this._sendDataToPanel(panelKey);
        } else {
          logInfo('No pending data yet, showing loading state');
          void panel.webview.postMessage({ type: 'loading', show: true });
        }
        break;
      case 'checkout': await this._checkoutBranch(owner, repo, number, instanceUrl); break;
      case 'refresh': await this._fetchPRData(panelKey); break;
      case 'merge': await this._mergePR(owner, repo, number, message.strategy, panelKey, instanceUrl); break;
      case 'revert': await this._revertCommit(message.commitSha, owner, repo, instanceUrl); break;
      case 'addComment': await this._addComment(owner, repo, number, message.body, panelKey, instanceUrl); break;
      case 'addReview': await this._addReview(owner, repo, number, message.state, message.body, panelKey, instanceUrl); break;
      case 'openInBrowser': await this._openInBrowser(owner, repo, number, instanceUrl); break;
      case 'updateBody': await this._updateBody(owner, repo, number, message.body, panelKey, instanceUrl); break;
      case 'openCIStatus':
        if (message.url) {
          await this._openCIStatus(message.url, owner, repo, instanceUrl);
        }
        break;
      case 'viewCIStatusLogs':
        await viewCIStatusLogs({ status: message.status, owner, repo, instanceUrl });
        break;
      case 'openCIWorkflowFile':
        await openWorkflowFileForCIStatus({ status: message.status, owner, repo, instanceUrl });
        break;
      case 'viewCommit': break;
      case 'viewFile': break;
    }
  }

  private async _openCIStatus(url: string, owner: string, repo: string, instanceUrl?: string): Promise<void> {
    // Check if this is a Forgejo Actions URL (e.g., /owner/repo/actions/runs/283/jobs/1)
    // These URLs are relative paths from the Forgejo instance
    const actionsMatch = url.match(/\/[^/]+\/[^/]+\/actions\/runs\/(\d+)(?:\/jobs\/(\d+))?/);
    if (actionsMatch) {
      const runNumber = parseInt(actionsMatch[1], 10);
      try {
        const config = await this._getConfig(owner, repo, instanceUrl);

        const client = new ForgejoClient(config.instanceUrl, config.token);
        const locatedRun = await client.getWorkflowRunByNumber(owner, repo, runNumber);
        if (!locatedRun) throw new Error(`Workflow run #${String(runNumber)} was not found`);
        const matchingRun = await client.getWorkflowRunDetails(owner, repo, locatedRun.id);
        await executeCommand('forgejo.showActionDetails', matchingRun, owner, repo, instanceUrl);
        return;
      } catch (error) {
        logError('Failed to open CI status in extension:', error);
      }
    }

    // Fallback: open in browser, fixing relative URLs
    try {
      let fullUrl = url;
      if (url.startsWith('/')) {
        const config = await getForgejoConfigFor(owner, repo, instanceUrl);
        if (config?.instanceUrl) {
          fullUrl = `${config.instanceUrl}${url}`;
        }
      }
      void vscode.env.openExternal(vscode.Uri.parse(fullUrl));
    } catch (error) {
      logError('Failed to open CI status URL:', error);
    }
  }

  private async _checkoutBranch(owner: string, repo: string, number: number, instanceUrl?: string): Promise<void> {
    try {
      const config = await this._getConfig(owner, repo, instanceUrl);
      const client = new ForgejoClient(config.instanceUrl, config.token);
      const details = await client.getPullRequestDetails(owner, repo, number);
      const repository = await this._selectLocalRepository(owner, repo, config.instanceUrl, 'Checkout Pull Request');
      if (!repository) return;
      if (repository.state.remotes.length === 0) throw new Error('The selected repository has no Git remote');
      const remote = repository.state.remotes.find(candidate => candidate.name === 'origin')
        ?? repository.state.remotes[0];
      await repository.fetch(remote.name, `refs/pull/${String(number)}/head`);
      const localBranch = `forgejo-pr-${String(number)}-${details.head.sha.slice(0, 8)}`;
      try { await repository.checkout(localBranch); }
      catch { await repository.createBranch(localBranch, true, 'FETCH_HEAD'); }
      void vscode.window.showInformationMessage(`Checked out branch: ${localBranch}`);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to checkout: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _mergePR(owner: string, repo: string, number: number, strategy: string, panelKey?: string, instanceUrl?: string): Promise<void> {
    const panelState = panelKey ? this._panels.get(panelKey) : undefined;
    try {
      const config = await this._getConfig(owner, repo, instanceUrl);
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.mergePullRequest(owner, repo, number, strategy as 'merge' | 'squash' | 'rebase' | 'rebase-merge' | 'fast-forward-only', false);
      void vscode.window.showInformationMessage('Pull request merged successfully');
      if (panelState) {
        void panelState.panel.webview.postMessage({ type: 'actionComplete', action: 'merge', success: true });
      }
      if (panelKey) await this._fetchPRData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to merge: ${error instanceof Error ? error.message : 'Unknown error'}`);
      if (panelState) {
        void panelState.panel.webview.postMessage({ type: 'actionComplete', action: 'merge', success: false });
      }
    }
  }

  private async _revertCommit(commitSha: string, owner: string, repo: string, instanceUrl?: string): Promise<void> {
    if (!/^[0-9a-f]{7,64}$/i.test(commitSha)) {
      void vscode.window.showErrorMessage('Cannot revert an invalid commit identifier.');
      return;
    }
    try {
      const config = await this._getConfig(owner, repo, instanceUrl);
      const repository = await this._selectLocalRepository(owner, repo, config.instanceUrl, 'Revert Pull Request');
      if (!repository) return;
      await new Promise<void>((resolve, reject) => {
        execFile('git', ['revert', commitSha], { cwd: repository.rootUri.fsPath }, error => {
          if (error) reject(error instanceof Error ? error : new Error(String(error)));
          else resolve();
        });
      });
      void vscode.window.showInformationMessage(`Reverted commit ${commitSha.slice(0, 8)}`);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to revert: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _selectLocalRepository(owner: string, repo: string, instanceUrl: string, title: string): Promise<Repository | undefined> {
    const gitExtension = await activateGitExtension();
    if (!gitExtension?.enabled) {
      throw new Error('The VS Code Git extension is unavailable');
    }
    const matches = gitExtension.getAPI(1).repositories.filter(repository =>
      repositoryMatchesConfig(repository, owner, repo, instanceUrl)
    );
    if (matches.length === 1) return matches[0];
    if (matches.length === 0) {
      throw new Error(`No local checkout matches ${owner}/${repo}`);
    }
    const picked = await vscode.window.showQuickPick(matches.map(repository => ({
      label: repository.rootUri.fsPath.split('/').pop() ?? repo,
      description: repository.rootUri.fsPath,
      repository
    })), { title, placeHolder: 'Select the local checkout' });
    return picked?.repository;
  }

  private async _addComment(owner: string, repo: string, number: number, body: string, panelKey?: string, instanceUrl?: string): Promise<void> {
    const panelState = panelKey ? this._panels.get(panelKey) : undefined;
    try {
      const config = await this._getConfig(owner, repo, instanceUrl);
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.createComment(owner, repo, number, body);
      void vscode.window.showInformationMessage('Comment added');
      if (panelState) {
        void panelState.panel.webview.postMessage({ type: 'actionComplete', action: 'addComment', success: true });
      }
      if (panelKey) await this._fetchPRData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to add comment: ${error instanceof Error ? error.message : 'Unknown error'}`);
      if (panelState) {
        void panelState.panel.webview.postMessage({ type: 'actionComplete', action: 'addComment', success: false });
      }
    }
  }

  private async _addReview(owner: string, repo: string, number: number, reviewState: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT', body: string, panelKey?: string, instanceUrl?: string): Promise<void> {
    const panelState = panelKey ? this._panels.get(panelKey) : undefined;
    try {
      const config = await this._getConfig(owner, repo, instanceUrl);
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.createReview(owner, repo, number, reviewState, body);
      void vscode.window.showInformationMessage(`Review ${reviewState.toLowerCase().replace(/_/g, ' ')}`);
      if (panelState) {
        void panelState.panel.webview.postMessage({ type: 'actionComplete', action: 'addReview', success: true });
      }
      if (panelKey) await this._fetchPRData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to add review: ${error instanceof Error ? error.message : 'Unknown error'}`);
      if (panelState) {
        void panelState.panel.webview.postMessage({ type: 'actionComplete', action: 'addReview', success: false });
      }
    }
  }

  private async _updateBody(owner: string, repo: string, number: number, body: string, panelKey?: string, instanceUrl?: string): Promise<void> {
    const panelState = panelKey ? this._panels.get(panelKey) : undefined;
    try {
      const config = await this._getConfig(owner, repo, instanceUrl);
      const client = new ForgejoClient(config.instanceUrl, config.token);
      const updatedPR = await client.updatePullRequestBody(owner, repo, number, body);
      logInfo('PR body updated:', { owner, repo, number });
      if (panelState) {
        void panelState.panel.webview.postMessage({ type: 'bodyUpdated', body: updatedPR.body });
        void panelState.panel.webview.postMessage({ type: 'actionComplete', action: 'updateBody', success: true });
      }
      if (panelState?.pendingData) {
        panelState.pendingData.pr.body = updatedPR.body;
      }
    } catch (error) {
      logError('Failed to update PR body:', error);
      void vscode.window.showErrorMessage(`Failed to update description: ${error instanceof Error ? error.message : 'Unknown error'}`);
      if (panelState) {
        void panelState.panel.webview.postMessage({ type: 'actionComplete', action: 'updateBody', success: false });
      }
    }
  }

  private async _openInBrowser(owner: string, repo: string, number: number, instanceUrl?: string): Promise<void> {
    try {
      const config = await this._getConfig(owner, repo, instanceUrl);
      const url = `${config.instanceUrl}/${owner}/${repo}/pulls/${String(number)}`;
      void vscode.env.openExternal(vscode.Uri.parse(url));
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to open: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private _getThemeName(kind: vscode.ColorThemeKind): 'light' | 'dark' | 'high-contrast' {
    switch (kind) {
      case vscode.ColorThemeKind.Light: return 'light';
      case vscode.ColorThemeKind.HighContrast: return 'high-contrast';
      case vscode.ColorThemeKind.HighContrastLight: return 'high-contrast';
      default: return 'dark';
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'prDetail', 'styles.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'prDetail', 'index.js'));

    const nonce = this._getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; img-src ${webview.cspSource} https:;">
  <title>PR Details</title>
  <link rel="stylesheet" href="${styleUri.toString()}">
</head>
<body>
  <div id="loading" class="loading">
    <div class="spinner"></div>
    <p>Loading pull request details...</p>
  </div>

  <div id="error" class="error" style="display: none;">
    <h3>Error</h3>
    <p id="error-message"></p>
    <button id="retry-btn" class="btn btn-primary">Retry</button>
  </div>

  <div id="content" style="display: none;">
    <header class="pr-header">
      <div class="pr-title-row">
        <h1 id="pr-title"></h1>
        <span id="pr-number"></span>
        <button id="copy-url-btn" class="icon-btn" title="Copy URL">📋</button>
      </div>

      <div class="pr-meta">
        <span id="pr-status-badge" class="status-badge"></span>
        <span id="pr-mergeability-badge" class="mergeability-badge" style="display: none;"></span>
        <span class="pr-author">
          by <img id="author-avatar" src="" alt="" class="avatar" style="display:none">
          <span id="author-name"></span>
        </span>
        <span class="pr-branch">
          <span id="base-branch"></span>
          <span class="branch-arrow">←</span>
          <span id="head-branch"></span>
        </span>
      </div>
    </header>

    <nav class="action-bar">
      <button id="checkout-btn" class="btn btn-primary">Checkout</button>
      <button id="refresh-btn" class="btn btn-secondary">Refresh</button>
      <button id="open-web-btn" class="btn btn-secondary">Open in Web</button>
      <button id="add-comment-btn" class="btn btn-secondary">+ Comment</button>
      <div id="merge-actions" class="merge-actions" style="display: none;">
        <button id="merge-btn" class="btn btn-success">Merge</button>
      </div>
      <div id="revert-actions" class="revert-actions" style="display: none;">
        <button id="revert-btn" class="btn btn-danger">Revert</button>
      </div>
    </nav>

    <section class="description-section">
      <div class="description-header">
        <h2>Description</h2>
        <button id="edit-description-btn" class="btn btn-secondary btn-small">Edit</button>
      </div>
      <div id="pr-description" class="markdown-body"></div>
      <div id="pr-description-editor" class="description-editor" style="display: none;">
        <textarea id="description-textarea" class="description-textarea"></textarea>
        <div class="description-editor-actions">
          <button id="save-description-btn" class="btn btn-primary btn-small">Save</button>
          <button id="cancel-description-btn" class="btn btn-secondary btn-small">Cancel</button>
        </div>
      </div>
    </section>

    <section id="ci-section" class="ci-section" style="display: none;">
      <h2>CI Status</h2>
      <div id="ci-status-list"></div>
    </section>

    <section class="activity-section">
      <h2>Activity <span id="activity-count"></span></h2>
      <div id="activity-timeline"></div>
    </section>

    <div id="comment-input-container" class="comment-input-container" style="display: none;">
      <textarea id="comment-input" placeholder="Write a comment..."></textarea>
      <div class="comment-actions">
        <button id="submit-comment-btn" class="btn btn-primary">Submit</button>
        <button id="cancel-comment-btn" class="btn btn-secondary">Cancel</button>
      </div>
    </div>

    <div id="review-dialog" class="review-dialog" style="display: none;">
      <h3>Submit Review</h3>
      <select id="review-state">
        <option value="COMMENT">Comment</option>
        <option value="APPROVE">Approve</option>
        <option value="REQUEST_CHANGES">Request Changes</option>
      </select>
      <textarea id="review-body" placeholder="Review comment..."></textarea>
      <div class="review-actions">
        <button id="submit-review-btn" class="btn btn-primary">Submit Review</button>
        <button id="cancel-review-btn" class="btn btn-secondary">Cancel</button>
      </div>
    </div>

    <div id="merge-dialog" class="merge-dialog" style="display: none;">
      <h3>Merge Pull Request</h3>
      <select id="merge-strategy">
        <option value="merge">Create a merge commit</option>
        <option value="squash">Squash and merge</option>
        <option value="rebase">Rebase and merge</option>
      </select>
      <div class="merge-actions">
        <button id="confirm-merge-btn" class="btn btn-success">Merge</button>
        <button id="cancel-merge-btn" class="btn btn-secondary">Cancel</button>
      </div>
    </div>
  </div>

  <script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
  }

  private _getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
