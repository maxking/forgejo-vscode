import * as vscode from 'vscode';
import { ForgejoClient, type ForgejoStopwatch, type ForgejoTrackedTime } from '../../api/forgejoClient';
import { getForgejoConfigFor } from '../../utils/config';
import { Issue } from '../../models/issue';
import { logDebug, logInfo, logError } from '../../utils/logger';
import { fetchNewestActivityPage, getTimelineEventName, type TimelineActivity } from '../shared/helpers';

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'addComment'; body: string }
  | { type: 'openInBrowser' }
  | { type: 'startWork' }
  | { type: 'closeIssue' }
  | { type: 'reopenIssue' }
  | { type: 'updateBody'; body: string }
  | { type: 'startTimer' }
  | { type: 'stopTimer' }
  | { type: 'cancelTimer' }
  | { type: 'addManualTime'; seconds: number }
  | { type: 'setActivitySortOrder'; order: ActivitySortOrder };

export type ExtensionMessage =
  | { type: 'update'; data: IssueDetailViewData }
  | { type: 'loading'; show: boolean }
  | { type: 'error'; message: string }
  | { type: 'theme'; theme: 'light' | 'dark' | 'high-contrast' }
  | { type: 'bodyUpdated'; body: string }
  | { type: 'actionComplete'; action: string; success: boolean };

export interface IssueActivity {
  type: 'comment' | 'timeline';
  id: number;
  created_at?: string;
  user?: {
    login: string;
    avatar_url?: string;
  };
  body?: string;
  event?: string;
  html_url?: string;
}

type IssueTimelineApiActivity = Omit<IssueActivity, 'type' | 'event'> & TimelineActivity;

export type ActivitySortOrder = 'newest-first' | 'oldest-first';

export interface IssueDetailViewData {
  issue: Issue;
  activities: IssueActivity[];
  activitySortOrder: ActivitySortOrder;
  timeTracking: IssueTimeTrackingViewData;
  owner: string;
  repo: string;
  canComment: boolean;
  instanceUrl?: string;
  historyTruncated: boolean;
  historyIsNewest: boolean;
}

export interface IssueTimeTrackingViewData {
  canTrack: boolean;
  totalSeconds: number;
  entries: ForgejoTrackedTime[];
  currentStopwatch?: ForgejoStopwatch;
  otherStopwatch?: ForgejoStopwatch;
  error?: string;
}

interface PanelState {
  panel: vscode.WebviewPanel;
  owner: string;
  repo: string;
  number: number;
  instanceUrl?: string;
  isReady: boolean;
  pendingData?: IssueDetailViewData | null;
  pendingError?: string | null;
  requestVersion?: number;
}

