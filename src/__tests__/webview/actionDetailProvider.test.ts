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

  it('falls back to the tree snapshot when the run lookup throws (e.g. 404 on older servers)', async () => {
    (getForgejoConfigFor as jest.Mock).mockResolvedValue({ instanceUrl: 'https://git.example', token: 'token' });
    const client = {
      getWorkflowRunByNumber: jest.fn().mockRejectedValue(new Error('404 Not Found')),
      getWorkflowRunDetails: jest.fn(),
      getWorkflowJobs: jest.fn()
    };
    (ForgejoClient as jest.MockedClass<typeof ForgejoClient>).mockImplementation(() => client as any);
    const provider = new ActionDetailWebviewProvider({} as never);
    (provider as any)._panels.set('panel', {
      panel: { webview: { postMessage: jest.fn() } }, owner: 'owner', repo: 'repo', runId: 123,
      run: { id: 123, run_number: 42, name: 'CI snapshot', created_at: '2026-01-01' }, isReady: false,
      pendingData: null, pendingError: null
    });

    await (provider as any)._fetchActionData('panel');

    const state = (provider as any)._panels.get('panel');
    expect(state.pendingError).toBeNull();
    expect(state.pendingData.run.name).toBe('CI snapshot');
    expect(state.pendingData.jobs).toEqual([]);
    expect(client.getWorkflowRunDetails).not.toHaveBeenCalled();
    expect(client.getWorkflowJobs).not.toHaveBeenCalled();
  });

  it('does not let a slower stale refresh overwrite newer action data', async () => {
    (getForgejoConfigFor as jest.Mock).mockResolvedValue({ instanceUrl: 'https://git.example', token: 'token' });
    let resolveFirst!: (value: any) => void;
    const firstLookup = new Promise(resolve => { resolveFirst = resolve; });
    const client = {
      getWorkflowRunByNumber: jest.fn().mockReturnValueOnce(firstLookup).mockResolvedValue({ id: 2 }),
      getWorkflowRunDetails: jest.fn().mockImplementation((_owner, _repo, id) => Promise.resolve({ id, name: `run-${String(id)}` })),
      getWorkflowJobs: jest.fn().mockResolvedValue({ jobs: [] })
    };
    (ForgejoClient as jest.MockedClass<typeof ForgejoClient>).mockImplementation(() => client as any);
    const provider = new ActionDetailWebviewProvider({} as never);
    (provider as any)._panels.set('panel', {
      panel: { webview: { postMessage: jest.fn() } }, owner: 'owner', repo: 'repo', runId: 1,
      run: { id: 1, run_number: 1, name: 'snapshot', created_at: '2026-01-01' }, isReady: false
    });

    const stale = (provider as any)._fetchActionData('panel');
    await (provider as any)._fetchActionData('panel');
    resolveFirst({ id: 1 });
    await stale;

    expect((provider as any)._panels.get('panel').pendingData.run.name).toBe('run-2');
  });
});
