import * as vscode from 'vscode';
import { ForgejoClient } from '../api/forgejoClient';
import { IssueCreateWebviewProvider, type InitialIssueDraft } from '../webview/issueCreate/provider';
import { ForgejoConfig, getForgejoConfig } from '../utils/config';
import { registerCommand } from '../commands/registry';

const REFERENCE_PATTERN = /(^|[^\w/])#(\d+)\b/g;
const TODO_COMMENT_PATTERN = /(?:^|[\s{(;])(?:(?:\/\/+)|#|--|;|\/\*+|\*|<!--)\s*\b(TODO|FIXME)\b(?:\([^)]+\))?\s*:?\s*(.*?)(?:\s*\*\/|\s*-->)?\s*$/i;
const COMPLETION_LIMIT = 10;
const CACHE_TTL_MS = 60_000;
const MAX_DECORATED_VISIBLE_LINES = 1_000;

type CacheKind = 'reference' | 'user';

interface CacheEntry<T> {
  expiresAt: number;
  value: Promise<T>;
}

interface ReferenceCompletionItem {
  number: number;
  title: string;
  state?: string;
  html_url?: string;
  pull_request?: unknown;
  user?: { login?: string; username?: string };
  labels?: { name?: string }[];
  assignees?: { login?: string; username?: string }[];
}

export interface TodoIssueDraft extends InitialIssueDraft {
  sourceUri: vscode.Uri;
  line: number;
}

function isSupportedDocument(document: vscode.TextDocument): boolean {
  return document.uri.scheme === 'file' || document.uri.scheme === 'untitled';
}

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase();
}

function userLogin(user: { login?: string; username?: string } | undefined): string | undefined {
  return user?.login ?? user?.username;
}

function labelNames(labels: { name?: string }[] | undefined): string {
  const names = labels?.map(label => label.name).filter((name): name is string => Boolean(name)) ?? [];
  return names.length > 0 ? names.join(', ') : 'None';
}

function referenceKind(item: { pull_request?: unknown }): 'Pull Request' | 'Issue' {
  return item.pull_request ? 'Pull Request' : 'Issue';
}

function markdownEscape(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+.!|-]/g, '\\$&');
}

function safeHttpUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? value : undefined;
  } catch {
    return undefined;
  }
}

export function findIssueReferenceAtPosition(document: vscode.TextDocument, position: vscode.Position): { number: number; range: vscode.Range } | undefined {
  const line = document.lineAt(position.line).text;
  REFERENCE_PATTERN.lastIndex = 0;

  for (let match = REFERENCE_PATTERN.exec(line); match; match = REFERENCE_PATTERN.exec(line)) {
    const referenceStart = match.index + match[1].length;
    const referenceEnd = referenceStart + match[0].length - match[1].length;
    if (position.character >= referenceStart && position.character <= referenceEnd) {
      return {
        number: Number(match[2]),
        range: new vscode.Range(position.line, referenceStart, position.line, referenceEnd)
      };
    }
  }

  return undefined;
}

export function findIssueReferenceRanges(document: vscode.TextDocument, visibleRanges?: readonly vscode.Range[]): vscode.Range[] {
  const ranges: vscode.Range[] = [];
  const scanRanges = visibleRanges && visibleRanges.length > 0
    ? visibleRanges
    : [new vscode.Range(0, 0, Math.max(0, document.lineCount - 1), Number.MAX_SAFE_INTEGER)];

  for (const visibleRange of scanRanges) {
    const startLine = Math.max(0, visibleRange.start.line);
    const endLine = Math.min(document.lineCount - 1, visibleRange.end.line, startLine + MAX_DECORATED_VISIBLE_LINES - 1);

    for (let lineNumber = startLine; lineNumber <= endLine; lineNumber++) {
      const line = document.lineAt(lineNumber).text;
      REFERENCE_PATTERN.lastIndex = 0;

      for (let match = REFERENCE_PATTERN.exec(line); match; match = REFERENCE_PATTERN.exec(line)) {
        const referenceStart = match.index + match[1].length;
        const referenceEnd = referenceStart + match[0].length - match[1].length;
        ranges.push(new vscode.Range(lineNumber, referenceStart, lineNumber, referenceEnd));
      }
    }
  }

  return ranges;
}

