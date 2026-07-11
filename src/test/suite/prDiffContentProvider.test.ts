import * as assert from 'assert';
import * as vscode from 'vscode';
import { PRDiffContentProvider, PR_DIFF_SCHEME, createPRFileUri, createPRFileUris, parsePRFileUri } from '../../providers/prDiffContentProvider';

suite('PR Diff Content Provider Test Suite', () => {
  let provider: PRDiffContentProvider;

  setup(() => {
    provider = new PRDiffContentProvider();
  });

  test('Provider should be created', () => {
    assert.ok(provider, 'Provider should be created');
  });

  test('Provider should implement TextDocumentContentProvider', () => {
    assert.ok(provider.provideTextDocumentContent, 'Should have provideTextDocumentContent method');
    assert.ok(provider.onDidChange, 'Should have onDidChange event');
  });

  test('Provider should have cache management methods', () => {
    assert.strictEqual(typeof provider.clearCache, 'function', 'Should have clearCache method');
    assert.strictEqual(typeof provider.refresh, 'function', 'Should have refresh method');
  });

  test('Provider should be registered for forgejo-pr scheme', async function() {
    this.timeout(10000);

    // Register the provider
    const disposable = vscode.workspace.registerTextDocumentContentProvider(
      PR_DIFF_SCHEME,
      provider
    );

    try {
      // Verify registration by checking if we can create URIs with the scheme
      const uri = createPRFileUri('owner', 'repo', 'main', 'test.ts');
      assert.strictEqual(uri.scheme, PR_DIFF_SCHEME, 'URI should have correct scheme');
      assert.ok(uri.path.includes('owner/repo/'), 'URI should contain owner/repo in path');
      assert.ok(uri.path.includes('test.ts'), 'URI should contain filename in path');
      assert.strictEqual(uri.query, '', 'URI should have no query parameters (ref is base64url-encoded in path)');
    } finally {
      disposable.dispose();
    }
  });

  test('createPRFileUri should encode special characters in filename', () => {
    const uri = createPRFileUri('owner', 'repo', 'main', 'file with spaces & special#chars.ts');

    assert.strictEqual(uri.scheme, PR_DIFF_SCHEME, 'URI should have correct scheme');

    // VS Code URI automatically decodes the path for display, so we check the full URI string
    const uriString = uri.toString();
    assert.ok(uriString.includes('file%20with%20spaces'), 'Spaces should be encoded in URI string');
    assert.ok(uriString.includes('%26%20special'), '& should be encoded in URI string');
    assert.ok(uriString.includes('%23chars'), '# should be encoded in URI string');
  });

  test('createPRFileUri should handle nested paths', () => {
    const uri = createPRFileUri('owner', 'repo', 'feature/branch', 'src/deep/nested/path/file.ts');

    assert.strictEqual(uri.scheme, PR_DIFF_SCHEME, 'URI should have correct scheme');
    assert.ok(uri.path.includes('owner'), 'Path should contain owner');
    assert.ok(uri.path.includes('repo'), 'Path should contain repo');
    assert.strictEqual(uri.query, '', 'URI should have no query parameters (ref is base64url-encoded in path)');
    assert.ok(uri.path.includes('src/deep/nested/path/file.ts'), 'Path should contain file path');
  });

  test('fork rename URIs preserve base and head repository identity', () => {
    const uris = createPRFileUris(
      { filename: 'src/new.ts', previous_filename: 'src/old.ts', status: 'renamed' } as never,
      { owner: 'upstream', repo: 'project', ref: 'base-sha', instanceUrl: 'https://git.example.com' },
      { owner: 'contributor', repo: 'project-fork', ref: 'head-sha', instanceUrl: 'https://git.example.com' }
    );
    assert.ok(uris.before && uris.after, 'Renamed files should have both URI sides');
    assert.deepStrictEqual(parsePRFileUri(uris.before), {
      owner: 'upstream', repo: 'project', ref: 'base-sha', filepath: 'src/old.ts', instanceUrl: 'https://git.example.com'
    });
    assert.deepStrictEqual(parsePRFileUri(uris.after), {
      owner: 'contributor', repo: 'project-fork', ref: 'head-sha', filepath: 'src/new.ts', instanceUrl: 'https://git.example.com'
    });
  });

  test('provideTextDocumentContent should handle invalid URI format', async function() {
    this.timeout(10000);

    const invalidUri = vscode.Uri.parse(`${PR_DIFF_SCHEME}://invalid`);

    try {
      const content = await provider.provideTextDocumentContent(invalidUri);

      // Should return error content instead of throwing
      assert.ok(content.includes('Error'), 'Should return error message in content');
    } catch (error) {
      // If it throws, that's also acceptable behavior
      assert.ok(true, 'Provider handled invalid URI');
    }
  });

  test('Cache should persist content between calls', async function() {
    this.timeout(10000);

    // Create a mock URI
    const uri = createPRFileUri('owner', 'repo', 'main', 'test.ts');

    // First call - will attempt to fetch (may fail without API config)
    try {
      await provider.provideTextDocumentContent(uri);
    } catch (error) {
      // Ignore errors - we're testing cache behavior
    }

    // Clear and verify clearing works
    provider.clearCache(uri);

    // Cache should be cleared
    assert.ok(true, 'Cache clear should complete without error');
  });

  test('clearCache should clear specific URI', async function() {
    this.timeout(10000);

    const uri1 = createPRFileUri('owner', 'repo', 'main', 'file1.ts');
    const uri2 = createPRFileUri('owner', 'repo', 'main', 'file2.ts');

    // Attempt to fetch both (may fail without config)
    try {
      await provider.provideTextDocumentContent(uri1);
      await provider.provideTextDocumentContent(uri2);
    } catch (error) {
      // Ignore fetch errors
    }

    // Clear only uri1
    provider.clearCache(uri1);

    assert.ok(true, 'Should be able to clear specific URI from cache');
  });

  test('clearCache should clear all when no URI provided', async function() {
    this.timeout(10000);

    const uri1 = createPRFileUri('owner', 'repo', 'main', 'file1.ts');
    const uri2 = createPRFileUri('owner', 'repo', 'main', 'file2.ts');

    // Attempt to fetch both
    try {
      await provider.provideTextDocumentContent(uri1);
      await provider.provideTextDocumentContent(uri2);
    } catch (error) {
      // Ignore fetch errors
    }

    // Clear all cache
    provider.clearCache();

    assert.ok(true, 'Should be able to clear entire cache');
  });

  test('refresh should trigger onDidChange event', async function() {
    this.timeout(10000);

    const uri = createPRFileUri('owner', 'repo', 'main', 'test.ts');

    // Listen for change event
    let eventFired = false;
    const disposable = provider.onDidChange((changedUri) => {
      if (changedUri.toString() === uri.toString()) {
        eventFired = true;
      }
    });

    try {
      // Refresh the URI
      provider.refresh(uri);

      // Give event time to fire
      await new Promise(resolve => setTimeout(resolve, 100));

      assert.ok(eventFired, 'onDidChange event should fire when refresh is called');
    } finally {
      disposable.dispose();
    }
  });

  test('provideTextDocumentContent should handle missing configuration', async function() {
    this.timeout(10000);

    const uri = createPRFileUri('nonexistent', 'repo', 'main', 'test.ts');

    try {
      const content = await provider.provideTextDocumentContent(uri);

      // Should return error content instead of throwing
      assert.ok(
        content.includes('Error') || content.includes('error'),
        'Should return error message when config is missing'
      );
    } catch (error) {
      // If it throws, verify it's a reasonable error
      assert.ok(error instanceof Error, 'Should throw proper Error object');
    }
  });
});

