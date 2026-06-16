import { test, expect } from './fixtures/vscode-harness';
import path from 'path';

// Open VS Code with the project root as workspace so git remote is detected
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

test.describe('Pull Request List', () => {
  test.use({ baseDir: PROJECT_ROOT });

  // These tests make real API calls to the Forgejo instance
  test.setTimeout(60_000);

  test.beforeEach(async ({ harness, evaluateInVSCode }) => {
    await harness.waitForExtensionActivation();

    // Configure the Forgejo instance matching the git remote (no token needed for public repos)
    await evaluateInVSCode(async (vscode) => {
      const config = vscode.workspace.getConfiguration('forgejo');
      await config.update('instances', [{
        id: 'test-forgejo',
        name: 'Forgejo',
        instanceUrl: 'https://codeberg.org',
        token: '',
        isDefault: true,
      }], vscode.ConfigurationTarget.Global);
    });

    // Refresh PRs now that an instance is configured
    await evaluateInVSCode(async (vscode) => {
      await vscode.commands.executeCommand('forgejo.refreshPullRequests');
    });

    // Wait for the API call to complete
    await new Promise(r => setTimeout(r, 5000));

    // Open the Forgejo sidebar and focus the PR tree view
    await harness.openForgejoSidebar();
    await evaluateInVSCode(async (vscode) => {
      await vscode.commands.executeCommand('forgejoPullRequests.focus');
    });
  });

  /** Collect all visible tree row labels from the sidebar */
  async function getTreeRowLabels(workbox: import('@playwright/test').Page): Promise<string[]> {
    const rows = workbox.locator('.monaco-list-row');
    const count = await rows.count();
    const labels: string[] = [];
    for (let i = 0; i < count; i++) {
      const text = await rows.nth(i).textContent();
      if (text) {
        labels.push(text.trim());
      }
    }
    return labels;
  }

  /**
   * Poll until at least one tree row label matches the pattern.
   * Returns all labels once a match is found, or throws on timeout.
   */
  async function waitForTreeRowsMatching(
    workbox: import('@playwright/test').Page,
    pattern: RegExp,
    timeout = 30_000,
  ): Promise<string[]> {
    const start = Date.now();
    let labels: string[] = [];
    while (Date.now() - start < timeout) {
      labels = await getTreeRowLabels(workbox);
      if (labels.some(l => pattern.test(l))) {
        return labels;
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    return labels;
  }

  test('should display pull request groups and lazy historical placeholders', async ({ harness, workbox }) => {
    // Poll until any PR group row appears. Open/Draft groups include counts;
    // Merged/Closed may initially be lazy placeholders without counts.
    const prGroupPattern = /^(Open|Merged|Closed|Draft)\s*\d*$/;
    const labels = await waitForTreeRowsMatching(workbox, prGroupPattern);

    await harness.captureScreenshot('pr-list');
    console.log('PR tree items:', labels);

    const foundGroups = labels.filter(label => prGroupPattern.test(label));
    expect(foundGroups.length).toBeGreaterThan(0);

    for (const group of foundGroups.filter(group => /\d+$/.test(group))) {
      const count = parseInt(group.replace(/^(Open|Merged|Closed|Draft)\s*/, ''), 10);
      expect(count).toBeGreaterThan(0);
    }

    console.log('PR groups found:', foundGroups);
  });
});

test.describe('Pull Request lazy loading', () => {
  test.use({ baseDir: PROJECT_ROOT });
  test.setTimeout(60_000);

  test.afterEach(async ({ evaluateInVSCode }) => {
    await evaluateInVSCode(() => {
      const globals = globalThis as typeof globalThis & { __forgejoOriginalFetch?: typeof fetch };
      if (globals.__forgejoOriginalFetch) {
        globalThis.fetch = globals.__forgejoOriginalFetch;
        delete globals.__forgejoOriginalFetch;
      }
    });
  });

  test('fetches open PRs initially and closed PRs only when Merged/Closed is expanded', async ({ harness, evaluateInVSCode, workbox }) => {
    await harness.waitForExtensionActivation();

    await evaluateInVSCode(async (vscode) => {
      const config = vscode.workspace.getConfiguration('forgejo');
      await config.update('instances', [{
        id: 'test-forgejo-mocked',
        name: 'Forgejo Mocked',
        instanceUrl: 'https://codeberg.org',
        token: '',
        isDefault: true,
      }], vscode.ConfigurationTarget.Global);
    });

    await evaluateInVSCode(() => {
      type FetchGlobals = typeof globalThis & {
        __forgejoOriginalFetch?: typeof fetch;
        __forgejoFetchCalls?: string[];
      };
      const globals = globalThis as FetchGlobals;
      globals.__forgejoOriginalFetch ??= globalThis.fetch;
      globals.__forgejoFetchCalls = [];

      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

        if (!url.includes('/api/v1/repos/maxking/forgejo-vscode/pulls')) {
          return globals.__forgejoOriginalFetch!(input, init);
        }

        globals.__forgejoFetchCalls?.push(url);
        const parsed = new URL(url);
        const state = parsed.searchParams.get('state');
        const limit = parsed.searchParams.get('limit');

        if (state === 'open') {
          return new Response(JSON.stringify([{
            number: 101,
            title: 'Open PR from mock',
            state: 'open',
            user: { login: 'alice' },
            html_url: 'https://codeberg.org/maxking/forgejo-vscode/pulls/101',
            created_at: '2026-01-01T00:00:00Z',
            merged: false,
            draft: false,
            comments: 0,
          }]), { status: 200, headers: { 'content-type': 'application/json', 'x-total-count': '1' } });
        }
        if (state === 'closed' && limit === '1') {
          return new Response(JSON.stringify([{}]), { status: 200, headers: { 'content-type': 'application/json', 'x-total-count': '2' } });
        }
        if (state === 'closed') {
          return new Response(JSON.stringify([{
            number: 201,
            title: 'Merged PR from mock',
            state: 'closed',
            user: { login: 'bob' },
            html_url: 'https://codeberg.org/maxking/forgejo-vscode/pulls/201',
            created_at: '2026-01-02T00:00:00Z',
            merged: true,
            draft: false,
            comments: 0,
          }, {
            number: 202,
            title: 'Closed PR from mock',
            state: 'closed',
            user: { login: 'carol' },
            html_url: 'https://codeberg.org/maxking/forgejo-vscode/pulls/202',
            created_at: '2026-01-03T00:00:00Z',
            merged: false,
            draft: false,
            comments: 0,
          }]), { status: 200, headers: { 'content-type': 'application/json', 'x-total-count': '2' } });
        }

        return new Response(JSON.stringify({ message: `Unexpected PR URL: ${url}` }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      };
    });

    await harness.openForgejoSidebar();
    await evaluateInVSCode(async (vscode) => {
      await vscode.commands.executeCommand('forgejoPullRequests.focus');
      await vscode.commands.executeCommand('forgejo.refreshPullRequests');
    });

    await expect(workbox.locator('.monaco-list-row', { hasText: /^Open/ }).first()).toBeVisible({ timeout: 30_000 });
    await expect(workbox.locator('.monaco-list-row', { hasText: /^Merged/ }).first()).toBeVisible();
    await expect(workbox.locator('.monaco-list-row', { hasText: /^Closed/ }).first()).toBeVisible();

    let calls = await evaluateInVSCode(() => {
      const globals = globalThis as typeof globalThis & { __forgejoFetchCalls?: string[] };
      return globals.__forgejoFetchCalls ?? [];
    });
    const prListCallsBeforeExpand = calls.filter(url => url.includes('/pulls'));
    expect(prListCallsBeforeExpand.some(url => url.includes('state=open'))).toBe(true);
    expect(prListCallsBeforeExpand.some(url => url.includes('state=closed') && url.includes('limit=1'))).toBe(true);
    expect(prListCallsBeforeExpand.some(url => url.includes('state=closed') && !url.includes('limit=1'))).toBe(false);

    await workbox.locator('.monaco-list-row', { hasText: /^Closed/ }).first().click();
    await expect(workbox.locator('.monaco-list-row', { hasText: /#202: Closed PR from mock/ }).first()).toBeVisible({ timeout: 30_000 });

    calls = await evaluateInVSCode(() => {
      const globals = globalThis as typeof globalThis & { __forgejoFetchCalls?: string[] };
      return globals.__forgejoFetchCalls ?? [];
    });
    const prListCallsAfterExpand = calls.filter(url => url.includes('/pulls'));
    expect(prListCallsAfterExpand.some(url => url.includes('state=closed') && !url.includes('limit=1'))).toBe(true);
  });

  test('loads additional PR pages from the tree Load more row', async ({ harness, evaluateInVSCode, workbox }) => {
    await harness.waitForExtensionActivation();

    await evaluateInVSCode(async (vscode) => {
      const config = vscode.workspace.getConfiguration('forgejo');
      await config.update('instances', [{
        id: 'test-forgejo-pr-load-more',
        name: 'Forgejo PR Load More',
        instanceUrl: 'https://codeberg.org',
        token: '',
        isDefault: true,
      }], vscode.ConfigurationTarget.Global);
      await config.update('autoDetectFromRemote', false, vscode.ConfigurationTarget.Global);
    });

    await evaluateInVSCode(() => {
      type FetchGlobals = typeof globalThis & {
        __forgejoOriginalFetch?: typeof fetch;
        __forgejoFetchCalls?: string[];
      };
      const globals = globalThis as FetchGlobals;
      globals.__forgejoOriginalFetch ??= globalThis.fetch;
      globals.__forgejoFetchCalls = [];

      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

        if (!url.includes('/api/v1/repos/maxking/forgejo-vscode/pulls')) {
          return globals.__forgejoOriginalFetch!(input, init);
        }

        globals.__forgejoFetchCalls?.push(url);
        const parsed = new URL(url);
        const state = parsed.searchParams.get('state');
        const page = parsed.searchParams.get('page') ?? '1';
        const limit = parsed.searchParams.get('limit');

        if (state === 'closed' && limit === '1') {
          return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json', 'x-total-count': '0' } });
        }

        if (state === 'closed') {
          return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json', 'x-total-count': '0' } });
        }

        if (state === 'open' && page === '1') {
          const openItems = Array.from({ length: 2 }, (_, index) => ({
            number: 1000 + index,
            title: `Open PR page one ${index + 1}`,
            state: 'open',
            user: { login: 'alice' },
            html_url: `https://codeberg.org/maxking/forgejo-vscode/pulls/${1000 + index}`,
            created_at: '2026-01-01T00:00:00Z',
            merged: false,
            draft: false,
            comments: 0,
          }));
          const draftItems = Array.from({ length: 48 }, (_, index) => ({
            number: 1100 + index,
            title: `Draft PR filler ${index + 1}`,
            state: 'open',
            user: { login: 'alice' },
            html_url: `https://codeberg.org/maxking/forgejo-vscode/pulls/${1100 + index}`,
            created_at: '2026-01-01T00:00:00Z',
            merged: false,
            draft: true,
            comments: 0,
          }));
          const items = [...openItems, ...draftItems];
          return new Response(JSON.stringify(items), { status: 200, headers: { 'content-type': 'application/json', 'x-total-count': '51' } });
        }

        if (state === 'open' && page === '2') {
          return new Response(JSON.stringify([{
            number: 1051,
            title: 'Open PR page two',
            state: 'open',
            user: { login: 'bob' },
            html_url: 'https://codeberg.org/maxking/forgejo-vscode/pulls/1051',
            created_at: '2026-01-02T00:00:00Z',
            merged: false,
            draft: false,
            comments: 0,
          }]), { status: 200, headers: { 'content-type': 'application/json', 'x-total-count': '51' } });
        }

        return new Response(JSON.stringify({ message: `Unexpected PR URL: ${url}` }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      };
    });

    await harness.openForgejoSidebar();
    await evaluateInVSCode(async (vscode) => {
      await vscode.commands.executeCommand('forgejoPullRequests.focus');
      await vscode.commands.executeCommand('forgejo.refreshPullRequests');
    });

    await expect(workbox.locator('.monaco-list-row', { hasText: /#1000: Open PR page one 1/ }).first()).toBeVisible({ timeout: 30_000 });
    const loadMore = workbox.locator('.monaco-list-row', { hasText: 'Load more pull requests' }).first();
    await expect(loadMore).toBeVisible({ timeout: 10_000 });

    await loadMore.click();
    await workbox.keyboard.press('Enter');
    await expect(workbox.locator('.monaco-list-row', { hasText: /#1051: Open PR page two/ }).first()).toBeVisible({ timeout: 30_000 });

    const calls = await evaluateInVSCode(() => {
      const globals = globalThis as typeof globalThis & { __forgejoFetchCalls?: string[] };
      return globals.__forgejoFetchCalls ?? [];
    });
    expect(calls.some(url => url.includes('/pulls') && url.includes('state=open') && url.includes('page=2'))).toBe(true);
  });
});
