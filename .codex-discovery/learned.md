# Discovery Notes

## Durable repo lessons

- `AGENTS.md` already calls out stable `TreeItem.id` values for command-backed or async-loaded tree items. PR and issue trees had this covered; the Actions tree did not before the 2026-06-21 automation run.
- Actions tree rows are backed by `/actions/tasks` task rows grouped by `run_number`; job steps are lazy-loaded by scraping through `ForgejoClient.getJobSteps()`.
- `WorkflowRunListItem.id` is non-optional in the current types, so job tree item identity can use `job.id` directly rather than a fallback.
- Actions tree message rows need parent context too. Repository-level messages should include config identity; job-level messages should include the parent job ID, otherwise identical labels like `No workflow runs found` or `No steps found` can still collide.
- Remote repository browsing already uses a versioned `forgejo-remote:/v1/...` URI and base64url-encoded instance/ref fields, so future remote-file URI changes should remain versioned rather than segment-count inferred.

## Areas already checked

- PR and issue tree providers already include stable IDs and pagination/load-more safeguards.
- Remote repository and virtual remote file providers already carry instance URL, owner, repo, branch, and path identity.
- `getForgejoConfigFor(owner, repo, instanceUrl)` intentionally returns unauthenticated config for explicit public instance URLs when no configured token exists.

## Useful next targets

- Review Actions tree pagination and API limits; `getWorkflowRuns()` delegates to `forgejo-ts` without local pagination in this wrapper.
- Review `createPullRequestCommand` local Git shelling against nested repository guidance; it still uses child_process for branch/default-branch detection.
- Audit extension command handlers that accept legacy positional args for missing repository identity fallbacks.
