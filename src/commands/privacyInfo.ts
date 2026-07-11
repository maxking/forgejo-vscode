import * as vscode from 'vscode';

/**
 * Factual privacy/data-handling report for the extension.
 *
 * Every claim here must stay verifiable against the source it cites. Do not
 * add claims that go beyond what's true in this codebase — see AGENTS.md
 * and issue #146 for the audit this report is based on.
 */
const PRIVACY_REPORT = `# Forgejo Extension — Privacy & Data Handling

This extension sends no telemetry or analytics, and makes network requests
only to the Forgejo instance(s) you configure.

## What this extension sends over the network

- The only outbound requests are Forgejo/Gitea API calls to the instance
  URL(s) you add under **Forgejo: Add Instance** (e.g. \`https://codeberg.org\`
  or your self-hosted instance). There is no other network destination —
  no analytics service, no crash reporter, no update-check endpoint, and no
  request to the extension author.

## What this extension stores, and where

| Data | Where | Notes |
|---|---|---|
| Personal access tokens | VS Code \`SecretStorage\` (OS keychain) | Never written to \`settings.json\` |
| Instance list (name, URL, SSH host/port, username) | VS Code \`settings.json\` (\`forgejo.instances\`) | No secrets in this list |
| PR/issue/diff content you view | In-memory only, for the current VS Code session | Cleared on close/refresh, never written to disk |
| Logs | Local "Forgejo" Output channel | Never transmitted anywhere |

## Things to know that are outside this extension's control

- **VS Code Settings Sync**: if you have Settings Sync enabled, VS Code may
  sync your \`settings.json\` (including the instance list above) and
  \`SecretStorage\` contents through your own sync account, depending on your
  Settings Sync configuration. That syncing is performed by VS Code itself,
  not by this extension.
- **VS Code's own telemetry**: VS Code core has a separate telemetry setting
  (\`telemetry.telemetryLevel\`) that is unrelated to this extension and not
  controlled by it.

## Verifying this yourself

This extension is open source. You can check these claims directly by
searching the source for network calls (\`src/api/forgejoClient.ts\`) and
storage usage (\`src/utils/secretStorage.ts\`).
`;

/**
 * Opens the privacy/data-handling report in a Markdown preview.
 */
export async function showPrivacyInfo(): Promise<void> {
	const doc = await vscode.workspace.openTextDocument({
		content: PRIVACY_REPORT,
		language: 'markdown',
	});
	await vscode.commands.executeCommand('markdown.showPreview', doc.uri);
}
