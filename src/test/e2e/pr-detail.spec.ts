import { test, expect } from '@playwright/test';
import {
  WebviewHarness,
  getPostedMessages,
  createMockPRData,
} from './fixtures/webview-harness';

test.describe('PR Detail Webview', () => {
  let harness: WebviewHarness;

  test.beforeEach(async ({ page }) => {
    harness = new WebviewHarness(page);
    await harness.loadPRDetail();
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

  test('displays PR title and number', async ({ page }) => {
    await harness.sendPRUpdate(createMockPRData({
      title: 'Fix login bug',
      number: 99,
    }));

    await expect(page.locator('#pr-title')).toHaveText('Fix login bug');
    await expect(page.locator('#pr-number')).toHaveText('#99');
  });

  test('shows open status badge for open PRs', async ({ page }) => {
    await harness.sendPRUpdate(createMockPRData({ state: 'open' }));

    const badge = page.locator('#pr-status-badge');
    await expect(badge).toHaveText('open');
    await expect(badge).toHaveClass(/\bopen\b/);
  });

  test('shows merged status badge for merged PRs', async ({ page }) => {
    await harness.sendPRUpdate(createMockPRData({
      state: 'closed',
      merged: true,
    }));

    const badge = page.locator('#pr-status-badge');
    await expect(badge).toHaveText('Merged');
    await expect(badge).toHaveClass(/\bmerged\b/);
  });

  test('shows draft status badge for draft PRs', async ({ page }) => {
    await harness.sendPRUpdate(createMockPRData({
      state: 'open',
      draft: true,
    }));

    const badge = page.locator('#pr-status-badge');
    await expect(badge).toHaveText('Draft');
    await expect(badge).toHaveClass(/\bdraft\b/);
  });

  test('displays author name', async ({ page }) => {
    await harness.sendPRUpdate(createMockPRData({
      user: { login: 'octocat' },
    }));

    await expect(page.locator('#author-name')).toHaveText('octocat');
  });

  test('displays base and head branches', async ({ page }) => {
    await harness.sendPRUpdate(createMockPRData({
      base: { ref: 'main' },
      head: { ref: 'feature/awesome' },
    }));

    await expect(page.locator('#base-branch')).toHaveText('main');
    await expect(page.locator('#head-branch')).toHaveText('feature/awesome');
  });

  test('shows merge button for open non-draft PRs', async ({ page }) => {
    await harness.sendPRUpdate(createMockPRData({
      state: 'open',
      draft: false,
    }));

    await expect(page.locator('#merge-actions')).toBeVisible();
    await expect(page.locator('#revert-actions')).toBeHidden();
  });

  test('shows revert button for merged PRs', async ({ page }) => {
    await harness.sendPRUpdate(createMockPRData({
      state: 'closed',
      merged: true,
      merge_commit_sha: 'abc123',
    }));

    await expect(page.locator('#merge-actions')).toBeHidden();
    await expect(page.locator('#revert-actions')).toBeVisible();
  });

  test('hides merge/revert for draft PRs', async ({ page }) => {
    await harness.sendPRUpdate(createMockPRData({
      state: 'open',
      draft: true,
    }));

    await expect(page.locator('#merge-actions')).toBeHidden();
    await expect(page.locator('#revert-actions')).toBeHidden();
  });

  test('displays description as markdown', async ({ page }) => {
    await harness.sendPRUpdate(createMockPRData({
      body: '**Bold text** and *italic text*',
    }));

    const desc = page.locator('#pr-description');
    await expect(desc.locator('strong')).toHaveText('Bold text');
    await expect(desc.locator('em')).toHaveText('italic text');
  });

  test('shows "No description" when body is empty', async ({ page }) => {
    await harness.sendPRUpdate(createMockPRData({ body: '' }));

    const desc = page.locator('#pr-description');
    await expect(desc).toContainText('No description provided');
  });

  test('displays CI statuses', async ({ page }) => {
    const data = createMockPRData();
    data.statuses = [
      { status: 'success', context: 'CI/build', description: 'Build passed', target_url: 'https://forgejo.example.com/owner/repo/actions/runs/1' },
      { status: 'failure', context: 'CI/test', description: 'Tests failed', target_url: 'https://forgejo.example.com/owner/repo/actions/runs/2' },
    ];
    await harness.sendPRUpdate(data);

    const ciSection = page.locator('#ci-section');
    await expect(ciSection).toBeVisible();
    await expect(ciSection.locator('.ci-status-item')).toHaveCount(2);
    await expect(ciSection.locator('.ci-status-context').first()).toHaveText('CI/build');
    await expect(ciSection.locator('.ci-status-context').last()).toHaveText('CI/test');
  });

  test('clicking CI status sends openCIStatus message', async ({ page }) => {
    const data = createMockPRData();
    data.statuses = [
      { status: 'success', context: 'CI/build', description: 'Build passed', target_url: 'https://forgejo.example.com/owner/repo/actions/runs/1' },
    ];
    await harness.sendPRUpdate(data);

    await page.locator('.ci-status-item').first().click();
    const messages = await getPostedMessages(page);
    const ciMessage = messages.find(m => m.type === 'openCIStatus');
    expect(ciMessage).toBeDefined();
    expect(ciMessage!.url).toBe('https://forgejo.example.com/owner/repo/actions/runs/1');
  });

  test('clicking CI status without target_url does not send message', async ({ page }) => {
    const data = createMockPRData();
    data.statuses = [
      { status: 'success', context: 'CI/build', description: 'Build passed' },
    ];
    await harness.sendPRUpdate(data);

    await page.locator('.ci-status-item').first().click();
    const messages = await getPostedMessages(page);
    const ciMessage = messages.find(m => m.type === 'openCIStatus');
    expect(ciMessage).toBeUndefined();
  });

  test('hides CI section when no statuses', async ({ page }) => {
    await harness.sendPRUpdate(createMockPRData());

    const ciSection = page.locator('#ci-section');
    await expect(ciSection).toBeHidden();
  });

  test('displays activity timeline with comments', async ({ page }) => {
    const data = createMockPRData();
    data.activities = [
      {
        type: 'comment',
        id: 1,
        created_at: '2025-01-15T10:00:00Z',
        user: { login: 'reviewer' },
        body: 'Looks good to me!',
      },
    ];
    await harness.sendPRUpdate(data);

    const timeline = page.locator('#activity-timeline');
    await expect(timeline.locator('.activity-item')).toHaveCount(1);
    await expect(timeline.locator('.activity-user')).toHaveText('reviewer');
    await expect(timeline.locator('.activity-action')).toHaveText('commented');
  });

  test('displays activity count', async ({ page }) => {
    const data = createMockPRData();
    data.activities = [
      { type: 'comment', id: 1, user: { login: 'u1' }, body: 'Hi' },
      { type: 'comment', id: 2, user: { login: 'u2' }, body: 'Hello' },
      { type: 'commit', id: 3, user: { login: 'u3' }, sha: 'abc1234', message: 'fix' },
    ];
    await harness.sendPRUpdate(data);

    await expect(page.locator('#activity-count')).toHaveText('(3 events)');
  });

  test('renders comment body with bold markdown', async ({ page }) => {
    const data = createMockPRData();
    data.activities = [
      {
        type: 'comment',
        id: 1,
        user: { login: 'reviewer' },
        body: '**LGTM!** Looks good.',
      },
    ];
    await harness.sendPRUpdate(data);

    const body = page.locator('#activity-timeline .activity-body');
    await expect(body.locator('strong')).toHaveText('LGTM!');
  });

  test('renders comment body with code block', async ({ page }) => {
    const data = createMockPRData();
    data.activities = [
      {
        type: 'comment',
        id: 1,
        user: { login: 'reviewer' },
        body: 'Use `const x = 1` instead',
      },
    ];
    await harness.sendPRUpdate(data);

    const body = page.locator('#activity-timeline .activity-body');
    await expect(body.locator('code')).toHaveText('const x = 1');
  });

  test('renders review body with markdown', async ({ page }) => {
    const data = createMockPRData();
    data.activities = [
      {
        type: 'review',
        id: 1,
        user: { login: 'maintainer' },
        state: 'APPROVED',
        body: '**Approved!** Great work on the `tests`.',
      },
    ];
    await harness.sendPRUpdate(data);

    const body = page.locator('#activity-timeline .activity-body');
    await expect(body.locator('strong')).toHaveText('Approved!');
    await expect(body.locator('code')).toHaveText('tests');
  });

  test('does not render HTML tags in comment body (XSS prevention)', async ({ page }) => {
    const data = createMockPRData();
    data.activities = [
      {
        type: 'comment',
        id: 1,
        user: { login: 'commenter' },
        body: '<script>alert("xss")</script>',
      },
    ];
    await harness.sendPRUpdate(data);

    const body = page.locator('#activity-timeline .activity-body');
    await expect(body.locator('script')).toHaveCount(0);
    await expect(body).toContainText('alert');
  });

  test('shows comment input when clicking + Comment', async ({ page }) => {
    await harness.sendPRUpdate(createMockPRData());

    const container = page.locator('#comment-input-container');
    await expect(container).toBeHidden();

    await page.locator('#add-comment-btn').click();
    await expect(container).toBeVisible();
  });

  test('hides comment input on cancel', async ({ page }) => {
    await harness.sendPRUpdate(createMockPRData());

    await page.locator('#add-comment-btn').click();
    const container = page.locator('#comment-input-container');
    await expect(container).toBeVisible();

    await page.locator('#cancel-comment-btn').click();
    await expect(container).toBeHidden();
  });

  test('submits comment and clears input', async ({ page }) => {
    await harness.sendPRUpdate(createMockPRData());

    await page.locator('#add-comment-btn').click();
    await page.locator('#comment-input').fill('Great work!');
    await page.locator('#submit-comment-btn').click();

    // Extension reports success after it handles the addComment request.
    await harness.postMessage({ type: 'actionComplete', action: 'addComment', success: true });

    // Comment input should be hidden and cleared after completion.
    await expect(page.locator('#comment-input-container')).toBeHidden();
    await expect(page.locator('#comment-input')).toHaveValue('');

    // Should have posted addComment message
    const messages = await getPostedMessages(page);
    expect(messages).toContainEqual({ type: 'addComment', body: 'Great work!' });
  });

  test('does not submit empty comment', async ({ page }) => {
    await harness.sendPRUpdate(createMockPRData());

    await page.locator('#add-comment-btn').click();
    // Leave input empty
    await page.locator('#submit-comment-btn').click();

    // Container should still be visible (not submitted)
    await expect(page.locator('#comment-input-container')).toBeVisible();

    const messages = await getPostedMessages(page);
    expect(messages.filter(m => m.type === 'addComment')).toHaveLength(0);
  });

  test('opens merge dialog when clicking merge', async ({ page }) => {
    await harness.sendPRUpdate(createMockPRData({
      state: 'open',
      draft: false,
    }));

    const dialog = page.locator('#merge-dialog');
    await expect(dialog).toBeHidden();

    await page.locator('#merge-btn').click();
    await expect(dialog).toBeVisible();
  });

  test('cancels merge dialog', async ({ page }) => {
    await harness.sendPRUpdate(createMockPRData({ state: 'open' }));

    await page.locator('#merge-btn').click();
    await expect(page.locator('#merge-dialog')).toBeVisible();

    await page.locator('#cancel-merge-btn').click();
    await expect(page.locator('#merge-dialog')).toBeHidden();
  });

  test('submits merge with selected strategy', async ({ page }) => {
    await harness.sendPRUpdate(createMockPRData({ state: 'open' }));

    await page.locator('#merge-btn').click();
    await page.locator('#merge-strategy').selectOption('squash');
    await page.locator('#confirm-merge-btn').click();

    const messages = await getPostedMessages(page);
    const mergeMsg = messages.find(m => m.type === 'merge');
    expect(mergeMsg).toBeDefined();
    expect(mergeMsg).toMatchObject({ type: 'merge', strategy: 'squash' });
  });

  test('sends refresh message on refresh click', async ({ page }) => {
    await harness.sendPRUpdate(createMockPRData());

    await page.locator('#refresh-btn').click();

    const messages = await getPostedMessages(page);
    expect(messages.filter(m => m.type === 'refresh')).not.toHaveLength(0);
  });

  test('sends openInBrowser message', async ({ page }) => {
    await harness.sendPRUpdate(createMockPRData());

    await page.locator('#open-web-btn').click();

    const messages = await getPostedMessages(page);
    expect(messages).toContainEqual({ type: 'openInBrowser' });
  });

  test('sends checkout message', async ({ page }) => {
    await harness.sendPRUpdate(createMockPRData());

    await page.locator('#checkout-btn').click();

    const messages = await getPostedMessages(page);
    expect(messages).toContainEqual({ type: 'checkout' });
  });

  test('shows error state', async ({ page }) => {
    await harness.postMessage({ type: 'error', message: 'Something went wrong' });

    await expect(page.locator('#error')).toBeVisible();
    await expect(page.locator('#error-message')).toHaveText('Something went wrong');
    await expect(page.locator('#content')).toBeHidden();
    await expect(page.locator('#loading')).toBeHidden();
  });

  test('retry button sends refresh message', async ({ page }) => {
    await harness.postMessage({ type: 'error', message: 'Error' });
    await expect(page.locator('#error')).toBeVisible();

    await page.locator('#retry-btn').click();

    const messages = await getPostedMessages(page);
    expect(messages.filter(m => m.type === 'refresh')).not.toHaveLength(0);
  });

  test('displays review activities', async ({ page }) => {
    const data = createMockPRData();
    data.activities = [
      {
        type: 'review',
        id: 1,
        submitted_at: '2025-01-15T10:00:00Z',
        user: { login: 'reviewer' },
        state: 'APPROVED',
        body: 'Ship it!',
      },
    ];
    await harness.sendPRUpdate(data);

    const timeline = page.locator('#activity-timeline');
    const reviewItem = timeline.locator('.activity-review');
    await expect(reviewItem).toHaveCount(1);
    await expect(reviewItem).toHaveClass(/\bapproved\b/);
  });

  test('displays commit activities', async ({ page }) => {
    const data = createMockPRData();
    data.activities = [
      {
        type: 'commit',
        id: 1,
        committed_at: '2025-01-15T10:00:00Z',
        user: { login: 'developer' },
        sha: 'abc1234567890',
        message: 'Fix the thing',
      },
    ];
    await harness.sendPRUpdate(data);

    const timeline = page.locator('#activity-timeline');
    await expect(timeline.locator('.activity-commit-sha')).toHaveText('abc1234');
    await expect(timeline.locator('.activity-commit-message')).toHaveText('Fix the thing');
  });

  test('renders timeline events and normalized commits with contextual details', async ({ page }) => {
    const data = createMockPRData();
    data.activities = [
      {
        type: 'timeline',
        id: 1,
        event: 'pull_push',
        created_at: '2025-01-15T09:00:00Z',
        user: { login: 'maxking-bot' },
        branch: 'feature/pagination',
        sha: '2ac4bf19de45',
        message: 'Use forgejo-ts pagination wrappers',
      },
      {
        type: 'commit',
        id: 2,
        committed_at: '2025-01-15T09:05:00Z',
        user: { login: 'maxking-bot' },
        sha: '817a50b98fca',
        message: 'Use forgejo-ts pagination wrappers\n\nKeep API paging bounded in tree providers.',
        html_url: 'https://git.example.com/owner/repo/commit/817a50b98fca',
      },
      {
        type: 'timeline',
        id: 3,
        event: 'merge_pull',
        created_at: '2025-01-15T09:20:00Z',
        user: { login: 'maxking-bot' },
        branch: 'main',
        commit_sha: '3f456d8c1020',
        commit_message: 'Merge pull request #42 from feature/pagination',
      },
      {
        type: 'timeline',
        id: 4,
        event: 'delete_branch',
        created_at: '2025-01-15T09:25:00Z',
        user: { login: 'maxking-bot' },
        branch: 'feature/pagination',
      },
      {
        type: 'timeline',
        id: 5,
        event: 'commit_ref',
        created_at: '2025-01-15T09:30:00Z',
        user: { login: 'maxking-bot' },
        sha: '9d25f38b4561',
        message: 'Reference pagination wrapper cleanup',
      },
    ];
    await harness.sendPRUpdate(data);

    const timeline = page.locator('#activity-timeline');
    await expect(timeline.locator('.activity-item')).toHaveCount(5);
    await expect(timeline).toContainText('maxking-bot pushed commits to feature/pagination');
    await expect(timeline).toContainText('2ac4bf1');
    await expect(timeline).toContainText('817a50b');
    await expect(timeline).toContainText('Use forgejo-ts pagination wrappers');
    await expect(timeline).toContainText('maxking-bot merged this pull request into main');
    await expect(timeline).toContainText('3f456d8');
    await expect(timeline).toContainText('Merge pull request #42 from feature/pagination');
    await expect(timeline).toContainText('maxking-bot deleted branch feature/pagination');
    await expect(timeline).toContainText('maxking-bot referenced this pull request from commit 9d25f38');
    await expect(timeline).toContainText('Reference pagination wrapper cleanup');
    await expect(timeline).not.toContainText('Unknown');
    await expect(timeline).not.toContainText('No commit message');
  });
});
