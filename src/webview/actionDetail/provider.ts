import * as vscode from 'vscode';
import { ForgejoClient } from '../../api/forgejoClient';
import { getForgejoConfigFor } from '../../utils/config';
import { WorkflowRun, WorkflowRunListItem, WorkflowJob, WorkflowJobRef } from '../../models/action';
import { logDebug, logInfo, logError } from '../../utils/logger';

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'rerun' }
  | { type: 'openInBrowser' }
  | { type: 'viewLogs'; jobRef: WorkflowJobRef };

function isValidJobRef(jobRef: unknown): jobRef is WorkflowJobRef {
  if (!jobRef || typeof jobRef !== 'object') {
    return false;
  }

  const ref = jobRef as WorkflowJobRef;
  return typeof ref.jobHtmlUrl === 'string'
    || typeof ref.jobId === 'number'
    || typeof ref.jobIndex === 'number';
}

export type ExtensionMessage =
  | { type: 'update'; data: ActionDetailViewData }
  | { type: 'loading'; show: boolean }
  | { type: 'error'; message: string }
  | { type: 'theme'; theme: 'light' | 'dark' | 'high-contrast' };

export interface ActionDetailViewData {
  run: WorkflowRun;
  jobs: WorkflowJob[];
  owner: string;
  repo: string;
}

interface PanelState {
  panel: vscode.WebviewPanel;
  owner: string;
  repo: string;
  runId: number;
  run: WorkflowRunListItem;  // Store the run data to avoid 404 on /actions/runs/{id}
  instanceUrl?: string;
  isReady: boolean;
  pendingData?: ActionDetailViewData | null;
  pendingError?: string | null;
}

export class ActionDetailWebviewProvider {
  public static readonly viewType = 'forgejo.actionDetail';
  private _panels = new Map<string, PanelState>();

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public async showActionDetails(owner: string, repo: string, run: WorkflowRunListItem, instanceUrl?: string): Promise<void> {
    const runId = run.id;
    logInfo('Showing action details in webview:', { owner, repo, runId, instanceUrl });

    const panelKey = `${instanceUrl ?? ''}/${owner}/${repo}/${String(runId)}`;

    if (this._panels.has(panelKey)) {
      const state = this._panels.get(panelKey);
      if (state) {
        state.panel.reveal(vscode.ViewColumn.One);
        await this._loadActionData(panelKey);
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      ActionDetailWebviewProvider.viewType,
      `Action #${String(runId)}: ${owner}/${repo}`,
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
      runId,
      run,
      instanceUrl,
      isReady: false,
      pendingData: null,
      pendingError: null
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
      logInfo('Action detail webview panel disposed:', panelKey);
      this._panels.delete(panelKey);
    }, undefined, []);

    void this._fetchActionData(panelKey);
  }

