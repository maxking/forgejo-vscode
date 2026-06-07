import { ForgejoRemoteSourceProvider } from '../../providers/forgejoRemoteSourceProvider';
import { ForgejoInstance } from '../../models/instance';

jest.mock('../../api/forgejoClient', () => ({
	ForgejoClient: jest.fn().mockImplementation(() => ({
		listUserRepos: jest.fn().mockResolvedValue([]),
	})),
}));

describe('ForgejoRemoteSourceProvider', () => {
	const instance: ForgejoInstance = {
		id: 'git-araj-me',
		name: 'git.araj.me',
		instanceUrl: 'https://git.araj.me',
		token: 'token',
	};

	test('uses the contributed Forgejo logo in the Git clone source picker', () => {
		const provider = new ForgejoRemoteSourceProvider(instance);

		expect(provider.icon).toBe('forgejo-logo');
	});
});
