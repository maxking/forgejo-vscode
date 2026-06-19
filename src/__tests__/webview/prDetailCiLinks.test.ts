import { CommitStatus } from '../../models/pullRequest';
import { openWorkflowFileForCIStatus, viewCIStatusLogs } from '../../commands/ciNavigation';
import { PRDetailWebviewProvider } from '../../webview/prDetail/provider';

jest.mock('../../commands/ciNavigation', () => ({
  openWorkflowFileForCIStatus: jest.fn(),
  viewCIStatusLogs: jest.fn(),
}));

describe('PR detail CI links', () => {
  const status: CommitStatus = {
    id: 7,
    status: 'failure',
    context: 'Test / smoke-test-vsix (pull_request)',
    description: 'Failing after 0s',
    target_url: '/maxking/forgejo-vscode/actions/runs/359/jobs/2',
    created_at: '2026-02-22T06:30:57Z',
    updated_at: '2026-02-22T06:30:57Z'
  };

  function createProvider(): PRDetailWebviewProvider {
    const provider = new PRDetailWebviewProvider({} as never);
    (provider as any)._panels.set('panel', {
      panel: { webview: { postMessage: jest.fn() } },
      owner: 'maxking',
      repo: 'forgejo-vscode',
      number: 191,
      instanceUrl: 'https://git.example.com',
      isReady: true,
      pendingData: null
    });
    return provider;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('routes failed status log requests through extension-side log navigation', async () => {
    const provider = createProvider();

    await (provider as any)._handleMessage({ type: 'viewCIStatusLogs', status }, 'panel');

    expect(viewCIStatusLogs).toHaveBeenCalledWith({
      status,
      owner: 'maxking',
      repo: 'forgejo-vscode',
      instanceUrl: 'https://git.example.com'
    });
  });

  test('routes workflow file requests with repository identity', async () => {
    const provider = createProvider();

    await (provider as any)._handleMessage({ type: 'openCIWorkflowFile', status }, 'panel');

    expect(openWorkflowFileForCIStatus).toHaveBeenCalledWith({
      status,
      owner: 'maxking',
      repo: 'forgejo-vscode',
      instanceUrl: 'https://git.example.com'
    });
  });
});

