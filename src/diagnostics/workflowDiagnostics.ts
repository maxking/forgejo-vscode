import * as vscode from 'vscode';
import {
  isAlias,
  isMap,
  isSeq,
  isScalar,
  parseDocument,
  Scalar,
  type Document,
  type Node,
  type Pair,
} from 'yaml';
import workflowSchema from './schemas/forgejo-workflow.schema.json';

const WORKFLOW_DIRECTORIES = [
  '/.forgejo/workflows/',
  '/.gitea/workflows/',
  '/.github/workflows/',
];

const WORKFLOW_GLOBS = [
  '**/.forgejo/workflows/*.{yml,yaml}',
  '**/.gitea/workflows/*.{yml,yaml}',
  '**/.github/workflows/*.{yml,yaml}',
];

const WORKFLOW_SCHEMA_ROOT = 'workflow-root';
const DEFAULT_EXPRESSION_FUNCTIONS = [
  'contains(2,2)',
  'endsWith(2,2)',
  'format(1,255)',
  'join(1,2)',
  'toJson(1,1)',
  'fromJson(1,1)',
];

export interface WorkflowValidationIssue {
  line: number;
  startCharacter: number;
  endCharacter: number;
  message: string;
  severity: vscode.DiagnosticSeverity;
}

interface YamlLinePosition {
  line: number;
  col: number;
}

interface RangedYamlNode {
  range?: [number, number, number];
}

interface YamlParserMessage {
  message: string;
  pos?: [number, number];
  linePos?: [YamlLinePosition, YamlLinePosition];
}

interface RunnerWorkflowSchema {
  version: string;
  definitions: Record<string, SchemaDefinition | undefined>;
}

interface SchemaDefinition {
  context?: string[];
  mapping?: MappingDefinition;
  sequence?: SequenceDefinition;
  'one-of'?: string[];
  'allowed-values'?: string[];
  string?: StringDefinition;
  number?: Record<string, never>;
  boolean?: Record<string, never>;
  null?: Record<string, never>;
}

interface MappingDefinition {
  properties?: Record<string, MappingProperty | string>;
  'loose-key-type'?: string;
  'loose-value-type'?: string;
}

interface MappingProperty {
  type: string;
  required?: boolean;
}

interface SequenceDefinition {
  'item-type': string;
}

interface StringDefinition {
  constant?: string;
  'is-expression'?: boolean;
  'require-non-empty'?: boolean;
}

const runnerWorkflowSchema = workflowSchema as RunnerWorkflowSchema;

function schemaDefinition(name: string): SchemaDefinition {
  const definition = runnerWorkflowSchema.definitions[name];
  if (definition) {
    return definition;
  }

  switch (name) {
    case 'any':
      return { 'one-of': ['sequence', 'mapping', 'number', 'boolean', 'string', 'null'] };
    case 'sequence':
      return { sequence: { 'item-type': 'any' } };
    case 'mapping':
      return { mapping: { 'loose-key-type': 'any', 'loose-value-type': 'any' } };
    case 'number':
      return { number: {} };
    case 'string':
      return { string: {} };
    case 'boolean':
      return { boolean: {} };
    case 'null':
      return { null: {} };
    default:
      return {};
  }
}

