# Agent Instructions

## Keep These Instructions Current

ALWAYS edit `AGENTS.md` in the same change/PR when a code review, bug, or pattern reveals a recurring repo-specific coding issue or best practice. Keep additions focused on durable, codebase-specific patterns rather than general or evolving AI capability guidance.

## Remote Repository Workflow

Use the `fj` CLI for interacting with Forgejo remotes instead of GitHub-style tooling. This project has two Forgejo repositories:

- Public/open-source repository: Codeberg (`codeberg.org`)
- Self-hosted repository: `git.araj.me`

Before running repo, issue, or pull request commands, identify the target remote/host from the current branch and task context. Prefer `fj` commands with an explicit remote or host so actions land on the intended repository:

- Inspect repository metadata with `fj repo view -R <remote>` or `fj -H <host> repo view <owner/repo>`.
- Search, view, and browse issues with `fj issue search -R <remote>`, `fj issue view -R <remote> <number>`, and `fj issue browse -R <remote> <number>`.
- Create and inspect pull requests with `fj pr create`, `fj pr view`, `fj pr status`, and `fj pr browse`; pass `-R <remote>` when operating from a local checkout and `--repo <owner/repo>` when creating a PR for a specific repository.
- Use `git.araj.me` for pull request creation, inspection, and follow-up by default. Do not open pull requests on Codeberg unless the user explicitly asks for a public Codeberg PR.
- Use Codeberg only for public repository or issue references when a task explicitly mentions the open-source/public project.

Always open regular pull requests by default. Do not create draft PRs unless the user explicitly asks for a draft; with `fj pr create`, avoid a `WIP: ` title prefix unless a draft PR is requested.

## Repo-Specific Coding Guidance

- Prefer `ForgejoClient`/`forgejo-ts` methods, especially `rawRequest()`, over ad-hoc `fetch` calls so timeout, logging, auth headers, and proxy behavior stay consistent.
- Do not perform speculative network requests during extension activation or provider construction; defer network work until the user invokes the feature.
- When passing remote URLs to the Git extension, filter out missing or empty URL strings using explicit TypeScript type guards (e.g., `(url): url is string => typeof url === 'string' && url.length > 0`) to satisfy strict typing.
- VS Code authentication providers must have both manifest contribution and runtime registration, and provider disposables should be pushed to `context.subscriptions`.
- Authentication sessions should respect requested scopes when VS Code calls `getSessions(scopes)` or `createSession(scopes)`.
- Configuration-change listeners can race with explicit create/remove flows; avoid double-firing auth/session events after awaited config updates by checking the in-memory cache (e.g. `_knownSessions`) before emitting.
- Add focused unit tests for provider/session lifecycle behavior and race fixes.
- Git remote source providers should set `icon` to the contributed Forgejo icon id (`forgejo-logo`) so VS Code/Cursor clone pickers show the branded provider icon.
- Prefer VS Code Git extension repository detection (`git.repositories`/`getRepository(uri)`) before shelling out from `workspaceFolders[0]`, so nested repositories detected by VS Code are respected.
- Guard optional VS Code API namespaces (for example `vscode.extensions`) in runtime code because Jest's lightweight VS Code mock may omit them.
- When grouping detected Git repositories for Forgejo views, deduplicate by normalized Forgejo remote identity (`instanceUrl/owner/repo`) so multiple local worktrees of the same repository do not appear as duplicate repo groups.
- Multi-repository Forgejo views should activate the VS Code Git extension before reading `git.repositories`; otherwise they may show no configuration before the Git extension has activated.
- Tree items and webview commands that originate from a repository group must carry enough repository identity (especially `instanceUrl`) into follow-up API calls; do not re-resolve with the active editor/default config for nested or multi-instance workflows.
- Tree items with commands or async-loaded children should set stable `TreeItem.id` values that include repository identity, and providers should not fire tree refresh events from inside `getChildren()`.
- If the same Forgejo item can appear under multiple tree groups, include the group/query identity in that item and child `TreeItem.id`; VS Code requires IDs to be unique across the whole tree, not only among siblings.
- When extending custom URI schemes, make optional path segments self-identifying or versioned; do not infer new URI formats from segment count when legacy file paths can contain arbitrary nested segments.
- Skip VS Code Git extension repository discovery when there are no workspace folders so no-config command/provider paths do not wait on repository discovery timeouts.
- When auto-detecting from a Git remote, never fall back to a configured default instance if the detected remote host does not match; use an HTTP(S) remote host unauthenticated or return no config for unmatched SSH remotes.
- When adding fields to `ForgejoInstance` or `forgejo.instances`, update the package schema, onboarding/manage-instance UX, README configuration docs, and focused tests together.
- Every change should add a README News entry under the current version and link to the public Codeberg issue or PR when one exists; user-facing releases should also bump `package.json`/`package-lock.json` together.
- Avoid unbounded pull request and issue fetches in tree providers; page Open/Draft/Merged/Closed PR groups and issue groups behind initial render, expansion, or explicit load-more actions.
- Deduplicate paged tree-provider API results before rendering stable `TreeItem.id` values; overlapping pages from large repositories must not register duplicate visible items.
- For authenticated review-requested PR queries, use `/repos/issues/search` with `review_requested=true` and filter results back to the selected repository before hydrating PR details; repository issue listing supports `created_by`/`assigned_by`/`mentioned_by` but not `review_requested_by`.
- For tree-view pagination changes, add VS Code Playwright coverage that opens the contributed view, interacts with visible tree rows, and uses mocked API pages so the UI behavior is deterministic.
- Forgejo timeline API rows use `type` for the action name, while detail webviews use `type` as a local activity discriminator; normalize the API action into `event` before assigning local activity types, and filter timeline comments when comments are fetched separately.
- Detail webviews should receive normalized activity view models rather than raw API rows; flatten nested Forgejo commit fields such as `commit.message`, `commit.author.date`, and `author.login` before rendering.
- Workflow file diagnostics must stay local and bounded; do not add network validation for `.forgejo/workflows`, `.gitea/workflows`, or `.github/workflows` during activation or document validation.

