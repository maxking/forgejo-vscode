import {
  findPullRequestForBranch,
  mapBranchStatusToPresentation,
  PullRequestListItemWithHead
} from '../../statusBar/branchStatusMapping';
import { CommitStatus } from '../../models/pullRequest';

function makePr(overrides: Partial<PullRequestListItemWithHead> = {}): PullRequestListItemWithHead {
  return {
    number: 1,
    title: 'Add feature',
    state: 'open',
    user: { login: 'maxking' } as PullRequestListItemWithHead['user'],
    html_url: 'https://git.example.com/o/r/pulls/1',
    created_at: '2026-01-01T00:00:00Z',
    merged: false,
    draft: false,
    comments: 0,
    head: { ref: 'feature-branch', sha: 'abc123' },
    base: { ref: 'master' },
    ...overrides
  };
}

describe('findPullRequestForBranch', () => {
  it('returns the PR whose head ref matches the branch name', () => {
    const target = makePr({ number: 5, head: { ref: 'my-branch', sha: 'sha5' } });
    const prs = [makePr({ number: 1, head: { ref: 'other-branch', sha: 'sha1' } }), target];

    expect(findPullRequestForBranch(prs, 'my-branch')).toBe(target);
  });

  it('returns undefined when no PR matches the branch name', () => {
    const prs = [makePr({ head: { ref: 'other-branch', sha: 'sha1' } })];

    expect(findPullRequestForBranch(prs, 'my-branch')).toBeUndefined();
  });

  it('returns undefined for an empty PR list', () => {
    expect(findPullRequestForBranch([], 'my-branch')).toBeUndefined();
  });

  it('picks the first match when multiple PRs share a head ref (should not normally happen)', () => {
    const first = makePr({ number: 1, head: { ref: 'dup', sha: 'sha1' } });
    const second = makePr({ number: 2, head: { ref: 'dup', sha: 'sha2' } });

    expect(findPullRequestForBranch([first, second], 'dup')).toBe(first);
  });
});

describe('mapBranchStatusToPresentation', () => {
  it('hides the item when there is no active repository', () => {
    expect(mapBranchStatusToPresentation({ kind: 'no-repo' })).toEqual({});
  });

  it('hides the item when no Forgejo config resolves for the active repository', () => {
    expect(mapBranchStatusToPresentation({ kind: 'no-config' })).toEqual({});
  });

  it('hides the item when the user has disabled the status bar item', () => {
    expect(mapBranchStatusToPresentation({ kind: 'disabled' })).toEqual({});
  });

  it('shows a loading indicator while resolving', () => {
    const presentation = mapBranchStatusToPresentation({ kind: 'loading', branchName: 'feature-branch' });

    expect(presentation.text).toContain('feature-branch');
    expect(presentation.text).toContain('sync~spin');
    expect(presentation.command).toBeUndefined();
  });

  it('surfaces a fetch error without throwing, including the error message in the tooltip', () => {
    const presentation = mapBranchStatusToPresentation({
      kind: 'error',
      branchName: 'feature-branch',
      message: 'Network timeout'
    });

    expect(presentation.text).toContain('feature-branch');
    expect(presentation.tooltip).toContain('Network timeout');
    expect(presentation.command).toBe('forgejo.statusBar.action');
  });

  it('offers to create a PR when the branch has no open pull request', () => {
    const presentation = mapBranchStatusToPresentation({ kind: 'no-pr', branchName: 'feature-branch' });

    expect(presentation.text).toContain('feature-branch');
    expect(presentation.text).toContain('git-pull-request-create');
    expect(presentation.command).toBe('forgejo.statusBar.action');
  });

  it('shows the PR number and passing CI status', () => {
    const pr = makePr({ number: 42 });
    const presentation = mapBranchStatusToPresentation({
      kind: 'has-pr',
      branchName: 'feature-branch',
      pr,
      ciStatuses: [] as CommitStatus[],
      ciStatus: 'success'
    });

    expect(presentation.text).toContain('#42');
    expect(presentation.text).toContain('check');
    expect(presentation.tooltip).toContain('#42');
    expect(presentation.tooltip).not.toContain('Draft');
    expect(presentation.command).toBe('forgejo.statusBar.action');
  });

  it('shows a failing CI icon when CI is red', () => {
    const presentation = mapBranchStatusToPresentation({
      kind: 'has-pr',
      branchName: 'feature-branch',
      pr: makePr({ number: 7 }),
      ciStatuses: [] as CommitStatus[],
      ciStatus: 'failure'
    });

    expect(presentation.text).toContain('error');
    expect(presentation.tooltip).toContain('CI failing');
  });

  it('shows a running/pending CI icon', () => {
    const presentation = mapBranchStatusToPresentation({
      kind: 'has-pr',
      branchName: 'feature-branch',
      pr: makePr({ number: 7 }),
      ciStatuses: [] as CommitStatus[],
      ciStatus: 'pending'
    });

    expect(presentation.text).toContain('sync~spin');
    expect(presentation.tooltip).toContain('CI running');
  });

  it('marks draft pull requests in the tooltip', () => {
    const presentation = mapBranchStatusToPresentation({
      kind: 'has-pr',
      branchName: 'feature-branch',
      pr: makePr({ number: 9, draft: true }),
      ciStatuses: [] as CommitStatus[],
      ciStatus: 'unknown'
    });

    expect(presentation.tooltip).toContain('Draft');
    expect(presentation.tooltip).toContain('CI status unknown');
  });
});