export function todoDraftFromLine(document: vscode.TextDocument, lineNumber: number): TodoIssueDraft | undefined {
  const line = document.lineAt(lineNumber);
  const match = TODO_COMMENT_PATTERN.exec(line.text);
  if (!match) {
    return undefined;
  }

  const tag = match[1].toUpperCase();
  const summary = match[2].trim();
  const fileName = document.uri.path.split('/').pop() ?? 'document';
  const title = summary.length > 0 ? summary : `${tag} in ${fileName}:${lineNumber + 1}`;
  const source = document.uri.fsPath.length > 0 ? document.uri.fsPath : document.uri.toString();
  const body = [
    `Created from ${tag} in \`${source}:${lineNumber + 1}\`.`,
    '',
    '```',
    line.text.trim(),
    '```'
  ].join('\n');

  return {
    title,
    body,
    sourceUri: document.uri,
    line: lineNumber
  };
}

export async function createIssueFromTodoCommand(
  issueCreateWebviewProvider: IssueCreateWebviewProvider,
  draft: TodoIssueDraft,
  getConfig: () => Promise<ForgejoConfig | null> = getForgejoConfig
): Promise<void> {
  const config = await getConfig();
  if (!config) {
    void vscode.window.showErrorMessage('Forgejo configuration not found. Please configure an instance first.');
    return;
  }

  if (!config.token) {
    void vscode.window.showErrorMessage('A Forgejo token is required to create issues. Please configure your token first.');
    return;
  }

  issueCreateWebviewProvider.showCreateIssue(config, draft);
}

export class ForgejoReferenceLanguageProvider implements vscode.HoverProvider, vscode.CompletionItemProvider, vscode.CodeActionProvider {
  private readonly cache = new Map<string, CacheEntry<ReferenceCompletionItem[] | string[]>>();

  constructor(
    private readonly issueCreateWebviewProvider: IssueCreateWebviewProvider,
    private readonly getConfig: () => Promise<ForgejoConfig | null> = getForgejoConfig,
    private readonly createClient: (config: ForgejoConfig) => ForgejoClient = config => new ForgejoClient(config.instanceUrl, config.token)
  ) {}

  async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
    if (!isSupportedDocument(document)) {
      return undefined;
    }

    const reference = findIssueReferenceAtPosition(document, position);
    if (!reference) {
      return undefined;
    }

    const config = await this.getConfig();
    if (!config) {
      return undefined;
    }

