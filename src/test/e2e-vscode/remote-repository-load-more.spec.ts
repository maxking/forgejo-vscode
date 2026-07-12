import { test, expect } from './fixtures/vscode-harness';
import path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

test.describe('Remote repository directory lazy loading', () => {
  test.use({ baseDir: PROJECT_ROOT });
  test.setTimeout(60_000);

  test.afterEach(async ({ evaluateInVSCode }) => {
    await evaluateInVSCode((vscode) => {
      const globals = globalThis as typeof globalThis & { __forgejoOriginalFetch?: typeof fetch };
      if (globals.__forgejoOriginalFetch) {
        globalThis.fetch = globals.__forgejoOriginalFetch;
        delete globals.__forgejoOriginalFetch;
      }

      type DialogGlobals = typeof globalThis & {
        __forgejoOriginalShowInputBox?: typeof vscode.window.showInputBox;
        __forgejoOriginalShowQuickPick?: typeof vscode.window.showQuickPick;
      };
      const dialogGlobals = globalThis as DialogGlobals;
      if (dialogGlobals.__forgejoOriginalShowInputBox) {
        (vscode.window as unknown as { showInputBox: typeof vscode.window.showInputBox }).showInputBox = dialogGlobals.__forgejoOriginalShowInputBox;
        delete dialogGlobals.__forgejoOriginalShowInputBox;
      }
      if (dialogGlobals.__forgejoOriginalShowQuickPick) {
        (vscode.window as unknown as { showQuickPick: typeof vscode.window.showQuickPick }).showQuickPick = dialogGlobals.__forgejoOriginalShowQuickPick;
        delete dialogGlobals.__forgejoOriginalShowQuickPick;
      }
    });
  });

  test('loads additional directory pages from the tree Load more row', async ({ harness, evaluateInVSCode, workbox }) => {
    await harness.waitForExtensionActivation();

    await evaluateInVSCode(async (vscode) => {
      const config = vscode.workspace.getConfiguration('forgejo');
      await config.update('instances', [{
        id: 'test-forgejo-remote-load-more',
        name: 'Forgejo Remote Load More',
        instanceUrl: 'https://codeberg.org',
        token: '',
        isDefault: true,
      }], vscode.ConfigurationTarget.Global);
      await config.update('autoDetectFromRemote', false, vscode.ConfigurationTarget.Global);
    });

    // Mock globalThis.fetch INSIDE the VS Code extension host so all
    // ForgejoClient HTTP calls hit these canned responses.
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

        if (url.includes('/api/v1/repos/maxking/forgejo-vscode/branches')) {
          globals.__forgejoFetchCalls?.push(url);
          return new Response(JSON.stringify([{ name: 'main' }]), {
            status: 200,
            headers: { 'content-type': 'application/json', 'x-total-count': '1' }
          });
        }

        if (url.includes('/api/v1/repos/maxking/forgejo-vscode/contents')) {
          globals.__forgejoFetchCalls?.push(url);
          const parsed = new URL(url);
          const page = parsed.searchParams.get('page') ?? '1';

          if (page === '1') {
            const entries = Array.from({ length: 100 }, (_value, index) => ({
              type: 'file',
              name: `file-${String(index).padStart(3, '0')}.txt`,
              path: `file-${String(index).padStart(3, '0')}.txt`,
              size: 1
            }));
            return new Response(JSON.stringify(entries), { status: 200, headers: { 'content-type': 'application/json' } });
          }

          if (page === '2') {
            return new Response(JSON.stringify([{
              type: 'file',
              name: 'file-100-page-two.txt',
              path: 'file-100-page-two.txt',
              size: 1
            }]), { status: 200, headers: { 'content-type': 'application/json' } });
          }

          return new Response(JSON.stringify({ message: `Unexpected contents page: ${page}` }), { status: 404, headers: { 'content-type': 'application/json' } });
        }

        return globals.__forgejoOriginalFetch!(input, init);
      };
    });

    // Drive the repository/branch pickers headlessly instead of the real
    // Quick Input widgets, mirroring how src/test/e2e-vscode/start-work-on-issue.spec.ts
    // patches vscode.window dialogs.
    await evaluateInVSCode((vscode) => {
      type DialogGlobals = typeof globalThis & {
        __forgejoOriginalShowInputBox?: typeof vscode.window.showInputBox;
        __forgejoOriginalShowQuickPick?: typeof vscode.window.showQuickPick;
      };
      const globals = globalThis as DialogGlobals;

      globals.__forgejoOriginalShowInputBox ??= vscode.window.showInputBox;
      globals.__forgejoOriginalShowQuickPick ??= vscode.window.showQuickPick;

      (vscode.window as unknown as { showInputBox: typeof vscode.window.showInputBox }).showInputBox = async () => 'maxking/forgejo-vscode';
      (vscode.window as unknown as { showQuickPick: typeof vscode.window.showQuickPick }).showQuickPick = async (items: unknown) => {
        const picks = await Promise.resolve(items) as Array<{ branch?: { name?: string } }>;
        return (picks.find(pick => pick.branch?.name === 'main') ?? picks[0]) as never;
      };
    });

    await harness.openForgejoSidebar();
    await evaluateInVSCode(async (vscode) => {
      await vscode.commands.executeCommand('forgejoRemoteRepositories.focus');
      await vscode.commands.executeCommand('forgejo.browseRemoteRepository');
    });

    // The repository row is nested under the instance's tree node, which
    // starts collapsed, so expand the instance row first.
    await expect(workbox.locator('.monaco-list-row', { hasText: 'Forgejo Remote Load More' }).first()).toBeVisible({ timeout: 30_000 });
    await workbox.locator('.monaco-list-row', { hasText: 'Forgejo Remote Load More' }).first().click();

    await expect(workbox.locator('.monaco-list-row', { hasText: 'maxking/forgejo-vscode' }).first()).toBeVisible({ timeout: 30_000 });
    await workbox.locator('.monaco-list-row', { hasText: 'maxking/forgejo-vscode' }).first().click();

    await expect(workbox.locator('.monaco-list-row', { hasText: 'file-000.txt' }).first()).toBeVisible({ timeout: 30_000 });

    // The 100-entry page overflows the virtualized tree view, so the
    // "Load more entries" row (item 101) isn't attached to the DOM until
    // the list actually scrolls there. Jump to the end of the focused list.
    await workbox.keyboard.press('End');
    const loadMore = workbox.locator('.monaco-list-row', { hasText: 'Load more entries' }).first();
    await expect(loadMore).toBeVisible({ timeout: 10_000 });

    await loadMore.click();
    await workbox.keyboard.press('Enter');
    await expect(workbox.locator('.monaco-list-row', { hasText: 'file-100-page-two.txt' }).first()).toBeVisible({ timeout: 30_000 });
    await expect(workbox.locator('.monaco-list-row', { hasText: 'Load more entries' })).toHaveCount(0);

    const calls = await evaluateInVSCode(() => {
      const globals = globalThis as typeof globalThis & { __forgejoFetchCalls?: string[] };
      return globals.__forgejoFetchCalls ?? [];
    });
    expect(calls.some(url => url.includes('/contents') && url.includes('page=2') && url.includes('limit=100'))).toBe(true);
  });
});
