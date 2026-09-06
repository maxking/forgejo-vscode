# Maintainer's Guide

This document contains workflows and commands for maintainers of the Forgejo VS Code Extension.

## Release Workflow

The extension uses automated publishing via GitHub Actions. When you push a version tag to the `github` remote, the workflow automatically:
1. Runs the full test suite (lint + unit + integration tests)
2. Verifies the tag matches `package.json` version
3. Packages the extension
4. Publishes to VS Code Marketplace
5. Publishes to Open VSX and creates a GitHub release with the `.vsix` artifact

### Publishing a Stable Release

```bash
# 1. Update version in package.json (creates a commit and tag)
npm version patch  # or minor, or major

# 2. Push the commit and tag to the canonical and GitHub remotes
git push origin master --follow-tags
git push github master --follow-tags

# The CI workflow will automatically:
# - Run tests
# - Publish to VS Code Marketplace as stable release
# - Create a GitHub release
```

### Publishing a Pre-release Version

Pre-release versions (alpha, beta, rc) are automatically detected and published with the `--pre-release` flag.

#### Alpha Release

```bash
# 1. Update version with alpha identifier
npm version 0.3.0-alpha.1 --no-git-tag-version

# 2. Commit and tag
git add package.json
git commit -m "chore: Prepare alpha release 0.3.0-alpha.1"
git tag v0.3.0-alpha.1

# 3. Push to the canonical and GitHub remotes
git push origin master --follow-tags
git push github master --follow-tags

# Result: Published as pre-release, users must opt-in
```

#### Beta Release

```bash
# 1. Update version with beta identifier
npm version 0.3.0-beta.1 --no-git-tag-version

# 2. Commit and tag
git add package.json
git commit -m "chore: Prepare beta release 0.3.0-beta.1"
git tag v0.3.0-beta.1

# 3. Push to the canonical and GitHub remotes
git push origin master --follow-tags
git push github master --follow-tags

# Result: Published as pre-release, users must opt-in
```

#### Release Candidate

```bash
# 1. Update version with rc identifier
npm version 0.3.0-rc.1 --no-git-tag-version

# 2. Commit and tag
git add package.json
git commit -m "chore: Prepare release candidate 0.3.0-rc.1"
git tag v0.3.0-rc.1

# 3. Push to the canonical and GitHub remotes
git push origin master --follow-tags
git push github master --follow-tags

# Result: Published as pre-release, users must opt-in
```

### Supported Version Formats

The workflow treats any semantic version containing a hyphenated pre-release
identifier as a pre-release (for example, `-alpha.1`, `-beta1`, or `-rc.2`).

| Version Format | Type | Published As |
|----------------|------|--------------|
| `v0.3.0` or `0.3.0` | Stable | Stable release |
| `v0.3.0-alpha.1` | Pre-release | Pre-release (--pre-release flag) |
| `v0.3.0-alpha1` | Pre-release | Pre-release |
| `v0.3.0-beta.1` | Pre-release | Pre-release |
| `v0.3.0-beta1` | Pre-release | Pre-release |
| `v0.3.0-rc.1` | Pre-release | Pre-release |

### Example Development Cycle

```bash
# Start development
v0.3.0-alpha.1  → Early testing phase
v0.3.0-alpha.2  → Bug fixes from alpha testing

# Feature complete, enter beta
v0.3.0-beta.1   → Feature complete, broader testing
v0.3.0-beta.2   → Beta bug fixes

# Release candidate
v0.3.0-rc.1     → Final testing before stable

# Stable release
v0.3.0          → Production release
```

## Manual Release (Without CI)

If you need to publish manually (e.g., CI is down):

```bash
# 1. Ensure tests pass
npm run lint
npm test

# 2. Build the extension
npm run compile

# 3. Package the extension
npm run package

# 4. Publish to marketplace
# For stable release:
npx vsce publish -p YOUR_VSCE_PAT

# For pre-release:
npx vsce publish --pre-release -p YOUR_VSCE_PAT

# 5. Create a GitHub release manually via the web UI
# Upload the generated .vsix file as an attachment
```

## Checking Release Status

### View Workflow Runs

```bash
# Via GitHub web UI:
# https://github.com/maxking/forgejo-vscode/actions
```

### View Published Versions

- **VS Code Marketplace**: https://marketplace.visualstudio.com/items?itemName=maxking.forgejo-vscode
- **GitHub Releases**: https://github.com/maxking/forgejo-vscode/releases

### Check if Pre-release is Available

Users can opt-in to pre-release versions in VS Code:
1. Extensions panel → Find "Forgejo Integration"
2. Click gear icon → "Switch to Pre-Release Version"

## Troubleshooting

### Publish Workflow Failed

```bash
# 1. Check the workflow logs
# Visit: https://github.com/maxking/forgejo-vscode/actions

# 2. Common failures:

# Tests failed:
# - Fix the failing tests
# - Push the fix to master
# - Create a new tag (increment patch version)

# Version mismatch:
# - Ensure package.json version matches the tag
# - Delete the tag locally and from both remotes before recreating it
# - Fix package.json version
# - Recreate the tag

# VSCE_PAT expired:
# - Generate new token at: https://marketplace.visualstudio.com/manage
# - Update the GitHub Actions secret: Settings → Secrets and variables → Actions
```

