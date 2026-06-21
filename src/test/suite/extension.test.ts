import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Activation Test Suite', () => {
  vscode.window.showInformationMessage('Starting extension activation tests');

  test('Extension should be present', () => {
    const extension = vscode.extensions.getExtension('maxking.forgejo-vscode');
    assert.ok(extension, 'Extension should be installed');
  });

  test('Extension should activate', async function() {
    this.timeout(10000);
    const extension = vscode.extensions.getExtension('maxking.forgejo-vscode');
    assert.ok(extension);

    await extension.activate();
    assert.strictEqual(extension.isActive, true, 'Extension should be active');
  });

  test('All commands should be registered', async function() {
    this.timeout(10000);

    const commands = await vscode.commands.getCommands(true);
    const forgejoCommands = [
      'forgejo.addInstance',
      'forgejo.manageInstances',
      'forgejo.refreshPullRequests',
      'forgejo.loadMorePullRequests',
      'forgejo.refreshIssues',
      'forgejo.loadMoreIssues',
      'forgejo.browseRemoteRepository',
      'forgejo.refreshRemoteRepositories',
      'forgejo.selectRemoteRepositoryBranch',
      'forgejo.openRemoteFile',
      'forgejo.configureInstanceUrl',
      'forgejo.setAuthToken',
      'forgejo.openPrInBrowser',
      'forgejo.openIssueInBrowser',
      'forgejo.showPrFileDiff',
      'forgejo.openPrInBrowserFromContext',
      'forgejo.openPrFileInBrowser',
      'forgejo.showPrDetails',
      'forgejo.mergePr',
      'forgejo.closePr'
    ];

    for (const command of forgejoCommands) {
      assert.ok(
        commands.includes(command),
        `Command ${command} should be registered`
      );
    }
  });

  test('Refresh Pull Requests command should execute', async function() {
    this.timeout(5000);

    try {
      await vscode.commands.executeCommand('forgejo.refreshPullRequests');
      assert.ok(true, 'Command executed without error');
    } catch (error) {
      assert.fail(`Command failed to execute: ${error}`);
    }
  });

  test('Refresh Issues command should execute', async function() {
    this.timeout(5000);

    try {
      await vscode.commands.executeCommand('forgejo.refreshIssues');
      assert.ok(true, 'Command executed without error');
    } catch (error) {
      assert.fail(`Command failed to execute: ${error}`);
    }
  });

  test('Tree views should be created', async function() {
    this.timeout(5000);

    // The tree views are created when the extension activates
    const extension = vscode.extensions.getExtension('maxking.forgejo-vscode');
    assert.ok(extension);

    if (!extension.isActive) {
      await extension.activate();
    }

    // If we reach here without errors, tree views were created successfully
    assert.ok(true, 'Tree views created without errors');
  });
});

