import { CommitStatus } from '../../models/pullRequest';
import { openWorkflowFileForCIStatus, viewCIStatusLogs } from '../../commands/ciNavigation';
import { PRDetailWebviewProvider } from '../../webview/prDetail/provider';
import { getForgejoConfigFor } from '../../utils/config';

jest.mock('../../commands/ciNavigation', () => ({
  openWorkflowFileForCIStatus: jest.fn(),
  viewCIStatusLogs: jest.fn(),
}));
jest.mock('../../utils/config');

const mockGetForgejoConfigFor = getForgejoConfigFor as jest.MockedFunction<typeof getForgejoConfigFor>;

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

  function createProvider(): { provider: PRDetailWebviewProvider; postMessage: jest.Mock } {
    const provider = new PRDetailWebviewProvider({} as never);
	const postMessage = jest.fn();
    (provider as any)._panels.set('panel', {
	  panel: { webview: { postMessage } },
      owner: 'maxking',
      repo: 'forgejo-vscode',
      number: 191,
      instanceUrl: 'https://git.example.com',
      isReady: true,
      pendingData: null
    });
	return { provider, postMessage };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('routes failed status log requests through extension-side log navigation', async () => {
	const { provider } = createProvider();

    await (provider as any)._handleMessage({ type: 'viewCIStatusLogs', status }, 'panel');

    expect(viewCIStatusLogs).toHaveBeenCalledWith({
      status,
      owner: 'maxking',
      repo: 'forgejo-vscode',
      instanceUrl: 'https://git.example.com'
    });
  });

  test('routes workflow file requests with repository identity', async () => {
	const { provider } = createProvider();

    await (provider as any)._handleMessage({ type: 'openCIWorkflowFile', status }, 'panel');

    expect(openWorkflowFileForCIStatus).toHaveBeenCalledWith({
      status,
      owner: 'maxking',
      repo: 'forgejo-vscode',
      instanceUrl: 'https://git.example.com'
    });
  });

	test('delivers a fetch error that occurs before the webview is ready', async () => {
		const { provider, postMessage } = createProvider();
		(provider as any)._panels.get('panel').isReady = false;
		mockGetForgejoConfigFor.mockRejectedValueOnce(new Error('Authentication failed'));

		await (provider as any)._fetchPRData('panel');
		expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));

		await (provider as any)._handleMessage({ type: 'ready' }, 'panel');
		expect(postMessage).toHaveBeenCalledWith({ type: 'error', message: 'Authentication failed' });
	});
});