export class IssueDetailWebviewProvider {
  public static readonly viewType = 'forgejo.issueDetail';
  private _panels = new Map<string, PanelState>();

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public async showIssueDetails(owner: string, repo: string, number: number, instanceUrl?: string): Promise<void> {
    logInfo('Showing Issue details in webview:', { owner, repo, number, instanceUrl });

    const panelKey = `${instanceUrl ?? ''}/${owner}/${repo}/issue/${String(number)}`;

    if (this._panels.has(panelKey)) {
      const state = this._panels.get(panelKey);
      if (state) {
        state.panel.reveal(vscode.ViewColumn.One);
        await this._loadIssueData(panelKey);
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      IssueDetailWebviewProvider.viewType,
      `Issue #${String(number)}: ${owner}/${repo}`,
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

    void this._fetchIssueData(panelKey);
  }

  private async _fetchIssueData(panelKey: string): Promise<void> {
    const state = this._panels.get(panelKey);
    if (!state) return;

    const { panel, owner, repo, number, instanceUrl } = state;
    const requestVersion = state.requestVersion = (state.requestVersion ?? 0) + 1;
    logInfo('_fetchIssueData starting:', { panelKey, isReady: state.isReady });

    try {
      const config = await this._getConfig(owner, repo, instanceUrl);

      const client = new ForgejoClient(config.instanceUrl, config.token);
      logInfo('Fetching Issue details from API...');
      const issueDetails = await client.getIssueDetails(owner, repo, number);
      logInfo('Issue details fetched:', { title: issueDetails.title });

      const activityResult = await this._fetchActivities(client, owner, repo, number);
      const activities = activityResult.items;
      logInfo('Activities fetched:', { activities: activities.length });

      const timeTracking = await this._fetchTimeTracking(client, owner, repo, number, Boolean(config.token));
      if (requestVersion !== state.requestVersion) return;
      logInfo('Time tracking fetched:', {
        totalSeconds: timeTracking.totalSeconds,
        entries: timeTracking.entries.length,
        hasCurrentStopwatch: Boolean(timeTracking.currentStopwatch),
        hasOtherStopwatch: Boolean(timeTracking.otherStopwatch)
      });

      state.pendingData = {
        issue: issueDetails,
        activities,
        activitySortOrder: this._getActivitySortOrder(),
        timeTracking,
        owner,
        repo,
        canComment: config.token.trim().length > 0,
        instanceUrl: state.instanceUrl,
        historyTruncated: activityResult.truncated,
        historyIsNewest: activityResult.newest
      };
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
      logError('Failed to fetch Issue data:', error);
      const message = error instanceof Error ? error.message : 'Failed to load Issue details';
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
    logInfo('Posting messages to webview:', { issueTitle: state.pendingData.issue.title });
    void panel.webview.postMessage({ type: 'theme', theme: this._getThemeName(vscode.window.activeColorTheme.kind) });
    void panel.webview.postMessage({ type: 'loading', show: true });
    void panel.webview.postMessage({ type: 'update', data: state.pendingData });
    void panel.webview.postMessage({ type: 'loading', show: false });
    logInfo('All messages posted to webview');
  }

  private async _loadIssueData(panelKey: string): Promise<void> {
    await this._fetchIssueData(panelKey);
  }

  private async _fetchActivities(client: ForgejoClient, owner: string, repo: string, number: number): Promise<{ items: IssueActivity[]; truncated: boolean; newest: boolean }> {
    const activities: IssueActivity[] = [];
    const pageClient = client as Partial<ForgejoClient>;
    const commentsPage = pageClient.getIssueCommentsPage;
    const timelinePage = pageClient.getIssueTimelinePage;
    const [comments, timeline] = await Promise.all([
      fetchNewestActivityPage(commentsPage ? page => commentsPage.call(client, owner, repo, number, { page, limit: 50 }) : undefined, () => client.getIssueComments(owner, repo, number), item => String(item.id)).catch(e => { logDebug('Could not fetch comments:', e); return { items: [], truncated: false, newest: true }; }),
      fetchNewestActivityPage(timelinePage ? page => timelinePage.call(client, owner, repo, number, { page, limit: 50 }) : undefined, () => client.getIssueTimeline(owner, repo, number), item => String(item.id)).catch(e => { logDebug('Could not fetch timeline:', e); return { items: [], truncated: false, newest: true }; })
    ]);
      activities.push(...(comments.items as IssueActivity[]).map((c) => ({ ...c, type: 'comment' as const })));
      activities.push(...(timeline.items as IssueTimelineApiActivity[]).flatMap((t): IssueActivity[] => {
        const event = getTimelineEventName(t);
        if (!event || event === 'comment' || event === 'commented') {
          return [];
        }
        return [{ ...t, event, type: 'timeline' as const }];
      }));
    const items = activities.sort((a, b) => {
      const dateA = new Date(a.created_at ?? 0);
      const dateB = new Date(b.created_at ?? 0);
      return dateB.getTime() - dateA.getTime();
    });
    return { items, truncated: comments.truncated || timeline.truncated, newest: comments.newest && timeline.newest };
  }

  private async _fetchTimeTracking(
    client: ForgejoClient,
    owner: string,
    repo: string,
    number: number,
    canTrack: boolean
  ): Promise<IssueTimeTrackingViewData> {
    const entries: ForgejoTrackedTime[] = [];
    let currentStopwatch: ForgejoStopwatch | undefined;
    let otherStopwatch: ForgejoStopwatch | undefined;
    let error: string | undefined;

    try {
      const pageSize = 50;
      let reachedSafetyCap = false;
      for (let page = 1; page <= 4; page += 1) {
        const pageEntries = await client.getIssueTrackedTimes(owner, repo, number, page, pageSize);
        entries.push(...pageEntries);
        if (pageEntries.length < pageSize) break;
        if (page === 4) reachedSafetyCap = true;
      }
      entries.splice(0, entries.length, ...Array.from(new Map(entries.map(entry => [entry.id, entry])).values()));
      if (reachedSafetyCap) error = 'Tracked-time history exceeds 200 rows; the displayed total is incomplete.';
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not fetch tracked time';
      logDebug('Could not fetch tracked time:', e);
    }

    if (canTrack) {
      try {
        const stopwatches = await client.getUserStopwatches();
        currentStopwatch = stopwatches.find(stopwatch => this._isStopwatchForIssue(stopwatch, owner, repo, number));
        otherStopwatch = stopwatches.find(stopwatch => !this._isStopwatchForIssue(stopwatch, owner, repo, number));
      } catch (e) {
        logDebug('Could not fetch user stopwatches:', e);
      }
    }

    return {
      canTrack,
      entries,
      totalSeconds: entries.reduce((total, entry) => total + (Number.isFinite(entry.time) ? entry.time : 0), 0),
      ...(currentStopwatch ? { currentStopwatch } : {}),
      ...(otherStopwatch ? { otherStopwatch } : {}),
      ...(error ? { error } : {})
    };
  }

  private _isStopwatchForIssue(stopwatch: ForgejoStopwatch, owner: string, repo: string, number: number): boolean {
    return stopwatch.issue_index === number
      && stopwatch.repo_name.toLowerCase() === repo.toLowerCase()
      && stopwatch.repo_owner_name.toLowerCase() === owner.toLowerCase();
  }

  private async _handleMessage(message: WebviewMessage, panelKey: string): Promise<void> {
    logDebug('Received message from webview:', message.type);
    const state = this._panels.get(panelKey);
    if (!state) return;

    const { owner, repo, number, instanceUrl } = state;

    switch (message.type) {
      case 'ready':
        logInfo('Webview ready message received, pendingData exists:', !!state.pendingData);
        state.isReady = true;
        if (state.pendingError) {
          void state.panel.webview.postMessage({ type: 'error', message: state.pendingError });
          state.pendingError = null;
        } else if (state.pendingData) {
          logInfo('Sending pending data to webview...');
          this._sendDataToPanel(panelKey);
        } else {
          logInfo('No pending data yet, showing loading state');
          void state.panel.webview.postMessage({ type: 'loading', show: true });
        }
        break;
      case 'refresh': await this._fetchIssueData(panelKey); break;
      case 'addComment': await this._addComment(owner, repo, number, message.body, panelKey, instanceUrl); break;
      case 'openInBrowser': await this._openInBrowser(owner, repo, number, instanceUrl); break;
      case 'startWork': await this._startWorkOnIssue(panelKey); break;
      case 'closeIssue': await this._closeIssue(owner, repo, number, panelKey, instanceUrl); break;
      case 'reopenIssue': await this._reopenIssue(owner, repo, number, panelKey, instanceUrl); break;
      case 'updateBody': await this._updateBody(owner, repo, number, message.body, panelKey, instanceUrl); break;
      case 'startTimer': await this._startTimer(owner, repo, number, panelKey, instanceUrl); break;
      case 'stopTimer': await this._stopTimer(owner, repo, number, panelKey, instanceUrl); break;
      case 'cancelTimer': await this._cancelTimer(owner, repo, number, panelKey, instanceUrl); break;
      case 'addManualTime': await this._addManualTime(owner, repo, number, message.seconds, panelKey, instanceUrl); break;
      case 'setActivitySortOrder': await this._setActivitySortOrder(message.order); break;
    }
  }

  private _getActivitySortOrder(): ActivitySortOrder {
    const configured = vscode.workspace.getConfiguration('forgejo').get<ActivitySortOrder>('activityTimelineSortOrder', 'newest-first');
    return configured === 'oldest-first' ? 'oldest-first' : 'newest-first';
  }

  private async _setActivitySortOrder(order: ActivitySortOrder): Promise<void> {
    await vscode.workspace.getConfiguration('forgejo').update('activityTimelineSortOrder', order, vscode.ConfigurationTarget.Global);
  }

  private async _getConfig(owner: string, repo: string, instanceUrl?: string) {
    const config = await getForgejoConfigFor(owner, repo, instanceUrl);
    if (!config) {
      throw new Error('Forgejo configuration not found');
    }
    return config;
  }

  private async _addComment(owner: string, repo: string, number: number, body: string, panelKey?: string, instanceUrl?: string): Promise<void> {
    try {
      const config = await this._getConfig(owner, repo, instanceUrl);
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.createComment(owner, repo, number, body);
      void vscode.window.showInformationMessage('Comment added');
      if (panelKey) await this._fetchIssueData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to add comment: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _closeIssue(owner: string, repo: string, number: number, panelKey?: string, instanceUrl?: string): Promise<void> {
    try {
      const config = await this._getConfig(owner, repo, instanceUrl);
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.updateIssueState(owner, repo, number, 'closed');
      void vscode.window.showInformationMessage(`Issue #${String(number)} closed`);
      if (panelKey) await this._fetchIssueData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to close issue: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _reopenIssue(owner: string, repo: string, number: number, panelKey?: string, instanceUrl?: string): Promise<void> {
    try {
      const config = await this._getConfig(owner, repo, instanceUrl);
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.updateIssueState(owner, repo, number, 'open');
      void vscode.window.showInformationMessage(`Issue #${String(number)} reopened`);
      if (panelKey) await this._fetchIssueData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to reopen issue: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _updateBody(owner: string, repo: string, number: number, body: string, panelKey?: string, instanceUrl?: string): Promise<void> {
    const panelState = panelKey ? this._panels.get(panelKey) : undefined;
    try {
      const config = await this._getConfig(owner, repo, instanceUrl);
      const client = new ForgejoClient(config.instanceUrl, config.token);
      const updatedIssue = await client.updateIssueBody(owner, repo, number, body);
      logInfo('Issue body updated:', { owner, repo, number });
      if (panelState) {
        void panelState.panel.webview.postMessage({ type: 'bodyUpdated', body: updatedIssue.body });
        void panelState.panel.webview.postMessage({ type: 'actionComplete', action: 'updateBody', success: true });
      }
      if (panelState?.pendingData) {
        panelState.pendingData.issue.body = updatedIssue.body;
      }
    } catch (error) {
      logError('Failed to update issue body:', error);
      void vscode.window.showErrorMessage(`Failed to update description: ${error instanceof Error ? error.message : 'Unknown error'}`);
      if (panelState) {
        void panelState.panel.webview.postMessage({ type: 'actionComplete', action: 'updateBody', success: false });
      }
    }
  }

  private async _startTimer(owner: string, repo: string, number: number, panelKey: string, instanceUrl?: string): Promise<void> {
    await this._runTimeTrackingAction(
      panelKey,
      async (client) => client.startIssueStopwatch(owner, repo, number),
      {
        success: `Started timer for issue #${String(number)}`,
        failure: 'Failed to start timer'
      },
      instanceUrl
    );
  }

  private async _stopTimer(owner: string, repo: string, number: number, panelKey: string, instanceUrl?: string): Promise<void> {
    await this._runTimeTrackingAction(
      panelKey,
      async (client) => client.stopIssueStopwatch(owner, repo, number),
      {
        success: `Stopped timer for issue #${String(number)}`,
        failure: 'Failed to stop timer'
      },
      instanceUrl
    );
  }

  private async _cancelTimer(owner: string, repo: string, number: number, panelKey: string, instanceUrl?: string): Promise<void> {
    await this._runTimeTrackingAction(
      panelKey,
      async (client) => client.deleteIssueStopwatch(owner, repo, number),
      {
        success: `Canceled timer for issue #${String(number)}`,
        failure: 'Failed to cancel timer'
      },
      instanceUrl
    );
  }

  private async _addManualTime(owner: string, repo: string, number: number, seconds: number, panelKey: string, instanceUrl?: string): Promise<void> {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      void vscode.window.showErrorMessage('Enter a tracked time greater than zero.');
      const panelState = this._panels.get(panelKey);
      void panelState?.panel.webview.postMessage({ type: 'actionComplete', action: 'timeTracking', success: false });
      return;
    }

    await this._runTimeTrackingAction(
      panelKey,
      async (client) => client.addIssueTrackedTime(owner, repo, number, Math.round(seconds)),
      {
        success: `Added tracked time to issue #${String(number)}`,
        failure: 'Failed to add tracked time'
      },
      instanceUrl
    );
  }

  private async _runTimeTrackingAction(
    panelKey: string,
    action: (client: ForgejoClient) => Promise<unknown>,
    messages: { success: string; failure: string },
    instanceUrl?: string
  ): Promise<void> {
    const panelState = this._panels.get(panelKey);
    if (!panelState) return;

    try {
      const config = await this._getConfig(panelState.owner, panelState.repo, instanceUrl);
      if (!config.token) {
        throw new Error('A Forgejo token is required for issue time tracking.');
      }
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await action(client);
      void vscode.window.showInformationMessage(messages.success);
      await this._fetchIssueData(panelKey);
      void panelState.panel.webview.postMessage({ type: 'actionComplete', action: 'timeTracking', success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logError(messages.failure, error);
      void vscode.window.showErrorMessage(`${messages.failure}: ${message}`);
      void panelState.panel.webview.postMessage({ type: 'actionComplete', action: 'timeTracking', success: false });
    }
  }

  private async _openInBrowser(owner: string, repo: string, number: number, instanceUrl?: string): Promise<void> {
    try {
      const config = await this._getConfig(owner, repo, instanceUrl);
      const url = `${config.instanceUrl}/${owner}/${repo}/issues/${String(number)}`;
      void vscode.env.openExternal(vscode.Uri.parse(url));
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to open: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _startWorkOnIssue(panelKey: string): Promise<void> {
    const state = this._panels.get(panelKey);
    const issue = state?.pendingData?.issue;
    if (!state || !issue) {
      void vscode.window.showErrorMessage('Issue details are not loaded yet.');
      return;
    }

    await vscode.commands.executeCommand(
      'forgejo.startWorkOnIssue',
      issue,
      state.owner,
      state.repo,
      state.instanceUrl
    );
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
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'issueDetail', 'styles.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'issueDetail', 'index.js'));

    const nonce = this._getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https:;">
  <title>Issue Details</title>
  <link rel="stylesheet" href="${styleUri.toString()}">
</head>
<body>
  <div id="loading" class="loading">
    <div class="spinner"></div>
    <p>Loading issue details...</p>
  </div>

  <div id="error" class="error" style="display: none;">
    <h3>Error</h3>
    <p id="error-message"></p>
    <button id="retry-btn" class="btn btn-primary">Retry</button>
  </div>

  <div id="content" style="display: none;">
    <header class="issue-header">
      <div class="issue-title-row">
        <h1 id="issue-title"></h1>
        <span id="issue-number"></span>
        <button id="copy-url-btn" class="icon-btn" title="Copy URL">📋</button>
      </div>

      <div class="issue-meta">
        <span id="issue-status-badge" class="status-badge"></span>
        <span class="issue-author">
          by <img id="author-avatar" src="" alt="" class="avatar" style="display:none">
          <span id="author-name"></span>
        </span>
        <span id="issue-created" class="issue-date"></span>
      </div>

      <div id="labels-container" class="labels-container" style="display: none;"></div>
      <div id="assignees-container" class="assignees-container" style="display: none;"></div>
    </header>

    <nav class="action-bar">
      <button id="start-work-btn" class="btn btn-primary">Start Work</button>
      <button id="refresh-btn" class="btn btn-secondary">Refresh</button>
      <button id="open-web-btn" class="btn btn-secondary">Open in Web</button>
      <div id="state-actions" class="state-actions">
        <button id="close-issue-btn" class="btn btn-danger" style="display: none;">Close Issue</button>
        <button id="reopen-issue-btn" class="btn btn-success" style="display: none;">Reopen Issue</button>
      </div>
    </nav>

    <section class="time-tracking-section">
      <div class="time-tracking-header">
        <h2>Time Tracking</h2>
        <span id="tracked-time-total" class="tracked-time-total"></span>
      </div>
      <div id="time-tracking-status" class="time-tracking-status"></div>
      <div class="time-tracking-actions">
        <button id="start-timer-btn" class="btn btn-primary btn-small">Start Timer</button>
        <button id="stop-timer-btn" class="btn btn-success btn-small" style="display: none;">Stop Timer</button>
        <button id="cancel-timer-btn" class="btn btn-secondary btn-small" style="display: none;">Cancel Timer</button>
        <button id="add-manual-time-btn" class="btn btn-secondary btn-small">Add Manual Time</button>
      </div>
      <form id="manual-time-form" class="manual-time-form" style="display: none;">
        <input id="manual-hours-input" class="manual-time-input" type="number" min="0" step="1" placeholder="Hours">
        <input id="manual-minutes-input" class="manual-time-input" type="number" min="0" max="59" step="1" placeholder="Minutes">
        <button id="save-manual-time-btn" class="btn btn-primary btn-small" type="submit">Add</button>
        <button id="cancel-manual-time-btn" class="btn btn-secondary btn-small" type="button">Cancel</button>
      </form>
      <div id="tracked-time-list" class="tracked-time-list"></div>
    </section>

    <section class="description-section">
      <div class="description-header">
        <h2>Description</h2>
        <button id="edit-description-btn" class="btn btn-secondary btn-small">Edit</button>
      </div>
      <div id="issue-description" class="markdown-body"></div>
      <div id="issue-description-editor" class="description-editor" style="display: none;">
        <textarea id="description-textarea" class="description-textarea"></textarea>
        <div class="description-editor-actions">
          <button id="save-description-btn" class="btn btn-primary btn-small">Save</button>
          <button id="cancel-description-btn" class="btn btn-secondary btn-small">Cancel</button>
        </div>
      </div>
    </section>

    <section class="activity-section">
      <div class="activity-section-header">
        <h2>Activity <span id="activity-count"></span></h2>
        <button id="activity-sort-btn" class="icon-btn" title="Toggle activity sort order">Newest first</button>
      </div>
      <div id="activity-timeline"></div>
    </section>

    <div id="comment-input-container" class="comment-input-container" style="display: none;">
      <textarea id="comment-input" placeholder="Write a comment..."></textarea>
      <div class="comment-actions">
        <button id="submit-comment-btn" class="btn btn-primary">Comment</button>
        <button id="cancel-comment-btn" class="btn btn-secondary">Clear</button>
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
