import * as vscode from 'vscode';
import { ForgejoClient, type CreateIssueOptions } from '../../api/forgejoClient';
import { IssueTreeProvider } from '../../providers/issueTreeProvider';
import { ForgejoConfig, getForgejoConfigFor } from '../../utils/config';
import { logDebug, logError, logInfo } from '../../utils/logger';

export interface CreateIssueFormPayload {
  title: string;
  body?: string;
  labels?: number[];
  assignees?: string[];
  milestone?: number;
  dueDate?: string;
}

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'createIssue'; data: CreateIssueFormPayload };

export type ExtensionMessage =
  | { type: 'theme'; theme: 'light' | 'dark' | 'high-contrast' }
  | { type: 'submitting'; show: boolean }
  | { type: 'error'; message: string }
  | { type: 'created'; number: number; title: string; url: string };

interface PanelState {
  panel: vscode.WebviewPanel;
  config: ForgejoConfig;
  isReady: boolean;
}

export class IssueCreateWebviewProvider {
  public static readonly viewType = 'forgejo.issueCreate';
  private _panelState: PanelState | undefined;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _issueTreeProvider: IssueTreeProvider
  ) {}

  public showCreateIssue(config: ForgejoConfig): void {
    logInfo('Showing create issue webview:', {
      owner: config.owner,
      repo: config.repo,
      instanceUrl: config.instanceUrl
    });

    if (this._panelState) {
      this._panelState.config = config;
      this._panelState.panel.reveal(vscode.ViewColumn.One);
      this._sendTheme();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      IssueCreateWebviewProvider.viewType,
      `Create Issue: ${config.owner}/${config.repo}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this._extensionUri]
      }
    );

    this._panelState = {
      panel,
      config,
      isReady: false
    };

    panel.webview.html = this._getHtmlForWebview(panel.webview);
    panel.webview.onDidReceiveMessage(
      (message: unknown) => {
        void this._handleMessage(message as WebviewMessage);
      },
      undefined,
      []
    );

    panel.onDidDispose(() => {
      this._panelState = undefined;
    }, undefined, []);
  }

  private async _handleMessage(message: WebviewMessage): Promise<void> {
    logDebug('Received create issue webview message:', message.type);

    switch (message.type) {
      case 'ready':
        if (this._panelState) {
          this._panelState.isReady = true;
          this._sendTheme();
        }
        break;
      case 'createIssue':
        await this._createIssue(message.data);
        break;
    }
  }

  private async _createIssue(data: CreateIssueFormPayload): Promise<void> {
    const state = this._panelState;
    if (!state) return;

    const title = data.title.trim();
    if (!title) {
      this._post({ type: 'error', message: 'Title is required.' });
      return;
    }

    this._post({ type: 'submitting', show: true });

    try {
      const config = await getForgejoConfigFor(state.config.owner, state.config.repo, state.config.instanceUrl);
      if (!config) {
        throw new Error('Forgejo configuration not found. Please configure an instance first.');
      }
      if (!config.token) {
        throw new Error('A Forgejo token is required to create issues. Please configure your token first.');
      }

      const client = new ForgejoClient(config.instanceUrl, config.token);
      const body = data.body?.trim() || undefined;
      const options = this._buildCreateIssueOptions(data);
      const issue = await client.createIssue(config.owner, config.repo, title, body, options);

      logInfo(`Issue #${issue.number} created: ${issue.title}`);
      this._issueTreeProvider.refresh();
      this._post({
        type: 'created',
        number: issue.number,
        title: issue.title,
        url: issue.html_url
      });

      const action = await vscode.window.showInformationMessage(
        `Issue #${issue.number} created successfully!`,
        'Open in Browser'
      );
      if (action === 'Open in Browser') {
        void vscode.env.openExternal(vscode.Uri.parse(issue.html_url));
      }
    } catch (error) {
      logError('Error creating issue:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      this._post({ type: 'error', message: `Failed to create issue: ${message}` });
      void vscode.window.showErrorMessage(`Failed to create issue: ${message}`);
    } finally {
      this._post({ type: 'submitting', show: false });
    }
  }

  private _buildCreateIssueOptions(data: CreateIssueFormPayload): CreateIssueOptions {
    return {
      ...(data.labels?.length ? { labels: data.labels } : {}),
      ...(data.assignees?.length ? { assignees: data.assignees } : {}),
      ...(data.milestone !== undefined ? { milestone: data.milestone } : {}),
      ...(data.dueDate ? { due_date: `${data.dueDate}T00:00:00Z` } : {})
    };
  }

  private _sendTheme(): void {
    this._post({ type: 'theme', theme: this._getThemeName(vscode.window.activeColorTheme.kind) });
  }

  private _post(message: ExtensionMessage): void {
    const panel = this._panelState?.panel;
    if (!panel) return;
    void panel.webview.postMessage(message);
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
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'issueCreate', 'styles.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'issueCreate', 'index.js'));
    const nonce = this._getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource};">
  <title>Create Issue</title>
  <link rel="stylesheet" href="${styleUri.toString()}">
</head>
<body>
  <main class="create-issue-page">
    <header class="page-header">
      <div>
        <p class="repo-name">${this._escapeHtml(this._panelState?.config.owner ?? '')}/${this._escapeHtml(this._panelState?.config.repo ?? '')}</p>
        <h1>Create Issue</h1>
      </div>
    </header>

    <div id="error" class="message message-error" style="display: none;"></div>
    <div id="success" class="message message-success" style="display: none;"></div>

    <form id="create-issue-form" class="issue-form">
      <label class="field">
        <span>Title</span>
        <input id="title" type="text" required maxlength="255" autocomplete="off" placeholder="Short issue title">
      </label>

      <label class="field">
        <span>Description</span>
        <textarea id="body" rows="10" placeholder="Describe the problem, expected behavior, and useful context"></textarea>
      </label>

      <div class="field-grid">
        <label class="field">
          <span>Labels</span>
          <input id="labels" type="text" inputmode="numeric" placeholder="Label IDs, separated by commas">
        </label>

        <label class="field">
          <span>Assignees</span>
          <input id="assignees" type="text" autocomplete="off" placeholder="Usernames, separated by commas">
        </label>

        <label class="field">
          <span>Milestone</span>
          <input id="milestone" type="number" min="1" step="1" placeholder="Milestone ID">
        </label>

        <label class="field">
          <span>Due Date</span>
          <input id="due-date" type="date">
        </label>
      </div>

      <footer class="form-actions">
        <button id="submit-btn" class="btn btn-primary" type="submit">Create Issue</button>
      </footer>
    </form>
  </main>

  <script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
  }

  private _escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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
