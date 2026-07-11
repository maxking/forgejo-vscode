import { PRDetailWebviewProvider } from '../../webview/prDetail/provider';
import { ForgejoClient } from '../../api/forgejoClient';
import { execFile } from 'child_process';

jest.mock('../../api/forgejoClient');
jest.mock('child_process', () => ({ execFile: jest.fn((_command, _args, _options, callback) => callback(null)) }));
jest.mock('../../utils/logger', () => ({ logInfo: jest.fn(), logDebug: jest.fn(), logError: jest.fn() }));

describe('PR detail Git actions', () => {
  const matching = { name: 'upstream', fetchUrl: 'git@git.example.com:owner/repo.git' };
  const repository = {
    rootUri: { fsPath: '/workspace/repo' },
    state: { remotes: [{ name: 'origin', fetchUrl: 'git@other.example.com:fork/repo.git' }, matching] },
    fetch: jest.fn().mockResolvedValue(undefined),
    checkout: jest.fn().mockRejectedValue(new Error('missing branch')),
    createBranch: jest.fn().mockResolvedValue(undefined)
  };

  beforeEach(() => {
    jest.clearAllMocks();
    repository.checkout.mockRejectedValue(new Error('missing branch'));
    (execFile as unknown as jest.Mock).mockImplementation((_command, _args, _options, callback) => callback(null));
    (ForgejoClient as jest.MockedClass<typeof ForgejoClient>).mockImplementation(() => ({
      getPullRequestDetails: jest.fn().mockResolvedValue({ head: { sha: 'abcdef1234567890' } })
    }) as any);
  });

  it('fetches checkout and revert objects from the exact matching remote', async () => {
    const provider = new PRDetailWebviewProvider({} as never);
    (provider as any)._getConfig = jest.fn().mockResolvedValue({ instanceUrl: 'https://git.example.com', token: 'token' });
    (provider as any)._selectLocalRepository = jest.fn().mockResolvedValue(repository);

    await (provider as any)._checkoutBranch('owner', 'repo', 42, 'https://git.example.com');
    await (provider as any)._revertCommit('abcdef1234567890', 'owner', 'repo', 42, 'https://git.example.com');

    expect(repository.fetch).toHaveBeenNthCalledWith(1, 'upstream', 'refs/pull/42/head');
    expect(repository.fetch).toHaveBeenNthCalledWith(2, 'upstream', 'refs/pull/42/head');
    expect(execFile).toHaveBeenCalledWith('git', ['revert', 'abcdef1234567890'], { cwd: '/workspace/repo' }, expect.any(Function));
  });
});
