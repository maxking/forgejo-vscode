import * as vscode from 'vscode';
import { PRTreeProvider, PRTreeItem, PROverviewItem } from './providers/prTreeProvider';
import { IssueTreeProvider, IssueTreeItem } from './providers/issueTreeProvider';
import { ActionsTreeProvider, WorkflowRunTreeItem, JobTreeItem, StepTreeItem, StepLogArgs, workflowRunNumberForItem } from './providers/actionsTreeProvider';
import { ReleaseTreeProvider } from './providers/releaseTreeProvider';
import { RemoteRepositoryTreeProvider, RemoteRepositoryItem, openRemoteFile } from './providers/remoteRepositoryTreeProvider';
import { WorkflowRunListItem } from './models/action';
import { PRDiffContentProvider, PR_DIFF_SCHEME, createPRFileUris } from './providers/prDiffContentProvider';
import { PRDetailsContentProvider, PR_DETAILS_SCHEME } from './providers/prDetailsContentProvider';
import { RemoteFileContentProvider, REMOTE_FILE_SCHEME } from './providers/remoteFileContentProvider';
import { PRDetailWebviewProvider } from './webview/prDetail/provider';
import { IssueDetailWebviewProvider } from './webview/issueDetail/provider';
import { IssueCreateWebviewProvider } from './webview/issueCreate/provider';
import { ActionDetailWebviewProvider } from './webview/actionDetail/provider';
import { ForgejoCommentController } from './providers/prCommentController';
import { PullRequestFile, PullRequestListItem } from './models/pullRequest';
import { configureInstanceUrlCommand, setAuthTokenCommand } from './commands/legacyConfig';
import { migrateToMultiInstance } from './utils/migration';
import { getAllInstances } from './utils/instanceHelpers';
import { startOnboarding } from './commands/onboarding';
import { manageInstances } from './commands/instanceManager';
import { showDiagnostics } from './commands/diagnostics';
import { showPrivacyInfo } from './commands/privacyInfo';
import { copyPermalinkCommand } from './commands/copyPermalink';
import { openWorkflowFileForRepository, openWorkflowFileForCIStatus, validateWorkflowsCommand, viewCIStatusLogs } from './commands/ciNavigation';
import { createIssueCommand } from './commands/createIssue';
import { createPullRequestCommand } from './commands/createPullRequest';
import { startWorkOnIssueCommand } from './commands/startWorkOnIssue';
import { createReleaseCommand } from './commands/createRelease';
import { mergePrCommand } from './commands/mergePr';
import { selectRemoteCommand } from './commands/selectRemote';
import { closePrCommand } from './commands/closePr';
import { registerCommand } from './commands/registry';
import { logger, logInfo } from './utils/logger';
import { ForgejoClient } from './api/forgejoClient';
import { ForgejoConfig, getForgejoConfig, getForgejoConfigFor } from './utils/config';
import { initializeSecretStorage, onDidChangeToken } from './utils/secretStorage';
import { migrateTokensToSecretStorage } from './utils/migration';
import { ForgejoRemoteSourceProvider } from './providers/forgejoRemoteSourceProvider';
import { ForgejoAuthenticationProvider } from './auth/forgejoAuthenticationProvider';
import { createRemoteSourcePublisher, publishRepositoryFromWorkspace } from './commands/publishToForgejo';
import { activateGitExtension } from './utils/gitExtension';
import { registerWorkflowDiagnostics } from './diagnostics/workflowDiagnostics';
import { registerReferenceLanguageFeatures } from './providers/referenceLanguageProvider';
import { BranchStatusBarController } from './statusBar/branchStatusBarController';

