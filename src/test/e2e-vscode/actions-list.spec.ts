import { test, expect } from './fixtures/vscode-harness';
import path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

test.describe('Actions lazy loading', () => {
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

  test('loads additional workflow run pages from the tree Load more row', async ({ harness, evaluateInVSCode, workbox }) => {
    await harness.waitForExtensionActivation();

    await evaluateInVSCode(async (vscode) => {
      const config = vscode.workspace.getConfiguration('forgejo');
      await config.update('instances', [{
        id: 'test-forgejo-actions-load-more',
        name: 'Forgejo Actions Load More',
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

        if (!url.includes('/api/v1/repos/maxking/forgejo-vscode/actions/tasks')) {
          return globals.__forgejoOriginalFetch!(input, init);
        }

        globals.__forgejoFetchCalls?.push(url);
        const parsed = new URL(url);
        const page = parsed.searchParams.get('page') ?? '1';

        if (page === '1') {
          const jobs = Array.from({ length: 50 }, (_, index) => ({
            id: 50000 + index,
            name: `job-${index + 1}`,
            run_number: 5000,
            status: 'success',
            conclusion: null,
            workflow_id: 'ci.yml',
            head_branch: 'main',
            head_sha: 'abc123def456',
            event: 'push',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:05:00Z',
            url: 'https://codeberg.org/maxking/forgejo-vscode/actions/runs/5000',
            display_title: 'Page one action',
          }));
          return new Response(JSON.stringify({ total_count: 51, workflow_runs: jobs }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }

        if (page === '2') {
          return new Response(JSON.stringify({
            total_count: 51,
            workflow_runs: [{
              id: 50100,
              name: 'job-page-two',
              run_number: 5001,
              status: 'success',
              conclusion: null,
              workflow_id: 'ci.yml',
              head_branch: 'main',
              head_sha: 'def456abc123',
              event: 'push',
              created_at: '2026-01-02T00:00:00Z',
              updated_at: '2026-01-02T00:05:00Z',
              url: 'https://codeberg.org/maxking/forgejo-vscode/actions/runs/5001',
              display_title: 'Page two action',
            }],
          }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ message: `Unexpected Actions URL: ${url}` }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      };
    });

    await harness.openForgejoSidebar();
    await evaluateInVSCode(async (vscode) => {
      await vscode.commands.executeCommand('forgejoActions.focus');
      await vscode.commands.executeCommand('forgejo.refreshActions');
    });

    await expect(workbox.locator('.monaco-list-row', { hasText: /Page one action \(#5000\)/ }).first()).toBeVisible({ timeout: 30_000 });
    const loadMore = workbox.locator('.monaco-list-row', { hasText: 'Load more workflow runs' }).first();
    await expect(loadMore).toBeVisible({ timeout: 10_000 });

    await loadMore.click();
    await workbox.keyboard.press('Enter');
    await expect(workbox.locator('.monaco-list-row', { hasText: /Page two action \(#5001\)/ }).first()).toBeVisible({ timeout: 30_000 });

    const calls = await evaluateInVSCode(() => {
      const globals = globalThis as typeof globalThis & { __forgejoFetchCalls?: string[] };
      return globals.__forgejoFetchCalls ?? [];
    });
    expect(calls.some(url => url.includes('/actions/tasks') && url.includes('page=2'))).toBe(true);
  });
});