function mappingProperty(value: MappingProperty | string): MappingProperty {
  if (typeof value === 'string') {
    return { type: value };
  }
  return value;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

export function isWorkflowFilePath(path: string): boolean {
  const normalized = normalizePath(path);
  return /\.(ya?ml)$/i.test(normalized)
    && WORKFLOW_DIRECTORIES.some(directory => normalized.includes(directory));
}

function createIssue(
  line: number,
  startCharacter: number,
  endCharacter: number,
  message: string,
  severity: vscode.DiagnosticSeverity = vscode.DiagnosticSeverity.Error
): WorkflowValidationIssue {
  return { line, startCharacter, endCharacter, message, severity };
}

function toZeroBasedRange(start: YamlLinePosition, end?: YamlLinePosition): vscode.Range {
  const startLine = Math.max(0, start.line - 1);
  const startCharacter = Math.max(0, start.col - 1);
  const endLine = end ? Math.max(0, end.line - 1) : startLine;
  const endCharacter = end ? Math.max(0, end.col - 1) : startCharacter + 1;
  return new vscode.Range(startLine, startCharacter, endLine, Math.max(startCharacter + 1, endCharacter));
}

function linePosForOffset(text: string, offset: number): YamlLinePosition {
  const boundedOffset = Math.max(0, Math.min(offset, text.length));
  const beforeOffset = text.slice(0, boundedOffset);
  const lineBreaks = beforeOffset.match(/\n/g)?.length ?? 0;
  const lastLineBreak = beforeOffset.lastIndexOf('\n');
  return {
    line: lineBreaks + 1,
    col: boundedOffset - lastLineBreak,
  };
}

function rangeForNode(text: string, node: Node | null | undefined): vscode.Range {
  const range = (node as RangedYamlNode | null | undefined)?.range;
  if (!range) {
    return new vscode.Range(0, 0, 0, 1);
  }

  return toZeroBasedRange(
    linePosForOffset(text, range[0]),
    linePosForOffset(text, range[1])
  );
}

function createIssueFromRange(
  range: vscode.Range,
  message: string,
  severity: vscode.DiagnosticSeverity = vscode.DiagnosticSeverity.Error
): WorkflowValidationIssue {
  return createIssue(range.start.line, range.start.character, range.end.character, message, severity);
}

function nodeDescription(node: Node | null | undefined): string {
  if (!node) {
    return 'empty';
  }
  if (isMap(node)) {
    return 'mapping';
  }
  if (isSeq(node)) {
    return 'sequence';
  }
  if (isScalar(node)) {
    return 'scalar';
  }
  return 'node';
}

function scalarValue(node: Node | null | undefined): unknown {
  return isScalar(node) ? node.value : undefined;
}

function scalarString(node: Node | null | undefined): string | null {
  const value = scalarValue(node);
  return typeof value === 'string' ? value : null;
}

function schemaTypeLabel(definitionName: string): string {
  return definitionName.replace(/-/g, ' ');
}

function oneOfMessage(definitionName: string, path: string, options: string[]): string {
  if (definitionName === 'job') {
    return 'Job must match either a normal job with "runs-on" or a reusable workflow job with "uses".';
  }
  if (definitionName === 'steps-item') {
    return 'Step must define either "run" or "uses".';
  }
  return `${schemaTypeLabel(path)} must match one of: ${options.map(schemaTypeLabel).join(', ')}.`;
}

function pairKey(pair: Pair): string | null {
  return pair.key instanceof Scalar ? String(pair.key.value) : null;
}

function pairValue(pair: Pair): Node | null | undefined {
  return asYamlNode(pair.value);
}

function mappingHasKey(node: Node | null | undefined, key: string): boolean {
  return isMap(node) && node.items.some(pair => pairKey(pair) === key);
}

function selectedOneOfBranch(definitionName: string, node: Node | null | undefined): string | null {
  if (definitionName === 'job') {
    return mappingHasKey(node, 'uses') ? 'workflow-job' : 'job-factory';
  }
  if (definitionName === 'steps-item') {
    if (mappingHasKey(node, 'run')) {
      return 'run-step';
    }
    if (mappingHasKey(node, 'uses')) {
      return 'regular-step';
    }
  }
  return null;
}

function validateSchemaNode(
  text: string,
  document: Document,
  node: Node | null | undefined,
  definitionName: string,
  path = definitionName,
  context: string[] = []
): WorkflowValidationIssue[] {
  const definition = schemaDefinition(definitionName);
  const effectiveContext = [...context, ...(definition.context ?? [])];
  const resolvedNode = resolveAlias(document, node);

  if (!resolvedNode) {
    return [createIssueFromRange(new vscode.Range(0, 0, 0, 1), `Expected ${schemaTypeLabel(definitionName)}.`)];
  }

  const expressionResult = validateEmbeddedExpressions(text, resolvedNode, effectiveContext);
  if (expressionResult.hadExpression) {
    return expressionResult.issues;
  }

  if (definition.mapping) {
    return validateMappingNode(text, document, resolvedNode, definitionName, definition.mapping, path, effectiveContext);
  }

  if (definition.sequence) {
    if (!isSeq(resolvedNode)) {
      return [createIssueFromRange(rangeForNode(text, resolvedNode), `Expected a sequence for ${schemaTypeLabel(definitionName)}, got ${nodeDescription(resolvedNode)}.`)];
    }
    const itemType = definition.sequence['item-type'];
    return resolvedNode.items.flatMap((item, index) =>
      validateSchemaNode(text, document, asYamlNode(item), itemType, `${path}[${index}]`, effectiveContext)
    );
  }

  if (definition['one-of']) {
    const selectedBranch = selectedOneOfBranch(definitionName, resolvedNode);
    if (selectedBranch) {
      return validateSchemaNode(text, document, resolvedNode, selectedBranch, path, effectiveContext);
    }

    for (const option of definition['one-of']) {
      if (validateSchemaNode(text, document, resolvedNode, option, path, effectiveContext).length === 0) {
        return [];
      }
    }
    return [createIssueFromRange(
      rangeForNode(text, resolvedNode),
      oneOfMessage(definitionName, path, definition['one-of'])
    )];
  }

  if (!isScalar(resolvedNode)) {
    return [createIssueFromRange(rangeForNode(text, resolvedNode), `Expected a scalar for ${schemaTypeLabel(definitionName)}, got ${nodeDescription(resolvedNode)}.`)];
  }

  if (definition.string) {
    const expressionIssues = definition.string['is-expression']
      ? validateExpressionValue(text, resolvedNode, effectiveContext)
      : [];
    if (expressionIssues.length > 0) {
      return expressionIssues;
    }

    const value = scalarValue(resolvedNode);
    if (typeof value !== 'string') {
      return [createIssueFromRange(rangeForNode(text, resolvedNode), `Expected a string for ${schemaTypeLabel(definitionName)}.`)];
    }
    if (definition.string.constant && definition.string.constant !== value) {
      return [createIssueFromRange(rangeForNode(text, resolvedNode), `Expected "${definition.string.constant}" for ${schemaTypeLabel(definitionName)}.`)];
    }
    if (definition.string['require-non-empty'] && value.length === 0) {
      return [createIssueFromRange(rangeForNode(text, resolvedNode), `${schemaTypeLabel(definitionName)} must not be empty.`)];
    }
    return [];
  }

  if (definition.number) {
    return typeof scalarValue(resolvedNode) === 'number'
      ? []
      : [createIssueFromRange(rangeForNode(text, resolvedNode), `Expected a number for ${schemaTypeLabel(definitionName)}.`)];
  }

  if (definition.boolean) {
    return typeof scalarValue(resolvedNode) === 'boolean'
      ? []
      : [createIssueFromRange(rangeForNode(text, resolvedNode), `Expected a boolean for ${schemaTypeLabel(definitionName)}.`)];
  }

  if (definition.null) {
    return scalarValue(resolvedNode) === null
      ? []
      : [createIssueFromRange(rangeForNode(text, resolvedNode), `Expected null for ${schemaTypeLabel(definitionName)}.`)];
  }

  if (definition['allowed-values']) {
    const value = String(scalarValue(resolvedNode));
    return definition['allowed-values'].includes(value)
      ? []
      : [createIssueFromRange(rangeForNode(text, resolvedNode), `Expected one of ${definition['allowed-values'].join(', ')} for ${schemaTypeLabel(definitionName)}.`)];
  }

  return [];
}

function validateMappingNode(
  text: string,
  document: Document,
  node: Node | null | undefined,
  definitionName: string,
  mapping: MappingDefinition,
  path: string,
  context: string[]
): WorkflowValidationIssue[] {
  if (!isMap(node)) {
    return [createIssueFromRange(rangeForNode(text, node), `Expected a mapping for ${schemaTypeLabel(definitionName)}, got ${nodeDescription(node)}.`)];
  }
  if (hasMergeKey(node)) {
    return [];
  }

  const issues: WorkflowValidationIssue[] = [];
  const properties = mapping.properties ?? {};

  for (const pair of node.items) {
    const key = pairKey(pair);
    const value = pairValue(pair);
    const keyExpressionResult = validateEmbeddedExpressions(text, asYamlNode(pair.key), context);
    if (keyExpressionResult.issues.length > 0) {
      issues.push(...keyExpressionResult.issues);
      continue;
    }
    if (key === null || keyExpressionResult.hadExpression) {
      continue;
    }

    const property = properties[key];
    if (!property) {
      const looseValueType = mapping['loose-value-type'];
      if (!looseValueType) {
        issues.push(createIssueFromRange(rangeForNode(text, asYamlNode(pair.key)), `Unknown workflow property "${key}".`));
        continue;
      }
      issues.push(...validateSchemaNode(text, document, value, looseValueType, `${path}.${key}`, context));
      continue;
    }

    issues.push(...validateSchemaNode(text, document, value, mappingProperty(property).type, `${path}.${key}`, context));
  }

  return issues;
}

function asYamlNode(value: unknown): Node | null | undefined {
  return value as Node | null | undefined;
}

function resolveAlias(document: Document, node: Node | null | undefined): Node | null | undefined {
  if (node && isAlias(node)) {
    return asYamlNode(node.resolve(document));
  }
  return node;
}

function functionSpec(value: string): { name: string; min: number; max: number } | null {
  const match = value.match(/^([a-zA-Z0-9_]+)\((\d+),(\d+|MAX)\)$/);
  if (!match) {
    return null;
  }
  return {
    name: match[1].toLowerCase(),
    min: Number(match[2]),
    max: match[3] === 'MAX' ? Number.MAX_SAFE_INTEGER : Number(match[3]),
  };
}

function expressionFunctions(context: string[]): Map<string, { min: number; max: number }> {
  const functions = new Map<string, { min: number; max: number }>();
  for (const value of [...DEFAULT_EXPRESSION_FUNCTIONS, ...context]) {
    const spec = functionSpec(value);
    if (spec) {
      functions.set(spec.name, { min: spec.min, max: spec.max });
    }
  }
  return functions;
}

function stripQuotedExpressionText(expression: string): string {
  return expression.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, "'x'");
}

