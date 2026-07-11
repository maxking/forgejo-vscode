import * as vscode from 'vscode';
import { getPullRequestPresentation } from '../../providers/pullRequestPresentation';
import { PullRequestListItemWithMergeability } from '../../models/pullRequest';

function makePR(overrides: Partial<PullRequestListItemWithMergeability> = {}): PullRequestListItemWithMergeability {
  return {
    number: 1,
    title: 'Example PR',
    state: 'open',
    user: { login: 'alice' },
    html_url: 'https://git.example.com/owner/repo/pulls/1',
    created_at: '2026-01-01T00:00:00Z',
    merged: false,
    draft: false,
    comments: 0,
    ...overrides
  };
}

describe('getPullRequestPresentation', () => {
  test('shows a warning icon and mergeability details for a conflicting PR', () => {
    const presentation = getPullRequestPresentation(makePR({ mergeable: false }));

    expect(presentation.iconPath).toEqual(new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground')));
    expect(presentation.description).toBe('by alice - Merge conflicts');
    expect(presentation.tooltip).toContain('Mergeability: Merge conflicts');
  });

  test('shows a merge icon and "Not applicable" mergeability for a merged PR', () => {
    const presentation = getPullRequestPresentation(makePR({ merged: true, state: 'closed' }));

    expect(presentation.iconPath).toEqual(new vscode.ThemeIcon('git-merge', new vscode.ThemeColor('gitDecoration.addedResourceForeground')));
    expect(presentation.description).toBe('by alice');
    expect(presentation.tooltip).not.toContain('Mergeability:');
    expect(presentation.tooltip).toContain('(merged)');
  });

  test('shows a draft icon for a draft PR', () => {
    const presentation = getPullRequestPresentation(makePR({ draft: true }));

    expect(presentation.iconPath).toEqual(new vscode.ThemeIcon('git-pull-request-draft'));
    expect(presentation.description).toBe('by alice');
    expect(presentation.tooltip).toContain('(draft)');
  });

  test('shows a closed icon for a closed, non-merged PR', () => {
    const presentation = getPullRequestPresentation(makePR({ state: 'closed', merged: false }));

    expect(presentation.iconPath).toEqual(new vscode.ThemeIcon('git-pull-request-closed', new vscode.ThemeColor('gitDecoration.deletedResourceForeground')));
    expect(presentation.description).toBe('by alice');
  });

  test('shows a mergeable icon and label for an open, cleanly mergeable PR', () => {
    const presentation = getPullRequestPresentation(makePR({ mergeable: true }));

    expect(presentation.iconPath).toEqual(new vscode.ThemeIcon('git-pull-request', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground')));
    expect(presentation.description).toBe('by alice - Ready to merge');
  });

  test('shows an unknown-mergeability label for an open PR where mergeability has not been fetched', () => {
    const presentation = getPullRequestPresentation(makePR());

    expect(presentation.iconPath).toEqual(new vscode.ThemeIcon('git-pull-request', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground')));
    expect(presentation.description).toBe('by alice - Mergeability unknown');
  });
});
