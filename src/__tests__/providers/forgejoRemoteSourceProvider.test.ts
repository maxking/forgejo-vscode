import { ForgejoRemoteSourceProvider } from '../../providers/forgejoRemoteSourceProvider';
import { ForgejoInstance } from '../../models/instance';
import { ForgejoClient } from '../../api/forgejoClient';

jest.mock('../../api/forgejoClient', () => ({
	ForgejoClient: jest.fn().mockImplementation(() => ({
		listUserRepos: jest.fn().mockResolvedValue([]),
	})),
}));

describe('ForgejoRemoteSourceProvider', () => {
	const listUserRepos = jest.fn();
	const instance: ForgejoInstance = {
		id: 'git-araj-me',
		name: 'git.araj.me',
		instanceUrl: 'https://git.araj.me',
		token: 'token',
	};

	beforeEach(() => {
		jest.mocked(ForgejoClient).mockImplementation(() => ({
			listUserRepos,
		}) as unknown as ForgejoClient);
		listUserRepos.mockResolvedValue([]);
	});

	test('uses the contributed Forgejo logo in the Git clone source picker', () => {
		const provider = new ForgejoRemoteSourceProvider(instance);

		expect(provider.icon).toBe('forgejo-logo');
	});

	test('keeps Forgejo clone URLs unchanged when no SSH port is configured', async () => {
		listUserRepos.mockResolvedValueOnce([{
			full_name: 'owner/repo',
			description: '',
			ssh_url: 'git@git.araj.me:owner/repo.git',
			clone_url: 'https://git.araj.me/owner/repo.git',
		}]);
		const provider = new ForgejoRemoteSourceProvider(instance);

		await expect(provider.getRemoteSources()).resolves.toEqual([{
			name: '$(repo) owner/repo',
			description: undefined,
			url: ['git@git.araj.me:owner/repo.git', 'https://git.araj.me/owner/repo.git'],
		}]);
	});

	test('rewrites scp-style SSH clone URLs with the configured SSH host', async () => {
		listUserRepos.mockResolvedValueOnce([{
			full_name: 'owner/repo',
			description: 'Repository description',
			ssh_url: 'git@git.araj.me:owner/repo.git',
			clone_url: 'https://git.araj.me/owner/repo.git',
		}]);
		const provider = new ForgejoRemoteSourceProvider({ ...instance, sshHost: 'ssh.araj.me' });

		await expect(provider.getRemoteSources()).resolves.toEqual([{
			name: '$(repo) owner/repo',
			description: 'Repository description',
			url: ['git@ssh.araj.me:owner/repo.git', 'https://git.araj.me/owner/repo.git'],
		}]);
	});

	test('rewrites ssh protocol clone URLs with the configured SSH host', async () => {
		listUserRepos.mockResolvedValueOnce([{
			full_name: 'owner/repo',
			description: '',
			ssh_url: 'ssh://git@git.araj.me/owner/repo.git',
			clone_url: 'https://git.araj.me/owner/repo.git',
		}]);
		const provider = new ForgejoRemoteSourceProvider({ ...instance, sshHost: 'ssh.araj.me' });

		await expect(provider.getRemoteSources()).resolves.toEqual([{
			name: '$(repo) owner/repo',
			description: undefined,
			url: ['ssh://git@ssh.araj.me/owner/repo.git', 'https://git.araj.me/owner/repo.git'],
		}]);
	});

	test('preserves the SSH port when rewriting the ssh protocol host', async () => {
		listUserRepos.mockResolvedValueOnce([{
			full_name: 'owner/repo',
			description: '',
			ssh_url: 'ssh://git@git.araj.me:2200/owner/repo.git',
			clone_url: 'https://git.araj.me/owner/repo.git',
		}]);
		const provider = new ForgejoRemoteSourceProvider({ ...instance, sshHost: 'ssh.araj.me' });

		await expect(provider.getRemoteSources()).resolves.toEqual([{
			name: '$(repo) owner/repo',
			description: undefined,
			url: ['ssh://git@ssh.araj.me:2200/owner/repo.git', 'https://git.araj.me/owner/repo.git'],
		}]);
	});

	test('applies both sshHost and sshPort when both are configured (scp-style source)', async () => {
		listUserRepos.mockResolvedValueOnce([{
			full_name: 'owner/repo',
			description: '',
			ssh_url: 'git@git.araj.me:owner/repo.git',
			clone_url: 'https://git.araj.me/owner/repo.git',
		}]);
		const provider = new ForgejoRemoteSourceProvider({ ...instance, sshHost: 'ssh.araj.me', sshPort: 2222 });

		await expect(provider.getRemoteSources()).resolves.toEqual([{
			name: '$(repo) owner/repo',
			description: undefined,
			url: ['ssh://git@ssh.araj.me:2222/owner/repo.git', 'https://git.araj.me/owner/repo.git'],
		}]);
	});

	test('rewrites scp-style SSH clone URLs with the legacy sshPort when no sshHost is set', async () => {
		listUserRepos.mockResolvedValueOnce([{
			full_name: 'owner/repo',
			description: 'Repository description',
			ssh_url: 'git@git.araj.me:owner/repo.git',
			clone_url: 'https://git.araj.me/owner/repo.git',
		}]);
		const provider = new ForgejoRemoteSourceProvider({ ...instance, sshPort: 2222 });

		await expect(provider.getRemoteSources()).resolves.toEqual([{
			name: '$(repo) owner/repo',
			description: 'Repository description',
			url: ['ssh://git@git.araj.me:2222/owner/repo.git', 'https://git.araj.me/owner/repo.git'],
		}]);
	});

	test('rewrites ssh protocol clone URLs with the legacy sshPort when no sshHost is set', async () => {
		listUserRepos.mockResolvedValueOnce([{
			full_name: 'owner/repo',
			description: '',
			ssh_url: 'ssh://git@git.araj.me/owner/repo.git',
			clone_url: 'https://git.araj.me/owner/repo.git',
		}]);
		const provider = new ForgejoRemoteSourceProvider({ ...instance, sshPort: 2022 });

		await expect(provider.getRemoteSources()).resolves.toEqual([{
			name: '$(repo) owner/repo',
			description: undefined,
			url: ['ssh://git@git.araj.me:2022/owner/repo.git', 'https://git.araj.me/owner/repo.git'],
		}]);
	});

	test('leaves SSH clone URLs unchanged when they already include a port (legacy sshPort)', async () => {
		listUserRepos.mockResolvedValueOnce([{
			full_name: 'owner/repo',
			description: '',
			ssh_url: 'ssh://git@git.araj.me:2200/owner/repo.git',
			clone_url: 'https://git.araj.me/owner/repo.git',
		}]);
		const provider = new ForgejoRemoteSourceProvider({ ...instance, sshPort: 2022 });

		await expect(provider.getRemoteSources()).resolves.toEqual([{
			name: '$(repo) owner/repo',
			description: undefined,
			url: ['ssh://git@git.araj.me:2200/owner/repo.git', 'https://git.araj.me/owner/repo.git'],
		}]);
	});
});
