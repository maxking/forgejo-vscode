import * as vscode from 'vscode';
import { ForgejoClient } from '../../api/forgejoClient';
import { doPublish } from '../../commands/publishToForgejo';
import type { Repository } from '../../types/git';

jest.mock('../../api/forgejoClient');
jest.mock('../../utils/logger', () => ({ logInfo: jest.fn(), logError: jest.fn() }));

const MockForgejoClient = ForgejoClient as jest.MockedClass<typeof ForgejoClient>;

function repository(overrides: Partial<Repository['state']>): Repository {
	return {
		rootUri: vscode.Uri.file('/workspace/repo'),
		state: {
			HEAD: { name: 'main', commit: 'abc123' },
			remotes: [],
			indexChanges: [],
			workingTreeChanges: [],
			mergeChanges: [],
			onDidChange: jest.fn() as unknown as vscode.Event<void>,
			...overrides
		},
		inputBox: { value: '' },
		add: jest.fn(),
		commit: jest.fn(),
		addRemote: jest.fn(),
		createBranch: jest.fn(),
		checkout: jest.fn(),
		push: jest.fn(),
		fetch: jest.fn(),
		getBranch: jest.fn()
	};
}

describe('doPublish preflight', () => {
	const createRepository = jest.fn();

	beforeEach(() => {
		jest.clearAllMocks();
		MockForgejoClient.mockImplementation(() => ({ createRepository } as any));
	});

	it('does not create a server repository when the chosen remote name exists', async () => {
		const local = repository({
			remotes: [
				{ name: 'origin', fetchUrl: 'https://git.example.com/owner/repo.git' },
				{ name: 'forgejo', fetchUrl: 'https://old.example/owner/repo.git' }
			]
		});

		await doPublish(local, 'https://git.example.com', 'token', 'repo', '', false);

		expect(createRepository).not.toHaveBeenCalled();
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			"A Git remote named 'forgejo' already exists. Rename or remove it before publishing."
		);
	});

	it('does not create a server repository for an empty unborn branch', async () => {
		const local = repository({ HEAD: undefined, remotes: [] });

		await doPublish(local, 'https://git.example.com', 'token', 'repo', '', false);

		expect(createRepository).not.toHaveBeenCalled();
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			'Add at least one file to the workspace before publishing a new repository.'
		);
	});
});
