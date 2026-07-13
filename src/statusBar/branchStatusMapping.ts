import type { PullRequestListItem } from '../models/pullRequest';
import type { AggregateCIStatus } from '../utils/commitStatus';

/**
 * The subset of a Forgejo pull request list item this module needs beyond
 * `PullRequestListItem` (which forgejo-ts trims down for the list endpoint,
 * even though the API actually returns `head`/`base` on every item -- see
 * `prTreeProvider.ts` reading `pr.head.ref`/`pr.base.ref` the same way).
 */
export interface PullRequestListItemWithHead extends PullRequestListItem {
  head: { ref: string; sha: string; repo?: { full_name: string } | null };
  base: { ref: string };
}

/**
 * Find the open pull request whose head branch matches the given branch name
 * *and* whose head repository is the tracked repository itself (identified by
 * its `owner/repo` full name). The head-repo check is what keeps a fork PR
 * that happens to share the local branch name from being misattributed to the
 * current branch; a PR whose `head.repo` is missing (e.g. the fork was deleted)
 * can never be the tracked repo, so it is treated as a non-match.
 *
 * `prs` is expected to be a single bounded page of open pull requests (see
 * `branchStatusBarController.ts`); this performs no I/O and does not paginate.
 */
export function findPullRequestForBranch(
  prs: PullRequestListItemWithHead[],
  branchName: string,
  headRepoFullName: string
): PullRequestListItemWithHead | undefined {
  // Owner/repo names are case-insensitive in Forgejo, and the configured
  // owner/repo may not match the API's canonical casing.
  const wanted = headRepoFullName.toLowerCase();
  return prs.find(
    pr => pr.head.ref === branchName && pr.head.repo?.full_name?.toLowerCase() === wanted
  );
}

export type BranchStatusViewState =
  | { kind: 'no-repo' }
  | { kind: 'no-config' }
  | { kind: 'disabled' }
  | { kind: 'loading'; branchName: string }
  | { kind: 'error'; branchName: string; message: string }
  | { kind: 'no-pr'; branchName: string }
  | {
      kind: 'has-pr';
      branchName: string;
      pr: PullRequestListItemWithHead;
      ciStatuses: import('../models/pullRequest').CommitStatus[];
      ciStatus: AggregateCIStatus;
    };

export interface StatusBarPresentation {
  /** `undefined` means the status bar item should be hidden. */
  text?: string;
  tooltip?: string;
  /** Command ID to invoke on click; only meaningful when `text` is set. */
  command?: string;
}

const CI_ICON: Record<AggregateCIStatus, string> = {
  success: '$(check)',
  failure: '$(error)',
  pending: '$(sync~spin)',
  unknown: '$(question)'
};

const CI_LABEL: Record<AggregateCIStatus, string> = {
  success: 'CI passing',
  failure: 'CI failing',
  pending: 'CI running',
  unknown: 'CI status unknown'
};

const STATUS_BAR_ACTION_COMMAND = 'forgejo.statusBar.action';

/**
 * Pure mapping from a resolved branch status state to what the status bar
 * item should display. Returning `text: undefined` means the controller
 * should hide the item.
 */
export function mapBranchStatusToPresentation(state: BranchStatusViewState): StatusBarPresentation {
  switch (state.kind) {
    case 'no-repo':
    case 'no-config':
    case 'disabled':
      return {};

    case 'loading':
      return {
        text: `$(sync~spin) ${state.branchName}`,
        tooltip: `Forgejo: loading status for ${state.branchName}...`
      };

    case 'error':
      return {
        text: `$(warning) ${state.branchName}`,
        tooltip: `Forgejo: could not load branch status\n${state.message}`,
        command: STATUS_BAR_ACTION_COMMAND
      };

    case 'no-pr':
      return {
        text: `$(git-pull-request-create) ${state.branchName}`,
        tooltip: `Forgejo: no open pull request for ${state.branchName}. Click to create one.`,
        command: STATUS_BAR_ACTION_COMMAND
      };

    case 'has-pr': {
      const pr = state.pr;
      const draftPrefix = pr.draft ? 'Draft ' : '';
      const ciIcon = CI_ICON[state.ciStatus];
      const ciLabel = CI_LABEL[state.ciStatus];
      return {
        text: `$(git-pull-request) #${pr.number} ${ciIcon}`,
        tooltip: `Forgejo: ${draftPrefix}PR #${pr.number} "${pr.title}" (${state.branchName}) - ${ciLabel}`,
        command: STATUS_BAR_ACTION_COMMAND
      };
    }
  }
}
