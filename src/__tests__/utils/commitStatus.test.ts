import {
  aggregateCIStatus,
  deduplicateCommitStatuses,
  selectRepresentativeCommitStatus
} from '../../utils/commitStatus';
import { CommitStatus } from '../../models/pullRequest';

function makeStatus(overrides: Partial<CommitStatus> = {}): CommitStatus {
  return {
    id: 1,
    status: 'success',
    context: 'ci/test',
    description: '',
    target_url: '',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides
  };
}

describe('deduplicateCommitStatuses', () => {
  it('keeps only the latest status per context', () => {
    const older = makeStatus({ id: 1, context: 'ci/test', status: 'pending', created_at: '2026-01-01T00:00:00Z' });
    const newer = makeStatus({ id: 2, context: 'ci/test', status: 'success', created_at: '2026-01-01T01:00:00Z' });

    expect(deduplicateCommitStatuses([older, newer])).toEqual([newer]);
  });

  it('keeps separate entries for different contexts', () => {
    const a = makeStatus({ context: 'ci/a' });
    const b = makeStatus({ context: 'ci/b' });

    expect(deduplicateCommitStatuses([a, b])).toEqual(expect.arrayContaining([a, b]));
  });

  it('skips entries with an invalid created_at date', () => {
    const invalid = makeStatus({ created_at: 'not-a-date' });

    expect(deduplicateCommitStatuses([invalid])).toEqual([]);
  });
});

describe('aggregateCIStatus', () => {
  it('returns unknown for an empty list', () => {
    expect(aggregateCIStatus([])).toBe('unknown');
  });

  it('returns failure when any status failed, even if others succeeded', () => {
    const statuses = [makeStatus({ status: 'success' }), makeStatus({ status: 'failure', context: 'other' })];
    expect(aggregateCIStatus(statuses)).toBe('failure');
  });

  it('treats "error" the same as "failure"', () => {
    expect(aggregateCIStatus([makeStatus({ status: 'error' })])).toBe('failure');
  });

  it('returns pending when nothing failed but something is still running', () => {
    const statuses = [makeStatus({ status: 'success' }), makeStatus({ status: 'pending', context: 'other' })];
    expect(aggregateCIStatus(statuses)).toBe('pending');
  });

  it('returns success only when every status succeeded', () => {
    const statuses = [makeStatus({ status: 'success' }), makeStatus({ status: 'success', context: 'other' })];
    expect(aggregateCIStatus(statuses)).toBe('success');
  });

  it('returns unknown for a mix that is neither all-success nor failing/pending (e.g. only warnings)', () => {
    expect(aggregateCIStatus([makeStatus({ status: 'warning' })])).toBe('unknown');
  });
});

describe('selectRepresentativeCommitStatus', () => {
  it('returns undefined for an empty list', () => {
    expect(selectRepresentativeCommitStatus([])).toBeUndefined();
  });

  it('prefers the first failing status over a passing one', () => {
    const passing = makeStatus({ status: 'success', context: 'a' });
    const failing = makeStatus({ status: 'failure', context: 'b' });

    expect(selectRepresentativeCommitStatus([passing, failing])).toBe(failing);
  });

  it('falls back to the first status when nothing is failing', () => {
    const first = makeStatus({ status: 'success', context: 'a' });
    const second = makeStatus({ status: 'pending', context: 'b' });

    expect(selectRepresentativeCommitStatus([first, second])).toBe(first);
  });
});
