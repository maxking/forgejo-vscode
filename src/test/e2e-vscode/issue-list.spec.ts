import { test, expect } from './fixtures/vscode-harness';
import path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

test.describe('Issue lazy loading', () => {
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

  test('loads additional issue pages from the tree Load more row', async ({ harness, evaluateInVSCode, workbox }) => {
    await harness.waitForExtensionActivation();

    await evaluateInVSCode(async (vscode) => {
      const config = vscode.workspace.getConfiguration('forgejo');
      await config.update('instances', [{
        id: 'test-forgejo-issue-load-more',
        name: 'Forgejo Issue Load More',
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

        if (!url.includes('/api/v1/repos/maxking/forgejo-vscode/issues')) {
          return globals.__forgejoOriginalFetch!(input, init);
        }

        globals.__forgejoFetchCalls?.push(url);
        const parsed = new URL(url);
        const state = parsed.searchParams.get('state');
        const page = parsed.searchParams.get('page') ?? '1';

        if (state === 'closed') {
          return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json', 'x-total-count': '0' } });
        }

        if (state === 'open' && page === '1') {
          const visibleIssues = Array.from({ length: 2 }, (_, index) => ({
            number: 2000 + index,
            title: `Open issue page one ${index + 1}`,
            state: 'open',
            user: { login: 'alice' },
            html_url: `https://codeberg.org/maxking/forgejo-vscode/issues/${2000 + index}`,
            created_at: '2026-01-01T00:00:00Z',
            comments: 0,
          }));
          const pullRequestItems = Array.from({ length: 48 }, (_, index) => ({
            number: 2100 + index,
            title: `Pull request filler ${index + 1}`,
            state: 'open',
            user: { login: 'alice' },
            html_url: `https://codeberg.org/maxking/forgejo-vscode/pulls/${2100 + index}`,
            created_at: '2026-01-01T00:00:00Z',
            comments: 0,
            pull_request: {
              html_url: `https://codeberg.org/maxking/forgejo-vscode/pulls/${2100 + index}`,
            },
          }));
          const items = [...visibleIssues, ...pullRequestItems];
          return new Response(JSON.stringify(items), { status: 200, headers: { 'content-type': 'application/json', 'x-total-count': '51' } });
        }

        if (state === 'open' && page === '2') {
          return new Response(JSON.stringify([{
            number: 2051,
            title: 'Open issue page two',
            state: 'open',
            user: { login: 'bob' },
            html_url: 'https://codeberg.org/maxking/forgejo-vscode/issues/2051',
            created_at: '2026-01-02T00:00:00Z',
            comments: 0,
          }]), { status: 200, headers: { 'content-type': 'application/json', 'x-total-count': '51' } });
        }

        return new Response(JSON.stringify({ message: `Unexpected issue URL: ${url}` }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      };
    });

    await harness.openForgejoSidebar();
    await evaluateInVSCode(async (vscode) => {
      await vscode.commands.executeCommand('forgejoIssues.focus');
      await vscode.commands.executeCommand('forgejo.refreshIssues');
    });

    await expect(workbox.locator('.monaco-list-row', { hasText: /#2000: Open issue page one 1/ }).first()).toBeVisible({ timeout: 30_000 });
    const loadMore = workbox.locator('.monaco-list-row', { hasText: 'Load more issues' }).first();
    await expect(loadMore).toBeVisible({ timeout: 10_000 });

    await loadMore.click();
    await workbox.keyboard.press('Enter');
    await expect(workbox.locator('.monaco-list-row', { hasText: /#2051: Open issue page two/ }).first()).toBeVisible({ timeout: 30_000 });

    const calls = await evaluateInVSCode(() => {
      const globals = globalThis as typeof globalThis & { __forgejoFetchCalls?: string[] };
      return globals.__forgejoFetchCalls ?? [];
    });
    expect(calls.some(url => url.includes('/issues') && url.includes('state=open') && url.includes('page=2'))).toBe(true);
  });
});
