import * as vscode from 'vscode';
import { ForgejoClient } from '../api/forgejoClient';
import { CommitStatus } from '../models/pullRequest';
import { WorkflowJobRef } from '../models/action';
import { getForgejoConfigFor } from '../utils/config';
import { isWorkflowFilePath, validateWorkspaceWorkflows } from '../diagnostics/workflowDiagnostics';
import { activateGitExtension } from '../utils/gitExtension';
import { repositoryMatchesConfig } from '../utils/gitRepositoryMatch';
import type { API } from '../types/git';

export interface CIStatusArgs {
  status: CommitStatus;
  owner: string;
  repo: string;
  instanceUrl?: string;
}

export interface WorkflowFileArgs {
  workflowName: string;
  owner: string;
  repo: string;
  instanceUrl?: string;
}

interface ActionJobTarget {
  runNumber: number;
  jobIndex: number;
  url: string;
}

function normalizeInstanceUrl(instanceUrl: string): string {
  return instanceUrl.replace(/\/+$/, '');
}

export function resolveStatusTargetUrl(targetUrl: string | undefined, instanceUrl: string): string | null {
  if (!targetUrl) {
    return null;
  }

  if (/^https?:\/\//i.test(targetUrl)) {
    return targetUrl;
  }

  try {
    return new URL(targetUrl, `${normalizeInstanceUrl(instanceUrl)}/`).toString();
  } catch {
    return null;
  }
}