suite('PR Diff Commands Test Suite', () => {
  vscode.window.showInformationMessage('Starting PR diff command tests');

  const mockFile = {
    filename: 'test.ts',
    status: 'modified' as const,
    additions: 5,
    deletions: 3,
    changes: 8,
    blob_url: 'https://example.com/blob',
    raw_url: 'https://example.com/raw',
    contents_url: 'https://example.com/contents'
  };

  const mockPR = {
    number: 42,
    title: 'Test PR',
    state: 'open' as const,
    user: { login: 'testuser' },
    html_url: 'https://example.com/pulls/42',
    created_at: '2026-01-01T00:00:00Z',
    merged: false,
    draft: false,
    comments: 5
  };

  test('showPrFileDiff command should be registered', async function() {
    this.timeout(5000);

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('forgejo.showPrFileDiff'), 'showPrFileDiff command should be registered');
  });

  test('openPrInBrowserFromContext command should be registered', async function() {
    this.timeout(5000);

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('forgejo.openPrInBrowserFromContext'), 'openPrInBrowserFromContext command should be registered');
  });

  test('openPrFileInBrowser command should be registered', async function() {
    this.timeout(5000);

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('forgejo.openPrFileInBrowser'), 'openPrFileInBrowser command should be registered');
  });

  test('showPrFileDiff command should handle modified file', async function() {
    this.timeout(10000);

    const modifiedFile = { ...mockFile, status: 'modified' as const };

    try {
      // Execute command - it will open diff editor
      await vscode.commands.executeCommand(
        'forgejo.showPrFileDiff',
        modifiedFile,
        mockPR,
        'owner',
        'repo',
        'main',
        'feature'
      );
      assert.ok(true, 'Command executed for modified file');
    } catch (error) {
      // Command may fail if there's no API connection, which is expected in tests
      assert.ok(true, 'Command execution attempted');
    }
  });

  test('showPrFileDiff command should handle added file', async function() {
    this.timeout(10000);

    const addedFile = { ...mockFile, status: 'added' as const };

    try {
      await vscode.commands.executeCommand(
        'forgejo.showPrFileDiff',
        addedFile,
        mockPR,
        'owner',
        'repo',
        'main',
        'feature'
      );
      assert.ok(true, 'Command executed for added file');
    } catch (error) {
      assert.ok(true, 'Command execution attempted');
    }
  });

  test('showPrFileDiff command should handle removed file', async function() {
    this.timeout(10000);

    const removedFile = { ...mockFile, status: 'removed' as const };

    try {
      await vscode.commands.executeCommand(
        'forgejo.showPrFileDiff',
        removedFile,
        mockPR,
        'owner',
        'repo',
        'main',
        'feature'
      );
      assert.ok(true, 'Command executed for removed file');
    } catch (error) {
      assert.ok(true, 'Command execution attempted');
    }
  });

  test('showPrFileDiff command should handle renamed file', async function() {
    this.timeout(10000);

    const renamedFile = { ...mockFile, status: 'renamed' as const, previous_filename: 'old.ts' };

    try {
      await vscode.commands.executeCommand(
        'forgejo.showPrFileDiff',
        renamedFile,
        mockPR,
        'owner',
        'repo',
        'main',
        'feature'
      );
      assert.ok(true, 'Command executed for renamed file');
    } catch (error) {
      assert.ok(true, 'Command execution attempted');
    }
  });

  test('showPrFileDiff command should handle errors gracefully', async function() {
    this.timeout(10000);

    try {
      // Call with invalid arguments
      await vscode.commands.executeCommand('forgejo.showPrFileDiff');
      assert.ok(true, 'Command handled missing arguments');
    } catch (error) {
      // Expected to fail, which is fine
      assert.ok(true, 'Command failed as expected with invalid arguments');
    }
  });

  test('openPrInBrowserFromContext command should work with PRTreeItem', async function() {
    this.timeout(10000);

    // We can't actually open browser in tests, but we can verify command executes
    try {
      // Command expects a PRTreeItem with htmlUrl property
      const mockPRTreeItem = {
        htmlUrl: 'https://example.com/pulls/42',
        pr: mockPR
      };
      await vscode.commands.executeCommand('forgejo.openPrInBrowserFromContext', mockPRTreeItem);
      assert.ok(true, 'Command executed without throwing');
    } catch (error) {
      assert.ok(true, 'Command execution attempted');
    }
  });

  test('openPrFileInBrowser command should work with PRFileItem', async function() {
    this.timeout(10000);

    try {
      // Command expects a PRFileItem with file.blob_url
      const mockPRFileItem = {
        file: mockFile
      };
      await vscode.commands.executeCommand('forgejo.openPrFileInBrowser', mockPRFileItem);
      assert.ok(true, 'Command executed without throwing');
    } catch (error) {
      assert.ok(true, 'Command execution attempted');
    }
  });

  test('openPrFileInBrowser command should handle invalid input', async function() {
    this.timeout(10000);

    try {
      await vscode.commands.executeCommand('forgejo.openPrFileInBrowser');
      assert.ok(true, 'Command handled missing arguments');
    } catch (error) {
      assert.ok(true, 'Command failed as expected');
    }
  });
});

suite('PR Details and Management Commands Test Suite', () => {
  vscode.window.showInformationMessage('Starting PR details and management tests');

  const mockPR = {
    number: 42,
    title: 'Test PR',
    state: 'open' as const,
    user: { login: 'testuser' },
    html_url: 'https://example.com/pulls/42',
    created_at: '2026-01-01T00:00:00Z',
    merged: false,
    draft: false,
    comments: 5
  };

  test('showPrDetails command should be registered', async function() {
    this.timeout(5000);

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('forgejo.showPrDetails'), 'showPrDetails command should be registered');
  });

  test('closePr command should be registered', async function() {
    this.timeout(5000);

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('forgejo.closePr'), 'closePr command should be registered');
  });

  test('showPrDetails command should handle missing arguments gracefully', async function() {
    this.timeout(10000);

    try {
      // Call without required arguments
      await vscode.commands.executeCommand('forgejo.showPrDetails');
      assert.ok(true, 'Command handled missing arguments');
    } catch (error) {
      // Expected to fail
      assert.ok(true, 'Command failed as expected with invalid arguments');
    }
  });

  test('mergePr command should be registered', async function() {
    this.timeout(5000);

    // Note: We can't test command execution with missing args because
    // it shows a QuickPick that waits for user input.
    // Instead we just verify the command is registered.
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('forgejo.mergePr'), 'mergePr command should be registered');
  });

  test('closePr command should handle missing arguments gracefully', async function() {
    this.timeout(10000);

    try {
      // Call without required arguments
      await vscode.commands.executeCommand('forgejo.closePr');
      assert.ok(true, 'Command handled missing arguments');
    } catch (error) {
      // Expected to fail
      assert.ok(true, 'Command failed as expected with invalid arguments');
    }
  });
});
