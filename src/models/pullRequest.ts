// Re-export all types from forgejo-ts for backward compatibility
import type { PullRequestListItem as ForgejoPullRequestListItem, PullRequest as ForgejoPullRequest } from 'forgejo-ts';

export type {
  PullRequest,
  PullRequestListItem,
  PullRequestFile,
  FileContentsResponse,
  CommitStatus,
  PullRequestReview,
  PullRequestCommit,
} from 'forgejo-ts';

export interface PullRequestListItemWithMergeability extends ForgejoPullRequestListItem {
  mergeable?: boolean | null;
}

/**
 * `forgejo-ts`'s `PullRequest` type omits `milestone` and `assignees`,
 * even though the Forgejo API always includes both. Detail views that
 * need to read/render current metadata use this narrow local extension
 * instead of widening the vendored type.
 */
export interface PullRequestWithMetadata extends ForgejoPullRequest {
  milestone?: { id: number; title: string } | null;
  assignees?: { login: string }[] | null;
}

interface MergeabilitySource {
  state?: string;
  draft?: boolean;
  merged?: boolean;
  mergeable?: boolean | null;
}

export interface PullRequestMergeability {
  state: 'mergeable' | 'conflicting' | 'unknown' | 'notApplicable';
  label: string;
  description: string;
}

export function getPullRequestMergeability(pr: MergeabilitySource): PullRequestMergeability {
  const isMerged = pr.merged === true;
  const isDraft = pr.draft === true;
  if (isMerged || pr.state === 'closed' || isDraft) {
    return {
      state: 'notApplicable',
      label: 'Not applicable',
      description: isMerged
        ? 'Already merged'
        : isDraft
        ? 'Draft pull requests cannot be merged yet'
        : 'Closed pull requests cannot be merged'
    };
  }

  if (pr.mergeable === true) {
    return {
      state: 'mergeable',
      label: 'Ready to merge',
      description: 'Forgejo reports this pull request can be merged cleanly'
    };
  }

  if (pr.mergeable === false) {
    return {
      state: 'conflicting',
      label: 'Merge conflicts',
      description: 'Forgejo reports this pull request cannot be merged cleanly'
    };
  }

  return {
    state: 'unknown',
    label: 'Mergeability unknown',
    description: 'Forgejo has not reported whether this pull request can be merged'
  };
}