    try {
      const item = await this.createClient(config).getIssueDetails(config.owner, config.repo, reference.number) as ReferenceCompletionItem;
      return new vscode.Hover(this.renderReferenceHover(item), reference.range);
    } catch {
      return undefined;
    }
  }

  async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.CompletionItem[] | undefined> {
    if (!isSupportedDocument(document)) {
      return undefined;
    }

    const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
    const match = /(^|[\s([{:])([#@])([A-Za-z0-9_-]*)$/.exec(linePrefix);
    if (!match) {
      return undefined;
    }

    const trigger = match[2];
    const query = match[3];
    const start = position.character - trigger.length - query.length;
    const range = new vscode.Range(position.line, start, position.line, position.character);
    const config = await this.getConfig();
    if (!config) {
      return [];
    }

    if (trigger === '#') {
      if (query && !/^\d+$/.test(query)) {
        return [];
      }
      const items = await this.getReferenceCompletions(config, query);
      return items.map(item => this.createReferenceCompletion(item, range));
    }

    const users = await this.getUserCompletions(config, query);
    return users.map(login => this.createUserCompletion(login, range));
  }

  provideCodeActions(document: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] | undefined {
    if (!isSupportedDocument(document)) {
      return undefined;
    }

    const draft = todoDraftFromLine(document, range.start.line);
    if (!draft) {
      return undefined;
    }

    const action = new vscode.CodeAction('Create Forgejo issue from TODO', vscode.CodeActionKind.QuickFix);
    action.command = {
      command: 'forgejo.createIssueFromTodo',
      title: 'Create Forgejo issue from TODO',
      arguments: [draft]
    };
    return [action];
  }

  private renderReferenceHover(item: ReferenceCompletionItem): vscode.MarkdownString {
    const author = userLogin(item.user) ?? 'Unknown';
    const url = safeHttpUrl(item.html_url);
    const markdown = new vscode.MarkdownString([
      `**${referenceKind(item)} #${item.number}: ${markdownEscape(item.title)}**`,
      '',
      `State: ${markdownEscape(item.state ?? 'unknown')}`,
      '',
      `Author: ${markdownEscape(author)}`,
      '',
      `Labels: ${markdownEscape(labelNames(item.labels))}`,
      '',
      url ? `[Open in Forgejo](${url})` : undefined
    ].filter((line): line is string => line !== undefined).join('\n'));
    return markdown;
  }

  private async getReferenceCompletions(config: ForgejoConfig, query: string): Promise<ReferenceCompletionItem[]> {
    if (query) {
      const exactNumber = Number(query);
      return this.cached('reference', config, query, async () => {
        try {
          const item = await this.createClient(config).getIssueDetails(config.owner, config.repo, exactNumber) as ReferenceCompletionItem;
          return String(item.number).startsWith(query) ? [item] : [];
        } catch {
          return [];
        }
      });
    }

    return this.cached('reference', config, query, async () => {
      const page = await this.createClient(config).getIssueReferencesPage(config.owner, config.repo, '', 1, COMPLETION_LIMIT);
      return page.items as ReferenceCompletionItem[];
    });
  }

  private async getUserCompletions(config: ForgejoConfig, query: string): Promise<string[]> {
    return this.cached('user', config, query, async () => {
      const page = await this.createClient(config).getIssueReferencesPage(config.owner, config.repo, '', 1, COMPLETION_LIMIT);
      const normalized = normalizeQuery(query);
      const users = new Set<string>();
      for (const item of page.items as ReferenceCompletionItem[]) {
        const itemUsers = [userLogin(item.user), ...(item.assignees ?? []).map(userLogin)];
        for (const login of itemUsers) {
          if (login && (!normalized || login.toLowerCase().startsWith(normalized))) {
            users.add(login);
          }
          if (users.size >= COMPLETION_LIMIT) {
            return Array.from(users);
          }
        }
      }
      return Array.from(users);
    });
  }

  private async cached<T extends ReferenceCompletionItem[] | string[]>(
    kind: CacheKind,
    config: ForgejoConfig,
    query: string,
    fetcher: () => Promise<T>
  ): Promise<T> {
    const key = `${kind}:${config.instanceUrl}:${config.owner}/${config.repo}:${normalizeQuery(query)}`;
    const now = Date.now();
    const cached = this.cache.get(key) as CacheEntry<T> | undefined;
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const value = fetcher().catch(() => [] as unknown as T);
    this.cache.set(key, {
      expiresAt: now + CACHE_TTL_MS,
      value
    });
    return value;
  }

  private createReferenceCompletion(item: ReferenceCompletionItem, range: vscode.Range): vscode.CompletionItem {
    const completion = new vscode.CompletionItem(`#${item.number}`, vscode.CompletionItemKind.Reference);
    completion.insertText = `#${item.number}`;
    completion.range = range;
    completion.detail = `${referenceKind(item)} #${item.number}`;
    completion.documentation = item.title;
    return completion;
  }

  private createUserCompletion(login: string, range: vscode.Range): vscode.CompletionItem {
    const completion = new vscode.CompletionItem(`@${login}`, vscode.CompletionItemKind.User);
    completion.insertText = `@${login}`;
    completion.range = range;
    completion.detail = 'Forgejo user';
    return completion;
  }
}

export function registerReferenceLanguageFeatures(
  context: vscode.ExtensionContext,
  issueCreateWebviewProvider: IssueCreateWebviewProvider
): void {
  const provider = new ForgejoReferenceLanguageProvider(issueCreateWebviewProvider);
  const selector: vscode.DocumentSelector = [
    { scheme: 'file' },
    { scheme: 'untitled' }
  ];

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(selector, provider),
    vscode.languages.registerCompletionItemProvider(selector, provider, '#', '@'),
    vscode.languages.registerCodeActionsProvider(selector, provider, {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
    }),
    registerCommand('forgejo.createIssueFromTodo', (draft) => createIssueFromTodoCommand(issueCreateWebviewProvider, draft))
  );

  registerReferenceDecorations(context, selector);
}

function registerReferenceDecorations(context: vscode.ExtensionContext, selector: vscode.DocumentSelector): void {
  const decorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('editor.wordHighlightBackground'),
    textDecoration: 'underline',
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.wordHighlightForeground'),
    overviewRulerLane: vscode.OverviewRulerLane.Right
  });

  const updateEditor = (editor: vscode.TextEditor | undefined): void => {
    if (!editor || !vscode.languages.match(selector, editor.document) || !isSupportedDocument(editor.document)) {
      return;
    }

    editor.setDecorations(decorationType, findIssueReferenceRanges(editor.document, editor.visibleRanges));
  };

  const updateVisibleEditors = (): void => {
    for (const editor of vscode.window.visibleTextEditors) {
      updateEditor(editor);
    }
  };

  context.subscriptions.push(
    decorationType,
    vscode.window.onDidChangeActiveTextEditor(updateEditor),
    vscode.window.onDidChangeVisibleTextEditors(updateVisibleEditors),
    vscode.window.onDidChangeTextEditorVisibleRanges(event => updateEditor(event.textEditor)),
    vscode.workspace.onDidChangeTextDocument(event => {
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document === event.document) {
          updateEditor(editor);
        }
      }
    })
  );

  updateVisibleEditors();
}
