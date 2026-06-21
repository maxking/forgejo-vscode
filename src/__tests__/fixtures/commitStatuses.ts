import { CommitStatus } from '../../models/pullRequest';

/**
 * Mock data for commit statuses used in tests
 */

export const mockStatusSuccess: CommitStatus = {
  id: 1,
  status: 'success',
  context: 'ci/build',
  description: 'Build passed',
  target_url: 'https://ci.example.com/builds/123',
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-01-15T10:05:00Z'
};

export const mockStatusPending: CommitStatus = {
  id: 2,
  status: 'pending',
  context: 'ci/test',
  description: 'Running tests...',
  target_url: 'https://ci.example.com/builds/124',
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-01-15T10:00:00Z'
};

export const mockStatusFailure: CommitStatus = {
  id: 3,
  status: 'failure',
  context: 'ci/lint',
  description: 'Linting failed',
  target_url: 'https://ci.example.com/builds/125',
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-01-15T10:02:00Z'
};

export const mockStatusError: CommitStatus = {
  id: 4,
  status: 'error',
  context: 'ci/deploy',
  description: 'Deployment error',
  target_url: 'https://ci.example.com/builds/126',
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-01-15T10:03:00Z'
};

export const mockStatusWarning: CommitStatus = {
  id: 5,
  status: 'warning',
  context: 'security/scan',
  description: 'Security warnings found',
  target_url: 'https://security.example.com/scans/127',
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-01-15T10:04:00Z'
};

export const mockAllStatuses: CommitStatus[] = [
  mockStatusSuccess,
  mockStatusPending,
  mockStatusFailure,
  mockStatusError,
  mockStatusWarning
];

export const mockAllSuccessStatuses: CommitStatus[] = [
  mockStatusSuccess,
  { ...mockStatusSuccess, id: 6, context: 'ci/integration' }
];

export const mockMixedStatuses: CommitStatus[] = [
  mockStatusSuccess,
  mockStatusPending,
  mockStatusFailure
];

export const mockEmptyStatuses: CommitStatus[] = [];

/**
 * Mock data simulating the Forgejo /statuses/ API response for PR #98.
 * The API returns ALL historical status updates (pending → final) for each CI job,
 * causing duplicates. There are 6 unique CI jobs but 12 status entries total.
 */
export const mockDuplicateStatuses: CommitStatus[] = [
  // Final statuses (newer, should be kept after deduplication)
  { id: 12, status: 'success', context: 'Test / live-test (12) (pull_request)',                   description: 'Successful in 8m16s',  target_url: '/maxking/forgejo-vscode/actions/runs/358/jobs/1', created_at: '2026-02-22T06:33:21Z', updated_at: '2026-02-22T06:33:21Z' },
  { id: 11, status: 'success', context: 'Test / test (18) (pull_request)',                        description: 'Successful in 3m20s',  target_url: '/maxking/forgejo-vscode/actions/runs/359/jobs/0', created_at: '2026-02-22T06:32:59Z', updated_at: '2026-02-22T06:32:59Z' },
  { id: 10, status: 'success', context: 'Test / live-test (13) (pull_request)',                   description: 'Successful in 7m36s',  target_url: '/maxking/forgejo-vscode/actions/runs/358/jobs/2', created_at: '2026-02-22T06:32:57Z', updated_at: '2026-02-22T06:32:57Z' },
  { id:  9, status: 'success', context: 'Test / test (20) (pull_request)',                        description: 'Successful in 3m6s',   target_url: '/maxking/forgejo-vscode/actions/runs/359/jobs/1', created_at: '2026-02-22T06:32:52Z', updated_at: '2026-02-22T06:32:52Z' },
  { id:  8, status: 'success', context: 'Test / live-test (11) (pull_request)',                   description: 'Successful in 8m11s',  target_url: '/maxking/forgejo-vscode/actions/runs/358/jobs/0', created_at: '2026-02-22T06:32:02Z', updated_at: '2026-02-22T06:32:02Z' },
  { id:  7, status: 'failure', context: 'Test / smoke-test-vsix (pull_request)',                  description: 'Failing after 0s',     target_url: '/maxking/forgejo-vscode/actions/runs/359/jobs/2', created_at: '2026-02-22T06:30:57Z', updated_at: '2026-02-22T06:30:57Z' },
  // Initial pending statuses (older, should be removed after deduplication)
  { id:  6, status: 'pending', context: 'Test / smoke-test-vsix (pull_request)',                  description: 'Waiting to run',        target_url: '/maxking/forgejo-vscode/actions/runs/359/jobs/2', created_at: '2026-02-22T06:23:48Z', updated_at: '2026-02-22T06:23:48Z' },
  { id:  5, status: 'pending', context: 'Test / test (20) (pull_request)',                        description: 'Waiting to run',        target_url: '/maxking/forgejo-vscode/actions/runs/359/jobs/1', created_at: '2026-02-22T06:23:48Z', updated_at: '2026-02-22T06:23:48Z' },
  { id:  4, status: 'pending', context: 'Test / test (18) (pull_request)',                        description: 'Waiting to run',        target_url: '/maxking/forgejo-vscode/actions/runs/359/jobs/0', created_at: '2026-02-22T06:23:48Z', updated_at: '2026-02-22T06:23:48Z' },
  { id:  3, status: 'pending', context: 'Test / live-test (13) (pull_request)',                   description: 'Waiting to run',        target_url: '/maxking/forgejo-vscode/actions/runs/358/jobs/2', created_at: '2026-02-22T06:23:48Z', updated_at: '2026-02-22T06:23:48Z' },
  { id:  2, status: 'pending', context: 'Test / live-test (12) (pull_request)',                   description: 'Waiting to run',        target_url: '/maxking/forgejo-vscode/actions/runs/358/jobs/1', created_at: '2026-02-22T06:23:48Z', updated_at: '2026-02-22T06:23:48Z' },
  { id:  1, status: 'pending', context: 'Test / live-test (11) (pull_request)',                   description: 'Waiting to run',        target_url: '/maxking/forgejo-vscode/actions/runs/358/jobs/0', created_at: '2026-02-22T06:23:48Z', updated_at: '2026-02-22T06:23:48Z' },
];

/** The 6 unique CI job contexts from PR #98 */
export const expectedDeduplicatedContexts = [
  'Test / live-test (11) (pull_request)',
  'Test / live-test (12) (pull_request)',
  'Test / live-test (13) (pull_request)',
  'Test / test (18) (pull_request)',
  'Test / test (20) (pull_request)',
  'Test / smoke-test-vsix (pull_request)',
];
