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

  test('should display pull request groups with counts', async ({ harness, workbox }) => {
    // Poll until PR group rows appear
    // Group labels include the count suffix, e.g. "Open4" or "Merged 26"
    const prGroupPattern = /^(Open|Merged|Closed|Draft)\s*\d+$/;
    const labels = await waitForTreeRowsMatching(workbox, prGroupPattern);

    await harness.captureScreenshot('pr-list');
    console.log('PR tree items:', labels);

    // The tree should show at least one PR state group (Open, Merged, Closed, Draft)
    const foundGroups = labels.filter(label => prGroupPattern.test(label));
    expect(foundGroups.length).toBeGreaterThan(0);

    // Each group should report at least 1 PR
    for (const group of foundGroups) {
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

      globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        globals.__forgejoFetchCalls?.push(url);

        if (url.includes('/api/v1/repos/maxking/forgejo-vscode/pulls')) {
          const parsed = new URL(url);
          const state = parsed.searchParams.get('state');
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
            }]), { status: 200, headers: { 'content-type': 'application/json' } });
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
            }]), { status: 200, headers: { 'content-type': 'application/json' } });
          }
        }

        return new Response(JSON.stringify({ message: `Unexpected URL: ${url}` }), {
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
    expect(prListCallsBeforeExpand.some(url => url.includes('state=closed'))).toBe(false);

    await workbox.locator('.monaco-list-row', { hasText: /^Closed/ }).first().click();
    await expect(workbox.locator('.monaco-list-row', { hasText: /#202: Closed PR from mock/ }).first()).toBeVisible({ timeout: 30_000 });

    calls = await evaluateInVSCode(() => {
      const globals = globalThis as typeof globalThis & { __forgejoFetchCalls?: string[] };
      return globals.__forgejoFetchCalls ?? [];
    });
    const prListCallsAfterExpand = calls.filter(url => url.includes('/pulls'));
    expect(prListCallsAfterExpand.some(url => url.includes('state=closed'))).toBe(true);
  });
});
