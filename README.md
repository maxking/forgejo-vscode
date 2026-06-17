# Forgejo VS Code Extension

> Browse Pull Requests, Issues, and Actions from Forgejo, Gitea, and Codeberg directly in VS Code.

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/maxking.forgejo-vscode?label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=maxking.forgejo-vscode)
[![Open VSX](https://img.shields.io/open-vsx/v/maxking/forgejo-vscode?label=Open%20VSX)](https://open-vsx.org/extension/maxking/forgejo-vscode)

<!-- TODO: Add screenshot here -->
<!-- ![Screenshot](docs/images/screenshot.png) -->

## Install

**[Install from VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=maxking.forgejo-vscode)** -- or search for "Forgejo Integration" in the Extensions panel (`Ctrl+Shift+X`).

**[Install from Open VSX](https://open-vsx.org/extension/maxking/forgejo-vscode)** -- for VSCodium and other compatible editors.

## Quick Start

1. **Open** a folder containing a Forgejo, Codeberg, or Gitea git repository
2. **Click** the Forgejo icon in the Activity Bar (sidebar)
3. **Done!** Your PRs and Issues appear automatically

For private repositories, [add a Personal Access Token](#setting-up-authentication).

## News

### 0.3.20

- **Pull request and issue search ([#135](https://codeberg.org/maxking/forgejo-vscode/issues/135)):** the Pull Requests and Issues views now search server-side through forgejo-ts 0.4.0 while preserving paged load-more behavior.
- **forgejo-ts pagination wrapper:** legacy Pull Request and Issue page helpers now delegate to forgejo-ts pagination metadata instead of rebuilding those requests locally.
- **Nested repository detection ([#22](https://codeberg.org/maxking/forgejo-vscode/issues/22)):** workspaces with nested Forgejo/Gitea repositories are now detected through VS Code's Git API and grouped by repository across Pull Requests, Issues, Actions, and Releases.
- **Safer instance matching ([#171](https://git.araj.me/maxking/forgejo-vscode/issues/171)):** repositories whose HTTP(S) git remote does not match any configured Forgejo instance now use the remote host unauthenticated instead of falling back to an unrelated default instance.
- **Paged PR and issue loading ([#20](https://codeberg.org/maxking/forgejo-vscode/issues/20)):** Pull request and issue trees now fetch the first page for each group, then load additional pages through explicit load-more actions so very large repositories remain responsive.
- **More reliable PR tree actions ([#20](https://codeberg.org/maxking/forgejo-vscode/issues/20)):** pull request tree rows now use stable identities so overview and file commands continue to work after refreshes and load-more updates.
- **Tree UI regression coverage ([#20](https://codeberg.org/maxking/forgejo-vscode/issues/20)):** VS Code Playwright tests now exercise the Pull Requests and Issues tree load-more rows with mocked API pages.
- **Agent workflow guidance:** repo instructions now ask agents to add follow-up commits instead of amending or force-pushing ongoing PR branches.

### 0.3.19

- **Forgejo clone picker icon:** the built-in Git clone source picker now shows the Forgejo logo next to configured Forgejo repository sources.
- **Publish to Forgejo ([#17](https://codeberg.org/maxking/forgejo-vscode/pulls/17)):** local repositories can now be published directly to a configured Forgejo instance from VS Code's built-in Source Control publish flow. Thanks to [@excubitor](https://codeberg.org/excubitor).

### 0.3.18

- **Forgejo authentication provider ([#16](https://codeberg.org/maxking/forgejo-vscode/pulls/16)):** configured Forgejo instances are now exposed through VS Code's Authentication API for better account/session integration. Thanks to [@excubitor](https://codeberg.org/excubitor).
- **Clone from Forgejo ([#18](https://codeberg.org/maxking/forgejo-vscode/pulls/18)):** Forgejo repositories now appear in VS Code's built-in Git clone flow via a remote source provider, with bounded repository lookups across configured instances. Thanks to [@excubitor](https://codeberg.org/excubitor).
- **Faster PR loading for large repositories ([#20](https://codeberg.org/maxking/forgejo-vscode/issues/20)):** the Pull Requests view now fetches open PRs first and lazy-loads merged/closed PRs only when those groups are expanded, avoiding long startup fetches on repositories with thousands of historical PRs.
- **Forgejo activity bar icon ([#15](https://codeberg.org/maxking/forgejo-vscode/pulls/15)):** the Activity Bar now uses the Forgejo logo instead of the generic pull request icon. Thanks to [@excubitor](https://codeberg.org/excubitor).

### 0.3.17

- **Safer git remote detection ([#130](https://codeberg.org/maxking/forgejo-vscode/pulls/130)):** the extension now separates repository identity from instance resolution. HTTP(S) remotes still support zero-config detection, while SSH remotes no longer guess a Forgejo web/API URL from the git transport. If you're using SSH remotes with a self-hosted instance, configure the Forgejo instance explicitly for the most reliable matching.
- **More secure token storage ([#129](https://codeberg.org/maxking/forgejo-vscode/pulls/129)):** personal access tokens are now stored in VS Code SecretStorage instead of settings.json.
- **Better remote parsing for dotted repository names ([#124](https://codeberg.org/maxking/forgejo-vscode/pulls/124)):** repositories with dots in their names are now detected correctly from git remotes.
- **Authentication docs clarified ([#128](https://codeberg.org/maxking/forgejo-vscode/pulls/128)):** the required token scopes now explicitly mention `read:issues`.

## Features

### Pull Requests
- Browse PRs grouped by state (Open/Draft load initially; Merged/Closed load on expansion)
- View file changes directly in VS Code's diff editor
- Add inline review comments on PR diffs
- Create new pull requests from within VS Code
- Merge PRs with multiple strategies (merge, squash, rebase)
- Close PRs directly from the sidebar
- Rich detail view showing description, comments, CI status, and timeline

### Issues
- Browse issues with full details and comments
- Create new issues from within VS Code
- Rich detail view with comment history and timeline events

### Actions / CI
- Monitor CI/CD workflow runs in a 3-level tree view (Run > Job > Step)
- View job logs directly in the editor
- Re-run failed workflows
- Clickable CI status links in PR detail views

### Multi-Instance & Auto-Detection
- Connect to multiple Forgejo servers simultaneously
- Auto-detect instance from your git remote
- Select preferred remote when multiple remotes exist
- Built-in diagnostics to troubleshoot connection issues

### Browser Integration
- Open any PR, Issue, or Action in your browser with one click

### Supported Platforms

- [Codeberg](https://codeberg.org)
- Self-hosted Forgejo instances
- Gitea instances (compatible API)

## Setting Up Authentication

Authentication is **optional for public repositories** but required for private repos.

### Step 1: Create a Personal Access Token (PAT)

#### On Codeberg

1. Go to [codeberg.org/user/settings/applications](https://codeberg.org/user/settings/applications)
2. Under "Manage Access Tokens", click **Generate New Token**
3. Enter a name (e.g., "VS Code Extension")
4. Select permissions:
   - `read:repository` - Browse repository files and pull requests (required)
   - `read:issues` - Browse issues (required)
   - `write:repository` - Merge PRs, close Issues (optional)
5. Click **Generate Token**
6. **Copy the token immediately** - you won't see it again!

#### On Self-Hosted Forgejo

1. Go to `https://your-forgejo-instance.com/user/settings/applications`
2. Follow the same steps as Codeberg above

### Step 2: Add the Token to VS Code

**Option A: Using Command Palette (Recommended)**

1. Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac)
2. Type **"Forgejo: Add Instance"**
3. Enter your instance URL (e.g., `https://codeberg.org`)
4. Enter a friendly name (e.g., "Codeberg")
5. Paste your token when prompted
6. Click **Test Connection** to verify

**Option B: Using Settings UI**

1. Open Settings: `Ctrl+,` (Windows/Linux) or `Cmd+,` (Mac)
2. Search for "forgejo"
3. Click **Edit in settings.json** under "Forgejo: Instances"
4. Add your instance configuration

### Multiple Instances

You can connect to multiple Forgejo servers:

1. Run **"Forgejo: Manage Instances"** from Command Palette
2. Add additional instances with their own tokens
3. The extension will match repositories to the correct instance automatically

## Usage

### Viewing Pull Requests

1. Click the **Forgejo icon** in the Activity Bar
2. Expand the **Pull Requests** section
3. Click a PR to see its files
4. Click a file to view the diff

### PR Actions

Right-click on a PR for options:
- **View PR Details** - See full description and comments
- **Open PR in Browser** - Open on Forgejo website
- **Merge PR** - Merge with options (merge commit, squash, rebase)
- **Close PR** - Close without merging

### Viewing Issues

1. Expand the **Issues** section in the Forgejo view
2. Click an issue to see full details, comments, and timeline
3. Right-click to open in browser
4. Use the **+** button in the Issues title bar to create a new issue

### Monitoring Actions / CI

1. Expand the **Actions** section in the Forgejo view
2. See workflow runs with their status (success, failure, running)
3. Expand a run to see individual jobs and steps
4. Click a step to view its logs in the editor
5. Right-click a run or job to re-run the workflow

### Commands

Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and type "Forgejo":

| Command | Description |
|---------|-------------|
| Forgejo: Add Instance | Add a new Forgejo server |
| Forgejo: Manage Instances | View and edit configured servers |
| Forgejo: Create Pull Request | Create a new PR from the current branch |
| Forgejo: Create Issue | Create a new issue |
| Forgejo: Refresh Pull Requests | Reload PR list |
| Forgejo: Refresh Issues | Reload Issue list |
| Forgejo: Refresh Actions | Reload Actions list |
| Forgejo: Select Git Remote | Choose which git remote to use |
| Forgejo: Show Diagnostics | Debug connection issues |
| Forgejo: Show Output Channel | View extension logs |

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `forgejo.autoDetectFromRemote` | `true` | Auto-detect instance from git remote |
| `forgejo.preferredRemote` | `""` | Preferred git remote name (default: auto-detect, falls back to origin) |
| `forgejo.debug` | `false` | Enable debug logging |
| `forgejo.showFileStatusNotifications` | `true` | Show notifications for added/deleted files |

## Troubleshooting

### "No Forgejo configuration found"

- Make sure you're in a workspace with a git repository
- Check that you have a git remote configured (`git remote -v`)
- Try running **"Forgejo: Add Instance"** to manually configure

### PRs or Issues not loading

1. Run **"Forgejo: Show Diagnostics"** to check connection status
2. Verify your token is valid and has correct permissions
3. Check the Output channel: **"Forgejo: Show Output Channel"**

### Authentication errors

1. Regenerate your token on the Forgejo website
2. Run **"Forgejo: Manage Instances"** to update the token
3. Make sure the token has `read:repository` and `read:issues` scopes

### Git remote not detected

The extension looks for the `origin` remote by default (configurable via `forgejo.preferredRemote`). Supported URL formats:
- HTTPS: `https://codeberg.org/owner/repo.git`
- SSH: `git@codeberg.org:owner/repo.git`
- SSH protocol: `ssh://git@codeberg.org/owner/repo.git`

## Feedback & Issues

Found a bug or have a feature request? Please open an issue on the [Codeberg repository](https://codeberg.org/maxking/forgejo-vscode).

## Acknowledgments

- [Forgejo](https://forgejo.org) - The self-hosted Git service this extension supports
- [Codeberg](https://codeberg.org) - For hosting Forgejo and being a great community
- [VS Code Extension API](https://code.visualstudio.com/api) - For making this possible
