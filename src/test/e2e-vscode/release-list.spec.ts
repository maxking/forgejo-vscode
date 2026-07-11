import { test, expect } from './fixtures/vscode-harness';
import path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

test.describe('Release pagination', () => {
  test.use({ baseDir: PROJECT_ROOT });
  test.setTimeout(60_000);

  test.afterEach(async ({ evaluateInVSCode }) => {
    await evaluateInVSCode(() => {
      const globals = globalThis as typeof globalThis & { __forgejoOriginalFetch?: typeof fetch };
      if (globals.__forgejoOriginalFetch) globalThis.fetch = globals.__forgejoOriginalFetch;
    });
  });

  test('loads a later release page from the visible load-more row', async ({ harness, evaluateInVSCode, workbox }) => {
    await harness.waitForExtensionActivation();
    await evaluateInVSCode(async vscode => {
      const config = vscode.workspace.getConfiguration('forgejo');
      await config.update('instances', [{ id: 'release-pages', name: 'Release Pages', instanceUrl: 'https://codeberg.org', token: '', isDefault: true }], vscode.ConfigurationTarget.Global);
      await config.update('autoDetectFromRemote', false, vscode.ConfigurationTarget.Global);
    });
    await evaluateInVSCode(() => {
      const globals = globalThis as typeof globalThis & { __forgejoOriginalFetch?: typeof fetch };
      globals.__forgejoOriginalFetch ??= globalThis.fetch;
      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const parsed = new URL(url);
        if (parsed.pathname.endsWith('/releases')) {
          const page = parsed.searchParams.get('page') ?? '1';
          const releases = page === '1'
            ? Array.from({ length: 50 }, (_, index) => ({ id: index + 1, tag_name: `v1.0.${String(index)}`, name: `Release page one ${String(index)}`, draft: false, prerelease: false, html_url: '#', assets: [] }))
            : [{ id: 51, tag_name: 'v2.0.0', name: 'Release page two', draft: false, prerelease: false, html_url: '#', assets: [] }];
          return new Response(JSON.stringify(releases), { status: 200, headers: { 'content-type': 'application/json', 'x-total-count': '51' } });
        }
        return globals.__forgejoOriginalFetch!(input, init);
      };
    });

    await harness.openForgejoSidebar();
    await evaluateInVSCode(async vscode => {
      await vscode.commands.executeCommand('forgejoReleases.focus');
      await vscode.commands.executeCommand('forgejo.refreshReleases');
    });
    const loadMore = workbox.locator('.monaco-list-row', { hasText: 'Load more releases' }).first();
    await expect(loadMore).toBeVisible({ timeout: 30_000 });
    await loadMore.click();
    await workbox.keyboard.press('Enter');
    await expect(workbox.locator('.monaco-list-row', { hasText: 'Release page two' }).first()).toBeVisible({ timeout: 30_000 });
  });
});