### VS Code Marketplace Authentication

The workflow uses the `VSCE_PAT` secret configured in GitHub Actions.

**To regenerate the token:**

1. Visit https://marketplace.visualstudio.com/manage/publishers/maxking
2. Go to "Personal Access Tokens"
3. Create a new token with "Marketplace (Manage)" scope
4. Update in GitHub:
   - Go to repository Settings → Secrets and variables → Actions
   - Update `VSCE_PAT` with the new token

### Rollback a Release

If you need to unpublish a broken release:

```bash
# 1. Unpublish from VS Code Marketplace
npx vsce unpublish maxking.forgejo-vscode@0.3.0

# 2. Delete the tag
git tag -d v0.3.0
git push --delete origin v0.3.0
git push --delete github v0.3.0

# 3. Delete the GitHub release via web UI
# https://github.com/maxking/forgejo-vscode/releases

# 4. Fix the issue and publish a new version
```

### Testing Before Release

```bash
# Run full test suite
npm run lint
npm run test:unit:coverage
npm run test:integration

# Test the packaged extension locally
npm run package
code --install-extension forgejo-vscode-0.3.0.vsix

# Test in Extension Development Host
# Press F5 in VS Code
```

## Version Numbering Guidelines

Follow [Semantic Versioning](https://semver.org/):

- **Major (1.0.0)**: Breaking changes, incompatible API changes
- **Minor (0.1.0)**: New features, backward-compatible
- **Patch (0.0.1)**: Bug fixes, backward-compatible

### When to Use Pre-releases

- **Alpha (`-alpha.x`)**: Early development, unstable, breaking changes expected
- **Beta (`-beta.x`)**: Feature complete, testing phase, minor changes possible
- **RC (`-rc.x`)**: Release candidate, final testing, only critical fixes

## CI/CD Configuration

The publish workflow is defined in `.github/workflows/publish.yml` and reuses `.github/workflows/test.yml` as its release gate.

### Required Secrets

| Secret | Description | Where to Get |
|--------|-------------|--------------|
| `VSCE_PAT` | VS Code Marketplace Personal Access Token | https://marketplace.visualstudio.com/manage |
| `OPEN_VSX_PAT` | Open VSX publishing token | https://open-vsx.org/user-settings/tokens |
| `GITHUB_TOKEN` | GitHub release token (auto-provided) | N/A (automatic) |

### Workflow Triggers

The workflow runs on any tag matching:
- `v*.*.*` (e.g., `v0.3.0`, `v1.0.0-beta.1`)
- `*.*.*` (e.g., `0.3.0`, `1.0.0-rc.1`)

### Workflow Steps

1. ✅ Checkout code
2. ✅ Install dependencies
3. ✅ Run linting
4. ✅ Run unit tests with coverage
5. ✅ Run integration tests
6. ✅ Detect if pre-release version
7. ✅ Package extension
8. ✅ Verify version matches tag
9. ✅ Publish to VS Code Marketplace
10. ✅ Upload VSIX artifact
11. ✅ Create GitHub release

## Maintenance Checklist

### Before Each Release

- [ ] All tests passing locally
- [ ] CHANGELOG.md updated (if exists)
- [ ] Version bumped in package.json
- [ ] No uncommitted changes
- [ ] Branch is up to date with remote

### After Each Release

- [ ] Verify extension published to marketplace
- [ ] Check GitHub release created
- [ ] Test installation from marketplace
- [ ] Monitor for user reports/issues

### Regular Maintenance

- [ ] Update dependencies monthly: `npm outdated && npm update`
- [ ] Check for VS Code API updates
- [ ] Review and close stale issues
- [ ] Update documentation as needed
- [ ] Rotate VSCE_PAT token yearly (security best practice)

## Dependency Notes

### Playwright Version Pinning

Playwright is pinned to `~1.52.0` for compatibility with `@mshanemc/vscode-test-playwright@0.0.1-beta14`,
which depends on Playwright 1.52.x APIs. Do not upgrade Playwright without testing the e2e VS Code
tests (`npm run test:e2e:vscode`). This constraint can be relaxed once the upstream package publishes
a stable release with broader Playwright version support.

### @mshanemc/vscode-test-playwright Patch

The `@mshanemc/vscode-test-playwright` package has a bug in its `exports` map — it is missing the
`./dist/injected/index.js` subpath entry. We use `patch-package` (via the `postinstall` script)
to add this entry automatically. The patch file is at `patches/@mshanemc+vscode-test-playwright+0.0.1-beta14.patch`.

## Support

For questions or issues with the release process:
- Create an issue: https://codeberg.org/maxking/forgejo-vscode/issues
- Check workflow logs: https://github.com/maxking/forgejo-vscode/actions
- Review this guide: `MAINTAINERS.md`
