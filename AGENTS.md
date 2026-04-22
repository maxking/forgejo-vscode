# Agent Instructions

## Landing the Plane (Session Completion)

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
> "Would you like me to create a new worktree for this work? If yes, what branch name should I use?"

**Worktree Location:** `.worktrees/<branch-name>/`

**Command sequence:**
```bash
# Ask user for branch name based on feature
# Example: user says "feature-auth-fix"
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

