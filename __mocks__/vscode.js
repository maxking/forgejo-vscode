// Mock implementation of VS Code API for Jest unit tests

class EventEmitter {
  constructor() {
    this.listeners = [];
  }

  get event() {
    return (listener) => {
      this.listeners.push(listener);
      return {
        dispose: () => {
          const index = this.listeners.indexOf(listener);
          if (index !== -1) {
            this.listeners.splice(index, 1);
          }
        }
      };
    };
  }

  fire(data) {
    this.listeners.forEach(listener => listener(data));
  }

  dispose() {
    this.listeners = [];
  }
}

class Uri {
  constructor(scheme, authority, path, query, fragment) {
    this.scheme = scheme;
    this.authority = authority;
    this.path = path;
    this.query = query;
    this.fragment = fragment;
    this.fsPath = path;
  }

  static parse(uri) {
    const match = uri.match(/^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i) ||
                  uri.match(/^([a-z][a-z0-9+.-]*):([^?#]*)(\?[^#]*)?(#.*)?$/i);

    if (!match) {
      throw new Error('Invalid URI');
    }

    if (match[0].includes('://')) {
      // URI with authority (e.g., http://example.com/path)
      return new Uri(match[1], match[2], match[3] || '', match[4] || '', match[5] || '');
    } else {
      // URI without authority (e.g., forgejo-pr:/path)
      return new Uri(match[1], '', match[2] || '', match[3] || '', match[4] || '');
    }
  }

  static from(components) {
    return new Uri(
      components.scheme || '',
      components.authority || '',
      components.path || '',
      components.query ? `?${components.query.replace(/^\?/, '')}` : '',
      components.fragment ? `#${components.fragment.replace(/^#/, '')}` : ''
    );
  }

  static file(path) {
    return new Uri('file', '', path, '', '');
  }

  static joinPath(base, ...paths) {
    return Uri.file([base.path, ...paths].join('/'));
  }

  with(change) {
    return new Uri(
      change.scheme ?? this.scheme,
      change.authority ?? this.authority,
      change.path ?? this.path,
      change.query ?? this.query,
      change.fragment ?? this.fragment
    );
  }

  toString() {
    let result = `${this.scheme}:`;
    if (this.authority) {
      result += `//${this.authority}`;
    }
    result += this.path;
    if (this.query) {
      result += this.query;
    }
    if (this.fragment) {
      result += this.fragment;
    }
    return result;
  }
}

class TreeItem {
  constructor(label, collapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
    this.contextValue = undefined;
    this.command = undefined;
    this.iconPath = undefined;
    this.tooltip = undefined;
    this.description = undefined;
  }
}

const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2
};

const ViewColumn = {
  One: 1
};

const ColorThemeKind = {
  Light: 1,
  Dark: 2,
  HighContrast: 3,
  HighContrastLight: 4
};

const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3
};

class ThemeIcon {
  constructor(id, color) {
    this.id = id;
    this.color = color;
  }
}

class ThemeColor {
  constructor(id) {
    this.id = id;
  }
}

const ProgressLocation = {
  Notification: 15,
  SourceControl: 1,
  Window: 10
};

const CommentMode = {
  Editing: 0,
  Preview: 1
};

class MarkdownString {
  constructor(value) {
    this.value = value || '';
    this.isTrusted = false;
    this.supportThemeIcons = false;
    this.supportHtml = false;
  }
}

class Hover {
  constructor(contents, range) {
    this.contents = Array.isArray(contents) ? contents : [contents];
    this.range = range;
  }
}

class CompletionItem {
  constructor(label, kind) {
    this.label = label;
    this.kind = kind;
    this.insertText = undefined;
    this.range = undefined;
    this.detail = undefined;
    this.documentation = undefined;
  }
}

const CompletionItemKind = {
  Text: 0,
  Method: 1,
  Function: 2,
  Constructor: 3,
  Field: 4,
  Variable: 5,
  Class: 6,
  Interface: 7,
  Module: 8,
  Property: 9,
  Unit: 10,
  Value: 11,
  Enum: 12,
  Keyword: 13,
  Snippet: 14,
  Color: 15,
  File: 16,
  Reference: 17,
  Folder: 18,
  EnumMember: 19,
  Constant: 20,
  Struct: 21,
  Event: 22,
  Operator: 23,
  TypeParameter: 24,
  User: 25
};

class CodeAction {
  constructor(title, kind) {
    this.title = title;
    this.kind = kind;
    this.command = undefined;
  }
}

const CodeActionKind = {
  QuickFix: { value: 'quickfix' }
};

class Range {
  constructor(startLine, startCharacter, endLine, endCharacter) {
    this.start = { line: startLine, character: startCharacter };
    this.end = { line: endLine, character: endCharacter };
  }
}

class Diagnostic {
  constructor(range, message, severity) {
    this.range = range;
    this.message = message;
    this.severity = severity;
  }
}

const DiagnosticSeverity = {
  Error: 0,
  Warning: 1,
  Information: 2,
  Hint: 3
};

const DecorationRangeBehavior = {
  OpenOpen: 0,
  ClosedClosed: 1,
  OpenClosed: 2,
  ClosedOpen: 3
};

const OverviewRulerLane = {
  Left: 1,
  Center: 2,
  Right: 4,
  Full: 7
};

const comments = {
  createCommentController: jest.fn(() => ({
    commentingRangeProvider: null,
    createCommentThread: jest.fn(() => ({
      comments: [],
      canReply: true,
      label: '',
      dispose: jest.fn(),
      uri: null,
      range: null
    })),
    dispose: jest.fn(),
  })),
};

const QuickPickItemKind = {
  Separator: -1,
  Default: 0
};

const window = {
  showInformationMessage: jest.fn(),
  showErrorMessage: jest.fn(),
  showWarningMessage: jest.fn(),
  showInputBox: jest.fn(),
  showQuickPick: jest.fn(),
  createTreeView: jest.fn(),
  createTextEditorDecorationType: jest.fn(() => ({ dispose: jest.fn() })),
  createWebviewPanel: jest.fn(),
  activeColorTheme: { kind: ColorThemeKind.Dark },
  activeTextEditor: undefined,
  visibleTextEditors: [],
  showTextDocument: jest.fn(),
  onDidChangeActiveTextEditor: jest.fn(() => ({ dispose: jest.fn() })),
  onDidChangeVisibleTextEditors: jest.fn(() => ({ dispose: jest.fn() })),
  onDidChangeTextEditorVisibleRanges: jest.fn(() => ({ dispose: jest.fn() })),
  createOutputChannel: jest.fn().mockImplementation(() => ({
    append: jest.fn(),
    appendLine: jest.fn(),
    clear: jest.fn(),
    show: jest.fn(),
    dispose: jest.fn()
  })),
  withProgress: jest.fn()
};

const workspace = {
  getConfiguration: jest.fn().mockImplementation(() => ({
    get: jest.fn(),
    update: jest.fn(),
    has: jest.fn(),
    inspect: jest.fn()
  })),
  workspaceFolders: undefined,
  findFiles: jest.fn().mockResolvedValue([]),
  openTextDocument: jest.fn(),
  onDidChangeConfiguration: jest.fn(() => ({ dispose: jest.fn() })),
  onDidOpenTextDocument: jest.fn(() => ({ dispose: jest.fn() })),
  onDidChangeTextDocument: jest.fn(() => ({ dispose: jest.fn() })),
  onDidSaveTextDocument: jest.fn(() => ({ dispose: jest.fn() })),
  onDidCloseTextDocument: jest.fn(() => ({ dispose: jest.fn() }))
};

const languages = {
  match: jest.fn(() => 1),
  createDiagnosticCollection: jest.fn(() => ({
    set: jest.fn(),
    delete: jest.fn(),
    clear: jest.fn(),
    dispose: jest.fn()
  })),
  registerHoverProvider: jest.fn(() => ({ dispose: jest.fn() })),
  registerCompletionItemProvider: jest.fn(() => ({ dispose: jest.fn() })),
  registerCodeActionsProvider: jest.fn(() => ({ dispose: jest.fn() }))
};

const commands = {
  registerCommand: jest.fn(),
  executeCommand: jest.fn()
};

const env = {
  clipboard: {
    readText: jest.fn(),
    writeText: jest.fn()
  },
  openExternal: jest.fn()
};

module.exports = {
  EventEmitter,
  Uri,
  TreeItem,
  TreeItemCollapsibleState,
  ConfigurationTarget,
  ThemeIcon,
  ThemeColor,
  ProgressLocation,
  QuickPickItemKind,
  CommentMode,
  MarkdownString,
  Hover,
  CompletionItem,
  CompletionItemKind,
  CodeAction,
  CodeActionKind,
  Range,
  Diagnostic,
  DiagnosticSeverity,
  DecorationRangeBehavior,
  OverviewRulerLane,
  comments,
  window,
  workspace,
  languages,
  commands,
  env,
  ViewColumn,
  ColorThemeKind
};