function countExpressionArguments(args: string): number {
  if (args.trim().length === 0) {
    return 0;
  }

  let depth = 0;
  let count = 1;
  for (const char of args) {
    if (char === '(' || char === '[' || char === '{') {
      depth++;
    } else if (char === ')' || char === ']' || char === '}') {
      depth = Math.max(0, depth - 1);
    } else if (char === ',' && depth === 0) {
      count++;
    }
  }
  return count;
}

function findFunctionCalls(expression: string): { name: string; args: string }[] {
  const calls: { name: string; args: string }[] = [];
  const callPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = callPattern.exec(expression)) !== null) {
    let index = callPattern.lastIndex;
    let depth = 1;
    while (index < expression.length && depth > 0) {
      const char = expression[index];
      if (char === '(') {
        depth++;
      } else if (char === ')') {
        depth--;
      }
      index++;
    }
    calls.push({ name: match[1], args: expression.slice(callPattern.lastIndex, Math.max(callPattern.lastIndex, index - 1)) });
  }
  return calls;
}

function validateSingleExpression(
  text: string,
  node: Node,
  expression: string,
  context: string[]
): WorkflowValidationIssue[] {
  const issues: WorkflowValidationIssue[] = [];
  const allowedContexts = new Set(context.filter(value => !functionSpec(value)).map(value => value.toLowerCase()));
  const allowedFunctions = expressionFunctions(context);
  const unquoted = stripQuotedExpressionText(expression);

  let balance = 0;
  for (const char of unquoted) {
    if (char === '(') {
      balance++;
    } else if (char === ')') {
      balance--;
    }
    if (balance < 0) {
      issues.push(createIssueFromRange(rangeForNode(text, node), 'Failed to parse workflow expression.'));
      return issues;
    }
  }
  if (balance !== 0) {
    issues.push(createIssueFromRange(rangeForNode(text, node), 'Failed to parse workflow expression.'));
    return issues;
  }

  for (const call of findFunctionCalls(unquoted)) {
    const allowed = allowedFunctions.get(call.name.toLowerCase());
    if (!allowed) {
      issues.push(createIssueFromRange(rangeForNode(text, node), `Unknown Function Call ${call.name}`));
      continue;
    }
    const argCount = countExpressionArguments(call.args);
    if (argCount < allowed.min) {
      issues.push(createIssueFromRange(rangeForNode(text, node), `Missing parameters for ${call.name} expected >= ${allowed.min} got ${argCount}`));
    } else if (argCount > allowed.max) {
      issues.push(createIssueFromRange(rangeForNode(text, node), `Too many parameters for ${call.name} expected <= ${allowed.max} got ${argCount}`));
    }
  }

  const variablePattern = /(?:^|[^\w.])([a-zA-Z_][a-zA-Z0-9_]*)\s*\./g;
  let match: RegExpExecArray | null;
  while ((match = variablePattern.exec(unquoted)) !== null) {
    const variableName = match[1];
    if (!allowedContexts.has(variableName.toLowerCase())) {
      issues.push(createIssueFromRange(rangeForNode(text, node), `Unknown Variable Access ${variableName}`));
    }
  }

  return issues;
}