export function parseActionJobTarget(url: string): ActionJobTarget | null {
  const match = url.match(/\/actions\/runs\/(\d+)\/jobs\/(\d+)(?:[/?#]|$)/);
  if (!match) {
    return null;
  }

  return {
    runNumber: Number(match[1]),
    jobIndex: Number(match[2]),
    url,
  };
}

export function inferWorkflowNameFromStatusContext(context: string): string {
  return context.split(' / ')[0].replace(/\s*\([^)]*\)\s*$/g, '').trim();
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function stripYamlScalar(value: string): string {
  const uncommented = value.replace(/\s+#.*$/, '').trim();
  if (
    (uncommented.startsWith('"') && uncommented.endsWith('"'))
    || (uncommented.startsWith("'") && uncommented.endsWith("'"))
  ) {
    return uncommented.slice(1, -1).trim();
  }
  return uncommented;
}

function getWorkflowName(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^name\s*:\s*(.+)$/);
    if (match) {
      return stripYamlScalar(match[1]);
    }

    if (line.trim() && !line.trim().startsWith('#')) {
      return null;
    }
  }
  return null;
}

const WORKFLOW_GLOBS = [
  '.forgejo/workflows/*.{yml,yaml}',
  '.gitea/workflows/*.{yml,yaml}',
  '.github/workflows/*.{yml,yaml}',
] as const;

async function getGitApi(): Promise<API | undefined> {
  const gitExtension = await activateGitExtension();
  if (!gitExtension?.enabled) {
    return undefined;
  }

  return gitExtension.getAPI(1);
}

async function resolveWorkflowSearchRoots(args: Pick<CIStatusArgs, 'owner' | 'repo' | 'instanceUrl'>): Promise<vscode.Uri[]> {
  const git = await getGitApi();
  if (!git) {
    return [];
  }

  const seen = new Set<string>();
  return git.repositories
    .filter(repository => repositoryMatchesConfig(repository, args.owner, args.repo, args.instanceUrl))
    .map(repository => repository.rootUri)
    .filter(uri => {
      if (seen.has(uri.fsPath)) {
        return false;
      }
      seen.add(uri.fsPath);
      return true;
    });
}

async function findWorkflowFiles(searchRoots?: readonly vscode.Uri[]): Promise<vscode.Uri[]> {
  const groups = searchRoots && searchRoots.length > 0
    ? await Promise.all(searchRoots.flatMap(root =>
      WORKFLOW_GLOBS.map(pattern =>
        vscode.workspace.findFiles(new vscode.RelativePattern(root.fsPath, pattern), '**/node_modules/**', 100)
      )
    ))
    : await Promise.all(WORKFLOW_GLOBS.map(pattern =>
      vscode.workspace.findFiles(`**/${pattern}`, '**/node_modules/**', 100)
    ));

  const seen = new Set<string>();
  return groups.flat().filter(uri => {
    if (!isWorkflowFilePath(uri.fsPath) || seen.has(uri.fsPath)) {
      return false;
    }
    seen.add(uri.fsPath);
    return true;
  });
}

export async function findWorkflowFileForStatus(status: CommitStatus, searchRoots?: readonly vscode.Uri[]): Promise<vscode.Uri | null> {
  const workflowName = inferWorkflowNameFromStatusContext(status.context);
  const workflowSlug = slugify(workflowName);
  const files = await findWorkflowFiles(searchRoots);
  const matches: vscode.Uri[] = [];

  for (const uri of files) {
    const document = await vscode.workspace.openTextDocument(uri);
    const configuredName = getWorkflowName(document.getText());
    const filename = uri.fsPath.split(/[\\/]/).pop() ?? '';
    const basename = filename.replace(/\.(ya?ml)$/i, '');
    const basenameSlug = slugify(basename);

    if (
      configuredName?.toLowerCase() === workflowName.toLowerCase()
      || filename.toLowerCase() === workflowName.toLowerCase()
      || basename.toLowerCase() === workflowName.toLowerCase()
      || basenameSlug === workflowSlug
    ) {
      matches.push(uri);
    }
  }

  if (matches.length === 0) {
    return null;
  }

  if (matches.length === 1) {
    return matches[0];
  }

  const picked = await vscode.window.showQuickPick(
    matches.map(uri => ({ label: uri.fsPath.split(/[\\/]/).pop() ?? uri.fsPath, description: uri.fsPath, uri })),
    { placeHolder: `Select workflow file for ${workflowName}` }
  );
  return picked?.uri ?? null;
}

export async function findWorkflowFileByName(workflowName: string, searchRoots?: readonly vscode.Uri[]): Promise<vscode.Uri | null> {
  return findWorkflowFileForStatus({
    id: 0,
    status: 'pending',
    context: workflowName,
    description: '',
    target_url: '',
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  } as CommitStatus, searchRoots);
}

export async function viewCIStatusLogs(args: CIStatusArgs): Promise<void> {
  const config = await getForgejoConfigFor(args.owner, args.repo, args.instanceUrl);
  if (!config) {
    void vscode.window.showErrorMessage('Forgejo configuration not found');
    return;
  }

  const targetUrl = resolveStatusTargetUrl(args.status.target_url, config.instanceUrl);
  if (!targetUrl) {
    void vscode.window.showInformationMessage('No CI log URL is available for this status.');
    return;
  }

  const actionTarget = parseActionJobTarget(targetUrl);
  if (!actionTarget) {
    void vscode.env.openExternal(vscode.Uri.parse(targetUrl));
    return;
  }

  const jobRef: WorkflowJobRef = {
    jobHtmlUrl: targetUrl,
    jobIndex: actionTarget.jobIndex,
    jobName: args.status.context,
  };

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Fetching logs for ${args.status.context}...`,
      cancellable: false
    },
    async () => {
      const client = new ForgejoClient(config.instanceUrl, config.token);
      const logs = await client.getWorkflowLogs(args.owner, args.repo, actionTarget.runNumber, jobRef);
      const doc = await vscode.workspace.openTextDocument({
        content: logs,
        language: 'log'
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    }
  );
}

export async function openWorkflowFileForCIStatus(args: CIStatusArgs): Promise<void> {
  const searchRoots = await resolveWorkflowSearchRoots(args);
  const uri = searchRoots.length > 0
    ? await findWorkflowFileForStatus(args.status, searchRoots)
    : null;
  if (!uri) {
    void vscode.window.showInformationMessage(`No local workflow file matched "${inferWorkflowNameFromStatusContext(args.status.context)}".`);
    return;
  }

  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: true });
}

export async function openWorkflowFileByName(workflowName: string): Promise<void> {
  const uri = await findWorkflowFileByName(workflowName);
  if (!uri) {
    void vscode.window.showInformationMessage(`No local workflow file matched "${workflowName}".`);
    return;
  }

  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: true });
}

export async function openWorkflowFileForRepository(args: WorkflowFileArgs): Promise<void> {
  const searchRoots = await resolveWorkflowSearchRoots(args);
  const uri = searchRoots.length > 0
    ? await findWorkflowFileByName(args.workflowName, searchRoots)
    : null;
  if (!uri) {
    void vscode.window.showInformationMessage(`No local workflow file matched "${args.workflowName}".`);
    return;
  }

  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: true });
}

export async function validateWorkflowsCommand(collection: vscode.DiagnosticCollection): Promise<void> {
  await validateWorkspaceWorkflows(collection);
  void vscode.window.showInformationMessage('Forgejo workflow diagnostics refreshed.');
}