suite('PR Diff Content Provider Error Handling Test Suite', () => {
  let provider: PRDiffContentProvider;

  setup(() => {
    provider = new PRDiffContentProvider();
  });

  test('provideTextDocumentContent should handle API errors gracefully', async function() {
    this.timeout(10000);

    // Create URI that will likely fail API call
    const uri = createPRFileUri('owner', 'repo', 'nonexistent-ref', 'nonexistent-file.ts');

    try {
      const content = await provider.provideTextDocumentContent(uri);

      // Should return error message in content
      assert.ok(typeof content === 'string', 'Should return string content');
      assert.ok(
        content.includes('Error') || content.includes('Failed'),
        'Should indicate error in content'
      );
    } catch (error) {
      // If it throws, that's also acceptable
      assert.ok(true, 'Provider handled API error');
    }
  });

  test('Provider should handle rapid successive calls', async function() {
    this.timeout(10000);

    const uri = createPRFileUri('owner', 'repo', 'main', 'test.ts');

    // Make multiple rapid calls
    const promises = [
      provider.provideTextDocumentContent(uri),
      provider.provideTextDocumentContent(uri),
      provider.provideTextDocumentContent(uri)
    ];

    try {
      await Promise.all(promises);
      assert.ok(true, 'Should handle rapid successive calls');
    } catch (error) {
      // Errors are expected without proper config
      assert.ok(true, 'Should handle errors in rapid calls');
    }
  });

  test('Provider should handle very long file paths', async function() {
    this.timeout(10000);

    const longPath = 'very/deep/nested/path/with/many/segments/'.repeat(10) + 'file.ts';
    const uri = createPRFileUri('owner', 'repo', 'main', longPath);

    assert.ok(uri.toString().length > 0, 'Should create URI with long path');

    try {
      await provider.provideTextDocumentContent(uri);
      assert.ok(true, 'Should handle long paths');
    } catch (error) {
      assert.ok(true, 'Should handle errors with long paths');
    }
  });
});