function validateEmbeddedExpressions(
  text: string,
  node: Node | null | undefined,
  context: string[]
): { hadExpression: boolean; issues: WorkflowValidationIssue[] } {
  const value = scalarString(node);
  if (value === null || !node) {
    return { hadExpression: false, issues: [] };
  }

  let offset = 0;
  const issues: WorkflowValidationIssue[] = [];
  while (offset < value.length) {
    const start = value.indexOf('${{', offset);
    if (start === -1) {
      break;
    }
    const end = value.indexOf('}}', start + 3);
    if (end === -1) {
      issues.push(createIssueFromRange(rangeForNode(text, node), 'Failed to parse workflow expression.'));
      return { hadExpression: true, issues };
    }
    issues.push(...validateSingleExpression(text, node, value.slice(start + 3, end), context));
    offset = end + 2;
  }

  return { hadExpression: offset > 0, issues };
}

function validateExpressionValue(
  text: string,
  node: Node | null | undefined,
  context: string[]
): WorkflowValidationIssue[] {
  const value = scalarString(node);
  if (value === null || !node) {
    return [];
  }
  return validateSingleExpression(text, node, value, context);
}

function hasMergeKey(node: Node | null | undefined): boolean {
  return isMap(node) && node.items.some(pair => pairKey(pair) === '<<');
}