  private async _fetchActionData(panelKey: string): Promise<void> {
    const state = this._panels.get(panelKey);
    if (!state) return;

    const { panel, owner, repo, run, instanceUrl } = state;
    logInfo('_fetchActionData starting:', { panelKey, isReady: state.isReady });

    try {
      const config = await this._getConfig(owner, repo, instanceUrl);

      const client = new ForgejoClient(config.instanceUrl, config.token);
      logInfo('Fetching jobs from API...');

      // Task-list rows use an instance-wide task id, while repository Actions
      // endpoints use the repository-local run number.
      let fullRun: WorkflowRun;
      const locatedRun = await client.getWorkflowRunByNumber(owner, repo, run.run_number);
      try {
        if (!locatedRun) throw new Error('Run id lookup returned no match');
        fullRun = await client.getWorkflowRunDetails(owner, repo, locatedRun.id);
      } catch (runError) {
        logError('Failed to refresh workflow run details (using tree snapshot):', runError);
        fullRun = {
          ...run,
          started_at: run.created_at,
          stopped_at: null,
          run_started_at: run.created_at
        };
      }

      // Run/job endpoints require the API run id obtained above.
      let jobs: WorkflowJob[] = [];
      try {
        if (!locatedRun) throw new Error('Cannot fetch jobs without a resolved workflow run id');
        const jobsResponse = await client.getWorkflowJobs(owner, repo, locatedRun.id);
        jobs = jobsResponse.jobs;
        logInfo('Jobs fetched:', { jobCount: jobs.length });
      } catch (jobError) {
        logError('Failed to fetch jobs (will show run without jobs):', jobError);
        // Continue with empty jobs - at least show the run info
      }

      state.pendingData = { run: fullRun, jobs, owner, repo };
      state.pendingError = null; // Clear any previous error
      logInfo('pendingData set, isReady:', state.isReady);

      if (state.isReady) {
        logInfo('Webview is ready, sending data...');
        this._sendDataToPanel(panelKey);
      } else {
        logInfo('Webview not ready yet, data will be sent when ready');
      }
    } catch (error) {
      logError('Failed to fetch action data:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to load action details';
      if (state.isReady) {
        void panel.webview.postMessage({
          type: 'error',
          message: errorMessage
        });
      } else {
        // Store error to show when webview becomes ready
        state.pendingError = errorMessage;
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
    logInfo('Posting messages to webview:', { runName: state.pendingData.run.name });
    void panel.webview.postMessage({ type: 'theme', theme: this._getThemeName(vscode.window.activeColorTheme.kind) });
    void panel.webview.postMessage({ type: 'loading', show: true });
    void panel.webview.postMessage({ type: 'update', data: state.pendingData });
    void panel.webview.postMessage({ type: 'loading', show: false });
    logInfo('All messages posted to webview');
  }

  private async _loadActionData(panelKey: string): Promise<void> {
    await this._fetchActionData(panelKey);
  }

  private async _handleMessage(message: WebviewMessage, panelKey: string): Promise<void> {
    logDebug('Received message from webview:', message.type);
    const state = this._panels.get(panelKey);
    if (!state) return;

    const { panel, owner, repo, runId, instanceUrl } = state;

    switch (message.type) {
      case 'ready':
        logInfo('Webview ready message received, pendingData exists:', !!state.pendingData, 'pendingError:', !!state.pendingError);
        state.isReady = true;
        if (state.pendingError) {
          logInfo('Showing pending error to webview...');
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
      case 'refresh':
        await this._fetchActionData(panelKey);
        break;
      case 'rerun':
        await this._rerunWorkflow(owner, repo, state.run.run_number, panelKey, instanceUrl);
        break;
      case 'openInBrowser':
        await this._openInBrowser(owner, repo, runId, instanceUrl);
        break;
      case 'viewLogs':
        if (!isValidJobRef(message.jobRef)) {
          void vscode.window.showErrorMessage('Action log request did not include a valid job reference');
          return;
        }
        await this._viewLogs(owner, repo, runId, message.jobRef, instanceUrl);
        break;
    }
  }

  private async _getConfig(owner: string, repo: string, instanceUrl?: string) {
    const config = await getForgejoConfigFor(owner, repo, instanceUrl);
    if (!config) {
      throw new Error('Forgejo configuration not found');
    }
    return config;
  }

  private async _rerunWorkflow(owner: string, repo: string, runNumber: number, panelKey: string, instanceUrl?: string): Promise<void> {
    try {
      const config = await this._getConfig(owner, repo, instanceUrl);
      const client = new ForgejoClient(config.instanceUrl, config.token);
      const locatedRun = await client.getWorkflowRunByNumber(owner, repo, runNumber);
      if (!locatedRun) throw new Error(`Workflow run #${String(runNumber)} was not found`);
      await client.rerunWorkflow(owner, repo, locatedRun.id);
      void vscode.window.showInformationMessage('Workflow re-run triggered successfully');
      await this._fetchActionData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to re-run workflow: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _openInBrowser(owner: string, repo: string, runId: number, instanceUrl?: string): Promise<void> {
    try {
      const config = await this._getConfig(owner, repo, instanceUrl);

      // Get run_number from stored run data (web UI uses run_number, not internal id)
      const panelKey = `${instanceUrl ?? ''}/${owner}/${repo}/${String(runId)}`;
      const state = this._panels.get(panelKey);
      const runNumber = state?.run.run_number ?? runId;

      const url = `${config.instanceUrl}/${owner}/${repo}/actions/runs/${String(runNumber)}`;
      void vscode.env.openExternal(vscode.Uri.parse(url));
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to open: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _viewLogs(owner: string, repo: string, runId: number, jobRef: WorkflowJobRef, instanceUrl?: string): Promise<void> {
    // Get the run data to access run_number (sequential index, not internal id)
    const panelKey = `${instanceUrl ?? ''}/${owner}/${repo}/${String(runId)}`;
    const state = this._panels.get(panelKey);
    const run = state?.pendingData?.run;

    if (!run) {
      void vscode.window.showErrorMessage('Run data not available');
      return;
    }

    try {
      const config = await this._getConfig(owner, repo, instanceUrl);

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Fetching logs for ${run.name}...`,
        cancellable: false
      }, async () => {
        const client = new ForgejoClient(config.instanceUrl, config.token);
        const logs = await client.getWorkflowLogs(owner, repo, run.run_number, jobRef);

        // Create untitled document with logs
        const doc = await vscode.workspace.openTextDocument({
          content: logs,
          language: 'log'
        });
        await vscode.window.showTextDocument(doc, { preview: true });
      });
    } catch (error) {
      const is404 = error instanceof Error && error.message.includes('404');
      const msg = is404
        ? 'Logs not available — private repo action logs are not supported due to auth limitations.'
        : `Failed to view logs: ${error instanceof Error ? error.message : 'Unknown error'}`;
      void vscode.window.showErrorMessage(msg);
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
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'actionDetail', 'styles.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'actionDetail', 'index.js'));

    const nonce = this._getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https:;">
  <title>Action Details</title>
  <link rel="stylesheet" href="${styleUri.toString()}">
</head>
<body>
  <div id="loading" class="loading">
    <div class="spinner"></div>
    <p>Loading action details...</p>
  </div>

  <div id="error" class="error" style="display: none;">
    <h3>Error</h3>
    <p id="error-message"></p>
    <button id="retry-btn" class="btn btn-primary">Retry</button>
  </div>

  <div id="content" style="display: none;">
    <!-- Health Summary -->
    <div class="health-summary">
      <span id="health-badge" class="health-badge"></span>
      <span id="health-stats" class="health-stats"></span>
    </div>

    <!-- Run Info Header -->
    <header class="action-header">
      <div class="action-title-row">
        <h1 id="action-name"></h1>
        <span id="run-number"></span>
      </div>
      <div class="run-meta">
        <div class="run-meta-item">
          <span class="label">Commit:</span>
          <span id="commit-info"></span>
        </div>
        <div class="run-meta-item">
          <span class="label">Branch:</span>
          <span id="branch-name"></span>
        </div>
        <div class="run-meta-item">
          <span class="label">Trigger:</span>
          <span id="event-type"></span>
        </div>
        <div class="run-meta-item">
          <span class="label">Duration:</span>
          <span id="duration"></span>
        </div>
      </div>
    </header>

    <!-- Action Bar -->
    <nav class="action-bar">
      <button id="refresh-btn" class="btn btn-secondary">Refresh</button>
      <button id="rerun-btn" class="btn btn-primary">Re-run Workflow</button>
      <button id="open-web-btn" class="btn btn-secondary">Open in Browser</button>
    </nav>

    <!-- Jobs Section -->
    <section class="jobs-section">
      <h2>Jobs <span id="jobs-count"></span></h2>
      <div id="jobs-list"></div>
    </section>

    <!-- Failing Steps Summary -->
    <section id="failures-section" class="failures-section" style="display: none;">
      <h2>Failed Steps</h2>
      <div id="failures-list"></div>
    </section>
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
