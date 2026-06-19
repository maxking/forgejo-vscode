# Agent Instructions

## Keep These Instructions Current

ALWAYS edit `AGENTS.md` in the same change/PR when a code review, bug, or pattern reveals a recurring repo-specific coding issue or best practice. Keep additions focused on durable, codebase-specific patterns rather than general or evolving AI capability guidance.

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
- When extending custom URI schemes, make optional path segments self-identifying or versioned; do not infer new URI formats from segment count when legacy file paths can contain arbitrary nested segments.
- Skip VS Code Git extension repository discovery when there are no workspace folders so no-config command/provider paths do not wait on repository discovery timeouts.
- When auto-detecting from a Git remote, never fall back to a configured default instance if the detected remote host does not match; use an HTTP(S) remote host unauthenticated or return no config for unmatched SSH remotes.
- Every change should add a README News entry under the current version and link to the public Codeberg issue or PR when one exists; user-facing releases should also bump `package.json`/`package-lock.json` together.
- Avoid unbounded pull request and issue fetches in tree providers; page Open/Draft/Merged/Closed PR groups and issue groups behind initial render, expansion, or explicit load-more actions.
- Deduplicate paged tree-provider API results before rendering stable `TreeItem.id` values; overlapping pages from large repositories must not register duplicate visible items.
- For authenticated review-requested PR queries, use `/repos/issues/search` with `review_requested=true` and filter results back to the selected repository before hydrating PR details; repository issue listing supports `created_by`/`assigned_by`/`mentioned_by` but not `review_requested_by`.
- For tree-view pagination changes, add VS Code Playwright coverage that opens the contributed view, interacts with visible tree rows, and uses mocked API pages so the UI behavior is deterministic.
- Forgejo timeline API rows use `type` for the action name, while detail webviews use `type` as a local activity discriminator; normalize the API action into `event` before assigning local activity types, and filter timeline comments when comments are fetched separately.
- Detail webviews should receive normalized activity view models rather than raw API rows; flatten nested Forgejo commit fields such as `commit.message`, `commit.author.date`, and `author.login` before rendering.

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

Why worktrees?

Keep master/main clean and stable
Parallel work on multiple features
Easy context switching without stashing
Isolated environments per feature
After creating worktree:

Switch to the worktree directory
Begin coding in the worktree
