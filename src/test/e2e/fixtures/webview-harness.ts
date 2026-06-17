import { Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Loads a webview into a Playwright page by constructing the same HTML
 * that the VS Code extension provider would generate, but with local
 * file:// references instead of webview URIs.
 */
export class WebviewHarness {
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Load the PR Detail webview with mock data.
   */
  async loadPRDetail(): Promise<void> {
    const html = this.buildPRDetailHtml();
    await this.page.setContent(html);
    await this.page.waitForFunction(() => {
      // Wait for the script to initialize
      return document.getElementById('loading') !== null;
    });
  }

  /**
   * Load the Issue Detail webview with mock data.
   */
  async loadIssueDetail(): Promise<void> {
    const html = this.buildIssueDetailHtml();
    await this.page.setContent(html);
    await this.page.waitForFunction(() => {
      return document.getElementById('loading') !== null;
    });
  }

  /**
   * Load the Action Detail webview with mock data.
   */
  async loadActionDetail(): Promise<void> {
    const html = this.buildActionDetailHtml();
    await this.page.setContent(html);
    await this.page.waitForFunction(() => {
      return document.getElementById('loading') !== null;
    });
  }

  /**
   * Send a message to the webview simulating the extension posting data.
   */
  async postMessage(message: Record<string, unknown>): Promise<void> {
    await this.page.evaluate((msg) => {
      window.postMessage(msg, '*');
    }, message);
  }

  /**
   * Send PR update data to the webview.
   */
  async sendPRUpdate(data: PRDetailData): Promise<void> {
    await this.postMessage({ type: 'update', data });
    // Wait for content to be visible
    await this.page.waitForSelector('#content', { state: 'visible', timeout: 5000 });
  }

  /**
   * Send Issue update data to the webview.
   */
  async sendIssueUpdate(data: IssueDetailData): Promise<void> {
    await this.postMessage({ type: 'update', data });
    await this.page.waitForSelector('#content', { state: 'visible', timeout: 5000 });
  }

  /**
   * Send Action update data to the webview.
   */
  async sendActionUpdate(data: ActionDetailData): Promise<void> {
    await this.postMessage({ type: 'update', data });
    await this.page.waitForSelector('#content', { state: 'visible', timeout: 5000 });
  }

  /**
   * Build the PR Detail HTML with inline styles and scripts.
   * This mirrors what PRDetailWebviewProvider._getHtmlForWebview() produces,
   * but adapted for running in a standalone browser context.
   */
  private buildPRDetailHtml(): string {
    const cssContent = this.readWebviewFile('prDetail', 'styles.css');
    const jsContent = this.readWebviewFile('prDetail', 'index.js');

    // Replace acquireVsCodeApi with a mock
    const patchedJs = this.patchJsForTesting(jsContent);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PR Details - Test</title>
  <style>${cssContent}</style>
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
        <button id="copy-url-btn" class="icon-btn" title="Copy URL">clipboard</button>
      </div>

      <div class="pr-meta">
        <span id="pr-status-badge" class="status-badge"></span>
        <span class="pr-author">
          by <img id="author-avatar" src="" alt="" class="avatar" style="display:none">
          <span id="author-name"></span>
        </span>
        <span class="pr-branch">
          <span id="base-branch"></span>
          <span class="branch-arrow">&#8592;</span>
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
      <textarea id="merge-message" placeholder="Merge message (optional)"></textarea>
      <div class="merge-actions">
        <button id="confirm-merge-btn" class="btn btn-success">Merge</button>
        <button id="cancel-merge-btn" class="btn btn-secondary">Cancel</button>
      </div>
    </div>
  </div>

  <script>${patchedJs}</script>
</body>
</html>`;
  }

  /**
   * Build the Issue Detail HTML with inline styles and scripts.
   */
  private buildIssueDetailHtml(): string {
    const cssContent = this.readWebviewFile('issueDetail', 'styles.css');
    const jsContent = this.readWebviewFile('issueDetail', 'index.js');

    const patchedJs = this.patchJsForTesting(jsContent);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Issue Details - Test</title>
  <style>${cssContent}</style>
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
        <button id="copy-url-btn" class="icon-btn" title="Copy URL">clipboard</button>
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
      <button id="refresh-btn" class="btn btn-secondary">Refresh</button>
      <button id="open-web-btn" class="btn btn-secondary">Open in Web</button>
      <button id="add-comment-btn" class="btn btn-secondary">+ Comment</button>
      <div id="state-actions" class="state-actions">
        <button id="close-issue-btn" class="btn btn-danger" style="display: none;">Close Issue</button>
        <button id="reopen-issue-btn" class="btn btn-success" style="display: none;">Reopen Issue</button>
      </div>
    </nav>

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
  </div>

  <script>${patchedJs}</script>
</body>
</html>`;
  }

  /**
   * Build the Action Detail HTML with inline styles and scripts.
   */
  private buildActionDetailHtml(): string {
    const cssContent = this.readWebviewFile('actionDetail', 'styles.css');
    const jsContent = this.readWebviewFile('actionDetail', 'index.js');

    const patchedJs = this.patchJsForTesting(jsContent);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Action Details - Test</title>
  <style>${cssContent}</style>
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

  <script>${patchedJs}</script>
</body>
</html>`;
  }

  /**
   * Read a file from the webview source directory.
   */
  private readWebviewFile(webview: string, filename: string): string {
    const filePath = path.resolve(
      __dirname, '..', '..', '..', 'webview', webview, filename
    );
    return fs.readFileSync(filePath, 'utf8');
  }

  /**
   * Patch the webview JavaScript for testing outside VS Code.
   * - Replaces acquireVsCodeApi() with a mock that records messages
   * - Makes the mock accessible via window.__vscodeMessages
   */
  private patchJsForTesting(js: string): string {
    const mock = `
// Mock VS Code API for testing
window.__vscodeMessages = [];
function acquireVsCodeApi() {
  return {
    postMessage: function(msg) {
      window.__vscodeMessages.push(msg);
    },
    getState: function() { return null; },
    setState: function() {}
  };
}
`;
    return mock + js;
  }
}

/**
 * Get messages that the webview posted to the extension (via vscode.postMessage).
 */
export async function getPostedMessages(page: Page): Promise<Record<string, unknown>[]> {
  return page.evaluate(() => (window as any).__vscodeMessages);
}

// ---- Action Detail support ----

export interface ActionDetailData {
  run: {
    name: string;
    run_number: number;
    status: string;
    conclusion?: string | null;
    head_sha: string;
    head_branch: string;
    event: string;
    display_title: string;
    created_at: string;
    updated_at: string;
    started_at?: string | null;
    stopped_at?: string | null;
    run_started_at?: string;
    id: number;
    workflow_id: string;
    url: string;
  };
  jobs: Array<{
    id: number;
    run_id: number;
    name: string;
    status: string;
    conclusion?: string | null;
    started_at?: string | null;
    completed_at?: string | null;
    steps: Array<{
      name: string;
      status: string;
      conclusion?: string | null;
      number: number;
      started_at?: string;
      completed_at?: string;
    }>;
  }>;
  owner: string;
  repo: string;
}

// ---- Mock data types ----

export interface PRDetailData {
  pr: {
    title: string;
    number: number;
    state: string;
    draft?: boolean;
    merged?: boolean;
    body?: string;
    html_url?: string;
    user?: { login: string; avatar_url?: string };
    base?: { ref: string };
    head?: { ref: string; sha?: string };
    merge_commit_sha?: string;
  };
  activities: Array<{
    type: string;
    id: number;
    created_at?: string;
    submitted_at?: string;
    committed_at?: string;
    user?: { login: string; avatar_url?: string };
    body?: string;
    state?: string;
    sha?: string;
    message?: string;
    event?: string;
  }>;
  statuses: Array<{
    status: string;
    context?: string;
    description?: string;
    target_url?: string;
    created_at?: string;
    updated_at?: string;
  }>;
  owner: string;
  repo: string;
}

export interface IssueDetailData {
  issue: {
    title: string;
    number: number;
    state: string;
    body?: string;
    html_url?: string;
    created_at?: string;
    user?: { login: string; avatar_url?: string };
    labels?: Array<{ name: string; color?: string }>;
    assignees?: Array<{ login: string }>;
  };
  activities: Array<{
    type: string;
    id: number;
    created_at?: string;
    user?: { login: string; avatar_url?: string };
    body?: string;
    event?: string;
  }>;
  owner: string;
  repo: string;
}

// ---- Factory helpers for mock data ----

export function createMockPRData(overrides: Partial<PRDetailData['pr']> = {}): PRDetailData {
  return {
    pr: {
      title: 'Add new feature',
      number: 42,
      state: 'open',
      body: 'This is the PR description.',
      html_url: 'https://git.example.com/owner/repo/pulls/42',
      user: { login: 'testuser', avatar_url: '' },
      base: { ref: 'main' },
      head: { ref: 'feature/new-feature', sha: 'abc1234567890' },
      ...overrides,
    },
    activities: [],
    statuses: [],
    owner: 'owner',
    repo: 'repo',
  };
}

export function createMockIssueData(overrides: Partial<IssueDetailData['issue']> = {}): IssueDetailData {
  return {
    issue: {
      title: 'Bug report',
      number: 10,
      state: 'open',
      body: 'This is the issue description.',
      html_url: 'https://git.example.com/owner/repo/issues/10',
      created_at: '2025-01-01T00:00:00Z',
      user: { login: 'reporter', avatar_url: '' },
      labels: [],
      assignees: [],
      ...overrides,
    },
    activities: [],
    owner: 'owner',
    repo: 'repo',
  };
}

export function createMockActionData(overrides: Partial<ActionDetailData['run']> = {}, jobs: ActionDetailData['jobs'] = []): ActionDetailData {
  return {
    run: {
      id: 1,
      name: 'CI Pipeline',
      run_number: 15,
      status: 'success',
      conclusion: null,
      head_sha: 'abc1234567890def',
      head_branch: 'main',
      event: 'push',
      display_title: 'Fix login bug',
      created_at: '2025-01-15T10:00:00Z',
      updated_at: '2025-01-15T10:05:00Z',
      started_at: '2025-01-15T10:00:00Z',
      stopped_at: '2025-01-15T10:05:00Z',
      run_started_at: '2025-01-15T10:00:00Z',
      workflow_id: 'ci.yml',
      url: 'https://git.example.com/owner/repo/actions/runs/15',
      ...overrides,
    },
    jobs,
    owner: 'owner',
    repo: 'repo',
  };
}