## Architecture & Code Patterns

### Activation

- The extension's `activationEvents` is `onStartupFinished`. Do not change it to a view-based activation event; doing so has caused circular-dependency regressions in the past.

### API client

- `src/api/forgejoClient.ts` is a thin backward-compatible wrapper around the [`forgejo-ts`](https://codeberg.org/maxking/forgejo-ts) client library. Prefer extending or composing that wrapper rather than introducing new raw `fetch` paths.
- All authenticated requests use the header `Authorization: token <TOKEN>`. Tokens are stored via `src/utils/secretStorage.ts` (VS Code `SecretStorage`), not in plain settings.
- Required token scopes: `read:repository` (PRs, files, refs) and `read:issues` (issues, comments).

### Forgejo API quirks

- `GET /api/v1/repos/{owner}/{repo}/issues` returns **both** issues and pull requests. Always filter out items that have a non-null `pull_request` field before rendering in the Issues tree.
- Base URL format: `{instanceUrl}/api/v1/repos/{owner}/{repo}/...`. `forgejoClient` always normalizes remotes to HTTPS before issuing requests.
- For review-requested PR queries, the repository-scoped issue listing endpoint does **not** support `review_requested_by`. Use `/repos/issues/search` with `review_requested=true` and filter the results back to the selected repository before hydrating PR details.

### Git remote detection (`src/utils/gitUtils.ts`)

Supported URL formats:

- HTTPS: `https://git.example.com/owner/repo.git`
- SSH scp-style: `git@git.example.com:owner/repo.git`
- SSH protocol: `ssh://git@git.example.com/owner/repo.git`

Parsing extracts the instance URL, owner, and repo name and converts to HTTPS for API calls.

### Console logging

Always prefix logs with `[Forgejo]` so they can be filtered in the Developer Tools console:

```typescript
console.log('[Forgejo] Fetching pull requests...');
console.error('[Forgejo] Error:', error);
```

Use the shared logger adapter (`src/utils/forgejoLoggerAdapter.ts`) when the call site already has a `ForgejoClient` available.

### Tree providers

- Implement `vscode.TreeDataProvider<T>`. Use an internal `EventEmitter` for `onDidChangeTreeData` and expose a `refresh()` method that fires it.
- Return a `MessageItem` (error or info) from `getChildren()` when the provider has an error or no data, instead of returning an empty array. This keeps the tree view informative.
- Group items by state (Open/Closed/Draft/Merged) at the top level.
- Never fire tree refresh events from inside `getChildren()`. Trigger refreshes only from explicit user actions or configuration-change listeners.

### VS Code extension conventions

- Command IDs must match the IDs declared in `package.json` `contributes.commands`. Register them in `activate()` and push the resulting `vscode.Disposable` to `context.subscriptions`.
- View IDs must match `package.json` `contributes.views`. Register providers with `vscode.window.createTreeView()` and add the returned view to `context.subscriptions`.
- Settings belong in `package.json` under `contributes.configuration`. Read them via `vscode.workspace.getConfiguration('forgejo')` and write with `config.update(key, value, ConfigurationTarget.Global)`.

### Testing strategy

The project uses a multi-track testing strategy. Pick the right track for the change:

- **Jest unit tests** (`npm run test:unit`, `npm run test:unit:watch`, `npm run test:unit:coverage`): fast tests of pure logic with no VS Code API. Lives in `src/__tests__/`.
- **Mocha + `@vscode/test-cli` integration tests** (`npm run test:integration`): tests that need a real Extension Host (tree providers, command registration, activation). Lives in `src/test/suite/`.
- **Playwright E2E tests** (`npm run test:e2e`, `npm run test:e2e:vscode`): UI-level tests against a launched VS Code instance. Use `npm run test:e2e:live` against a real Forgejo when needed.
- **Live API tests** (`npm run test:live`): require a running Forgejo instance (see `docker-compose.e2e.yml`).

Pre-commit gate: `npm run lint && npm run test:unit && npm run compile`.
Pre-push gate: `npm run test:ci` (lint + unit coverage + integration).

CI runs on the Forgejo workflows at `.forgejo/workflows/test.yml` against Node 18 and Node 20.

## Landing the Plane (Session Completion)

Before pushing, ask the user for confirmation unless they have explicitly requested a push/merge in the current task.

Before merging any PR, ask the user for confirmation even if the PR appears ready.

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File follow-up notes** - Document anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   git push
   git status  # MUST show "up to date with origin"
   ```
4. **Clean up** - Clear stashes, prune remote branches
5. **Verify** - All changes committed AND pushed
6. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
- Do not amend commits or force-push ongoing PR branches; add follow-up commits and push normally so reviewers can track incremental changes.

## Building and Installing Extension

**ALWAYS build the extension after making changes** to verify it compiles correctly.

**Build command:**
```bash
npm run compile
```

**Package for distribution:**
```bash
vsce package --allow-missing-repository
```

**After building, ALWAYS ask the user:**
> "Would you like me to install the extension in VS Code?"

**Install command (run only if user says yes):**
```bash
code --install-extension forgejo-vscode-0.1.0.vsix --force
```

**Why?**
- Building catches TypeScript errors before committing
- Installing allows immediate testing of changes
- The `--force` flag ensures the extension is updated even if same version


## Starting Work (Always Create Worktree)

**Before writing any code**, ask the user:
> "Would you like me to create a new worktree for this work?"

If the user says yes but does not provide a branch name, choose a concise, relevant branch name yourself instead of asking a follow-up question.

**Worktree Location:** `.worktrees/<branch-name>/`

**Command sequence:**
```bash
# Use a concise branch name based on the work if the user does not provide one.
# Example branch: feature-auth-fix
mkdir -p .worktrees
git worktree add .worktrees/feature-auth-fix -b feature-auth-fix
cd .worktrees/feature-auth-fix
```

