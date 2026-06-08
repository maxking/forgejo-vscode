import { test, expect } from './fixtures/vscode-harness';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const PARENT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'forgejo-nested-repos-'));

function runGit(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function makeRepo(parent: string, relativeDir: string, remoteUrl: string): string {
  const repoDir = path.join(parent, relativeDir);
  fs.mkdirSync(repoDir, { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'README.md'), `# ${relativeDir}\n`);

  runGit(repoDir, ['init']);
  runGit(repoDir, ['config', 'user.name', 'Forgejo E2E Test']);
  runGit(repoDir, ['config', 'user.email', 'forgejo-e2e@example.test']);
  runGit(repoDir, ['config', 'commit.gpgsign', 'false']);
  runGit(repoDir, ['remote', 'add', 'origin', remoteUrl]);
  runGit(repoDir, ['add', 'README.md']);
  runGit(repoDir, ['commit', '-m', 'Initial commit']);

  return repoDir;
}

function createNestedWorkspace(): { repoA: string; repoB: string; repoC: string } {
  fs.writeFileSync(path.join(PARENT_DIR, 'parent.txt'), 'workspace parent is not a git repository\n');
  fs.mkdirSync(path.join(PARENT_DIR, '.vscode'), { recursive: true });
  fs.writeFileSync(path.join(PARENT_DIR, '.vscode', 'settings.json'), JSON.stringify({
    'git.autoRepositoryDetection': 'subFolders',
    'git.repositoryScanMaxDepth': 4,
    'forgejo.instances': [{
      id: 'codeberg',
      name: 'Codeberg',
      instanceUrl: 'https://codeberg.org',
      token: '',
      isDefault: true,
    }],
  }, null, 2));

  return {
    repoA: makeRepo(PARENT_DIR, 'repo-a', 'https://codeberg.org/maxking/forgejo-vscode.git'),
    repoB: makeRepo(PARENT_DIR, 'repo-b', 'https://codeberg.org/forgejo/forgejo.git'),
    repoC: makeRepo(PARENT_DIR, path.join('packages', 'repo-c'), 'https://codeberg.org/forgejo-contrib/forgejo-cli.git'),
  };
}

const REPOS = createNestedWorkspace();

async function waitForTreeLabels(workbox: import('@playwright/test').Page, expected: string[]): Promise<string[]> {
  const started = Date.now();
  let labels: string[] = [];
  while (Date.now() - started < 20_000) {
    const rows = workbox.locator('.monaco-list-row');
    const count = await rows.count();
    labels = [];
    for (let i = 0; i < count; i++) {
      const text = await rows.nth(i).textContent();
      if (text) {
        labels.push(text.trim());
      }
    }
    if (expected.every(label => labels.some(row => row.includes(label)))) {
      return labels;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return labels;
}

test.describe('Nested repository detection', () => {
  test.use({ baseDir: PARENT_DIR });
  test.setTimeout(60_000);

  test.afterAll(async () => {
    await fs.promises.rm(PARENT_DIR, { recursive: true, force: true });
  });

  test('uses VS Code Git nested repository detection for Forgejo config', async ({
    harness,
    evaluateInVSCode,
  }) => {
    await harness.waitForExtensionActivation();

    const gitRepoRoots = await evaluateInVSCode(async (vscode) => {
      const gitExtension = vscode.extensions.getExtension('vscode.git');
      const git = gitExtension ? await gitExtension.activate() : undefined;
      const api = git?.getAPI(1);

      const started = Date.now();
      while (Date.now() - started < 20_000) {
        const roots = api?.repositories.map((repo: { rootUri: { fsPath: string } }) => repo.rootUri.fsPath).sort() ?? [];
        if (roots.length >= 3) {
          return roots;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      return api?.repositories.map((repo: { rootUri: { fsPath: string } }) => repo.rootUri.fsPath).sort() ?? [];
    });

    expect(gitRepoRoots).toContain(REPOS.repoA);
    expect(gitRepoRoots).toContain(REPOS.repoB);
    expect(gitRepoRoots).toContain(REPOS.repoC);

    async function activeForgejoConfigReport(relativeFile: string): Promise<string> {
      return await evaluateInVSCode(async (vscode, rel: string) => {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
          throw new Error('Expected workspace folder');
        }

        const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder.uri, rel));
        await vscode.window.showTextDocument(doc);

        const report = await vscode.commands.executeCommand<string>('forgejo.showDiagnostics');
        if (!report) {
          throw new Error('Expected diagnostics command to return a report');
        }
        return report;
      }, relativeFile);
    }

    const repoAReport = await activeForgejoConfigReport('repo-a/README.md');
    expect(repoAReport).toContain('- Owner: maxking');
    expect(repoAReport).toContain('- Repo: forgejo-vscode');

    const repoBReport = await activeForgejoConfigReport('repo-b/README.md');
    expect(repoBReport).toContain('- Owner: forgejo');
    expect(repoBReport).toContain('- Repo: forgejo');

    const repoCReport = await activeForgejoConfigReport('packages/repo-c/README.md');
    expect(repoCReport).toContain('- Owner: forgejo-contrib');
    expect(repoCReport).toContain('- Repo: forgejo-cli');
  });

  test('nests Forgejo pull request view by detected repository name', async ({
    harness,
    evaluateInVSCode,
    workbox,
  }) => {
    await harness.waitForExtensionActivation();
    await harness.openForgejoSidebar();

    await evaluateInVSCode(async (vscode) => {
      await vscode.commands.executeCommand('forgejoPullRequests.focus');
      await vscode.commands.executeCommand('forgejo.refreshPullRequests');
    });

    const labels = await waitForTreeLabels(workbox, [
      'maxking/forgejo-vscode',
      'forgejo/forgejo',
      'forgejo-contrib/forgejo-cli',
    ]);

    expect(labels.some(label => label.includes('maxking/forgejo-vscode'))).toBe(true);
    expect(labels.some(label => label.includes('forgejo/forgejo'))).toBe(true);
    expect(labels.some(label => label.includes('forgejo-contrib/forgejo-cli'))).toBe(true);
  });
});
