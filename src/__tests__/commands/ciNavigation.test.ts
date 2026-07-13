import * as vscode from 'vscode';
import { ForgejoClient } from '../../api/forgejoClient';
import { getForgejoConfigFor } from '../../utils/config';
import {
  findWorkflowFileForStatus,
  openWorkflowFileForRepository,
  openWorkflowFileForCIStatus,
  parseActionJobTarget,
  resolveStatusTargetUrl,
  viewCIStatusLogs,
} from '../../commands/ciNavigation';
import { CommitStatus } from '../../models/pullRequest';
import { activateGitExtension } from '../../utils/gitExtension';

jest.mock('../../api/forgejoClient');
jest.mock('../../utils/config');
jest.mock('../../utils/gitExtension');

const mockActivateGitExtension = activateGitExtension as jest.MockedFunction<typeof activateGitExtension>;

function createRepository(rootPath: string, remoteUrl: string) {
  return {
    rootUri: vscode.Uri.file(rootPath),
    state: {
      HEAD: { name: 'main' },
      remotes: [{ name: 'origin', fetchUrl: remoteUrl }],
      indexChanges: [],
      workingTreeChanges: [],
      mergeChanges: [],
    },
  };
}

function mockGitApi(repositories: any[]) {
  mockActivateGitExtension.mockResolvedValue({
    enabled: true,
    getAPI: () => ({
      repositories,
      getRepository: jest.fn(),
    }),
  } as any);
}

