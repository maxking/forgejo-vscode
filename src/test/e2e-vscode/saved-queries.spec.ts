import { test, expect } from './fixtures/vscode-harness';
import path from 'path';

// Open VS Code with the project root as workspace so git remote is detected
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

test.describe('Saved Query Dashboard', () => {
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

  test('shows the five built-in query groups', async ({ harness, evaluateInVSCode, workbox }) => {
    await harness.waitForExtensionActivation();

    await evaluateInVSCode(async (vscode) => {
      const config = vscode.workspace.getConfiguration('forgejo');
      await config.update('instances', [{
        id: 'test-forgejo-saved-queries',
        name: 'Forgejo Saved Queries',
        instanceUrl: 'https://codeberg.org',
        token: '',
        isDefault: true,
      }], vscode.ConfigurationTarget.Global);
    });

    await harness.openForgejoSidebar();
    await evaluateInVSCode(async (vscode) => {
      await vscode.commands.executeCommand('forgejoSavedQueries.focus');
      await vscode.commands.executeCommand('forgejo.refreshSavedQueries');
    });

    for (const label of ['Waiting for my review', 'Assigned to me', 'Created by me', 'Mentioned me', 'Recently updated']) {
      await expect(workbox.locator('.monaco-list-row', { hasText: label }).first()).toBeVisible({ timeout: 30_000 });
    }
  });

  test('loads additional pages from the tree Load more row for "Recently updated"', async ({ harness, evaluateInVSCode, workbox }) => {
    await harness.waitForExtensionActivation();

    await evaluateInVSCode(async (vscode) => {
      const config = vscode.workspace.getConfiguration('forgejo');
      await config.update('instances', [{
        id: 'test-forgejo-saved-queries-load-more',
        name: 'Forgejo Saved Queries Load More',
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
        const page = parsed.searchParams.get('page') ?? '1';
        const sort = parsed.searchParams.get('sort');

        if (sort !== 'recentupdate') {
          return new Response(JSON.stringify({ message: `Expected sort=recentupdate, got: ${url}` }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          });
        }

        if (page === '1') {
          const items = Array.from({ length: 50 }, (_, index) => ({
            number: 2000 + index,
            title: `Recently updated PR ${index + 1}`,
            state: 'open',
            user: { login: 'alice' },
            html_url: `https://codeberg.org/maxking/forgejo-vscode/pulls/${2000 + index}`,
            created_at: '2026-01-01T00:00:00Z',
            merged: false,
            draft: false,
            comments: 0,
          }));
          return new Response(JSON.stringify(items), { status: 200, headers: { 'content-type': 'application/json', 'x-total-count': '51' } });
        }

        if (page === '2') {
          return new Response(JSON.stringify([{
            number: 2050,
            title: 'Recently updated PR page two',
            state: 'open',
            user: { login: 'bob' },
            html_url: 'https://codeberg.org/maxking/forgejo-vscode/pulls/2050',
            created_at: '2026-01-02T00:00:00Z',
            merged: false,
            draft: false,
            comments: 0,
          }]), { status: 200, headers: { 'content-type': 'application/json', 'x-total-count': '51' } });
        }

        return new Response(JSON.stringify({ message: `Unexpected saved-query PR URL: ${url}` }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      };
    });

    await harness.openForgejoSidebar();
    await evaluateInVSCode(async (vscode) => {
      await vscode.commands.executeCommand('forgejoSavedQueries.focus');
      await vscode.commands.executeCommand('forgejo.refreshSavedQueries');
    });

    const recentlyUpdatedGroup = workbox.locator('.monaco-list-row', { hasText: 'Recently updated' }).first();
    await expect(recentlyUpdatedGroup).toBeVisible({ timeout: 30_000 });
    await recentlyUpdatedGroup.click();

    const pullRequestsSection = workbox.locator('.monaco-list-row', { hasText: 'Pull Requests' }).first();
    await expect(pullRequestsSection).toBeVisible({ timeout: 15_000 });
    await pullRequestsSection.click();

    await expect(workbox.locator('.monaco-list-row', { hasText: /#2000: Recently updated PR 1/ }).first()).toBeVisible({ timeout: 30_000 });
    const loadMore = workbox.locator('.monaco-list-row', { hasText: 'Load more pull requests' }).first();
    await expect(loadMore).toBeVisible({ timeout: 10_000 });

    await loadMore.click();
    await workbox.keyboard.press('Enter');
    await expect(workbox.locator('.monaco-list-row', { hasText: /#2050: Recently updated PR page two/ }).first()).toBeVisible({ timeout: 30_000 });

    const calls = await evaluateInVSCode(() => {
      const globals = globalThis as typeof globalThis & { __forgejoFetchCalls?: string[] };
      return globals.__forgejoFetchCalls ?? [];
    });
    expect(calls.some(url => url.includes('/pulls') && url.includes('sort=recentupdate') && url.includes('page=2'))).toBe(true);
  });
});
