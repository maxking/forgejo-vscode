import * as vscode from 'vscode';
import { ForgejoClient } from '../../api/forgejoClient';
import { getForgejoConfigFor } from '../../utils/config';
import {
  findWorkflowFileForStatus,
  parseActionJobTarget,
  resolveStatusTargetUrl,
  viewCIStatusLogs,
} from '../../commands/ciNavigation';
import { CommitStatus } from '../../models/pullRequest';

jest.mock('../../api/forgejoClient');
jest.mock('../../utils/config');

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
});

