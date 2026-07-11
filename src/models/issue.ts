// Re-export all types from forgejo-ts for backward compatibility
export type {
  Issue,
  IssueListItem,
  IssueComment,
  TimelineEvent,
} from 'forgejo-ts';

import type { Issue } from 'forgejo-ts';

/**
 * `forgejo-ts`'s `Issue` type omits `milestone`, even though the Forgejo
 * API always includes it (`null` when unset). Detail views that need to
 * read/render the current milestone use this narrow local extension
 * instead of widening the vendored type.
 */
export interface IssueWithMilestone extends Issue {
  milestone?: { id: number; title: string } | null;
}
