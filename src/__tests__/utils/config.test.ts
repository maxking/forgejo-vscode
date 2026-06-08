import * as vscode from 'vscode';
import { getForgejoConfig, getForgejoRepositoryConfigs } from '../../utils/config';
import { detectGitRemote, detectGitRepositories } from '../../utils/gitUtils';

// Mock gitUtils
jest.mock('../../utils/gitUtils');

interface MockConfigOptions {
		autoDetectFromRemote?: boolean;
}

// Helper to mock configuration
const mockConfig = (instances: any[], options: MockConfigOptions = {}) => {
	const get = jest.fn((key) => {
		if (key === 'instances') return instances;
		if (key === 'autoDetectFromRemote') return options.autoDetectFromRemote;
		return undefined;
	});
	(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
		get,
		update: jest.fn(),
		inspect: jest.fn()
	});
};

describe('config', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('getForgejoConfig', () => {
        const mockInstances = [
            {
                id: '1',
                name: 'Codeberg',
                instanceUrl: 'https://codeberg.org',
                token: 'token1',
                isDefault: true
            },
            {
                id: '2',
                name: 'Work',
                instanceUrl: 'https://git.company.com',
                token: 'token2'
            }
        ];

        it('should return unauthenticated config from HTTP(S) git remote when no instances configured', async () => {
            mockConfig([]);
            (detectGitRemote as jest.Mock).mockReturnValue({
                instanceUrl: 'https://codeberg.org',
                remoteHost: 'codeberg.org',
                owner: 'owner',
                repo: 'repo'
            });

            const config = await getForgejoConfig();
            expect(config).not.toBeNull();
            expect(config!.instanceUrl).toBe('https://codeberg.org');
            expect(config!.owner).toBe('owner');
            expect(config!.repo).toBe('repo');
            expect(config!.token).toBe('');
            expect(config!.matchConfidence).toBe('default');
        });

        it('should return null if no instances and no git remote', async () => {
            mockConfig([]);
            (detectGitRemote as jest.Mock).mockReturnValue(null);

            const config = await getForgejoConfig();
            expect(config).toBeNull();
        });

        it('should return null for SSH remotes when no instances are configured', async () => {
            mockConfig([]);
            (detectGitRemote as jest.Mock).mockReturnValue({
                remoteHost: 'codeberg.org',
                owner: 'owner',
                repo: 'repo'
            });

            const config = await getForgejoConfig();
            expect(config).toBeNull();
        });

        it('should return matched instance from HTTP(S) git remote', async () => {
            mockConfig(mockInstances);
            (detectGitRemote as jest.Mock).mockReturnValue({
                instanceUrl: 'https://git.company.com',
                remoteHost: 'git.company.com',
                owner: 'myorg',
                repo: 'myrepo'
            });

            const config = await getForgejoConfig();
            
            expect(config).toEqual({
                instanceUrl: 'https://git.company.com',
                token: 'token2',
                owner: 'myorg',
                repo: 'myrepo',
                instanceId: '2',
                matchConfidence: 'exact'
            });
        });

        it('should fallback to default instance if no match found', async () => {
            mockConfig(mockInstances);
            (detectGitRemote as jest.Mock).mockReturnValue({
                instanceUrl: 'https://github.com', // Not in instances
                remoteHost: 'github.com',
                owner: 'owner',
                repo: 'repo'
            });

            const config = await getForgejoConfig();

			expect(config).toEqual({
				instanceUrl: 'https://codeberg.org', // Default instance
				token: 'token1',
				owner: 'owner',
				repo: 'repo',
				instanceId: '1',
				matchConfidence: 'default'
			});
        });

        it('should match instance when autoDetectFromRemote is explicitly true', async () => {
            mockConfig(mockInstances, { autoDetectFromRemote: true });
            (detectGitRemote as jest.Mock).mockReturnValue({
                instanceUrl: 'https://git.company.com',
                remoteHost: 'git.company.com',
                owner: 'myorg',
                repo: 'myrepo'
            });

            const config = await getForgejoConfig();

            expect(config).toEqual({
                instanceUrl: 'https://git.company.com',
                token: 'token2',
                owner: 'myorg',
                repo: 'myrepo',
                instanceId: '2',
                matchConfidence: 'exact'
            });
        });

        it('should skip instance matching when autoDetectFromRemote is false', async () => {
            mockConfig(mockInstances, { autoDetectFromRemote: false });
            (detectGitRemote as jest.Mock).mockReturnValue({
                instanceUrl: 'https://unknown.example.com',
                remoteHost: 'unknown.example.com',
                owner: 'owner',
                repo: 'repo'
            });

            const config = await getForgejoConfig();

            expect(config).toEqual({
                instanceUrl: 'https://codeberg.org',
                token: 'token1',
                owner: 'owner',
                repo: 'repo',
                instanceId: '1',
                matchConfidence: 'default'
            });
        });

        it('should fallback to first instance if no default and no match', async () => {
            const noDefaultInstances = [
                { ...mockInstances[1], isDefault: false }, // Work
                { ...mockInstances[0], isDefault: false }  // Codeberg
            ];
            mockConfig(noDefaultInstances);
            
            (detectGitRemote as jest.Mock).mockReturnValue({
                instanceUrl: 'https://github.com',
                remoteHost: 'github.com',
                owner: 'owner',
                repo: 'repo'
            });

            const config = await getForgejoConfig();

            expect(config).toEqual({
                instanceUrl: 'https://git.company.com', // First instance
                token: 'token2',
                owner: 'owner',
                repo: 'repo',
                instanceId: '2',
                matchConfidence: 'first'
            });
        });

        it('should return null if git remote detection fails (even with instances)', async () => {
            mockConfig(mockInstances);
            (detectGitRemote as jest.Mock).mockReturnValue(null);

            const config = await getForgejoConfig();

            // Cannot determine owner/repo without gitInfo, so returns null
            expect(config).toBeNull();
        });

        it('should handle git remote with different path structure', async () => {
            mockConfig(mockInstances);
            (detectGitRemote as jest.Mock).mockReturnValue({
                instanceUrl: 'https://codeberg.org',
                remoteHost: 'codeberg.org',
                owner: 'owner',
                repo: 'repo'
            });

            const config = await getForgejoConfig();

            expect(config?.instanceId).toBe('1');
            expect(config?.matchConfidence).toBe('exact');
        });

        it('should deduplicate multiple worktrees pointing at the same Forgejo repository', async () => {
            mockConfig(mockInstances);
            (detectGitRemote as jest.Mock).mockReturnValue(null);
            (detectGitRepositories as jest.Mock).mockReturnValue([
                {
                    instanceUrl: 'https://codeberg.org',
                    remoteHost: 'codeberg.org',
                    owner: 'maxking',
                    repo: 'forgejo-vscode',
                    rootPath: '/workspace/.worktrees/a',
                    remoteName: 'origin'
                },
                {
                    instanceUrl: 'https://codeberg.org',
                    remoteHost: 'codeberg.org',
                    owner: 'maxking',
                    repo: 'forgejo-vscode',
                    rootPath: '/workspace/.worktrees/b',
                    remoteName: 'origin'
                },
                {
                    instanceUrl: 'https://codeberg.org',
                    remoteHost: 'codeberg.org',
                    owner: 'forgejo',
                    repo: 'forgejo',
                    rootPath: '/workspace/forgejo',
                    remoteName: 'origin'
                }
            ]);

            const configs = await getForgejoRepositoryConfigs();

            expect(configs.map(config => config.label)).toEqual([
                'maxking/forgejo-vscode',
                'forgejo/forgejo'
            ]);
            expect(configs[0].rootPath).toBe('/workspace/.worktrees/a');
        });

        it('should match configured instance from SSH remote host without inferring instanceUrl', async () => {
            mockConfig(mockInstances);
            (detectGitRemote as jest.Mock).mockReturnValue({
                remoteHost: 'git.company.com',
                owner: 'myorg',
                repo: 'myrepo'
            });

            const config = await getForgejoConfig();

            expect(config).toEqual({
                instanceUrl: 'https://git.company.com',
                token: 'token2',
                owner: 'myorg',
                repo: 'myrepo',
                instanceId: '2',
                matchConfidence: 'exact'
            });
        });
    });
});
