import * as vscode from 'vscode';
import {
  createIssueFromTodoCommand,
  findIssueReferenceAtPosition,
  ForgejoReferenceLanguageProvider,
  registerReferenceDecorations,
  todoDraftFromLine
} from '../../providers/referenceLanguageProvider';
import type { ForgejoConfig } from '../../utils/config';

const config: ForgejoConfig = {
  instanceUrl: 'https://git.example.com',
  owner: 'owner',
  repo: 'repo',
  token: ''
};

function documentWithLines(lines: string[], path = '/workspace/file.ts'): vscode.TextDocument {
  return {
    uri: vscode.Uri.file(path),
    lineCount: lines.length,
    lineAt: (line: number) => ({ text: lines[line] }),
  } as unknown as vscode.TextDocument;
}

function position(line: number, character: number): vscode.Position {
  return { line, character } as vscode.Position;
}

describe('ForgejoReferenceLanguageProvider', () => {
  let client: {
    getIssueDetails: jest.Mock;
    getIssueReferencesPage: jest.Mock;
  };
  let provider: ForgejoReferenceLanguageProvider;
  let issueCreateProvider: { showCreateIssue: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.window.visibleTextEditors as any) = [];
    issueCreateProvider = { showCreateIssue: jest.fn() };
    client = {
      getIssueDetails: jest.fn(),
      getIssueReferencesPage: jest.fn()
    };
    provider = new ForgejoReferenceLanguageProvider(
      issueCreateProvider as any,
      async () => config,
      () => client as any
    );
  });

  it('finds issue reference ranges at the hovered position', () => {
    const document = documentWithLines(['See #190 for details']);

    const reference = findIssueReferenceAtPosition(document, position(0, 6));

    expect(reference).toEqual({
      number: 190,
      range: new vscode.Range(0, 4, 0, 8)
    });
  });

  it('registers issue reference decorations only after a reference is resolved', () => {
    const document = documentWithLines(['See #190']);
    const setDecorations = jest.fn();
    const decorationType = { dispose: jest.fn() };
    const context = { subscriptions: [] as vscode.Disposable[] } as vscode.ExtensionContext;
    const editor = {
      document,
      visibleRanges: [new vscode.Range(0, 0, 0, 8)],
      setDecorations
    };
    (vscode.languages.match as jest.Mock).mockReturnValue(1);
    (vscode.window.createTextEditorDecorationType as jest.Mock).mockReturnValue(decorationType);
    (vscode.window.visibleTextEditors as any) = [editor];

    const markResolvedReference = registerReferenceDecorations(context, [{ scheme: 'file' }]);
    const updateEditor = (vscode.window.onDidChangeActiveTextEditor as jest.Mock).mock.calls[0][0];
    updateEditor(editor);

    expect(vscode.window.createTextEditorDecorationType).toHaveBeenCalledWith(expect.objectContaining({
      backgroundColor: expect.any(vscode.ThemeColor),
      textDecoration: 'underline'
    }));
    expect(setDecorations).toHaveBeenLastCalledWith(decorationType, []);

    markResolvedReference(document, new vscode.Range(0, 4, 0, 8));

    expect(setDecorations).toHaveBeenLastCalledWith(decorationType, [new vscode.Range(0, 4, 0, 8)]);
  });

  it('renders public no-auth issue hovers with title, state, author, labels, and link', async () => {
    client.getIssueDetails.mockResolvedValue({
      number: 190,
      title: 'Reference hovers',
      state: 'open',
      user: { login: 'alice' },
      labels: [{ name: 'type/feature' }],
      html_url: 'https://git.example.com/owner/repo/issues/190'
    });

    const hover = await provider.provideHover(documentWithLines(['Fixes #190']), position(0, 8));

    const markdown = hover?.contents[0] as vscode.MarkdownString;
    expect(client.getIssueDetails).toHaveBeenCalledWith('owner', 'repo', 190);
    expect(markdown.value).toContain('Issue #190: Reference hovers');
    expect(markdown.value).toContain('State: open');
    expect(markdown.value).toContain('Author: alice');
    expect(markdown.value).toContain('Labels: type/feature');
    expect(markdown.value).toContain('[Open in Forgejo](https://git.example.com/owner/repo/issues/190)');
    expect(markdown.isTrusted).toBe(false);
  });

  it('marks reference decorations only when hover lookup succeeds', async () => {
    const markResolvedReference = jest.fn();
    provider = new ForgejoReferenceLanguageProvider(
      issueCreateProvider as any,
      async () => config,
      () => client as any,
      markResolvedReference
    );
    const document = documentWithLines(['Fixes #190']);
    client.getIssueDetails.mockResolvedValue({
      number: 190,
      title: 'Reference hovers',
      state: 'open',
      labels: []
    });

    await provider.provideHover(document, position(0, 8));

    expect(markResolvedReference).toHaveBeenCalledWith(document, new vscode.Range(0, 6, 0, 10));
  });

  it('omits unsafe hover links from API responses', async () => {
    client.getIssueDetails.mockResolvedValue({
      number: 190,
      title: 'Reference hovers',
      state: 'open',
      user: { login: 'alice' },
      labels: [],
      html_url: 'command:workbench.action.reloadWindow'
    });

    const hover = await provider.provideHover(documentWithLines(['Fixes #190']), position(0, 8));

    const markdown = hover?.contents[0] as vscode.MarkdownString;
    expect(markdown.value).not.toContain('Open in Forgejo');
  });

  it('renders pull request hovers when the issue detail is a PR row', async () => {
    client.getIssueDetails.mockResolvedValue({
      number: 12,
      title: 'Patch branch',
      state: 'closed',
      user: { login: 'bob' },
      labels: [],
      html_url: 'https://git.example.com/owner/repo/pulls/12',
      pull_request: { url: 'https://git.example.com/api/v1/repos/owner/repo/pulls/12' }
    });

    const hover = await provider.provideHover(documentWithLines(['Related #12']), position(0, 10));

    const markdown = hover?.contents[0] as vscode.MarkdownString;
    expect(markdown.value).toContain('Pull Request #12: Patch branch');
  });

  it('returns no hover when the API lookup fails', async () => {
    client.getIssueDetails.mockRejectedValue(new Error('not found'));

    const hover = await provider.provideHover(documentWithLines(['Broken #404']), position(0, 9));

    expect(hover).toBeUndefined();
  });

  it('does not mark reference decorations when the API lookup fails', async () => {
    const markResolvedReference = jest.fn();
    provider = new ForgejoReferenceLanguageProvider(
      issueCreateProvider as any,
      async () => config,
      () => client as any,
      markResolvedReference
    );
    client.getIssueDetails.mockRejectedValue(new Error('not found'));

    const hover = await provider.provideHover(documentWithLines(['Broken #12345']), position(0, 9));

    expect(hover).toBeUndefined();
    expect(markResolvedReference).not.toHaveBeenCalled();
  });

  it('returns bounded reference completions and caches repeated lookups', async () => {
    client.getIssueReferencesPage.mockResolvedValue({
      items: [
        { number: 1, title: 'First issue', state: 'open', labels: [] },
        {
          number: 2,
          title: 'Second PR',
          state: 'open',
          labels: [],
          pull_request: { url: 'https://git.example.com/api/v1/repos/owner/repo/pulls/2' }
        }
      ],
      page: 1,
      limit: 10,
      hasMore: false
    });
    const document = documentWithLines(['See #']);

    const first = await provider.provideCompletionItems(document, position(0, 5));
    const second = await provider.provideCompletionItems(document, position(0, 5));

    expect(client.getIssueReferencesPage).toHaveBeenCalledTimes(1);
    expect(client.getIssueReferencesPage).toHaveBeenCalledWith('owner', 'repo', '', 1, 10);
    expect(first?.map(item => item.label)).toEqual(['#1', '#2']);
    expect(first?.map(item => item.detail)).toEqual(['Issue #1', 'Pull Request #2']);
    expect(second?.map(item => item.label)).toEqual(['#1', '#2']);
  });

  it('uses exact issue lookup for numeric reference completion prefixes', async () => {
    client.getIssueDetails.mockResolvedValue({ number: 190, title: 'Exact issue', state: 'open', labels: [] });

    const items = await provider.provideCompletionItems(documentWithLines(['See #190']), position(0, 8));

    expect(client.getIssueDetails).toHaveBeenCalledWith('owner', 'repo', 190);
    expect(items?.map(item => item.label)).toEqual(['#190']);
  });

  it('returns cached username completions from bounded repository rows', async () => {
    client.getIssueReferencesPage.mockResolvedValue({
      items: [
        { number: 1, title: 'Assigned', user: { login: 'alice' }, assignees: [{ login: 'alex' }, { login: 'bob' }] }
      ],
      page: 1,
      limit: 10,
      hasMore: false
    });
    const document = documentWithLines(['cc @a']);

    const first = await provider.provideCompletionItems(document, position(0, 5));
    const second = await provider.provideCompletionItems(document, position(0, 5));

    expect(client.getIssueReferencesPage).toHaveBeenCalledTimes(1);
    expect(client.getIssueReferencesPage).toHaveBeenCalledWith('owner', 'repo', '', 1, 10);
    expect(first?.map(item => item.label)).toEqual(['@alice', '@alex']);
    expect(second?.map(item => item.label)).toEqual(['@alice', '@alex']);
  });

  it('returns empty completions when completion APIs fail', async () => {
    client.getIssueReferencesPage.mockRejectedValue(new Error('network'));

    const items = await provider.provideCompletionItems(documentWithLines(['See #']), position(0, 5));

    expect(items).toEqual([]);
  });

  it('creates TODO code actions with an editable draft payload', () => {
    const document = documentWithLines(['// TODO: Handle empty repository state'], '/workspace/src/file.ts');

    const actions = provider.provideCodeActions(document, new vscode.Range(0, 0, 0, 10));

    expect(actions).toHaveLength(1);
    expect(actions?.[0].command?.command).toBe('forgejo.createIssueFromTodo');
    expect(actions?.[0].command?.arguments?.[0]).toMatchObject({
      title: 'Handle empty repository state',
      sourceUri: document.uri,
      line: 0
    });
    expect(actions?.[0].command?.arguments?.[0].body).toContain('// TODO: Handle empty repository state');
  });

  it('does not create TODO code actions for non-comment text', () => {
    const document = documentWithLines(['const TODO = "Handle later";']);

    const actions = provider.provideCodeActions(document, new vscode.Range(0, 0, 0, 10));

    expect(actions).toBeUndefined();
  });

  it('extracts fallback TODO titles when the comment has no summary', () => {
    const draft = todoDraftFromLine(documentWithLines(['# FIXME'], '/workspace/README.md'), 0);

    expect(draft?.title).toBe('FIXME in README.md:1');
    expect(draft?.body).toContain('# FIXME');
  });

  it('opens the create issue form for authenticated TODO actions', async () => {
    const authenticatedConfig = { ...config, token: 'token' };
    const draft = todoDraftFromLine(documentWithLines(['// TODO: Make it so']), 0)!;

    await createIssueFromTodoCommand(
      issueCreateProvider as any,
      draft,
      async () => authenticatedConfig
    );

    expect(issueCreateProvider.showCreateIssue).toHaveBeenCalledWith(authenticatedConfig, draft);
  });

  it('rejects no-auth TODO issue creation before opening the preview', async () => {
    const draft = todoDraftFromLine(documentWithLines(['// TODO: Make it so']), 0)!;

    await createIssueFromTodoCommand(
      issueCreateProvider as any,
      draft,
      async () => config
    );

    expect(issueCreateProvider.showCreateIssue).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'A Forgejo token is required to create issues. Please configure your token first.'
    );
  });

  it('resolves the Forgejo config from the TODO draft source URI instead of the active editor', async () => {
    const repoAConfig: ForgejoConfig = {
      instanceUrl: 'https://git.example.com',
      owner: 'repo-a-owner',
      repo: 'repo-a',
      token: 'token-a'
    };
    const repoBConfig: ForgejoConfig = {
      instanceUrl: 'https://git.example.com',
      owner: 'repo-b-owner',
      repo: 'repo-b',
      token: 'token-b'
    };
    const getConfig = jest.fn(async (sourceUri?: vscode.Uri) =>
      sourceUri?.fsPath.includes('repo-b') ? repoBConfig : repoAConfig);
    const draft = todoDraftFromLine(
      documentWithLines(['// TODO: file bug from repo B'], '/workspace/repo-b/src/file.ts'),
      0
    )!;

    await createIssueFromTodoCommand(issueCreateProvider as any, draft, getConfig);

    expect(getConfig).toHaveBeenCalledWith(draft.sourceUri);
    expect(issueCreateProvider.showCreateIssue).toHaveBeenCalledWith(repoBConfig, draft);
  });
});
