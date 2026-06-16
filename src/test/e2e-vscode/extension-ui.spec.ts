import { test, expect } from './fixtures/vscode-harness';

test.describe('Forgejo Extension UI', () => {

  test('extension activates and registers commands', async ({ harness }) => {
    // The extension uses onStartupFinished, so it should activate quickly
    const isActive = await harness.isExtensionActive();
    expect(isActive).toBe(true);

    // Verify key commands are registered
    const commands = await harness.getRegisteredCommands('forgejo.');
    expect(commands).toContain('forgejo.addInstance');
    expect(commands).toContain('forgejo.refreshPullRequests');
    expect(commands).toContain('forgejo.loadMorePullRequests');
    expect(commands).toContain('forgejo.refreshIssues');
    expect(commands).toContain('forgejo.loadMoreIssues');
    expect(commands).toContain('forgejo.showDiagnostics');
    expect(commands).toContain('forgejo.showOutput');
  });

  test('actions commands are registered', async ({ harness }) => {
    await harness.waitForExtensionActivation();
    const commands = await harness.getRegisteredCommands('forgejo.');
    expect(commands).toContain('forgejo.refreshActions');
    expect(commands).toContain('forgejo.viewStepLogs');
    expect(commands).toContain('forgejo.showActionDetails');
    expect(commands).toContain('forgejo.viewActionLogs');
  });

  test('Forgejo view container is registered', async ({ harness, evaluateInVSCode }) => {
    await harness.waitForExtensionActivation();

    // Verify the Forgejo view container command exists (VS Code registers a
    // command for each view container: workbench.view.extension.<id>)
    const commands = await harness.getRegisteredCommands('workbench.view.extension.forgejo');
    expect(commands.length).toBeGreaterThan(0);
  });

  test('sidebar views are registered and can be opened', async ({ harness, evaluateInVSCode }) => {
    await harness.waitForExtensionActivation();

    // Open the Forgejo sidebar
    await harness.openForgejoSidebar();

    // Verify we can execute the focus commands for each view
    // (these commands exist when the views are registered)
    const commands = await harness.getRegisteredCommands('forgejo');
    expect(commands).toContain('forgejoPullRequests.focus');
    expect(commands).toContain('forgejoIssues.focus');
    expect(commands).toContain('forgejoActions.focus');
  });

  test('tree views exist when no remote configured', async ({ harness, evaluateInVSCode }) => {
    await harness.waitForExtensionActivation();
    await harness.openForgejoSidebar();
    await harness.captureScreenshot('tree-views-no-config');

    // Without a git remote / instance configured, the extension should still
    // have its views registered. Verify via the focus commands.
    const commands = await harness.getRegisteredCommands('forgejo');
    expect(commands).toContain('forgejoPullRequests.focus');
    expect(commands).toContain('forgejoIssues.focus');
  });

  test('forgejo.showOutput command executes without error', async ({ harness }) => {
    // Verify the command executes without throwing.
    // We cannot programmatically verify the output panel contents because
    // VS Code does not expose an API to query output channels.
    await harness.executeCommand('forgejo.showOutput');
    await harness.captureScreenshot('output-channel');
  });

  test('forgejo.showDiagnostics command executes without error', async ({ harness }) => {
    await harness.waitForExtensionActivation();

    // Should not throw
    await harness.executeCommand('forgejo.showDiagnostics');
    await harness.captureScreenshot('diagnostics');
  });
});