export async function activate(context: vscode.ExtensionContext) {
  logInfo('Extension is now active');
  logInfo('VS Code version:', vscode.version);
  logInfo('Workspace folders:', vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath));

  // Initialize SecretStorage before any migration or config reads
  initializeSecretStorage(context.secrets);

  // Migrate legacy config first (before creating tree providers)
  await migrateToMultiInstance();

  // Migrate plaintext tokens from settings.json to SecretStorage
  await migrateTokensToSecretStorage();

  // Create tree data providers
  const prTreeProvider = new PRTreeProvider();
  const issueTreeProvider = new IssueTreeProvider();
  const actionsTreeProvider = new ActionsTreeProvider();
  const releaseTreeProvider = new ReleaseTreeProvider();
  const remoteRepositoryTreeProvider = new RemoteRepositoryTreeProvider();
  const workflowDiagnostics = registerWorkflowDiagnostics(context);

  // Late-bound so addInstance/manageInstances can trigger a re-registration
  let refreshRemoteSourceProviders: () => Promise<void> = () => Promise.resolve();
	const remoteFileProvider = new RemoteFileContentProvider();
	context.subscriptions.push(onDidChangeToken(() => {
		prTreeProvider.refresh();
		issueTreeProvider.refresh();
		actionsTreeProvider.refresh();
		releaseTreeProvider.refresh();
		remoteRepositoryTreeProvider.refresh();
		remoteFileProvider.refresh();
		void refreshRemoteSourceProviders();
	}));

  // Helper to update the context key for viewsWelcome
  async function updateNoInstanceContext() {
    const instances = await getAllInstances();
    const config = await getForgejoConfig();
    // Show welcome content only when no instances AND no usable git remote
    await vscode.commands.executeCommand('setContext', 'forgejo.noInstanceConfigured', instances.length === 0 && !config);
    return instances;
  }

  // Set initial context and check for first-time setup
  void (async () => {
    const instances = await updateNoInstanceContext();
    const isTest = process.env.NODE_ENV === 'test' || typeof (global as Record<string, unknown>).it === 'function';

    if (instances.length === 0 && !isTest) {
      // viewsWelcome content now provides the primary onboarding UX
      // No dismissible dialog needed - the welcome view buttons persist
    }
  })();

  // Register tree views
  const prTreeView = vscode.window.createTreeView('forgejoPullRequests', {
    treeDataProvider: prTreeProvider,
    showCollapseAll: true
  });

  const issueTreeView = vscode.window.createTreeView('forgejoIssues', {
    treeDataProvider: issueTreeProvider,
    showCollapseAll: true
  });

  const actionsTreeView = vscode.window.createTreeView('forgejoActions', {
    treeDataProvider: actionsTreeProvider,
    showCollapseAll: true
  });

  const releaseTreeView = vscode.window.createTreeView('forgejoReleases', {
    treeDataProvider: releaseTreeProvider,
    showCollapseAll: true
  });

  const remoteRepositoryTreeView = vscode.window.createTreeView('forgejoRemoteRepositories', {
    treeDataProvider: remoteRepositoryTreeProvider,
    showCollapseAll: true
  });

  // Create virtual document provider for PR diffs
  const prDiffProvider = new PRDiffContentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(PR_DIFF_SCHEME, prDiffProvider),
    prDiffProvider
  );

  // Create comment controller for inline PR comments
  const commentController = new ForgejoCommentController();
  context.subscriptions.push(commentController);

  // Register submit inline comment command
  context.subscriptions.push(
    registerCommand('forgejo.submitInlineComment', async (reply: vscode.CommentReply) => {
      await commentController.handleCreateComment(reply);
    })
  );

  // Create virtual document provider for PR details
  const prDetailsProvider = new PRDetailsContentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(PR_DETAILS_SCHEME, prDetailsProvider),
    prDetailsProvider
  );

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(REMOTE_FILE_SCHEME, remoteFileProvider),
    remoteFileProvider
  );

  // Register instance management commands
  context.subscriptions.push(
    registerCommand('forgejo.addInstance', async () => {
      const success = await startOnboarding();
      if (success) {
        await updateNoInstanceContext();
        prTreeProvider.refresh();
        issueTreeProvider.refresh();
        actionsTreeProvider.refresh();
        releaseTreeProvider.refresh();
        remoteRepositoryTreeProvider.refresh();
        remoteFileProvider.refresh();
        await refreshRemoteSourceProviders();
      }
    })
  );

  context.subscriptions.push(
    registerCommand('forgejo.manageInstances', async () => {
      await manageInstances();
      await updateNoInstanceContext();
      prTreeProvider.refresh();
      issueTreeProvider.refresh();
      actionsTreeProvider.refresh();
      releaseTreeProvider.refresh();
      remoteRepositoryTreeProvider.refresh();
      remoteFileProvider.refresh();
      await refreshRemoteSourceProviders();
    })
  );

  context.subscriptions.push(
    registerCommand('forgejo.showDiagnostics', async () => {
      return await showDiagnostics();
    })
  );

  context.subscriptions.push(
    registerCommand('forgejo.showPrivacyInfo', async () => {
      await showPrivacyInfo();
    })
  );

  context.subscriptions.push(
    registerCommand('forgejo.copyPermalink', async () => {
      await copyPermalinkCommand();
    })
  );

  context.subscriptions.push(
    registerCommand('forgejo.validateWorkflows', async () => {
      await validateWorkflowsCommand(workflowDiagnostics);
    })
  );

  context.subscriptions.push(
    registerCommand('forgejo.showOutput', () => {
      logger.show();
    })
  );

  // Register refresh commands
  context.subscriptions.push(
    registerCommand('forgejo.refreshPullRequests', () => {
      prTreeProvider.refresh();
      void vscode.window.showInformationMessage('Pull Requests refreshed');
    })
  );

  context.subscriptions.push(
    registerCommand('forgejo.refreshRemoteRepositories', () => {
      remoteRepositoryTreeProvider.refresh();
      remoteFileProvider.refresh();
      void vscode.window.showInformationMessage('Remote repositories refreshed');
    })
  );

  context.subscriptions.push(
    registerCommand('forgejo.browseRemoteRepository', item => remoteRepositoryTreeProvider.browseRepository(item))
  );

  context.subscriptions.push(
    registerCommand('forgejo.selectRemoteRepositoryBranch', async (item?: RemoteRepositoryItem) => {
      if (!item) {
        void vscode.window.showInformationMessage('Select a remote repository from the Forgejo Repositories view to change branches.');
        return;
      }
      await remoteRepositoryTreeProvider.selectBranch(item);
    })
  );

  context.subscriptions.push(
    registerCommand('forgejo.openRemoteFile', openRemoteFile)
  );

  context.subscriptions.push(
    registerCommand('forgejo.refreshRepositoryPullRequests', (repositoryItem) => {
      prTreeProvider.refreshRepository(repositoryItem);
      void vscode.window.showInformationMessage(`Pull Requests refreshed for ${repositoryItem.config.label}`);
    })
  );

  context.subscriptions.push(
    registerCommand('forgejo.searchPullRequests', async () => {
      const query = await vscode.window.showInputBox({
        title: 'Search Pull Requests',
        prompt: 'Search pull request titles and descriptions. Leave blank to clear search.',
        value: prTreeProvider.getSearchQuery() ?? ''
      });
      if (query === undefined) {
        return;
      }

      prTreeProvider.setSearchQuery(query);
    })
  );

  context.subscriptions.push(
    registerCommand('forgejo.loadMorePullRequests', (item) => prTreeProvider.loadMorePullRequests(item))
  );
  context.subscriptions.push(
    registerCommand('forgejo.loadMorePullRequestFiles', (item) => prTreeProvider.loadMorePullRequestFiles(item))
  );

  context.subscriptions.push(
    registerCommand('forgejo.refreshIssues', () => {
      issueTreeProvider.refresh();
      void vscode.window.showInformationMessage('Issues refreshed');
    })
  );

  context.subscriptions.push(
    registerCommand('forgejo.searchIssues', async () => {
      const query = await vscode.window.showInputBox({
        title: 'Search Issues',
        prompt: 'Search issue titles and descriptions. Leave blank to clear search.',
        value: issueTreeProvider.getSearchQuery() ?? ''
      });
      if (query === undefined) {
        return;
      }

      issueTreeProvider.setSearchQuery(query);
    })
  );

  context.subscriptions.push(
    registerCommand('forgejo.loadMoreIssues', (item) => issueTreeProvider.loadMoreIssues(item))
  );

  // Register create issue command
  context.subscriptions.push(
    registerCommand('forgejo.createIssue', () => createIssueCommand(issueCreateWebviewProvider))
  );

  context.subscriptions.push(
    registerCommand('forgejo.createIssueForRepository', (repositoryItem) => createIssueCommand(issueCreateWebviewProvider, repositoryItem.config))
  );

  // Register create pull request command
  context.subscriptions.push(
    registerCommand('forgejo.createPullRequest', () => createPullRequestCommand(prTreeProvider))
  );

  context.subscriptions.push(
    registerCommand('forgejo.createPullRequestForRepository', (repositoryItem) => createPullRequestCommand(prTreeProvider, repositoryItem.config))
  );

  context.subscriptions.push(
    registerCommand('forgejo.refreshActions', () => {
      actionsTreeProvider.refresh();
      void vscode.window.showInformationMessage('Actions refreshed');
    })
  );

  context.subscriptions.push(
    registerCommand('forgejo.loadMoreActions', (item) => actionsTreeProvider.loadMoreActions(item))
  );

  // Register configuration commands
  context.subscriptions.push(
    registerCommand('forgejo.configureInstanceUrl', () =>
      configureInstanceUrlCommand(prTreeProvider, issueTreeProvider, actionsTreeProvider)
    )
  );

  context.subscriptions.push(
    registerCommand('forgejo.setAuthToken', () =>
      setAuthTokenCommand(prTreeProvider, issueTreeProvider, actionsTreeProvider)
    )
  );

  // Register select remote command
  context.subscriptions.push(
    registerCommand('forgejo.selectRemote', () => selectRemoteCommand(prTreeProvider, issueTreeProvider, actionsTreeProvider))
  );

  // Register open in browser commands
  context.subscriptions.push(
    registerCommand('forgejo.openPrInBrowser', (url: string) => {
      if (url) {
        void vscode.env.openExternal(vscode.Uri.parse(url));
      }
    })
  );

  context.subscriptions.push(
    registerCommand('forgejo.openIssueInBrowser', (url: string) => {
      if (url) {
        void vscode.env.openExternal(vscode.Uri.parse(url));
      }
    })
  );

  // Register PR file diff viewer
  context.subscriptions.push(
    registerCommand(
      'forgejo.showPrFileDiff',
      async (
        file: PullRequestFile,
        pr: PullRequestListItem,
        owner: string,
        repo: string,
        baseRef: string,
        headRef: string,
        instanceUrl?: string,
        headOwner: string = owner,
        headRepo: string = repo
      ) => {
        console.log('[Forgejo] Opening diff for file:', file.filename);

        try {
          const uris = createPRFileUris(
            file,
            { owner, repo, ref: baseRef, instanceUrl },
            { owner: headOwner, repo: headRepo, ref: headRef, instanceUrl }
          );
          // Handle deleted files (no "after" version)
          if (file.status === 'removed') {
            const beforeUri = uris.before;
            if (!beforeUri) throw new Error('Removed file is missing its base document URI');
            commentController.registerPRContext(beforeUri, {
              owner, repo, prNumber: pr.number, baseRef, headRef, filePath: file.filename, instanceUrl
            });
            const doc = await vscode.workspace.openTextDocument(beforeUri);
            await vscode.window.showTextDocument(doc, { preview: true });
            const showNotifications = vscode.workspace.getConfiguration('forgejo').get<boolean>('showFileStatusNotifications', true);
            if (showNotifications) {
              void vscode.window.showInformationMessage(`File ${file.filename} was deleted in PR #${pr.number}`);
            }
            return;
          }

          // Handle added files (no "before" version)
          if (file.status === 'added') {
            const afterUri = uris.after;
            if (!afterUri) throw new Error('Added file is missing its head document URI');
            commentController.registerPRContext(afterUri, {
              owner, repo, prNumber: pr.number, baseRef, headRef, filePath: file.filename, instanceUrl
            });
            const doc = await vscode.workspace.openTextDocument(afterUri);
            await vscode.window.showTextDocument(doc, { preview: true });
            const showNotifications = vscode.workspace.getConfiguration('forgejo').get<boolean>('showFileStatusNotifications', true);
            if (showNotifications) {
              void vscode.window.showInformationMessage(`File ${file.filename} was added in PR #${pr.number}`);
            }
            return;
          }

          // For modified/renamed files, show diff
          const beforePath = file.previous_filename ?? file.filename;
          const afterPath = file.filename;

          const { before: beforeUri, after: afterUri } = uris;
          if (!beforeUri || !afterUri) throw new Error('Changed file is missing a diff document URI');

          // Register PR context for both sides of the diff
          commentController.registerPRContext(beforeUri, {
            owner, repo, prNumber: pr.number, baseRef, headRef, filePath: beforePath, instanceUrl
          });
          commentController.registerPRContext(afterUri, {
            owner, repo, prNumber: pr.number, baseRef, headRef, filePath: afterPath, instanceUrl
          });

          const title = `PR #${pr.number}: ${file.filename}`;

          // Open VS Code's native diff viewer
          await vscode.commands.executeCommand(
            'vscode.diff',
            beforeUri,
            afterUri,
            title,
            { preview: true }
          );

          console.log('[Forgejo] Diff opened successfully');
        } catch (error) {
          console.error('[Forgejo] Error opening diff:', error);
          void vscode.window.showErrorMessage(
            `Failed to open diff: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }
    )
  );

  // Add context menu command to open PR in browser
  context.subscriptions.push(
    registerCommand(
      'forgejo.openPrInBrowserFromContext',
      (prItem) => {
        if (prItem.htmlUrl) {
          void vscode.env.openExternal(vscode.Uri.parse(prItem.htmlUrl));
        }
      }
    )
  );

  // Add context menu command to open file in browser
  context.subscriptions.push(
    registerCommand(
      'forgejo.openPrFileInBrowser',
      (fileItem) => {
        if (fileItem.file.blob_url) {
          void vscode.env.openExternal(vscode.Uri.parse(fileItem.file.blob_url));
        }
      }
    )
  );

  // Register PR details viewer command
  // Handles both direct tree item click (args: pr, owner, repo) and
  // context menu invocation (args: PROverviewItem)
  context.subscriptions.push(
    registerCommand(
      'forgejo.showPrDetails',
      async (prOrItem, owner?, repo?, instanceUrl?) => {
        try {
          let prNumber: number;
          let actualOwner: string;
          let actualRepo: string;
          let actualInstanceUrl: string | undefined;

          if (prOrItem instanceof PROverviewItem) {
            prNumber = prOrItem.pr.number;
            actualOwner = prOrItem.owner;
            actualRepo = prOrItem.repo;
            actualInstanceUrl = prOrItem.instanceUrl;
          } else {
            prNumber = prOrItem.number;
            actualOwner = owner ?? '';
            actualRepo = repo ?? '';
            actualInstanceUrl = instanceUrl;
          }

          await prDetailWebviewProvider.showPRDetails(actualOwner, actualRepo, prNumber, actualInstanceUrl);
        } catch (error) {
          console.error('[Forgejo] Error opening PR details:', error);
          void vscode.window.showErrorMessage(
            `Failed to open PR details: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }
    )
  );

  // Handles both TreeItem.command (args: pr, owner, repo) and
  // context menu invocation (args: PRTreeItem)
  context.subscriptions.push(
    registerCommand(
      'forgejo.mergePr',
      (prOrItem, owner?, repo?, instanceUrl?) => {
        let pr: PullRequestListItem;
        let actualOwner: string;
        let actualRepo: string;
        let actualInstanceUrl: string | undefined;
        let repositoryConfig: ForgejoConfig | undefined;

        if (prOrItem instanceof PRTreeItem) {
          pr = prOrItem.pr;
          actualOwner = prOrItem.owner;
          actualRepo = prOrItem.repo;
          actualInstanceUrl = prOrItem.config?.instanceUrl;
          repositoryConfig = prOrItem.config;
        } else {
          pr = prOrItem;
          actualOwner = owner ?? '';
          actualRepo = repo ?? '';
          actualInstanceUrl = instanceUrl;
        }

        return mergePrCommand(pr, actualOwner, actualRepo, prTreeProvider, repositoryConfig, actualInstanceUrl);
      }
    )
  );

  // Handles both TreeItem.command (args: pr, owner, repo) and
  // context menu invocation (args: PRTreeItem)
  context.subscriptions.push(
    registerCommand(
      'forgejo.closePr',
      async (prOrItem, owner?, repo?, instanceUrl?) => {
        let pr: PullRequestListItem;
        let actualOwner: string;
        let actualRepo: string;
        let actualInstanceUrl: string | undefined;
        let repositoryConfig: ForgejoConfig | undefined;

        if (prOrItem instanceof PRTreeItem) {
          pr = prOrItem.pr;
          actualOwner = prOrItem.owner;
          actualRepo = prOrItem.repo;
          actualInstanceUrl = prOrItem.config?.instanceUrl;
          repositoryConfig = prOrItem.config;
        } else {
          pr = prOrItem;
          actualOwner = owner ?? '';
          actualRepo = repo ?? '';
          actualInstanceUrl = instanceUrl;
        }

        await closePrCommand(pr, actualOwner, actualRepo, prTreeProvider, repositoryConfig, actualInstanceUrl);
      }
    )
  );

  // Register Actions commands
  context.subscriptions.push(
    registerCommand(
      'forgejo.openActionInBrowser',
      (item: WorkflowRunTreeItem | JobTreeItem | StepTreeItem) => {
        if (item instanceof WorkflowRunTreeItem) {
          if (item.jobs.length === 0) {
            void vscode.window.showInformationMessage('No workflow run URL available');
            return;
          }

          const run = item.jobs[0];
          if (run.url) {
            void vscode.env.openExternal(vscode.Uri.parse(run.url));
          } else {
            void vscode.window.showInformationMessage('No workflow run URL available');
          }
        } else if (item instanceof JobTreeItem) {
          if (item.job.url) {
            void vscode.env.openExternal(vscode.Uri.parse(item.job.url));
          } else {
            void vscode.window.showInformationMessage('No job URL available');
          }
        } else if (item instanceof StepTreeItem) {
          // Steps don't have their own URL; open the parent job page
          void getForgejoConfigFor(item.owner, item.repo, item.instanceUrl).then(config => {
            if (config) {
              const jobTarget = item.jobRef.jobHtmlUrl
                ?? (item.jobRef.jobId !== undefined
                  ? `${config.instanceUrl}/${item.owner}/${item.repo}/actions/runs/${item.runNumber}/jobs/${item.jobRef.jobId}`
                  : item.jobRef.jobIndex !== undefined
                    ? `${config.instanceUrl}/${item.owner}/${item.repo}/actions/runs/${item.runNumber}/jobs/${item.jobRef.jobIndex}`
                    : null);

              if (!jobTarget) {
                void vscode.window.showErrorMessage('Cannot open job page: missing job reference');
                return;
              }

              const url = jobTarget;
              void vscode.env.openExternal(vscode.Uri.parse(url));
            }
          });
        }
      }
    )
  );

  context.subscriptions.push(
    registerCommand(
      'forgejo.openActionInBrowserDirect',
      (url: string) => {
        if (url) {
          void vscode.env.openExternal(vscode.Uri.parse(url));
        }
      }
    )
  );

  context.subscriptions.push(
    registerCommand(
      'forgejo.rerunAction',
      async (item: WorkflowRunTreeItem | JobTreeItem) => {
        // Get the run data from either a run item or a job item
        let run: WorkflowRunListItem | undefined;
        if (item instanceof WorkflowRunTreeItem) {
          run = item.jobs.length > 0 ? item.jobs[0] : undefined;
        } else {
          run = item.job;
        }
        if (!run) {
          void vscode.window.showErrorMessage('Cannot re-run this workflow: no run information available.');
          return;
        }

        try {
          const confirm = await vscode.window.showWarningMessage(
            `Re-run workflow "${run.name}"?`,
            { modal: true },
            'Re-run'
          );

          if (confirm !== 'Re-run') {
            return;
          }

          const config = await getForgejoConfigFor(item.owner, item.repo, item.instanceUrl);
          if (!config) {
            void vscode.window.showErrorMessage('Forgejo configuration not found');
            return;
          }

          const client = new ForgejoClient(config.instanceUrl, config.token);
          await client.rerunWorkflowByNumber(item.owner, item.repo, workflowRunNumberForItem(item));

          void vscode.window.showInformationMessage('Workflow re-run triggered!');
          actionsTreeProvider.refresh();
        } catch (error) {
          console.error('[Forgejo] Error re-running workflow:', error);
          void vscode.window.showErrorMessage(
            `Failed to re-run workflow: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }
    )
  );

  context.subscriptions.push(
    registerCommand('forgejo.openWorkflowFile', async (item: WorkflowRunTreeItem | JobTreeItem) => {
      const workflowName = item instanceof WorkflowRunTreeItem
        ? item.jobs[0]?.workflow_id
        : item.job.workflow_id;

      if (!workflowName) {
        void vscode.window.showInformationMessage('No workflow file is associated with this action row.');
        return;
      }

      await openWorkflowFileForRepository({
        workflowName,
        owner: item.owner,
        repo: item.repo,
        instanceUrl: item.instanceUrl
      });
    })
  );

  context.subscriptions.push(
    registerCommand('forgejo.viewCIStatusLogs', async (status, owner, repo, instanceUrl) => {
      await viewCIStatusLogs({ status, owner, repo, instanceUrl });
    })
  );

  context.subscriptions.push(
    registerCommand('forgejo.openCIWorkflowFile', async (status, owner, repo, instanceUrl) => {
      await openWorkflowFileForCIStatus({ status, owner, repo, instanceUrl });
    })
  );

  // Register Action details viewer command
  // Handles both direct invocation (args: run, owner, repo) and
  // context menu invocation (args: WorkflowRunTreeItem or JobTreeItem)
  context.subscriptions.push(
    registerCommand(
      'forgejo.showActionDetails',
      async (runOrItem, owner?, repo?, instanceUrl?) => {
        try {
          let run: WorkflowRunListItem;
          let actualOwner: string;
          let actualRepo: string;
          let actualInstanceUrl: string | undefined;

          if (runOrItem instanceof WorkflowRunTreeItem) {
            // jobs is guaranteed non-empty — the constructor accesses jobs[0]
            run = runOrItem.jobs[0];
            actualOwner = runOrItem.owner;
            actualRepo = runOrItem.repo;
            actualInstanceUrl = runOrItem.instanceUrl;
          } else if (runOrItem instanceof JobTreeItem) {
            run = runOrItem.job;
            actualOwner = runOrItem.owner;
            actualRepo = runOrItem.repo;
            actualInstanceUrl = runOrItem.instanceUrl;
          } else {
            run = runOrItem;
            actualOwner = owner ?? '';
            actualRepo = repo ?? '';
            actualInstanceUrl = instanceUrl;
          }

          await actionDetailWebviewProvider.showActionDetails(actualOwner, actualRepo, run, actualInstanceUrl);
        } catch (error) {
          console.error('[Forgejo] Error opening Action details:', error);
          void vscode.window.showErrorMessage(
            `Failed to open Action details: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }
    )
  );

  // Register action log viewer command
  // Handles context menu invocation where first arg is a tree item
  // (WorkflowRunTreeItem, JobTreeItem, or StepTreeItem)
  context.subscriptions.push(
    registerCommand(
      'forgejo.viewActionLogs',
      async (runOrItem, job?, owner?, repo?) => {
        try {
          let runNumber: number;
          let jobRef: { jobId?: number; jobHtmlUrl?: string; jobIndex?: number };
          let actualOwner: string;
          let actualRepo: string;
          let actualInstanceUrl: string | undefined;
          let jobName: string;

          if (runOrItem instanceof JobTreeItem) {
            runNumber = runOrItem.job.run_number;
            jobRef = runOrItem.jobRef;
            actualOwner = runOrItem.owner;
            actualRepo = runOrItem.repo;
            actualInstanceUrl = runOrItem.instanceUrl;
            jobName = runOrItem.job.name;
          } else if (runOrItem instanceof WorkflowRunTreeItem) {
            // jobs is guaranteed non-empty — the constructor accesses jobs[0]
            runNumber = runOrItem.runNumber;
            const firstJob = runOrItem.jobs[0];
            jobRef = {
              jobId: firstJob.id,
              jobHtmlUrl: firstJob.html_url,
              jobIndex: 0
            };
            actualOwner = runOrItem.owner;
            actualRepo = runOrItem.repo;
            actualInstanceUrl = runOrItem.instanceUrl;
            jobName = firstJob.name;
          } else if (runOrItem instanceof StepTreeItem) {
            runNumber = runOrItem.runNumber;
            jobRef = runOrItem.jobRef;
            actualOwner = runOrItem.owner;
            actualRepo = runOrItem.repo;
            actualInstanceUrl = runOrItem.instanceUrl;
            jobName = runOrItem.step.summary;
          } else {
            // Legacy direct invocation with explicit args
            runNumber = runOrItem.run_number;
            jobRef = {
              jobId: job?.id,
              jobHtmlUrl: job?.html_url
            };
            actualOwner = owner ?? '';
            actualRepo = repo ?? '';
            actualInstanceUrl = undefined;
            jobName = job?.name ?? 'job';
          }

          const config = await getForgejoConfigFor(actualOwner, actualRepo, actualInstanceUrl);
          if (!config) {
            void vscode.window.showErrorMessage('Forgejo configuration not found');
            return;
          }

          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Fetching logs for ${jobName}...`,
              cancellable: false
            },
            async () => {
              const client = new ForgejoClient(config.instanceUrl, config.token);
              const logs = await client.getWorkflowLogs(actualOwner, actualRepo, runNumber, jobRef);
              const doc = await vscode.workspace.openTextDocument({
                content: logs,
                language: 'log'
              });
              await vscode.window.showTextDocument(doc, { preview: true });
            }
          );
        } catch (error) {
          console.error('[Forgejo] Error fetching logs:', error);
          const is404 = error instanceof Error && error.message.includes('404');
          const msg = is404
            ? 'Logs not available — private repo action logs are not supported due to auth limitations.'
            : `Failed to fetch logs: ${error instanceof Error ? error.message : 'Unknown error'}`;
          void vscode.window.showErrorMessage(msg);
        }
      }
    )
  );

  // Register step log viewer command (triggered by clicking a step in the tree)
  context.subscriptions.push(
    registerCommand(
      'forgejo.viewStepLogs',
      async (args: StepLogArgs) => {
        try {
          const config = await getForgejoConfigFor(args.owner, args.repo, args.instanceUrl);
          if (!config) {
            void vscode.window.showErrorMessage('Forgejo configuration not found');
            return;
          }

          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Fetching logs for ${args.stepSummary}...`,
              cancellable: false
            },
            async () => {
              const client = new ForgejoClient(config.instanceUrl, config.token);
              const logs = await client.getWorkflowLogs(
                args.owner, args.repo, args.runNumber, args.jobRef
              );

              const doc = await vscode.workspace.openTextDocument({
                content: logs,
                language: 'log'
              });
              await vscode.window.showTextDocument(doc, { preview: true });
            }
          );
        } catch (error) {
          console.error('[Forgejo] Error fetching step logs:', error);
          const is404 = error instanceof Error && error.message.includes('404');
          const msg = is404
            ? 'Logs not available — private repo action logs are not supported due to auth limitations.'
            : `Failed to fetch logs: ${error instanceof Error ? error.message : 'Unknown error'}`;
          void vscode.window.showErrorMessage(msg);
        }
      }
    )
  );

  // Add tree views to subscriptions
  context.subscriptions.push(prTreeView);
  context.subscriptions.push(issueTreeView);
  context.subscriptions.push(actionsTreeView);
  context.subscriptions.push(remoteRepositoryTreeView);

  // Create PR detail webview provider (not registered as WebviewViewProvider since we use WebviewPanel)
  const prDetailWebviewProvider = new PRDetailWebviewProvider(context.extensionUri);

  // Create Issue detail webview provider
  const issueDetailWebviewProvider = new IssueDetailWebviewProvider(context.extensionUri);

  // Create Issue creation webview provider
  const issueCreateWebviewProvider = new IssueCreateWebviewProvider(context.extensionUri, issueTreeProvider);
  registerReferenceLanguageFeatures(context, issueCreateWebviewProvider);

  // Create Action detail webview provider
  const actionDetailWebviewProvider = new ActionDetailWebviewProvider(context.extensionUri);

  // Status bar item showing the active repository's branch/PR/CI status.
  // activate() schedules one debounced, gated, cached initial refresh so the
  // item populates without waiting for a user action; every later refresh
  // goes through that same bounded path (see BranchStatusBarController).
  const branchStatusBarController = new BranchStatusBarController();
  branchStatusBarController.activate(context);
  context.subscriptions.push(
    registerCommand('forgejo.statusBar.action', () => branchStatusBarController.handleClick())
  );

  // Register Issue details viewer command
  // Handles both direct tree item click (args: issue, owner, repo) and
  // context menu invocation (args: IssueTreeItem)
  context.subscriptions.push(
    registerCommand(
      'forgejo.showIssueDetails',
      async (issueOrItem, owner?, repo?, instanceUrl?) => {
        try {
          let issueNumber: number;
          let actualOwner: string;
          let actualRepo: string;
          let actualInstanceUrl: string | undefined;

          if (issueOrItem instanceof IssueTreeItem) {
            issueNumber = issueOrItem.issue.number;
            actualOwner = issueOrItem.owner;
            actualRepo = issueOrItem.repo;
            actualInstanceUrl = issueOrItem.instanceUrl;
          } else {
            issueNumber = issueOrItem.number;
            actualOwner = owner ?? '';
            actualRepo = repo ?? '';
            actualInstanceUrl = instanceUrl;
          }

          await issueDetailWebviewProvider.showIssueDetails(actualOwner, actualRepo, issueNumber, actualInstanceUrl);
        } catch (error) {
          console.error('[Forgejo] Error opening Issue details:', error);
          void vscode.window.showErrorMessage(
            `Failed to open Issue details: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }
    )
  );

  context.subscriptions.push(
    registerCommand('forgejo.startWorkOnIssue', startWorkOnIssueCommand)
  );

  // Register open issue in browser from context menu command
  context.subscriptions.push(
    registerCommand(
      'forgejo.openIssueInBrowserFromContext',
      (issueItem) => {
        if (issueItem.htmlUrl) {
          void vscode.env.openExternal(vscode.Uri.parse(issueItem.htmlUrl));
        }
      }
    )
  );

  // Register release commands
  context.subscriptions.push(
    registerCommand('forgejo.refreshReleases', () => {
      releaseTreeProvider.refresh();
      void vscode.window.showInformationMessage('Releases refreshed');
    })
  );
  context.subscriptions.push(registerCommand(
    'forgejo.loadMoreReleases', item => releaseTreeProvider.loadMoreReleases(item)
  ));

  context.subscriptions.push(
    registerCommand('forgejo.openReleaseInBrowser', (url: string) => {
      if (url) {
        void vscode.env.openExternal(vscode.Uri.parse(url));
      }
    })
  );

  context.subscriptions.push(
    registerCommand('forgejo.createRelease', (target) => createReleaseCommand(releaseTreeProvider, target))
  );

  // Add releases tree view to subscriptions
  context.subscriptions.push(releaseTreeView);

  const gitExtension = await activateGitExtension();

  context.subscriptions.push(
    registerCommand('forgejo.publishToForgejo', async () => {
      const git = gitExtension?.enabled ? gitExtension.getAPI(1) : undefined;
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length === 0 || !git) {
        void vscode.window.showErrorMessage('No workspace folder open.');
        return;
      }
      let workspaceUri: vscode.Uri;
      if (folders.length === 1) {
        workspaceUri = folders[0].uri;
      } else {
        const picked = await vscode.window.showQuickPick(
          folders.map(f => ({ label: f.name, description: f.uri.fsPath, uri: f.uri })),
          { placeHolder: 'Select a workspace folder to publish' }
        );
        if (!picked) return;
        workspaceUri = picked.uri;
      }
      await publishRepositoryFromWorkspace(git, workspaceUri);
    })
  );

  async function registerGitProviders() {
    if (!gitExtension?.enabled) return;
    const git = gitExtension.getAPI(1);

    let providerDisposables: vscode.Disposable[] = [];
    let providerRefreshGeneration = 0;

    refreshRemoteSourceProviders = async () => {
      const generation = ++providerRefreshGeneration;
      const instances = await getAllInstances();
      if (generation !== providerRefreshGeneration) return;
      const replacements: vscode.Disposable[] = [];
      for (const instance of instances) {
        replacements.push(git.registerRemoteSourceProvider(new ForgejoRemoteSourceProvider(instance)));
      }
      if (generation !== providerRefreshGeneration) {
        for (const disposable of replacements) disposable.dispose();
        return;
      }
      const previous = providerDisposables;
      providerDisposables = replacements;
      for (const disposable of previous) disposable.dispose();
      logInfo(`Remote source providers registered for ${instances.length} instance(s)`);
    };

    await refreshRemoteSourceProviders();

    const configListener = vscode.workspace.onDidChangeConfiguration(async e => {
      if (e.affectsConfiguration('forgejo.instances')) {
        await refreshRemoteSourceProviders();
      }
    });

    context.subscriptions.push(configListener, {
      dispose: () => { for (const d of providerDisposables) d.dispose(); }
    });
  }

  function registerPublisher() {
    if (!gitExtension?.enabled) return;
    const git = gitExtension.getAPI(1);
    context.subscriptions.push(git.registerRemoteSourcePublisher(createRemoteSourcePublisher()));
  }

  async function registerGitIntegrations() {
    await registerGitProviders();
    registerPublisher();
  }

  if (gitExtension?.enabled) {
    await registerGitIntegrations();
  } else if (gitExtension) {
    const listener = gitExtension.onDidChangeEnablement(async enabled => {
      if (enabled) {
        await registerGitIntegrations();
        listener.dispose();
      }
    });
    context.subscriptions.push(listener);
  }

  const authenticationProvider = new ForgejoAuthenticationProvider();
  context.subscriptions.push(
    authenticationProvider,
    vscode.authentication.registerAuthenticationProvider(
      'forgejo',
      'Forgejo',
      authenticationProvider,
      { supportsMultipleAccounts: true }
    )
  );

  // Add logger to subscriptions for proper cleanup
  context.subscriptions.push(logger);

  logInfo('Extension activation complete');
}

export function deactivate() {
  logInfo('Extension is now deactivated');
}
