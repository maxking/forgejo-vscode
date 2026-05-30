import * as vscode from 'vscode';
import { ForgejoAuthenticationProvider } from '../../auth/forgejoAuthenticationProvider';
import { getAllInstances, removeInstance } from '../../utils/instanceHelpers';

jest.mock('../../utils/instanceHelpers');

const mockGetAllInstances = getAllInstances as jest.MockedFunction<typeof getAllInstances>;
const mockRemoveInstance = removeInstance as jest.MockedFunction<typeof removeInstance>;

describe('ForgejoAuthenticationProvider', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		(vscode.workspace.onDidChangeConfiguration as jest.Mock).mockReturnValue({ dispose: jest.fn() });
		mockRemoveInstance.mockResolvedValue(undefined);
	});

	it('returns configured instances as authentication sessions with requested scopes', async () => {
		mockGetAllInstances.mockResolvedValue([
			{
				id: 'inst-1',
				name: 'Codeberg',
				instanceUrl: 'https://codeberg.org',
				token: 'token-1',
				username: 'alice',
			},
		]);

		const provider = new ForgejoAuthenticationProvider();
		const sessions = await provider.getSessions(['read:repository', 'read:issues']);

		expect(sessions).toEqual([
			expect.objectContaining({
				id: 'inst-1',
				accessToken: 'token-1',
				scopes: ['read:repository', 'read:issues'],
				account: { id: 'inst-1', label: 'alice - https://codeberg.org' },
			}),
		]);
		provider.dispose();
	});

	it('createSession returns only a newly added instance', async () => {
		mockGetAllInstances
			.mockResolvedValueOnce([
				{ id: 'old', name: 'Old', instanceUrl: 'https://old.example', token: 'old-token' },
			])
			.mockResolvedValueOnce([
				{ id: 'old', name: 'Old', instanceUrl: 'https://old.example', token: 'old-token' },
				{ id: 'new', name: 'New', instanceUrl: 'https://new.example', token: 'new-token' },
			]);
		(vscode.commands.executeCommand as jest.Mock).mockResolvedValue(undefined);

		const provider = new ForgejoAuthenticationProvider();
		const session = await provider.createSession(['read:user']);

		expect(vscode.commands.executeCommand).toHaveBeenCalledWith('forgejo.addInstance');
		expect(session).toEqual(expect.objectContaining({
			id: 'new',
			accessToken: 'new-token',
			scopes: ['read:user'],
		}));
		provider.dispose();
	});

	it('createSession throws when add instance is cancelled', async () => {
		mockGetAllInstances
			.mockResolvedValueOnce([
				{ id: 'old', name: 'Old', instanceUrl: 'https://old.example', token: 'old-token' },
			])
			.mockResolvedValueOnce([
				{ id: 'old', name: 'Old', instanceUrl: 'https://old.example', token: 'old-token' },
			]);
		(vscode.commands.executeCommand as jest.Mock).mockResolvedValue(undefined);

		const provider = new ForgejoAuthenticationProvider();
		await expect(provider.createSession(['read:user'])).rejects.toThrow('No Forgejo instance was added.');
		provider.dispose();
	});

	it('removeSession does not fire twice if configuration listener already removed the session', async () => {
		let configListener: ((event: { affectsConfiguration: (section: string) => boolean }) => void | Promise<void>) | undefined;
		(vscode.workspace.onDidChangeConfiguration as jest.Mock).mockImplementation(listener => {
			configListener = listener;
			return { dispose: jest.fn() };
		});
		mockGetAllInstances
			.mockResolvedValueOnce([
				{ id: 'old', name: 'Old', instanceUrl: 'https://old.example', token: 'old-token' },
			])
			.mockResolvedValueOnce([]);
		mockRemoveInstance.mockImplementation(async () => {
			await configListener?.({ affectsConfiguration: section => section === 'forgejo.instances' });
		});

		const provider = new ForgejoAuthenticationProvider();
		await provider.getSessions();
		const listener = jest.fn();
		provider.onDidChangeSessions(listener);

		await provider.removeSession('old');

		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith({
			added: [],
			removed: [expect.objectContaining({ id: 'old' })],
			changed: [],
		});
		provider.dispose();
	});
});
