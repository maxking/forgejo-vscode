// Re-export shared types from forgejo-ts
export type {
  ReviewComment,
  PullReview,
  CreatePullReviewComment,
  CreatePullReviewOptions,
} from 'forgejo-ts';

// VS Code extension-specific type (not in forgejo-ts)
export interface PRContext {
  owner: string;
  repo: string;
  prNumber: number;
  baseRef: string;
  headRef: string;
  filePath: string;
  instanceUrl?: string;
}