function parserIssue(text: string, error: YamlParserMessage): WorkflowValidationIssue {
  if (error.linePos?.[0]) {
    const range = toZeroBasedRange(error.linePos[0], error.linePos[1]);
    return createIssueFromRange(range, error.message);
  }

  if (error.pos?.[0] !== undefined) {
    const start = linePosForOffset(text, error.pos[0]);
    const end = linePosForOffset(text, error.pos[1]);
    return createIssueFromRange(toZeroBasedRange(start, end), error.message);
  }

  return createIssue(0, 0, 1, error.message);
}

export function validateWorkflowText(text: string, filePath = 'workflow.yml'): WorkflowValidationIssue[] {
  if (!isWorkflowFilePath(filePath)) {
    return [];
  }

  const document = parseDocument(text, {
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
  });

  const parserIssues = [
    ...document.errors.map(error => parserIssue(text, error as YamlParserMessage)),
    ...document.warnings.map(warning => parserIssue(text, warning as YamlParserMessage)),
  ];

  if (parserIssues.length > 0) {
    return parserIssues;
  }

  return validateSchemaNode(text, document, document.contents as Node | null | undefined, WORKFLOW_SCHEMA_ROOT);
}

function toDiagnostic(issue: WorkflowValidationIssue): vscode.Diagnostic {
  const range = new vscode.Range(issue.line, issue.startCharacter, issue.line, Math.max(issue.startCharacter + 1, issue.endCharacter));
  return new vscode.Diagnostic(range, issue.message, issue.severity);
}

async function validateUri(uri: vscode.Uri, collection: vscode.DiagnosticCollection): Promise<void> {
  if (!isWorkflowFilePath(uri.fsPath)) {
    collection.delete(uri);
    return;
  }

  try {
    const document = await vscode.workspace.openTextDocument(uri);
    collection.set(uri, validateWorkflowText(document.getText(), uri.fsPath).map(toDiagnostic));
  } catch (error) {
    collection.set(uri, [
      new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 1),
        `Unable to validate workflow: ${error instanceof Error ? error.message : 'unknown error'}`,
        vscode.DiagnosticSeverity.Warning
      )
    ]);
  }
}

export async function validateWorkspaceWorkflows(collection: vscode.DiagnosticCollection): Promise<void> {
  const uris = await Promise.all(WORKFLOW_GLOBS.map(glob => vscode.workspace.findFiles(glob, '**/node_modules/**', 100)));
  await Promise.all(uris.flat().map(uri => validateUri(uri, collection)));
}

export function registerWorkflowDiagnostics(context: vscode.ExtensionContext): vscode.DiagnosticCollection {
  const collection = vscode.languages.createDiagnosticCollection('forgejo-workflows');

  context.subscriptions.push(
    collection,
    vscode.workspace.onDidOpenTextDocument(document => {
      if (isWorkflowFilePath(document.uri.fsPath)) {
        collection.set(document.uri, validateWorkflowText(document.getText(), document.uri.fsPath).map(toDiagnostic));
      }
    }),
    vscode.workspace.onDidChangeTextDocument(event => {
      if (isWorkflowFilePath(event.document.uri.fsPath)) {
        collection.set(event.document.uri, validateWorkflowText(event.document.getText(), event.document.uri.fsPath).map(toDiagnostic));
      }
    }),
    vscode.workspace.onDidSaveTextDocument(document => {
      if (isWorkflowFilePath(document.uri.fsPath)) {
        collection.set(document.uri, validateWorkflowText(document.getText(), document.uri.fsPath).map(toDiagnostic));
      }
    }),
    vscode.workspace.onDidCloseTextDocument(document => {
      if (isWorkflowFilePath(document.uri.fsPath)) {
        collection.delete(document.uri);
      }
    })
  );

  void validateWorkspaceWorkflows(collection);

  return collection;
}
