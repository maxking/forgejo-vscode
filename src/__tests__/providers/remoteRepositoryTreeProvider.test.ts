import * as vscode from 'vscode';
import { ForgejoClient } from '../../api/forgejoClient';
import { getAllInstances } from '../../utils/instanceHelpers';
import {
  RemoteRepositoryBrowseItem,
  RemoteRepositoryDirectoryItem,
  RemoteRepositoryFileItem,
  RemoteRepositoryInstanceItem,
  RemoteRepositoryItem,
  RemoteRepositoryTreeProvider,
  openRemoteFile
} from '../../providers/remoteRepositoryTreeProvider';
import { parseRemoteFileUri } from '../../providers/remoteFileContentProvider';
import { ForgejoInstance } from '../../models/instance';

jest.mock('../../api/forgejoClient');
jest.mock('../../utils/instanceHelpers', () => ({
  getAllInstances: jest.fn(),
  normalizeUrl: (url: string) => {
    const withProtocol = /^https?:\/\//.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
    return withProtocol.replace(/\/$/, '');
  }
}));

describe('RemoteRepositoryTreeProvider', () => {
  let provider: RemoteRepositoryTreeProvider;
  let mockClient: jest.Mocked<ForgejoClient>;
  let mockGetAllInstances: jest.MockedFunction<typeof getAllInstances>;

  const publicInstance: ForgejoInstance = {
    id: 'public',
    name: 'Public Forgejo',
    instanceUrl: 'https://public.example.com'
  };

  const privateInstance: ForgejoInstance = {
    id: 'private',
    name: 'Private Forgejo',
    instanceUrl: 'https://git.example.com',
    token: 'secret-token'
  };

  beforeEach(() => {
    mockClient = {
      listBranches: jest.fn(),
      getRepositoryContents: jest.fn()
    } as any;
    (ForgejoClient as jest.MockedClass<typeof ForgejoClient>).mockImplementation(() => mockClient);
    mockGetAllInstances = getAllInstances as jest.MockedFunction<typeof getAllInstances>;
    mockGetAllInstances.mockResolvedValue([publicInstance, privateInstance]);
    (vscode.window.showInputBox as jest.Mock).mockReset();
    (vscode.window.showQuickPick as jest.Mock).mockReset();
    (vscode.workspace.openTextDocument as jest.Mock).mockReset();
    (vscode.window.showTextDocument as jest.Mock).mockReset();
    provider = new RemoteRepositoryTreeProvider();
  });

  test('lists configured instances without making network requests', async () => {
    const root = await provider.getChildren();

    expect(root).toHaveLength(2);
    expect(root[0]).toBeInstanceOf(RemoteRepositoryInstanceItem);
    expect((root[0] as RemoteRepositoryInstanceItem).instance.name).toBe('Public Forgejo');
    expect(ForgejoClient).not.toHaveBeenCalled();
  });

  test('adds a public no-token repository after branch selection', async () => {
    mockClient.listBranches.mockResolvedValue([{ name: 'main' }, { name: 'develop' }]);
    (vscode.window.showInputBox as jest.Mock).mockResolvedValue('maxking/forgejo-vscode');
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValue({
      label: 'main',
      branch: { name: 'main' }
    });

    const selection = await provider.browseRepository(new RemoteRepositoryBrowseItem(publicInstance));
    const instanceChildren = await provider.getChildren(new RemoteRepositoryInstanceItem(publicInstance));

    expect(selection?.branch).toBe('main');
    expect(ForgejoClient).toHaveBeenCalledWith('https://public.example.com', '');
    expect(mockClient.listBranches).toHaveBeenCalledWith('maxking', 'forgejo-vscode', 1, 100);
    expect(instanceChildren[1]).toBeInstanceOf(RemoteRepositoryItem);
    expect((instanceChildren[1] as RemoteRepositoryItem).selection).toMatchObject({
      instanceUrl: 'https://public.example.com',
      owner: 'maxking',
      repo: 'forgejo-vscode',
      branch: 'main',
      token: ''
    });
  });

  test('switches the selected branch for a remote repository', async () => {
    mockClient.listBranches
      .mockResolvedValueOnce([{ name: 'main' }])
      .mockResolvedValueOnce([{ name: 'main' }, { name: 'feature/browser' }]);
    (vscode.window.showInputBox as jest.Mock).mockResolvedValue('maxking/forgejo-vscode');
    (vscode.window.showQuickPick as jest.Mock)
      .mockResolvedValueOnce({ label: 'main', branch: { name: 'main' } })
      .mockResolvedValueOnce({ label: 'feature/browser', branch: { name: 'feature/browser' } });

    await provider.browseRepository(new RemoteRepositoryBrowseItem(privateInstance));
    const initialChildren = await provider.getChildren(new RemoteRepositoryInstanceItem(privateInstance));
    const repoItem = initialChildren[1] as RemoteRepositoryItem;
    await provider.selectBranch(repoItem);
    const updatedChildren = await provider.getChildren(new RemoteRepositoryInstanceItem(privateInstance));

    expect((updatedChildren[1] as RemoteRepositoryItem).selection.branch).toBe('feature/browser');
    expect(ForgejoClient).toHaveBeenLastCalledWith('https://git.example.com', 'secret-token');
  });

  test('lazily fetches and sorts directory entries', async () => {
    const repoItem = new RemoteRepositoryItem({
      instanceId: 'private',
      instanceName: 'Private Forgejo',
      instanceUrl: 'https://git.example.com',
      token: 'secret-token',
      owner: 'maxking',
      repo: 'forgejo-vscode',
      branch: 'main'
    });
    mockClient.getRepositoryContents.mockResolvedValue([
      { type: 'file', name: 'README.md', path: 'README.md', size: 100 },
      { type: 'dir', name: 'src', path: 'src' }
    ]);

    const children = await provider.getChildren(repoItem);

    expect(mockClient.getRepositoryContents).toHaveBeenCalledWith('maxking', 'forgejo-vscode', '', 'main', 1, 100);
    expect(children[0]).toBeInstanceOf(RemoteRepositoryDirectoryItem);
    expect(children[1]).toBeInstanceOf(RemoteRepositoryFileItem);
  });

  test('passes bounded directory parameters and adds a cap message for large directories', async () => {
    const repoItem = new RemoteRepositoryItem({
      instanceId: 'private',
      instanceName: 'Private Forgejo',
      instanceUrl: 'https://git.example.com',
      token: 'secret-token',
      owner: 'maxking',
      repo: 'forgejo-vscode',
      branch: 'main'
    });
    mockClient.getRepositoryContents.mockResolvedValue(Array.from({ length: 101 }, (_value, index) => ({
      type: 'file',
      name: `file-${index}.txt`,
      path: `file-${index}.txt`,
      size: 1
    })));

    const children = await provider.getChildren(repoItem);

    expect(mockClient.getRepositoryContents).toHaveBeenCalledWith('maxking', 'forgejo-vscode', '', 'main', 1, 100);
    expect(children).toHaveLength(101);
    expect(String((children[100] as vscode.TreeItem).label)).toContain('Showing first 100 entries');
  });

  test('opens remote files as virtual documents with full repository identity', async () => {
    const fileItem = new RemoteRepositoryFileItem({
      instanceId: 'private',
      instanceName: 'Private Forgejo',
      instanceUrl: 'https://git.example.com',
      token: 'secret-token',
      owner: 'maxking',
      repo: 'forgejo-vscode',
      branch: 'feature/browser'
    }, {
      type: 'file',
      name: 'README.md',
      path: 'docs/README.md',
      size: 100
    });
    (vscode.workspace.openTextDocument as jest.Mock).mockImplementation(async (uri: vscode.Uri) => ({ uri }));

    await openRemoteFile(fileItem);

    const openedUri = (vscode.workspace.openTextDocument as jest.Mock).mock.calls[0][0] as vscode.Uri;
    expect(parseRemoteFileUri(openedUri)).toEqual({
      instanceUrl: 'https://git.example.com',
      owner: 'maxking',
      repo: 'forgejo-vscode',
      ref: 'feature/browser',
      filepath: 'docs/README.md'
    });
    expect(vscode.window.showTextDocument).toHaveBeenCalledWith({ uri: openedUri }, { preview: true });
  });

  test('openRemoteFile handles command-palette execution without a tree item', async () => {
    await openRemoteFile();

    expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'Select a remote file from the Forgejo Repositories view to open it.'
    );
  });
});
