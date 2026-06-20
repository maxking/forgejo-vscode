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

### 0.3.24

- **Faster CI dependency installs:** all test/publish/live-test jobs now cache the npm download cache (`~/.npm`) keyed on `package-lock.json`, so the ~740-package `npm ci` reinstall reuses cached tarballs instead of re-fetching them from the registry on every run.
- **Start work on issue ([#188](https://git.araj.me/maxking/forgejo-vscode/issues/188)):** issue rows now offer a start-work action that picks a local Git repository, suggests branch names from the issue number and title, and checks out the branch through VS Code's Git extension from the configured base ref.
- **Issue comment composer ([#200](https://git.araj.me/maxking/forgejo-vscode/issues/200)):** issue detail views now show the comment text box immediately when the selected repository has a configured token, instead of requiring a separate "+ Comment" reveal button.

### 0.3.23

- **Faster live Playwright CI:** the live-test Docker image now bakes VS Code and the Playwright chromium browser, and the live/VS Code Playwright configs reuse the baked VS Code install instead of downloading 241 MB on every run.
- **Open VSX workflow schema publishing fix:** the vendored workflow schema now avoids password-shaped string mappings that Open VSX secret scanning can mistake for credentials during publication.
- **PR and issue autolinks ([#199](https://git.araj.me/maxking/forgejo-vscode/issues/199)):** detail webviews now link same-repository `#123` and cross-repository `owner/repo#123` references in descriptions and comments.

### 0.3.21

- Development version after the 0.3.20 release.
- **Built-in query views ([#136](https://git.araj.me/maxking/forgejo-vscode/issues/136)):** Pull Request and Issue views now include "My Queries" groups for assigned, created, and mentioned items, plus PRs waiting for your review.
- **Query view duplicate row fix ([#136](https://git.araj.me/maxking/forgejo-vscode/issues/136)):** Pull Request and Issue rows now keep distinct tree item IDs when the same item appears in both a state group and a "My Queries" group.
- **Improved issue creation ([#180](https://git.araj.me/maxking/forgejo-vscode/issues/180)):** creating an issue now opens a dedicated webview page with title, description, labels, assignees, milestone, and due date fields instead of a multi-step input prompt.
- **Create issue repository safety ([#180](https://git.araj.me/maxking/forgejo-vscode/issues/180)):** create issue pages are now scoped by instance, owner, and repository so the displayed repository always matches the submit target.
- **Create issue submission safety ([#180](https://git.araj.me/maxking/forgejo-vscode/issues/180)):** multi-repository issue creation now uses repository-scoped actions, and duplicate create clicks are ignored while a submission is in flight.
- **Create issue CI fix ([#195](https://git.araj.me/maxking/forgejo-vscode/pulls/195)):** issue creation changes now satisfy the lint rules used by the pull request test workflow.
- **Duplicate PR tree row fix:** paged pull request results are now deduplicated before rendering so overlapping API pages cannot register the same tree item id twice.
- **Richer pull request activity details:** PR detail timelines now normalize Forgejo commit payloads before rendering, so commit authors, timestamps, messages, branch actions, merge commits, and commit references show useful context instead of "Unknown" or empty commit rows.
- **Custom SSH clone ports ([#26](https://codeberg.org/maxking/forgejo-vscode/issues/26)):** configured instances can now set `sshPort` so VS Code's Forgejo clone picker uses the right SSH port for self-hosted servers.
- **Workflow validation and failed CI navigation ([#191](https://git.araj.me/maxking/forgejo-vscode/issues/191)):** Forgejo-compatible workflow files now get local diagnostics, and failed CI rows link directly to logs and matching workflow files.

### 0.3.20

- **Pull request and issue search ([#135](https://codeberg.org/maxking/forgejo-vscode/issues/135)):** the Pull Requests and Issues views now search server-side through forgejo-ts 0.4.0 while preserving paged load-more behavior.
- **forgejo-ts pagination wrapper:** legacy Pull Request and Issue page helpers now delegate to forgejo-ts pagination metadata instead of rebuilding those requests locally.
- **Issue and PR timeline activity rendering ([forgejo#13020](https://codeberg.org/forgejo/forgejo/issues/13020)):** detail views now preserve Forgejo timeline action names and skip duplicate timeline comment rows instead of showing extra "performed an action" entries.
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
4. Paste your token when prompted
5. The extension tests the connection
6. Enter a friendly name (e.g., "Codeberg")
7. Enter an SSH port if your self-hosted instance does not use port 22, or leave it blank
8. The extension saves the instance

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

### Built-In Query Views

Pull Request and Issue **My Queries** groups require an authentication token because the extension first resolves the current API user with `GET /user`.

Pull Request state groups use the Forgejo pull request list API:

| Section | Query | Client-side filter |
| --- | --- | --- |
| Open | `/repos/{owner}/{repo}/pulls?state=open&page={page}&limit=50` | `draft === false` |
| Draft | `/repos/{owner}/{repo}/pulls?state=open&page={page}&limit=50` | `draft === true` |
| Merged | `/repos/{owner}/{repo}/pulls?state=closed&page={page}&limit=50` | `merged === true` |
| Closed | `/repos/{owner}/{repo}/pulls?state=closed&page={page}&limit=50` | `merged === false` |

When Pull Request search text is active, state groups instead use `/repos/{owner}/{repo}/issues?state={open|closed}&type=pulls&q={search}&page={page}&limit=50`, hydrate each matched row as a PR, then apply the same client-side filter.

Pull Request **My Queries** groups use issue-search filters with `type=pulls` and `state=open`:

| Section | Query | Notes |
| --- | --- | --- |
| Assigned to me | `/repos/{owner}/{repo}/issues?state=open&type=pulls&assigned_by={login}&page={page}&limit=50` | Hydrates each matched issue as a PR. |
| Waiting for my review | `/repos/issues/search?state=open&type=pulls&review_requested=true&owner={owner}&page={page}&limit=50` | Forgejo treats `review_requested=true` as "review requested from the authenticated user"; the extension filters results back to `{owner}/{repo}` before hydrating PRs. |
| Created by me | `/repos/{owner}/{repo}/issues?state=open&type=pulls&created_by={login}&page={page}&limit=50` | Hydrates each matched issue as a PR. |
| Mentioned me | `/repos/{owner}/{repo}/issues?state=open&type=pulls&mentioned_by={login}&page={page}&limit=50` | Hydrates each matched issue as a PR. |

Issue state groups use the Forgejo issue list API:

| Section | Query | Client-side filter |
| --- | --- | --- |
| Open | `/repos/{owner}/{repo}/issues?state=open&type=issues&page={page}&limit=50` | Excludes rows with `pull_request`. |
| Closed | `/repos/{owner}/{repo}/issues?state=closed&type=issues&page={page}&limit=50` | Excludes rows with `pull_request`. |

When Issue search text is active, state groups add `q={search}` to the same issue-list query.

Issue **My Queries** groups use `state=open` issue filters:

| Section | Query | Client-side filter |
| --- | --- | --- |
| Assigned to me | `/repos/{owner}/{repo}/issues?state=open&type=issues&assigned_by={login}&page={page}&limit=50` | Excludes rows with `pull_request`. |
| Created by me | `/repos/{owner}/{repo}/issues?state=open&type=issues&created_by={login}&page={page}&limit=50` | Excludes rows with `pull_request`. |
| Mentioned me | `/repos/{owner}/{repo}/issues?state=open&type=issues&mentioned_by={login}&page={page}&limit=50` | Excludes rows with `pull_request`. |

When the tree search box has text, **My Queries** groups also add `q={search}` to the query shown in the table.

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

### Maintaining Workflow Validation

Workflow diagnostics use the schema bundled by Forgejo runner, the same Actions parser Forgejo calls through `act/model.ReadWorkflow` and `act/jobparser.Parse`. The vendored schema lives at `src/diagnostics/schemas/forgejo-workflow.schema.json`.

To refresh the schema from the currently documented runner version:

```bash
npm run update:workflow-schema
```

To bump to a specific Forgejo runner version:

```bash
FORGEJO_RUNNER_VERSION=v12.11.1 npm run update:workflow-schema
```

After updating, run `npm run lint`, `npm run compile`, and `npm run test:unit -- workflowDiagnostics`.

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

Per-instance entries in `forgejo.instances` also support `sshPort` for self-hosted servers whose SSH service does not listen on port 22:

```json
{
  "id": "my-forgejo",
  "name": "My Forgejo",
  "instanceUrl": "https://git.example.com",
  "sshPort": 2222
}
```

For existing instances, run **"Forgejo: Manage Instances"**, select the instance, then choose **"Edit SSH Port"**.

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
