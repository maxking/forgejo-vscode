import { test, expect } from './fixtures/vscode-harness';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const WORKSPACE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'forgejo-start-work-'));
const ISSUE_BRANCH = 'issue/188-add-start-work-on-issue-command';

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

function createWorkspace(): void {
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  fs.writeFileSync(path.join(WORKSPACE_DIR, 'README.md'), '# start work e2e\n');
  fs.mkdirSync(path.join(WORKSPACE_DIR, '.vscode'), { recursive: true });
  fs.writeFileSync(path.join(WORKSPACE_DIR, '.vscode', 'settings.json'), JSON.stringify({
    'forgejo.instances': [{
      id: 'codeberg',
      name: 'Codeberg',
      instanceUrl: 'https://codeberg.org',
      token: '',
      isDefault: true,
    }],
    'forgejo.autoDetectFromRemote': false,
    'forgejo.startWorkOnIssueBaseRef': 'origin/master',
  }, null, 2));

  runGit(WORKSPACE_DIR, ['init', '--initial-branch=master']);
  runGit(WORKSPACE_DIR, ['config', 'user.name', 'Forgejo E2E Test']);
  runGit(WORKSPACE_DIR, ['config', 'user.email', 'forgejo-e2e@example.test']);
  runGit(WORKSPACE_DIR, ['config', 'commit.gpgsign', 'false']);
  runGit(WORKSPACE_DIR, ['remote', 'add', 'origin', 'https://codeberg.org/maxking/forgejo-vscode.git']);
  runGit(WORKSPACE_DIR, ['add', 'README.md']);
  runGit(WORKSPACE_DIR, ['commit', '-m', 'Initial commit']);
  runGit(WORKSPACE_DIR, ['update-ref', 'refs/remotes/origin/master', 'master']);
}

createWorkspace();

test.describe('Start work on issue', () => {
  test.use({ baseDir: WORKSPACE_DIR });
  test.setTimeout(60_000);

  test.afterAll(async () => {
    await fs.promises.rm(WORKSPACE_DIR, { recursive: true, force: true });
  });

  test('creates and checks out an issue branch from the configured base ref', async ({
    harness,
    evaluateInVSCode,
  }) => {
    await harness.waitForExtensionActivation();

    const result = await evaluateInVSCode(async (vscode, args: { branchName: string }) => {
      const gitExtension = vscode.extensions.getExtension('vscode.git');
      const git = gitExtension ? await gitExtension.activate() : undefined;
      const api = git?.getAPI(1);

      const started = Date.now();
      while (Date.now() - started < 20_000) {
        if ((api?.repositories.length ?? 0) > 0) {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      const originalShowQuickPick = vscode.window.showQuickPick;
      const originalShowWarningMessage = vscode.window.showWarningMessage;
      const originalShowInformationMessage = vscode.window.showInformationMessage;

      try {
        (vscode.window as unknown as {
          showQuickPick: typeof vscode.window.showQuickPick;
          showWarningMessage: typeof vscode.window.showWarningMessage;
          showInformationMessage: typeof vscode.window.showInformationMessage;
        }).showQuickPick = async (items: unknown) => {
          const picks = await Promise.resolve(items) as Array<{ branchName?: string }>;
          const branchPick = picks.find(pick => pick.branchName === args.branchName);
          if (!branchPick) {
            throw new Error(`Branch pick ${args.branchName} not found`);
          }
          return branchPick as never;
        };
        (vscode.window as unknown as { showWarningMessage: typeof vscode.window.showWarningMessage }).showWarningMessage = async (_message: string, _optionsOrFirstItem?: unknown, ...items: string[]) => {
          return (items.find(item => item === 'Checkout Existing Branch') ?? 'Continue') as never;
        };
        (vscode.window as unknown as { showInformationMessage: typeof vscode.window.showInformationMessage }).showInformationMessage = async () => undefined as never;

        await vscode.commands.executeCommand('forgejo.startWorkOnIssue', {
          number: 188,
          title: 'Add start-work-on-issue command',
          state: 'open',
          comments: 0,
          user: { login: 'alice' },
          html_url: 'https://codeberg.org/maxking/forgejo-vscode/issues/188',
        }, 'maxking', 'forgejo-vscode', 'https://codeberg.org');
      } finally {
        (vscode.window as unknown as { showQuickPick: typeof vscode.window.showQuickPick }).showQuickPick = originalShowQuickPick;
        (vscode.window as unknown as { showWarningMessage: typeof vscode.window.showWarningMessage }).showWarningMessage = originalShowWarningMessage;
        (vscode.window as unknown as { showInformationMessage: typeof vscode.window.showInformationMessage }).showInformationMessage = originalShowInformationMessage;
      }

      const repository = api?.repositories[0];
      return {
        head: repository?.state.HEAD?.name,
        branchCommit: await repository?.getBranch(args.branchName).then((branch: { commit?: string }) => branch.commit),
        originMasterCommit: await repository?.getBranch('origin/master').then((branch: { commit?: string }) => branch.commit),
      };
    }, { branchName: ISSUE_BRANCH });

    expect(result.head).toBe(ISSUE_BRANCH);
    expect(result.branchCommit).toBe(result.originMasterCommit);
  });
});
