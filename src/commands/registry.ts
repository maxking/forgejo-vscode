/**
 * Type-safe command registry for Forgejo VS Code extension.
 *
 * VS Code's `registerCommand` and `executeCommand` use `any` for arguments,
 * so TypeScript cannot verify that callers and handlers agree on types.
 * This module provides a central `CommandMap` that defines the expected
 * argument tuple for every command, plus typed wrappers that enforce it
 * at compile time.
 *
 * Context menu invocation: when a command appears in package.json under
 * `view/item/context`, VS Code passes the tree item as the first argument.
 * Handlers for those commands must accept the tree item type in their
 * first parameter (reflected in the CommandMap via union types).
 */

import * as vscode from 'vscode';
import type { PullRequestListItem, PullRequestFile } from '../models/pullRequest';
import type { WorkflowRunListItem, WorkflowJob } from '../models/action';
import type { IssueListItem } from '../models/issue';
import type { IssueTreeItem } from '../providers/issueTreeProvider';
import type { PRTreeItem, PROverviewItem, PRFileItem } from '../providers/prTreeProvider';
import type { WorkflowRunTreeItem, JobTreeItem, StepTreeItem, StepLogArgs } from '../providers/actionsTreeProvider';

// ---------------------------------------------------------------------------
// Command argument map
// ---------------------------------------------------------------------------

/**
 * Maps every `forgejo.*` command ID to its expected argument tuple.
 *
 * Commands invoked from `view/item/context` receive a tree item as arg 0.
 * Those entries should use a union type for arg 0 so both the context-menu
 * path (tree item) and the direct-invocation path (data object) compile.
 */
export interface CommandMap {
  // -- No-arg commands (toolbar buttons, palette, etc.) --------------------
  'forgejo.addInstance': [];
  'forgejo.manageInstances': [];
  'forgejo.showDiagnostics': [];
  'forgejo.showOutput': [];
  'forgejo.refreshPullRequests': [];
  'forgejo.refreshIssues': [];
  'forgejo.refreshActions': [];
  'forgejo.refreshReleases': [];
  'forgejo.configureInstanceUrl': [];
  'forgejo.setAuthToken': [];
  'forgejo.selectRemote': [];
  'forgejo.createIssue': [];
  'forgejo.createPullRequest': [];
  'forgejo.createRelease': [];
  'forgejo.publishToForgejo': [];

  // -- Simple URL commands -------------------------------------------------
  'forgejo.openPrInBrowser': [url: string];
  'forgejo.openIssueInBrowser': [url: string];
  'forgejo.openReleaseInBrowser': [url: string];
  'forgejo.openActionInBrowserDirect': [url: string];

  // -- Inline comment ------------------------------------------------------
  'forgejo.submitInlineComment': [reply: vscode.CommentReply];

  // -- PR file diff (TreeItem.command only) --------------------------------
  'forgejo.showPrFileDiff': [
    file: PullRequestFile,
    pr: PullRequestListItem,
    owner: string,
    repo: string,
    baseRef: string,
    headRef: string,
  ];

  // -- Context menu commands -----------------------------------------------
  // Commands in package.json `view/item/context` receive the tree item as
  // arg 0. Union types below ensure handlers accept both the context-menu
  // path (tree item) and the direct-invocation path (data object).

  'forgejo.openPrInBrowserFromContext': [prItem: PRTreeItem];
  'forgejo.openPrFileInBrowser': [fileItem: PRFileItem];

  // view/item/context: viewItem == prOverview  +  executeCommand calls
  'forgejo.showPrDetails': [
    prOrItem: PullRequestListItem | PROverviewItem,
    owner?: string,
    repo?: string,
  ];

  // view/item/context: viewItem == pullRequest
  'forgejo.mergePr': [
    prOrItem: PullRequestListItem | PRTreeItem,
    owner?: string,
    repo?: string,
  ];

  // view/item/context: viewItem == pullRequest
  'forgejo.closePr': [
    prOrItem: PullRequestListItem | PRTreeItem,
    owner?: string,
    repo?: string,
  ];

  // view/item/context: viewItem == issue  +  TreeItem.command
  'forgejo.showIssueDetails': [
    issueOrItem: IssueListItem | IssueTreeItem,
    owner?: string,
    repo?: string,
  ];

  'forgejo.openIssueInBrowserFromContext': [issueItem: IssueTreeItem];

  // view/item/context: viewItem == workflowRun | workflowJob
  'forgejo.showActionDetails': [
    runOrItem: WorkflowRunListItem | WorkflowRunTreeItem | JobTreeItem,
    owner?: string,
    repo?: string,
  ];

  // view/item/context: viewItem == workflowRun | workflowJob | workflowStep
  'forgejo.viewActionLogs': [
    runOrItem: WorkflowRunTreeItem | JobTreeItem | StepTreeItem | WorkflowRunListItem,
    job?: WorkflowJob,
    owner?: string,
    repo?: string,
  ];

  'forgejo.openActionInBrowser': [item: WorkflowRunTreeItem | JobTreeItem | StepTreeItem];
  'forgejo.rerunAction': [item: WorkflowRunTreeItem | JobTreeItem];

  'forgejo.viewStepLogs': [args: StepLogArgs];
}

// ---------------------------------------------------------------------------
// Typed helpers
// ---------------------------------------------------------------------------

/**
 * Type-safe wrapper around `vscode.commands.registerCommand`.
 *
 * Ensures the handler signature matches what `CommandMap` declares for the
 * given command ID. This catches mismatches at compile time — if you change
 * the command's context menu `when` clause to target a new tree item type,
 * the compiler will force you to update the handler.
 */
export function registerCommand<K extends keyof CommandMap>(
  id: K,
  handler: (...args: CommandMap[K]) => void | Promise<void>,
): vscode.Disposable {
  return vscode.commands.registerCommand(
    id,
    handler as (...args: unknown[]) => unknown,
  );
}

/**
 * Type-safe wrapper around `vscode.commands.executeCommand`.
 *
 * Ensures call-site arguments match what the handler expects.
 */
export function executeCommand<K extends keyof CommandMap>(
  id: K,
  ...args: CommandMap[K]
): Thenable<unknown> {
  return vscode.commands.executeCommand(id, ...args);
}
