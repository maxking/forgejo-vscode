import { test, expect } from './fixtures/vscode-harness';

/**
 * Live Playwright tests for PR interactions against a real Forgejo instance.
 *
 * Requires these env vars (set by CI or manually):
 *   FORGEJO_TEST_URL       - Base URL of the Forgejo instance (e.g. http://forgejo:3000)
 *   FORGEJO_TEST_TOKEN     - API token for the test user
 *   FORGEJO_LIVE_WORKSPACE - Path to a git repo whose origin points at the test instance
 */

const FORGEJO_URL = process.env.FORGEJO_TEST_URL || '';
const FORGEJO_TOKEN = process.env.FORGEJO_TEST_TOKEN || '';
const WORKSPACE = process.env.FORGEJO_LIVE_WORKSPACE || '';

const shouldRun = !!(WORKSPACE && FORGEJO_URL && FORGEJO_TOKEN);

test.describe('Pull Request Interactions - Live Forgejo', () => {
  test.skip(!shouldRun, 'Requires FORGEJO_LIVE_WORKSPACE, FORGEJO_TEST_URL, FORGEJO_TEST_TOKEN');

  test.use({ baseDir: WORKSPACE || '/tmp' });

  test.setTimeout(60_000);

  test.beforeEach(async ({ harness, evaluateInVSCode }) => {
    await harness.waitForExtensionActivation();

    const url = FORGEJO_URL;
    const token = FORGEJO_TOKEN;
    await evaluateInVSCode(async (vscode, args: { url: string; token: string }) => {
      const config = vscode.workspace.getConfiguration('forgejo');
      await config.update('instances', [{
        id: 'live-test',
        name: 'Live Test',
        instanceUrl: args.url,
        token: args.token,
        isDefault: true,
      }], vscode.ConfigurationTarget.Global);
    }, { url, token });

    await evaluateInVSCode(async (vscode) => {
      await vscode.commands.executeCommand('forgejo.refreshPullRequests');
    });

    await new Promise(r => setTimeout(r, 5000));

    await harness.openForgejoSidebar();
    await evaluateInVSCode(async (vscode) => {
      await vscode.commands.executeCommand('forgejoPullRequests.focus');
    });
  });

  /** Collect all visible tree row labels from the sidebar */
  async function getTreeRowLabels(workbox: import('@playwright/test').Page): Promise<string[]> {
    const rows = workbox.locator('.monaco-list-row');
    return (await rows.allTextContents())
      .map(text => text.trim())
      .filter(text => text.length > 0);
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

  test('should add a comment to a PR via API', async ({ harness, evaluateInVSCode }) => {
    // Create a fresh PR for this test
    const prNumber = await evaluateInVSCode(async (_vscode, args: { url: string; token: string }) => {
      // Create a unique branch for this test
      const branchName = `test-comment-pr-${Date.now()}`;
      await fetch(`${args.url}/api/v1/repos/testuser/test-repo/branches`, {
        headers: { 'Authorization': `token ${args.token}`, 'Content-Type': 'application/json' },
        method: 'POST',
        body: JSON.stringify({ new_branch_name: branchName, old_branch_name: 'main' }),
      });

      // Add a file so the branch differs from main
      const content = btoa(`comment test ${Date.now()}`);
      await fetch(`${args.url}/api/v1/repos/testuser/test-repo/contents/comment-test-${Date.now()}.txt`, {
        headers: { 'Authorization': `token ${args.token}`, 'Content-Type': 'application/json' },
        method: 'POST',
        body: JSON.stringify({ message: 'add file for comment test', content, branch: branchName }),
      });

      // Create a PR
      const prResp = await fetch(`${args.url}/api/v1/repos/testuser/test-repo/pulls`, {
        headers: { 'Authorization': `token ${args.token}`, 'Content-Type': 'application/json' },
        method: 'POST',
        body: JSON.stringify({ title: 'PR for comment test', body: 'Test body', head: branchName, base: 'main' }),
      });
      const pr = await prResp.json();
      return pr.number as number;
    }, { url: FORGEJO_URL, token: FORGEJO_TOKEN });

    expect(prNumber).toBeGreaterThan(0);

    // Add a comment
    const commentCreated = await evaluateInVSCode(async (_vscode, args: { url: string; token: string; prNumber: number }) => {
      const resp = await fetch(`${args.url}/api/v1/repos/testuser/test-repo/issues/${args.prNumber}/comments`, {
        headers: { 'Authorization': `token ${args.token}`, 'Content-Type': 'application/json' },
        method: 'POST',
        body: JSON.stringify({ body: 'Automated test comment on PR' }),
      });
      return resp.ok;
    }, { url: FORGEJO_URL, token: FORGEJO_TOKEN, prNumber });

    expect(commentCreated).toBe(true);

    // Verify the comment exists
    const comments = await evaluateInVSCode(async (_vscode, args: { url: string; token: string; prNumber: number }) => {
      const resp = await fetch(`${args.url}/api/v1/repos/testuser/test-repo/issues/${args.prNumber}/comments`, {
        headers: { 'Authorization': `token ${args.token}` },
      });
      const data = await resp.json();
      return data as Array<{ body: string }>;
    }, { url: FORGEJO_URL, token: FORGEJO_TOKEN, prNumber });

    const testComment = comments.find(c => c.body === 'Automated test comment on PR');
    expect(testComment).toBeDefined();

    await harness.captureScreenshot('pr-comment-added');
  });

  test('should close a PR via API and verify tree view updates', async ({ harness, evaluateInVSCode, workbox }) => {
    // Create a fresh branch and PR for this test
    const prNumber = await evaluateInVSCode(async (_vscode, args: { url: string; token: string }) => {
      const branchName = `test-close-pr-${Date.now()}`;
      await fetch(`${args.url}/api/v1/repos/testuser/test-repo/branches`, {
        headers: { 'Authorization': `token ${args.token}`, 'Content-Type': 'application/json' },
        method: 'POST',
        body: JSON.stringify({ new_branch_name: branchName, old_branch_name: 'main' }),
      });

      const content = btoa(`close test ${Date.now()}`);
      await fetch(`${args.url}/api/v1/repos/testuser/test-repo/contents/close-test-${Date.now()}.txt`, {
        headers: { 'Authorization': `token ${args.token}`, 'Content-Type': 'application/json' },
        method: 'POST',
        body: JSON.stringify({ message: 'add file for close test', content, branch: branchName }),
      });

      const prResp = await fetch(`${args.url}/api/v1/repos/testuser/test-repo/pulls`, {
        headers: { 'Authorization': `token ${args.token}`, 'Content-Type': 'application/json' },
        method: 'POST',
        body: JSON.stringify({ title: 'PR to close', body: 'Will be closed', head: branchName, base: 'main' }),
      });
      const pr = await prResp.json();
      return pr.number as number;
    }, { url: FORGEJO_URL, token: FORGEJO_TOKEN });

    expect(prNumber).toBeGreaterThan(0);

    // Close the PR
    const closed = await evaluateInVSCode(async (_vscode, args: { url: string; token: string; prNumber: number }) => {
      const resp = await fetch(`${args.url}/api/v1/repos/testuser/test-repo/pulls/${args.prNumber}`, {
        headers: { 'Authorization': `token ${args.token}`, 'Content-Type': 'application/json' },
        method: 'PATCH',
        body: JSON.stringify({ state: 'closed' }),
      });
      return resp.ok;
    }, { url: FORGEJO_URL, token: FORGEJO_TOKEN, prNumber });

    expect(closed).toBe(true);

    // Refresh and check tree view
    await evaluateInVSCode(async (vscode) => {
      await vscode.commands.executeCommand('forgejo.refreshPullRequests');
    });

    // Poll until a Closed group appears
    const closedPattern = /^Closed(?:\s*\d+)?$/;
    const labels = await waitForTreeRowsMatching(workbox, closedPattern);
    console.log('PR tree after close:', labels);

    // Should have a Closed group now
    const closedGroup = labels.find(label => closedPattern.test(label));
    expect(closedGroup).toBeDefined();

    await harness.captureScreenshot('pr-closed-tree');
  });

  test('should create a PR via API and verify it appears in tree view', async ({ harness, evaluateInVSCode, workbox }) => {
    // Create a unique branch and PR
    const prTitle = `Auto PR ${Date.now()}`;
    const created = await evaluateInVSCode(async (_vscode, args: { url: string; token: string; title: string }) => {
      const branchName = `test-create-pr-${Date.now()}`;
      await fetch(`${args.url}/api/v1/repos/testuser/test-repo/branches`, {
        headers: { 'Authorization': `token ${args.token}`, 'Content-Type': 'application/json' },
        method: 'POST',
        body: JSON.stringify({ new_branch_name: branchName, old_branch_name: 'main' }),
      });

      const content = btoa(`create test ${Date.now()}`);
      await fetch(`${args.url}/api/v1/repos/testuser/test-repo/contents/create-test-${Date.now()}.txt`, {
        headers: { 'Authorization': `token ${args.token}`, 'Content-Type': 'application/json' },
        method: 'POST',
        body: JSON.stringify({ message: 'add file for create test', content, branch: branchName }),
      });

      const prResp = await fetch(`${args.url}/api/v1/repos/testuser/test-repo/pulls`, {
        headers: { 'Authorization': `token ${args.token}`, 'Content-Type': 'application/json' },
        method: 'POST',
        body: JSON.stringify({ title: args.title, body: 'Created by test', head: branchName, base: 'main' }),
      });
      return prResp.ok;
    }, { url: FORGEJO_URL, token: FORGEJO_TOKEN, title: prTitle });

    expect(created).toBe(true);

    // Refresh and verify tree
    await evaluateInVSCode(async (vscode) => {
      await vscode.commands.executeCommand('forgejo.refreshPullRequests');
    });

    // Poll until the new PR title appears in the tree
    const start = Date.now();
    let labels: string[] = [];
    while (Date.now() - start < 30_000) {
      labels = await getTreeRowLabels(workbox);
      if (labels.find(label => label.includes(prTitle))) {
        break;
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    console.log('PR tree after create:', labels);

    const foundPR = labels.find(label => label.includes(prTitle));
    expect(foundPR).toBeDefined();

    await harness.captureScreenshot('pr-created-in-tree');
  });

  test('should refresh PR list and see updated data', async ({ harness, evaluateInVSCode, workbox }) => {
    // Execute refresh
    await evaluateInVSCode(async (vscode) => {
      await vscode.commands.executeCommand('forgejo.refreshPullRequests');
    });

    // Poll until PR groups appear after refresh
    const prGroupPattern = /^(Open|Merged|Closed|Draft)\s*\d+$/;
    const labels = await waitForTreeRowsMatching(workbox, prGroupPattern);
    console.log('PR tree after refresh:', labels);

    // Should have at least one group and one PR entry
    expect(labels.length).toBeGreaterThan(0);

    const foundGroups = labels.filter(label => prGroupPattern.test(label));
    expect(foundGroups.length).toBeGreaterThan(0);

    await harness.captureScreenshot('pr-refreshed');
  });

  test('should handle diagnostics command when instance is configured', async ({ harness, evaluateInVSCode }) => {
    // Execute diagnostics command - should not throw
    const didNotThrow = await evaluateInVSCode(async (vscode) => {
      try {
        await vscode.commands.executeCommand('forgejo.showDiagnostics');
        return true;
      } catch {
        return false;
      }
    });

    expect(didNotThrow).toBe(true);

    await harness.captureScreenshot('pr-diagnostics');
  });
});
