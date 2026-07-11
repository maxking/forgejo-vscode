import { test, expect } from './fixtures/vscode-harness';
import path from 'path';
import { execSync } from 'child_process';

// Open VS Code with the project root as workspace so git remote/branch detection
// operate on this real checkout, exactly like pr-list.spec.ts.
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

function getCurrentBranch(): string {
  return execSync('git rev-parse --abbrev-ref HEAD', { cwd: PROJECT_ROOT, encoding: 'utf-8' }).trim();
}

test.describe('Branch status bar item (mocked)', () => {
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

  test('shows the linked open pull request and CI status for the current branch', async ({ harness, evaluateInVSCode, workbox }) => {
    await harness.waitForExtensionActivation();
    const branch = getCurrentBranch();

    await evaluateInVSCode((vscode, branchName: string) => {
      type FetchGlobals = typeof globalThis & { __forgejoOriginalFetch?: typeof fetch };
      const globals = globalThis as FetchGlobals;
      globals.__forgejoOriginalFetch ??= globalThis.fetch;

      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

        if (url.includes('/api/v1/repos/maxking/forgejo-vscode/pulls')) {
          const parsed = new URL(url);
          if (parsed.searchParams.get('state') === 'open') {
            return new Response(JSON.stringify([{
              number: 4242,
              title: 'Status bar test PR',
              state: 'open',
              user: { login: 'alice' },
              html_url: 'https://codeberg.org/maxking/forgejo-vscode/pulls/4242',
              created_at: '2026-01-01T00:00:00Z',
              merged: false,
              draft: false,
              comments: 0,
              head: { ref: branchName, sha: 'deadbeef' },
              base: { ref: 'master' }
            }]), { status: 200, headers: { 'content-type': 'application/json', 'x-total-count': '1' } });
          }
        }

        if (url.includes('/api/v1/repos/maxking/forgejo-vscode/statuses/deadbeef')) {
          return new Response(JSON.stringify([{
            id: 1,
            status: 'success',
            context: 'ci/test',
            description: 'All checks passed',
            target_url: 'https://codeberg.org/maxking/forgejo-vscode/actions/runs/1',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z'
          }]), { status: 200, headers: { 'content-type': 'application/json', 'x-total-count': '1' } });
        }

        return globals.__forgejoOriginalFetch!(input, init);
      };
    }, branch);

    await evaluateInVSCode(async (vscode) => {
      const config = vscode.workspace.getConfiguration('forgejo');
      await config.update('autoDetectFromRemote', false, vscode.ConfigurationTarget.Global);
      await config.update('instances', [{
        id: 'test-forgejo-status-bar',
        name: 'Forgejo Status Bar Test',
        instanceUrl: 'https://codeberg.org',
        token: '',
        isDefault: true,
      }], vscode.ConfigurationTarget.Global);
    });

    const statusBarItem = workbox.locator('.statusbar-item', { hasText: '#4242' });
    await expect(statusBarItem).toBeVisible({ timeout: 30_000 });
  });

  test('keeps the status bar item hidden when no Forgejo instance is configured', async ({ harness, evaluateInVSCode, workbox }) => {
    await harness.waitForExtensionActivation();

    await evaluateInVSCode(async (vscode) => {
      const config = vscode.workspace.getConfiguration('forgejo');
      await config.update('instances', [], vscode.ConfigurationTarget.Global);
      await config.update('autoDetectFromRemote', false, vscode.ConfigurationTarget.Global);
    });

    // Give the debounced refresh a chance to run; there is nothing to wait
    // for becoming visible, so a short fixed wait is the least flaky option.
    await new Promise(r => setTimeout(r, 1500));

    await expect(workbox.locator('.statusbar-item', { hasText: /git-pull-request|#\d+/ })).toHaveCount(0);
  });
});
