import type { CommitStatus } from '../models/pullRequest';

/**
 * Deduplicate commit statuses by context, keeping only the latest entry per context.
 * The Forgejo /statuses/ API returns all historical status updates for a SHA,
 * so each CI job can appear multiple times as it transitions through states.
 * Each status update creates a new record with a new `created_at` timestamp,
 * so we compare by `created_at` to find the most recent per context.
 */
export function deduplicateCommitStatuses(statuses: CommitStatus[]): CommitStatus[] {
  const latestByContext = new Map<string, CommitStatus>();
  for (const status of statuses) {
    const key = status.context;
    const statusDate = new Date(status.created_at).getTime();
    if (isNaN(statusDate)) continue; // Skip entries with invalid dates
    const existing = latestByContext.get(key);
    const existingDate = existing ? new Date(existing.created_at).getTime() : -Infinity;
    if (statusDate > existingDate) {
      latestByContext.set(key, status);
    }
  }
  return Array.from(latestByContext.values());
}

export type AggregateCIStatus = 'success' | 'failure' | 'pending' | 'unknown';

/**
 * Combine a (deduplicated) list of commit statuses into a single overall
 * CI status: any failure/error wins, otherwise any pending wins, otherwise
 * success if every status succeeded, otherwise unknown (e.g. empty list, or
 * only warning statuses).
 */
export function aggregateCIStatus(statuses: CommitStatus[]): AggregateCIStatus {
  if (statuses.length === 0) {
    return 'unknown';
  }
  if (statuses.some(status => status.status === 'failure' || status.status === 'error')) {
    return 'failure';
  }
  if (statuses.some(status => status.status === 'pending')) {
    return 'pending';
  }
  if (statuses.every(status => status.status === 'success')) {
    return 'success';
  }
  return 'unknown';
}

/**
 * Pick a single commit status to drill into when the user asks to "open CI
 * details": prefer the first failing/erroring status (the one most likely to
 * need attention), otherwise fall back to the first status in the list.
 * Returns `undefined` for an empty list.
 */
export function selectRepresentativeCommitStatus(statuses: CommitStatus[]): CommitStatus | undefined {
  return statuses.find(status => status.status === 'failure' || status.status === 'error') ?? statuses[0];
}
