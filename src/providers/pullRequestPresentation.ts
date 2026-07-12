import * as vscode from 'vscode';
import { getPullRequestMergeability, PullRequestListItemWithMergeability } from '../models/pullRequest';

/**
 * Presentation (tooltip/description/icon) shared by every pull request tree
 * row across the extension (`prTreeProvider.ts` and the saved-query
 * dashboard), so the two views can't drift on how PR state is rendered.
 */
export interface PullRequestPresentation {
  tooltip: string;
  description: string;
  iconPath: vscode.ThemeIcon;
}

export function getPullRequestPresentation(pr: PullRequestListItemWithMergeability): PullRequestPresentation {
  const mergeability = getPullRequestMergeability(pr);
  const mergeabilitySuffix = mergeability.state === 'notApplicable' ? '' : `\nMergeability: ${mergeability.label}`;

  const tooltip = `${pr.title}\nby ${pr.user.login}\nState: ${pr.state}${pr.merged ? ' (merged)' : ''}${pr.draft ? ' (draft)' : ''}${mergeabilitySuffix}`;
  const description = mergeability.state === 'notApplicable'
    ? `by ${pr.user.login}`
    : `by ${pr.user.login} - ${mergeability.label}`;

  let iconPath: vscode.ThemeIcon;
  if (mergeability.state === 'conflicting') {
    iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
  } else if (pr.merged) {
    iconPath = new vscode.ThemeIcon('git-merge', new vscode.ThemeColor('gitDecoration.addedResourceForeground'));
  } else if (pr.draft) {
    iconPath = new vscode.ThemeIcon('git-pull-request-draft');
  } else if (pr.state === 'closed') {
    iconPath = new vscode.ThemeIcon('git-pull-request-closed', new vscode.ThemeColor('gitDecoration.deletedResourceForeground'));
  } else {
    iconPath = new vscode.ThemeIcon('git-pull-request', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'));
  }

  return { tooltip, description, iconPath };
}
