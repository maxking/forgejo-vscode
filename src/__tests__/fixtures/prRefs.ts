/**
 * Mock data for pull request refs (base and head branches)
 */

export interface MockPRRefs {
  base: string;
  head: string;
}

/**
 * Standard PR refs for feature branch to main
 */
export const mockStandardRefs: MockPRRefs = {
  base: 'main',
  head: 'feature/new-feature'
};

/**
 * PR refs for bugfix branch
 */
export const mockBugfixRefs: MockPRRefs = {
  base: 'develop',
  head: 'bugfix/fix-issue-123'
};

/**
 * PR refs with special characters in branch names
 */
export const mockSpecialCharRefs: MockPRRefs = {
  base: 'main',
  head: 'feature/add-special-chars-#123'
};

/**
 * PR refs with slashes in branch names
 */
export const mockNestedRefs: MockPRRefs = {
  base: 'release/v1.0',
  head: 'hotfix/release/v1.0/critical-fix'
};

/**
 * PR refs for release branch
 */
export const mockReleaseRefs: MockPRRefs = {
  base: 'main',
  head: 'release/v2.0.0'
};

/**
 * Mock PR details with refs included
 */
export const mockPRWithRefs = {
  id: 1,
  number: 42,
  title: 'Add new feature',
  body: 'This PR adds a new feature with comprehensive tests.\n\n## Changes:\n- Added feature X\n- Updated documentation',
  state: 'open' as const,
  user: {
    login: 'testuser',
    avatar_url: 'https://git.example.com/avatars/testuser'
  },
  created_at: '2026-01-01T10:00:00Z',
  updated_at: '2026-01-02T15:30:00Z',
  html_url: 'https://git.example.com/owner/repo/pulls/42',
  head: {
    ref: mockStandardRefs.head,
    sha: 'abc123def456',
    repo: {
      full_name: 'owner/repo'
    }
  },
  // base.sha is the *live tip* of the base branch (moves as the base branch
  // advances) and must NOT be used for diff purposes. merge_base is the
  // frozen divergence commit and is the correct field to diff against.
  // Kept deliberately distinct from merge_base so tests that accidentally
  // read base.sha instead of merge_base fail loudly. See issue #182.
  base: {
    ref: mockStandardRefs.base,
    sha: 'basebranchtip789'
  },
  merge_base: 'mergebasecommit123',
  mergeable: true,
  merged: false,
  merge_commit_sha: null,
  draft: false,
  comments: 5,
  labels: [
    { name: 'enhancement', color: 'a2eeef' },
    { name: 'tests-passed', color: '0e8a16' }
  ]
};

/**
 * Mock PR details with bugfix refs
 */
export const mockPRWithBugfixRefs = {
  ...mockPRWithRefs,
  number: 43,
  title: 'Fix critical bug',
  head: {
    ref: mockBugfixRefs.head,
    repo: {
      full_name: 'owner/repo'
    }
  },
  base: {
    ref: mockBugfixRefs.base
  }
};

/**
 * Mock PR details with missing refs (for error testing)
 */
export const mockPRWithMissingRefs = {
  id: 2,
  number: 44,
  title: 'PR with missing refs',
  body: '',
  state: 'open' as const,
  user: {
    login: 'testuser',
    avatar_url: 'https://git.example.com/avatars/testuser'
  },
  created_at: '2026-01-01T10:00:00Z',
  updated_at: '2026-01-02T15:30:00Z',
  html_url: 'https://git.example.com/owner/repo/pulls/44',
  head: {
    ref: '',
    sha: '',
    repo: {
      full_name: 'owner/repo'
    }
  },
  base: {
    ref: ''
  },
  mergeable: true,
  merged: false,
  merge_commit_sha: null,
  draft: false,
  comments: 0,
  labels: []
};

/**
 * Array of all mock refs for iteration
 */
export const allMockRefs: MockPRRefs[] = [
  mockStandardRefs,
  mockBugfixRefs,
  mockSpecialCharRefs,
  mockNestedRefs,
  mockReleaseRefs
];
