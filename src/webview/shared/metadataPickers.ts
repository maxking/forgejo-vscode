/**
 * Shared VS Code QuickPick pickers for editing labels, assignees, and
 * milestone on an issue or pull request.
 *
 * Both issueDetail and prDetail webview providers use these — Forgejo
 * treats pull requests as issues internally, so the same repo-level
 * label/milestone/assignee lists and the same update semantics apply to
 * both entity types (see `ForgejoClient.setIssueLabels`/`updateIssueMetadata`).
 */
import * as vscode from 'vscode';
import { ForgejoClient } from '../../api/forgejoClient';

interface LabelPickItem extends vscode.QuickPickItem {
  labelId: number;
}

/**
 * Shows a multi-select label picker pre-checked against the entity's
 * current labels. Returns the full desired label-ID list (replace
 * semantics), or `undefined` if the user cancelled.
 */
export async function pickLabels(
  client: ForgejoClient,
  owner: string,
  repo: string,
  currentLabelNames: string[]
): Promise<number[] | undefined> {
  const allLabels = await client.listRepoLabels(owner, repo);
  if (allLabels.length === 0) {
    void vscode.window.showInformationMessage('This repository has no labels defined.');
    return undefined;
  }

  const currentSet = new Set(currentLabelNames.map(name => name.toLowerCase()));
  const items: LabelPickItem[] = allLabels.map(label => ({
    label: label.name,
    description: label.description,
    picked: currentSet.has(label.name.toLowerCase()),
    labelId: label.id
  }));

  const selected = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: 'Select labels'
  });
  if (!selected) return undefined;

  return selected.map(item => item.labelId);
}

interface AssigneePickItem extends vscode.QuickPickItem {
  login: string;
}

/**
 * Shows a multi-select assignee picker pre-checked against the entity's
 * current assignees. Returns the full desired assignee-login list
 * (replace semantics), or `undefined` if the user cancelled.
 */
export async function pickAssignees(
  client: ForgejoClient,
  owner: string,
  repo: string,
  currentLogins: string[]
): Promise<string[] | undefined> {
  const users = await client.listAssignableUsers(owner, repo);
  if (users.length === 0) {
    void vscode.window.showInformationMessage('No assignable users found for this repository.');
    return undefined;
  }

  const currentSet = new Set(currentLogins.map(login => login.toLowerCase()));
  const items: AssigneePickItem[] = users.map(user => ({
    label: user.login,
    picked: currentSet.has(user.login.toLowerCase()),
    login: user.login
  }));

  const selected = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: 'Select assignees'
  });
  if (!selected) return undefined;

  return selected.map(item => item.login);
}

interface MilestonePickItem extends vscode.QuickPickItem {
  milestoneId: number;
}

/**
 * Shows a single-select milestone picker (plus a "No milestone" option
 * to unset). Returns the selected milestone ID (`0` means unset), or
 * `undefined` if the user cancelled.
 */
export async function pickMilestone(
  client: ForgejoClient,
  owner: string,
  repo: string,
  currentMilestoneId: number | null | undefined
): Promise<number | undefined> {
  const milestones = await client.listMilestones(owner, repo, 'open');
  const currentId = currentMilestoneId ?? 0;

  const items: MilestonePickItem[] = [
    {
      label: 'No milestone',
      description: currentId === 0 ? 'Current' : undefined,
      milestoneId: 0
    },
    ...milestones.map(milestone => {
      const descriptionParts = [
        currentId === milestone.id ? 'Current' : undefined,
        milestone.due_on ? `due ${milestone.due_on}` : undefined
      ].filter((part): part is string => Boolean(part));
      return {
        label: milestone.title,
        description: descriptionParts.length > 0 ? descriptionParts.join(' — ') : undefined,
        milestoneId: milestone.id
      };
    })
  ];

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select milestone'
  });
  if (!selected) return undefined;

  return selected.milestoneId;
}
