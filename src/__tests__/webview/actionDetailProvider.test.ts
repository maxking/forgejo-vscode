import { ActionDetailWebviewProvider } from '../../webview/actionDetail/provider';
import { ForgejoClient } from '../../api/forgejoClient';
import { getForgejoConfigFor } from '../../utils/config';

jest.mock('../../api/forgejoClient');
jest.mock('../../utils/config');
jest.mock('../../utils/logger', () => ({ logInfo: jest.fn(), logDebug: jest.fn(), logError: jest.fn() }));

describe('ActionDetailWebviewProvider run identity', () => {
  it('resolves run_number and calls run endpoints with the distinct API id', async () => {
    (getForgejoConfigFor as jest.Mock).mockResolvedValue({ instanceUrl: 'https://git.example', owner: 'owner', repo: 'repo', token: 'token' });
    const client = {
      getWorkflowRunByNumber: jest.fn().mockResolvedValue({ id: 9001, run_number: 42 }),
      getWorkflowRunDetails: jest.fn().mockResolvedValue({ id: 9001, run_number: 42, name: 'CI' }),
      getWorkflowJobs: jest.fn().mockResolvedValue({ jobs: [] })
    };
    (ForgejoClient as jest.MockedClass<typeof ForgejoClient>).mockImplementation(() => client as any);
    const provider = new ActionDetailWebviewProvider({} as never);
    (provider as any)._panels.set('panel', {
      panel: { webview: { postMessage: jest.fn() } }, owner: 'owner', repo: 'repo', runId: 123,
      run: { id: 123, run_number: 42, name: 'CI', created_at: '2026-01-01' }, isReady: false,
      pendingData: null, pendingError: null
    });

    await (provider as any)._fetchActionData('panel');

    expect(client.getWorkflowRunByNumber).toHaveBeenCalledWith('owner', 'repo', 42);
    expect(client.getWorkflowRunDetails).toHaveBeenCalledWith('owner', 'repo', 9001);
    expect(client.getWorkflowJobs).toHaveBeenCalledWith('owner', 'repo', 9001);
  });
});