describe('ciNavigation', () => {
  const status: CommitStatus = {
    id: 7,
    status: 'failure',
    context: 'Test / smoke-test-vsix (pull_request)',
    description: 'Failing after 0s',
    target_url: '/maxking/forgejo-vscode/actions/runs/359/jobs/2',
    created_at: '2026-02-22T06:30:57Z',
    updated_at: '2026-02-22T06:30:57Z'
  };

  const config = {
    instanceUrl: 'https://git.example.com',
    owner: 'maxking',
    repo: 'forgejo-vscode',
    token: 'token'
  };

  let mockClient: jest.Mocked<ForgejoClient>;

  beforeEach(() => {
    jest.clearAllMocks();
    (getForgejoConfigFor as jest.MockedFunction<typeof getForgejoConfigFor>).mockResolvedValue(config);
    mockClient = {
      getWorkflowLogs: jest.fn().mockResolvedValue('failed log output')
    } as any;
    (ForgejoClient as jest.MockedClass<typeof ForgejoClient>).mockImplementation(() => mockClient);
    mockActivateGitExtension.mockResolvedValue(undefined as any);
    (vscode.window.withProgress as jest.Mock).mockImplementation(async (_options, task) => task());
    (vscode.workspace.openTextDocument as jest.Mock).mockImplementation(async (input) => {
      if (typeof input === 'object' && 'content' in input) {
        return { getText: () => input.content, uri: vscode.Uri.file('/tmp/log.txt') };
      }
      return { getText: () => 'name: Test\non: push\njobs:\n  test:\n    runs-on: docker\n    steps:\n      - run: npm test\n', uri: input };
    });
  });

  test('resolves relative Forgejo status URLs against the configured instance', () => {
    expect(resolveStatusTargetUrl(status.target_url, config.instanceUrl))
      .toBe('https://git.example.com/maxking/forgejo-vscode/actions/runs/359/jobs/2');
  });

  test('parses Forgejo Actions job targets', () => {
    expect(parseActionJobTarget('https://git.example.com/maxking/forgejo-vscode/actions/runs/359/jobs/2')).toEqual({
      runNumber: 359,
      jobIndex: 2,
      url: 'https://git.example.com/maxking/forgejo-vscode/actions/runs/359/jobs/2'
    });
  });

  test('fetches Forgejo Actions logs for a failed status', async () => {
    await viewCIStatusLogs({ status, owner: 'maxking', repo: 'forgejo-vscode' });

    expect(mockClient.getWorkflowLogs).toHaveBeenCalledWith(
      'maxking',
      'forgejo-vscode',
      359,
      {
        jobHtmlUrl: 'https://git.example.com/maxking/forgejo-vscode/actions/runs/359/jobs/2',
        jobIndex: 2,
        jobName: 'Test / smoke-test-vsix (pull_request)'
      }
    );
    expect(vscode.window.showTextDocument).toHaveBeenCalled();
  });

  test('opens external CI status URLs when they are not Forgejo Actions jobs', async () => {
    await viewCIStatusLogs({
      status: { ...status, target_url: 'https://ci.example.com/build/1' },
      owner: 'maxking',
      repo: 'forgejo-vscode'
    });

    expect(mockClient.getWorkflowLogs).not.toHaveBeenCalled();
    expect(vscode.env.openExternal).toHaveBeenCalledWith(vscode.Uri.parse('https://ci.example.com/build/1'));
  });

  test('finds a matching local workflow file by workflow name', async () => {
    const uri = vscode.Uri.file('/repo/.forgejo/workflows/test.yml');
    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([uri]);
    (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue({
      uri,
      getText: () => 'name: Test\non: push\njobs:\n  test:\n    runs-on: docker\n    steps:\n      - run: npm test\n'
    });

    await expect(findWorkflowFileForStatus(status)).resolves.toBe(uri);
  });

  test('opens the workflow file from the matching PR repository root', async () => {
    const repoA = createRepository('/workspace/repo-a', 'git@git.example.com:owner/repo-a.git');
    const repoB = createRepository('/workspace/repo-b', 'git@git.example.com:owner/repo-b.git');
    const repoAWorkflow = vscode.Uri.file('/workspace/repo-a/.forgejo/workflows/test.yml');
    const repoBWorkflow = vscode.Uri.file('/workspace/repo-b/.forgejo/workflows/test.yml');
    mockGitApi([repoA, repoB]);
    (vscode.workspace.findFiles as jest.Mock).mockImplementation(async (pattern) => {
      if (pattern.base === '/workspace/repo-a') {
        return [repoAWorkflow];
      }
      if (pattern.base === '/workspace/repo-b') {
        return [repoBWorkflow];
      }
      return [];
    });
    (vscode.workspace.openTextDocument as jest.Mock).mockImplementation(async (input) => ({
      uri: input,
      getText: () => 'name: Test\non: push\njobs:\n  test:\n    runs-on: docker\n    steps:\n      - run: npm test\n'
    }));

    await openWorkflowFileForCIStatus({
      status,
      owner: 'owner',
      repo: 'repo-b',
      instanceUrl: 'https://git.example.com'
    });

    expect(vscode.workspace.findFiles).toHaveBeenCalledWith(
      expect.objectContaining({ base: '/workspace/repo-b' }),
      '**/node_modules/**',
      100
    );
    expect(vscode.workspace.findFiles).not.toHaveBeenCalledWith(
      expect.objectContaining({ base: '/workspace/repo-a' }),
      expect.anything(),
      expect.anything()
    );
    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ uri: repoBWorkflow }),
      { preview: true }
    );
  });

  test('does not open unrelated workflow files when no local repository matches the PR identity', async () => {
    const repoA = createRepository('/workspace/repo-a', 'git@git.example.com:owner/repo-a.git');
    mockGitApi([repoA]);
    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([
      vscode.Uri.file('/workspace/repo-a/.forgejo/workflows/test.yml')
    ]);

    await openWorkflowFileForCIStatus({
      status,
      owner: 'owner',
      repo: 'repo-b',
      instanceUrl: 'https://git.example.com'
    });

    expect(vscode.workspace.findFiles).not.toHaveBeenCalled();
    expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('No local workflow file matched "Test".');
  });

  test('falls back to a workspace-wide search when the git extension is unavailable', async () => {
    mockActivateGitExtension.mockResolvedValue(undefined as any);
    const workflow = vscode.Uri.file('/workspace/.forgejo/workflows/test.yml');
    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([workflow]);
    (vscode.workspace.openTextDocument as jest.Mock).mockImplementation(async (input) => ({
      uri: input,
      getText: () => 'name: Test\non: push\njobs:\n  test:\n    runs-on: docker\n    steps:\n      - run: npm test\n'
    }));

    await openWorkflowFileForCIStatus({
      status,
      owner: 'owner',
      repo: 'repo-b',
      instanceUrl: 'https://git.example.com'
    });

    expect(vscode.workspace.findFiles).toHaveBeenCalledWith('**/.forgejo/workflows/*.{yml,yaml}', '**/node_modules/**', 100);
    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ uri: workflow }),
      { preview: true }
    );
  });

  test('falls back to a workspace-wide search when no git repositories are open', async () => {
    mockGitApi([]);
    const workflow = vscode.Uri.file('/workspace/.forgejo/workflows/ci.yml');
    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([workflow]);
    (vscode.workspace.openTextDocument as jest.Mock).mockImplementation(async (input) => ({
      uri: input,
      getText: () => 'name: CI\non: push\njobs:\n  test:\n    runs-on: docker\n    steps:\n      - run: npm test\n'
    }));

    await openWorkflowFileForRepository({
      workflowName: 'ci.yml',
      owner: 'owner',
      repo: 'nested',
      instanceUrl: 'https://git.example.com'
    });

    expect(vscode.workspace.findFiles).toHaveBeenCalledWith('**/.github/workflows/*.{yml,yaml}', '**/node_modules/**', 100);
    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ uri: workflow }),
      { preview: true }
    );
  });

  test('opens an Actions tree workflow file only from the selected repository root', async () => {
    const parentRepo = createRepository('/workspace', 'git@git.example.com:owner/parent.git');
    const nestedRepo = createRepository('/workspace/nested', 'git@git.example.com:owner/nested.git');
    const parentWorkflow = vscode.Uri.file('/workspace/.forgejo/workflows/ci.yml');
    const nestedWorkflow = vscode.Uri.file('/workspace/nested/.forgejo/workflows/ci.yml');
    mockGitApi([parentRepo, nestedRepo]);
    (vscode.workspace.findFiles as jest.Mock).mockImplementation(async (pattern) => {
      if (pattern.base === '/workspace') {
        return [parentWorkflow];
      }
      if (pattern.base === '/workspace/nested') {
        return [nestedWorkflow];
      }
      return [];
    });
    (vscode.workspace.openTextDocument as jest.Mock).mockImplementation(async (input) => ({
      uri: input,
      getText: () => 'name: CI\non: push\njobs:\n  test:\n    runs-on: docker\n    steps:\n      - run: npm test\n'
    }));

    await openWorkflowFileForRepository({
      workflowName: 'ci.yml',
      owner: 'owner',
      repo: 'nested',
      instanceUrl: 'https://git.example.com'
    });

    expect(vscode.workspace.findFiles).toHaveBeenCalledWith(
      expect.objectContaining({ base: '/workspace/nested' }),
      '**/node_modules/**',
      100
    );
    expect(vscode.workspace.findFiles).not.toHaveBeenCalledWith(
      expect.objectContaining({ base: '/workspace' }),
      expect.anything(),
      expect.anything()
    );
    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ uri: nestedWorkflow }),
      { preview: true }
    );
  });
});
