import { test, expect } from '@playwright/test';
import {
  WebviewHarness,
  getPostedMessages,
  createMockIssueData,
} from './fixtures/webview-harness';

test.describe('Issue Detail Webview', () => {
  let harness: WebviewHarness;

  test.beforeEach(async ({ page }) => {
    harness = new WebviewHarness(page);
    await harness.loadIssueDetail();
  });

  test('shows loading state initially', async ({ page }) => {
    const loading = page.locator('#loading');
    await expect(loading).toBeVisible();

    const content = page.locator('#content');
    await expect(content).toBeHidden();
  });

  test('sends ready message on initialization', async ({ page }) => {
    const messages = await getPostedMessages(page);
    expect(messages).toContainEqual({ type: 'ready' });
  });

  test('displays issue title and number', async ({ page }) => {
    await harness.sendIssueUpdate(createMockIssueData({
      title: 'Login page crashes',
      number: 55,
    }));

    await expect(page.locator('#issue-title')).toHaveText('Login page crashes');
    await expect(page.locator('#issue-number')).toHaveText('#55');
  });

  test('shows open status badge', async ({ page }) => {
    await harness.sendIssueUpdate(createMockIssueData({ state: 'open' }));

    const badge = page.locator('#issue-status-badge');
    await expect(badge).toHaveText('open');
    await expect(badge).toHaveClass(/\bopen\b/);
  });

  test('shows closed status badge', async ({ page }) => {
    await harness.sendIssueUpdate(createMockIssueData({ state: 'closed' }));

    const badge = page.locator('#issue-status-badge');
    await expect(badge).toHaveText('closed');
    await expect(badge).toHaveClass(/\bclosed\b/);
  });

  test('displays author name', async ({ page }) => {
    await harness.sendIssueUpdate(createMockIssueData({
      user: { login: 'bug-reporter' },
    }));

    await expect(page.locator('#author-name')).toHaveText('bug-reporter');
  });

  test('shows Close button for open issues', async ({ page }) => {
    await harness.sendIssueUpdate(createMockIssueData({ state: 'open' }));

    await expect(page.locator('#close-issue-btn')).toBeVisible();
    await expect(page.locator('#reopen-issue-btn')).toBeHidden();
  });

  test('shows Reopen button for closed issues', async ({ page }) => {
    await harness.sendIssueUpdate(createMockIssueData({ state: 'closed' }));

    await expect(page.locator('#close-issue-btn')).toBeHidden();
    await expect(page.locator('#reopen-issue-btn')).toBeVisible();
  });

  test('sends closeIssue message on Close click', async ({ page }) => {
    await harness.sendIssueUpdate(createMockIssueData({ state: 'open' }));

    await page.locator('#close-issue-btn').click();

    const messages = await getPostedMessages(page);
    expect(messages).toContainEqual({ type: 'closeIssue' });
  });

  test('sends reopenIssue message on Reopen click', async ({ page }) => {
    await harness.sendIssueUpdate(createMockIssueData({ state: 'closed' }));

    await page.locator('#reopen-issue-btn').click();

    const messages = await getPostedMessages(page);
    expect(messages).toContainEqual({ type: 'reopenIssue' });
  });

  test('shows idle time tracking controls and total tracked time', async ({ page }) => {
    const data = createMockIssueData();
    data.timeTracking = {
      canTrack: true,
      totalSeconds: 3660,
      entries: [
        { id: 1, time: 1800, user_name: 'alice', created: '2026-01-01T00:00:00Z' },
        { id: 2, time: 1860, user_name: 'bob', created: '2026-01-02T00:00:00Z' },
      ],
    };

    await harness.sendIssueUpdate(data);

    await expect(page.locator('#tracked-time-total')).toHaveText('1h 01m');
    await expect(page.locator('#time-tracking-status')).toHaveText('No timer is running for this issue.');
    await expect(page.locator('#start-timer-btn')).toBeVisible();
    await expect(page.locator('#stop-timer-btn')).toBeHidden();
    await expect(page.locator('.tracked-time-entry')).toHaveCount(2);
  });

  test('sends startTimer message on Start Timer click', async ({ page }) => {
    await harness.sendIssueUpdate(createMockIssueData());

    await page.locator('#start-timer-btn').click();

    const messages = await getPostedMessages(page);
    expect(messages).toContainEqual({ type: 'startTimer' });
  });

  test('shows running timer controls and sends stop and cancel messages', async ({ page }) => {
    const data = createMockIssueData();
    data.timeTracking = {
      canTrack: true,
      totalSeconds: 120,
      entries: [],
      currentStopwatch: {
        issue_index: 10,
        issue_title: 'Bug report',
        repo_name: 'repo',
        repo_owner_name: 'owner',
        seconds: 90,
      },
    };

    await harness.sendIssueUpdate(data);

    await expect(page.locator('#time-tracking-status')).toContainText('Timer running');
    await expect(page.locator('#start-timer-btn')).toBeHidden();
    await expect(page.locator('#stop-timer-btn')).toBeVisible();
    await expect(page.locator('#cancel-timer-btn')).toBeVisible();

    await page.locator('#stop-timer-btn').click();
    await harness.sendIssueUpdate(data);
    await page.locator('#cancel-timer-btn').click();

    const messages = await getPostedMessages(page);
    expect(messages).toContainEqual({ type: 'stopTimer' });
    expect(messages).toContainEqual({ type: 'cancelTimer' });
  });

  test('disables start when another stopwatch is running', async ({ page }) => {
    const data = createMockIssueData();
    data.timeTracking = {
      canTrack: true,
      totalSeconds: 0,
      entries: [],
      otherStopwatch: {
        issue_index: 99,
        issue_title: 'Other issue',
        repo_name: 'repo',
        repo_owner_name: 'owner',
        seconds: 60,
      },
    };

    await harness.sendIssueUpdate(data);

    await expect(page.locator('#time-tracking-status')).toContainText('Timer running on owner/repo#99');
    await expect(page.locator('#start-timer-btn')).toBeDisabled();
  });

  test('sends addManualTime message from manual time form', async ({ page }) => {
    await harness.sendIssueUpdate(createMockIssueData());

    await page.locator('#add-manual-time-btn').click();
    await page.locator('#manual-hours-input').fill('1');
    await page.locator('#manual-minutes-input').fill('15');
    await page.locator('#save-manual-time-btn').click();

    const messages = await getPostedMessages(page);
    expect(messages).toContainEqual({ type: 'addManualTime', seconds: 4500 });
  });

  test('displays issue description', async ({ page }) => {
    await harness.sendIssueUpdate(createMockIssueData({
      body: 'Steps to reproduce the bug',
    }));

    const desc = page.locator('#issue-description');
    await expect(desc).toContainText('Steps to reproduce the bug');
  });

  test('displays labels', async ({ page }) => {
    await harness.sendIssueUpdate(createMockIssueData({
      labels: [
        { name: 'bug', color: 'f44336' },
        { name: 'priority:high', color: 'ff9800' },
      ],
    }));

    const labels = page.locator('#labels-container');
    await expect(labels).toBeVisible();
    await expect(labels.locator('.label')).toHaveCount(2);
    await expect(labels.locator('.label').first()).toContainText('bug');
    await expect(labels.locator('.label').last()).toContainText('priority:high');
  });

  test('hides labels when none exist', async ({ page }) => {
    await harness.sendIssueUpdate(createMockIssueData({ labels: [] }));

    await expect(page.locator('#labels-container')).toBeHidden();
  });

  test('displays assignees', async ({ page }) => {
    await harness.sendIssueUpdate(createMockIssueData({
      assignees: [{ login: 'dev1' }, { login: 'dev2' }],
    }));

    const assignees = page.locator('#assignees-container');
    await expect(assignees).toBeVisible();
    await expect(assignees).toContainText('dev1');
    await expect(assignees).toContainText('dev2');
  });

  test('hides assignees when none exist', async ({ page }) => {
    await harness.sendIssueUpdate(createMockIssueData({ assignees: [] }));

    await expect(page.locator('#assignees-container')).toBeHidden();
  });

  test('displays activity timeline with comments', async ({ page }) => {
    const data = createMockIssueData();
    data.activities = [
      {
        type: 'comment',
        id: 1,
        created_at: '2025-01-15T10:00:00Z',
        user: { login: 'commenter' },
        body: 'I can reproduce this.',
      },
    ];
    await harness.sendIssueUpdate(data);

    const timeline = page.locator('#activity-timeline');
    await expect(timeline.locator('.activity-item')).toHaveCount(1);
    await expect(timeline.locator('.activity-user')).toHaveText('commenter');
    await expect(timeline.locator('.activity-action')).toHaveText('commented');
  });

  test('renders comment body with bold markdown', async ({ page }) => {
    const data = createMockIssueData();
    data.activities = [
      {
        type: 'comment',
        id: 1,
        user: { login: 'commenter' },
        body: '**bold text** and normal text',
      },
    ];
    await harness.sendIssueUpdate(data);

    const body = page.locator('#activity-timeline .activity-body');
    await expect(body.locator('strong')).toHaveText('bold text');
  });

  test('renders comment body with italic markdown', async ({ page }) => {
    const data = createMockIssueData();
    data.activities = [
      {
        type: 'comment',
        id: 1,
        user: { login: 'commenter' },
        body: '*italic text*',
      },
    ];
    await harness.sendIssueUpdate(data);

    const body = page.locator('#activity-timeline .activity-body');
    await expect(body.locator('em')).toHaveText('italic text');
  });

  test('renders comment body with inline code', async ({ page }) => {
    const data = createMockIssueData();
    data.activities = [
      {
        type: 'comment',
        id: 1,
        user: { login: 'commenter' },
        body: 'Use `npm install` to install',
      },
    ];
    await harness.sendIssueUpdate(data);

    const body = page.locator('#activity-timeline .activity-body');
    await expect(body.locator('code')).toHaveText('npm install');
  });

  test('renders comment body with a heading', async ({ page }) => {
    const data = createMockIssueData();
    data.activities = [
      {
        type: 'comment',
        id: 1,
        user: { login: 'commenter' },
        body: '## Steps to Reproduce',
      },
    ];
    await harness.sendIssueUpdate(data);

    const body = page.locator('#activity-timeline .activity-body');
    await expect(body.locator('h2')).toHaveText('Steps to Reproduce');
  });

  test('renders comment body with a link', async ({ page }) => {
    const data = createMockIssueData();
    data.activities = [
      {
        type: 'comment',
        id: 1,
        user: { login: 'commenter' },
        body: '[see docs](https://example.com)',
      },
    ];
    await harness.sendIssueUpdate(data);

    const body = page.locator('#activity-timeline .activity-body');
    await expect(body.locator('a')).toHaveText('see docs');
    await expect(body.locator('a')).toHaveAttribute('href', 'https://example.com');
  });

  test('does not render HTML tags in comment body (XSS prevention)', async ({ page }) => {
    const data = createMockIssueData();
    data.activities = [
      {
        type: 'comment',
        id: 1,
        user: { login: 'commenter' },
        body: '<script>alert("xss")</script>',
      },
    ];
    await harness.sendIssueUpdate(data);

    const body = page.locator('#activity-timeline .activity-body');
    // Script tags should not be rendered as actual elements
    await expect(body.locator('script')).toHaveCount(0);
    // The escaped text should appear instead
    await expect(body).toContainText('alert');
  });

  test('displays activity count', async ({ page }) => {
    const data = createMockIssueData();
    data.activities = [
      { type: 'comment', id: 1, user: { login: 'u1' }, body: 'Comment 1' },
      { type: 'comment', id: 2, user: { login: 'u2' }, body: 'Comment 2' },
    ];
    await harness.sendIssueUpdate(data);

    await expect(page.locator('#activity-count')).toHaveText('(2 events)');
  });

  test('shows comment input when commenting is available', async ({ page }) => {
    await harness.sendIssueUpdate(createMockIssueData());

    await expect(page.locator('#add-comment-btn')).toHaveCount(0);
    await expect(page.locator('#comment-input-container')).toBeVisible();
    await expect(page.locator('#submit-comment-btn')).toHaveText('Comment');
  });

  test('hides comment input when commenting is unavailable', async ({ page }) => {
    const data = createMockIssueData();
    data.canComment = false;
    await harness.sendIssueUpdate(data);

    await expect(page.locator('#add-comment-btn')).toHaveCount(0);
    await expect(page.locator('#comment-input-container')).toBeHidden();
  });

  test('clears comment input without hiding it', async ({ page }) => {
    await harness.sendIssueUpdate(createMockIssueData());

    await expect(page.locator('#comment-input-container')).toBeVisible();
    await page.locator('#comment-input').fill('Draft comment');

    await page.locator('#cancel-comment-btn').click();
    await expect(page.locator('#comment-input-container')).toBeVisible();
    await expect(page.locator('#comment-input')).toHaveValue('');
  });

  test('submits comment and clears input', async ({ page }) => {
    await harness.sendIssueUpdate(createMockIssueData());

    await page.locator('#comment-input').fill('Adding my two cents');
    await page.locator('#submit-comment-btn').click();

    await expect(page.locator('#comment-input-container')).toBeVisible();
    await expect(page.locator('#comment-input')).toHaveValue('');

    const messages = await getPostedMessages(page);
    expect(messages).toContainEqual({ type: 'addComment', body: 'Adding my two cents' });
  });

  test('does not submit empty comment', async ({ page }) => {
    await harness.sendIssueUpdate(createMockIssueData());

    await page.locator('#submit-comment-btn').click();

    await expect(page.locator('#comment-input-container')).toBeVisible();

    const messages = await getPostedMessages(page);
    expect(messages.filter(m => m.type === 'addComment')).toHaveLength(0);
  });

  test('sends refresh message', async ({ page }) => {
    await harness.sendIssueUpdate(createMockIssueData());

    await page.locator('#refresh-btn').click();

    const messages = await getPostedMessages(page);
    expect(messages.filter(m => m.type === 'refresh')).not.toHaveLength(0);
  });

  test('sends openInBrowser message', async ({ page }) => {
    await harness.sendIssueUpdate(createMockIssueData());

    await page.locator('#open-web-btn').click();

    const messages = await getPostedMessages(page);
    expect(messages).toContainEqual({ type: 'openInBrowser' });
  });

  test('shows error state', async ({ page }) => {
    await harness.postMessage({ type: 'error', message: 'Failed to load issue' });

    await expect(page.locator('#error')).toBeVisible();
    await expect(page.locator('#error-message')).toHaveText('Failed to load issue');
    await expect(page.locator('#content')).toBeHidden();
    await expect(page.locator('#loading')).toBeHidden();
  });

  test('retry sends refresh message', async ({ page }) => {
    await harness.postMessage({ type: 'error', message: 'Error' });
    await expect(page.locator('#error')).toBeVisible();

    await page.locator('#retry-btn').click();

    const messages = await getPostedMessages(page);
    expect(messages.filter(m => m.type === 'refresh')).not.toHaveLength(0);
  });

  test('displays timeline events', async ({ page }) => {
    const data = createMockIssueData();
    data.activities = [
      {
        type: 'timeline',
        id: 1,
        created_at: '2025-01-15T10:00:00Z',
        user: { login: 'admin' },
        event: 'closed',
      },
    ];
    await harness.sendIssueUpdate(data);

    const timeline = page.locator('#activity-timeline');
    await expect(timeline.locator('.activity-event')).toContainText('closed this issue');
  });
});
