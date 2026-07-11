import * as vscode from 'vscode';
import {
  MAX_REMOTE_FILE_BYTES,
  RemoteFileContentProvider,
  createRemoteFileUri,
  parseRemoteFileUri
} from '../../providers/remoteFileContentProvider';
import { ForgejoClient } from '../../api/forgejoClient';
import { getForgejoConfigFor } from '../../utils/config';

jest.mock('../../api/forgejoClient');
jest.mock('../../utils/config');

describe('RemoteFileContentProvider', () => {
  let provider: RemoteFileContentProvider;
  let mockClient: jest.Mocked<ForgejoClient>;
  let mockGetForgejoConfigFor: jest.MockedFunction<typeof getForgejoConfigFor>;

  beforeEach(() => {
    mockClient = {
      getRepositoryContents: jest.fn()
    } as any;
    (ForgejoClient as jest.MockedClass<typeof ForgejoClient>).mockImplementation(() => mockClient);
    mockGetForgejoConfigFor = getForgejoConfigFor as jest.MockedFunction<typeof getForgejoConfigFor>;
    mockGetForgejoConfigFor.mockResolvedValue({
      instanceUrl: 'https://git.example.com',
      owner: 'owner',
      repo: 'repo',
      token: 'test-token'
    });
    provider = new RemoteFileContentProvider();
  });

  test('round-trips stable URI identity with instance, repository, branch, and path', () => {
    const uri = createRemoteFileUri(
      'https://git.example.com',
      'owner',
      'repo',
      'feature/remote-browser',
      'src/deep/file with spaces.ts'
    );

    const parsed = parseRemoteFileUri(uri);

    expect(parsed).toEqual({
      instanceUrl: 'https://git.example.com',
      owner: 'owner',
      repo: 'repo',
      ref: 'feature/remote-browser',
      filepath: 'src/deep/file with spaces.ts'
    });
  });

  test('fetches text file content with token from matching config', async () => {
    const uri = createRemoteFileUri('https://git.example.com', 'owner', 'repo', 'main', 'README.md');
    mockClient.getRepositoryContents.mockResolvedValue({
      type: 'file',
      name: 'README.md',
      path: 'README.md',
      size: 11,
      encoding: 'base64',
      content: Buffer.from('hello world').toString('base64')
    });

    const content = await provider.provideTextDocumentContent(uri);

    expect(content).toBe('hello world');
    expect(ForgejoClient).toHaveBeenCalledWith('https://git.example.com', 'test-token');
    expect(mockClient.getRepositoryContents).toHaveBeenCalledWith('owner', 'repo', 'README.md', { ref: 'main' });
  });

  test('uses no token for public repositories when no matching token exists', async () => {
    const uri = createRemoteFileUri('https://public.example.com', 'public', 'repo', 'main', 'README.md');
    mockGetForgejoConfigFor.mockResolvedValue({
      instanceUrl: 'https://public.example.com',
      owner: 'public',
      repo: 'repo',
      token: ''
    });
    mockClient.getRepositoryContents.mockResolvedValue({
      type: 'file',
      name: 'README.md',
      path: 'README.md',
      encoding: 'base64',
      content: Buffer.from('public readme').toString('base64')
    });

    const content = await provider.provideTextDocumentContent(uri);

    expect(content).toBe('public readme');
    expect(ForgejoClient).toHaveBeenCalledWith('https://public.example.com', '');
  });

  test('returns a bounded message for large files', async () => {
    const uri = createRemoteFileUri('https://git.example.com', 'owner', 'repo', 'main', 'large.log');
    mockClient.getRepositoryContents.mockResolvedValue({
      type: 'file',
      name: 'large.log',
      path: 'large.log',
      size: MAX_REMOTE_FILE_BYTES + 1,
      encoding: 'base64',
      content: Buffer.from('not decoded').toString('base64')
    });

    const content = await provider.provideTextDocumentContent(uri);

    expect(content).toContain('too large to preview');
    expect(content).toContain(uri.toString());
  });

  test('returns a bounded message for large base64 files without size metadata', async () => {
    const uri = createRemoteFileUri('https://git.example.com', 'owner', 'repo', 'main', 'large-without-size.log');
    mockClient.getRepositoryContents.mockResolvedValue({
      type: 'file',
      name: 'large-without-size.log',
      path: 'large-without-size.log',
      encoding: 'base64',
      content: Buffer.alloc(MAX_REMOTE_FILE_BYTES + 1, 'a').toString('base64')
    });

    const content = await provider.provideTextDocumentContent(uri);

    expect(content).toContain('too large to preview');
    expect(content).toContain(uri.toString());
  });

  test('returns a binary file message instead of decoded binary content', async () => {
    const uri = createRemoteFileUri('https://git.example.com', 'owner', 'repo', 'main', 'image.png');
    mockClient.getRepositoryContents.mockResolvedValue({
      type: 'file',
      name: 'image.png',
      path: 'image.png',
      size: 4,
      encoding: 'base64',
      content: Buffer.from([0, 1, 2, 3]).toString('base64')
    });

    const content = await provider.provideTextDocumentContent(uri);

    expect(content).toContain('appears to be binary');
    expect(content).toContain(uri.toString());
  });

  test('refetches branch content so advancing branches do not remain stale', async () => {
    const uri = createRemoteFileUri('https://git.example.com', 'owner', 'repo', 'main', 'empty.txt');
    mockClient.getRepositoryContents.mockResolvedValue({
      type: 'file',
      name: 'empty.txt',
      path: 'empty.txt',
      size: 0,
      encoding: 'base64',
      content: ''
    });

    const first = await provider.provideTextDocumentContent(uri);
    const second = await provider.provideTextDocumentContent(uri);

    expect(first).toBe('');
    expect(second).toBe('');
	expect(mockClient.getRepositoryContents).toHaveBeenCalledTimes(2);
  });

  test('rejects ambiguous URI formats without the versioned identity layout', () => {
    const uri = vscode.Uri.parse('forgejo-remote:/owner/repo/main/file.ts');

    expect(() => parseRemoteFileUri(uri)).toThrow('Invalid remote file URI format');
  });
});
