import * as vscode from 'vscode';
import { WorkflowRunTreeItem, JobTreeItem, StepTreeItem, ActionsTreeProvider, ScrapedStep, ActionLoadMoreItem, workflowRunNumberForItem } from '../../providers/actionsTreeProvider';
import { ForgejoClient } from '../../api/forgejoClient';
import { getForgejoConfig, getForgejoRepositoryConfigs } from '../../utils/config';
import { WorkflowRunListItem } from '../../models/action';
import {
  mockWorkflowRunSuccess,
  mockWorkflowRunFailed,
  mockWorkflowRunInProgress,
  mockWorkflowRunCancelled,
  mockWorkflowRunSuccessJob2,
  mockActionTasksResponse,
  mockEmptyActionTasksResponse,
  mockScrapedStepCheckout,
  mockScrapedStepBuild,
  mockScrapedStepTest,
  mockScrapedStepFailed,
  mockScrapedStepRunning,
  mockScrapedSteps
} from '../fixtures/workflowRuns';

// Mock dependencies
jest.mock('../../api/forgejoClient');
jest.mock('../../utils/config');

describe('ActionsTreeProvider', () => {
  let provider: ActionsTreeProvider;
  let mockClient: jest.Mocked<ForgejoClient>;
  let mockGetForgejoConfig: jest.MockedFunction<typeof getForgejoConfig>;
  let mockGetForgejoRepositoryConfigs: jest.MockedFunction<typeof getForgejoRepositoryConfigs>;

  const mockConfig = {
    instanceUrl: 'https://git.example.com',
    owner: 'test-owner',
    repo: 'test-repo',
    token: 'test-token'
  };

  beforeEach(() => {
    mockClient = {
      getWorkflowRuns: jest.fn(),
      getWorkflowRunsPage: jest.fn(),
      getJobSteps: jest.fn()
    } as any;

    mockGetForgejoConfig = getForgejoConfig as jest.MockedFunction<typeof getForgejoConfig>;
    mockGetForgejoRepositoryConfigs = getForgejoRepositoryConfigs as jest.MockedFunction<typeof getForgejoRepositoryConfigs>;
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    mockGetForgejoRepositoryConfigs.mockResolvedValue([{ ...mockConfig, label: 'test-owner/test-repo' }]);

    (ForgejoClient as jest.MockedClass<typeof ForgejoClient>).mockImplementation(() => mockClient);

    // Default: return empty so constructor's refresh doesn't blow up
    mockClient.getWorkflowRunsPage.mockResolvedValue({
      items: [],
      page: 1,
      limit: 50,
      hasMore: false
    });

    provider = new ActionsTreeProvider();

    jest.clearAllMocks();
  });

  describe('WorkflowRunTreeItem', () => {
    const owner = 'test-owner';
    const repo = 'test-repo';

    test('should create with display_title and run number as label', () => {
      const item = new WorkflowRunTreeItem(42, [mockWorkflowRunSuccess], owner, repo);
      expect(item.label).toBe('Add new feature (#42)');
    });

    test('should show branch and workflow file in description', () => {
      const item = new WorkflowRunTreeItem(42, [mockWorkflowRunSuccess], owner, repo);
      expect(item.description).toBe('main · ci.yml');
    });

    test('should set tooltip with workflow info', () => {
      const item = new WorkflowRunTreeItem(42, [mockWorkflowRunSuccess], owner, repo);
      expect(item.tooltip).toContain('Workflow: ci.yml');
      expect(item.tooltip).toContain('Branch: main');
      expect(item.tooltip).toContain('Commit: abc123def456');
      expect(item.tooltip).toContain('Trigger: push');
      expect(item.tooltip).toContain('Add new feature');
      expect(item.tooltip).toContain('Jobs: 1');
    });

    test('should set contextValue to workflowRun', () => {
      const item = new WorkflowRunTreeItem(42, [mockWorkflowRunSuccess], owner, repo);
      expect(item.contextValue).toBe('workflowRun');
    });

    test('should mark failed workflow runs for failure-specific commands', () => {
      const item = new WorkflowRunTreeItem(43, [mockWorkflowRunFailed], owner, repo);
      expect(item.contextValue).toBe('workflowRunFailed');
    });

    test('should be Collapsed (not Expanded)', () => {
      const item = new WorkflowRunTreeItem(42, [mockWorkflowRunSuccess], owner, repo);
      expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed);
    });

    test('should not have a command (click expands/collapses)', () => {
      const item = new WorkflowRunTreeItem(42, [mockWorkflowRunSuccess], owner, repo);
      expect(item.command).toBeUndefined();
    });

    test('should set stable id with repository identity', () => {
      const item = new WorkflowRunTreeItem(42, [mockWorkflowRunSuccess], owner, repo, 'https://git.example.com');
      expect(item.id).toBe('workflow-run/https%3A%2F%2Fgit.example.com/test-owner/test-repo/42');
    });

    test('should show running icon when any job is in_progress', () => {
      const item = new WorkflowRunTreeItem(44, [mockWorkflowRunInProgress, mockWorkflowRunSuccess], owner, repo);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('sync~spin');
    });

    test('should show running icon when any job is queued', () => {
      const queuedJob: WorkflowRunListItem = { ...mockWorkflowRunSuccess, status: 'queued' };
      const item = new WorkflowRunTreeItem(42, [queuedJob], owner, repo);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('sync~spin');
    });

    test('should show running icon when any job is waiting', () => {
      const waitingJob: WorkflowRunListItem = { ...mockWorkflowRunSuccess, status: 'waiting' };
      const item = new WorkflowRunTreeItem(42, [waitingJob], owner, repo);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('sync~spin');
    });

    test('should show failure icon when any job failed', () => {
      const item = new WorkflowRunTreeItem(43, [mockWorkflowRunFailed, mockWorkflowRunSuccess], owner, repo);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('error');
    });

    test('should show success icon when all jobs succeeded', () => {
      const item = new WorkflowRunTreeItem(42, [mockWorkflowRunSuccess], owner, repo);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('pass');
    });

    test('should show cancelled icon when any job cancelled and none running/failed', () => {
      const item = new WorkflowRunTreeItem(45, [mockWorkflowRunCancelled, mockWorkflowRunSuccess], owner, repo);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('circle-slash');
    });

    test('should show default icon for unknown statuses', () => {
      const unknownJob: WorkflowRunListItem = { ...mockWorkflowRunSuccess, status: 'unknown' as any };
      const item = new WorkflowRunTreeItem(42, [unknownJob], owner, repo);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('circle-outline');
    });

    test('should show correct job count for multi-job runs', () => {
      const item = new WorkflowRunTreeItem(42, [mockWorkflowRunSuccess, mockWorkflowRunSuccessJob2], owner, repo);
      expect(item.tooltip).toContain('Jobs: 2');
    });

    test('should store owner and repo', () => {
      const item = new WorkflowRunTreeItem(42, [mockWorkflowRunSuccess], owner, repo);
      expect(item.owner).toBe(owner);
      expect(item.repo).toBe(repo);
    });

    test('should handle empty job list without crashing', () => {
      const item = new WorkflowRunTreeItem(42, [], owner, repo);
      expect(item.label).toBe('Workflow Run #42');
      expect(item.description).toBe('No jobs');
      expect(item.tooltip).toContain('Workflow: #42');
      expect(item.tooltip).toContain('Jobs: 0');
    });

    test('should show neutral icon (not pass) for empty job list', () => {
      const item = new WorkflowRunTreeItem(42, [], owner, repo);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('circle-outline');
    });
  });

  describe('JobTreeItem', () => {
    const owner = 'test-owner';
    const repo = 'test-repo';

    test('should create with job name as label', () => {
      const item = new JobTreeItem(mockWorkflowRunSuccess, 0, owner, repo);
      expect(item.label).toBe('CI');
    });

    test('should show status in description', () => {
      const item = new JobTreeItem(mockWorkflowRunSuccess, 0, owner, repo);
      expect(item.description).toBe('success');
    });

    test('should set tooltip with job info including run number', () => {
      const item = new JobTreeItem(mockWorkflowRunSuccess, 0, owner, repo);
      expect(item.tooltip).toContain('Job: CI');
      expect(item.tooltip).toContain('Status: success');
      expect(item.tooltip).toContain('Run: #42');
      expect(item.tooltip).toContain('Job ID: 123');
    });

    test('should be Collapsed (has step children)', () => {
      const item = new JobTreeItem(mockWorkflowRunSuccess, 0, owner, repo);
      expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed);
    });

    test('should not have a command (click expands to show steps)', () => {
      const item = new JobTreeItem(mockWorkflowRunSuccess, 0, owner, repo);
      expect(item.command).toBeUndefined();
    });

    test('should open logs directly for failed jobs', () => {
      const item = new JobTreeItem(mockWorkflowRunFailed, 0, owner, repo);
      expect(item.contextValue).toBe('workflowJobFailed');
      expect(item.command).toEqual({
        command: 'forgejo.viewActionLogs',
        title: 'View Logs',
        arguments: [item]
      });
    });

    test('should set correct icon for success', () => {
      const item = new JobTreeItem(mockWorkflowRunSuccess, 0, owner, repo);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('pass');
    });

    test('should set correct icon for failure', () => {
      const item = new JobTreeItem(mockWorkflowRunFailed, 0, owner, repo);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('error');
    });

    test('should set correct icon for in_progress', () => {
      const item = new JobTreeItem(mockWorkflowRunInProgress, 0, owner, repo);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('sync~spin');
    });

    test('should set correct icon for cancelled', () => {
      const item = new JobTreeItem(mockWorkflowRunCancelled, 0, owner, repo);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('circle-slash');
    });

    test('should set correct icon for skipped', () => {
      const skippedJob: WorkflowRunListItem = { ...mockWorkflowRunSuccess, status: 'skipped' };
      const item = new JobTreeItem(skippedJob, 0, owner, repo);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('debug-step-over');
    });

    test('should set default icon for unknown status', () => {
      const unknownJob: WorkflowRunListItem = { ...mockWorkflowRunSuccess, status: 'unknown' as any };
      const item = new JobTreeItem(unknownJob, 0, owner, repo);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('circle-outline');
    });

    test('should set contextValue to workflowJob', () => {
      const item = new JobTreeItem(mockWorkflowRunSuccess, 0, owner, repo);
      expect(item.contextValue).toBe('workflowJob');
    });

    test('should store job and jobIndex', () => {
      const item = new JobTreeItem(mockWorkflowRunSuccess, 2, owner, repo);
      expect(item.job).toBe(mockWorkflowRunSuccess);
      expect(item.jobIndex).toBe(2);
      expect(item.jobRef).toEqual({
        jobId: 123,
        jobName: 'CI',
        jobHtmlUrl: undefined,
      });
    });

    test('should initialize with no cached steps', () => {
      const item = new JobTreeItem(mockWorkflowRunSuccess, 0, owner, repo);
      expect(item.fetchedSteps).toBeUndefined();
      expect(item.fetchError).toBeUndefined();
    });

    test('should set stable id with repository and job identity', () => {
      const item = new JobTreeItem(mockWorkflowRunSuccess, 0, owner, repo, 'https://git.example.com');
      expect(item.id).toBe('workflow-job/https%3A%2F%2Fgit.example.com/test-owner/test-repo/42/123');
    });
  });

  describe('workflowRunNumberForItem', () => {
    test('uses stable run identity instead of a distinct task/job id', () => {
      const job = { ...mockWorkflowRunSuccess, id: 9001, run_number: 42 };

      expect(workflowRunNumberForItem(new JobTreeItem(job, 0, 'owner', 'repo'))).toBe(42);
      expect(workflowRunNumberForItem(new WorkflowRunTreeItem(42, [job], 'owner', 'repo'))).toBe(42);
      expect(job.id).not.toBe(job.run_number);
    });
  });

  describe('StepTreeItem', () => {
    const owner = 'test-owner';
    const repo = 'test-repo';

    test('should create with step summary as label', () => {
      const item = new StepTreeItem(mockScrapedStepCheckout, { jobId: 123, jobIndex: 0 }, 42, owner, repo);
      expect(item.label).toBe('Checkout');
    });

    test('should show duration in description', () => {
      const item = new StepTreeItem(mockScrapedStepCheckout, { jobId: 123, jobIndex: 0 }, 42, owner, repo);
      expect(item.description).toBe('5s');
    });

    test('should have undefined description when no duration', () => {
      const item = new StepTreeItem(mockScrapedStepRunning, { jobId: 123, jobIndex: 0 }, 42, owner, repo);
      expect(item.description).toBeUndefined();
    });

    test('should set tooltip with step info', () => {
      const item = new StepTreeItem(mockScrapedStepCheckout, { jobId: 123, jobIndex: 0 }, 42, owner, repo);
      expect(item.tooltip).toContain('Step: Checkout');
      expect(item.tooltip).toContain('Status: success');
      expect(item.tooltip).toContain('Duration: 5s');
    });

    test('should omit duration from tooltip when empty', () => {
      const item = new StepTreeItem(mockScrapedStepRunning, { jobId: 123, jobIndex: 0 }, 42, owner, repo);
      expect(item.tooltip).not.toContain('Duration:');
    });

    test('should be a leaf node (None collapsible state)', () => {
      const item = new StepTreeItem(mockScrapedStepCheckout, { jobId: 123, jobIndex: 0 }, 42, owner, repo);
      expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
    });

    test('should set contextValue to workflowStep', () => {
      const item = new StepTreeItem(mockScrapedStepCheckout, { jobId: 123, jobIndex: 0 }, 42, owner, repo);
      expect(item.contextValue).toBe('workflowStep');
    });

    test('should set command to forgejo.viewStepLogs with plain serializable args', () => {
      const item = new StepTreeItem(mockScrapedStepCheckout, { jobId: 123, jobIndex: 0 }, 42, owner, repo);
      expect(item.command).toBeDefined();
      expect(item.command!.command).toBe('forgejo.viewStepLogs');
      const args = item.command!.arguments![0];
      // Must be a plain object, not the tree item itself (circular reference guard)
      expect(args).not.toBe(item);
      expect(args).toEqual({
        stepSummary: 'Checkout',
        owner,
        repo,
        runNumber: 42,
        jobRef: { jobId: 123, jobIndex: 0 }
      });
    });

    test('should not create circular JSON in command arguments', () => {
      const item = new StepTreeItem(mockScrapedStepCheckout, { jobId: 123, jobIndex: 1 }, 55, owner, repo);
      // JSON.stringify must not throw "Converting circular structure to JSON"
      expect(() => JSON.stringify(item.command!.arguments)).not.toThrow();
    });

    test('should set correct icon for success', () => {
      const item = new StepTreeItem(mockScrapedStepCheckout, { jobId: 123, jobIndex: 0 }, 42, owner, repo);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('pass');
    });

    test('should set correct icon for failure', () => {
      const item = new StepTreeItem(mockScrapedStepFailed, { jobId: 123, jobIndex: 0 }, 42, owner, repo);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('error');
    });

    test('should set correct icon for running (from web scraping)', () => {
      const item = new StepTreeItem(mockScrapedStepRunning, { jobId: 123, jobIndex: 0 }, 42, owner, repo);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('sync~spin');
    });

    test('should set correct icon for in_progress', () => {
      const inProgressStep: ScrapedStep = { summary: 'Deploy', duration: '', status: 'in_progress' };
      const item = new StepTreeItem(inProgressStep, { jobId: 123, jobIndex: 0 }, 42, owner, repo);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('sync~spin');
    });

    test('should store jobRef, runNumber, owner, repo', () => {
      const item = new StepTreeItem(mockScrapedStepCheckout, { jobId: 123, jobIndex: 2 }, 42, owner, repo);
      expect(item.step).toBe(mockScrapedStepCheckout);
      expect(item.jobRef).toEqual({ jobId: 123, jobIndex: 2 });
      expect(item.runNumber).toBe(42);
      expect(item.owner).toBe(owner);
      expect(item.repo).toBe(repo);
    });

    test('should set stable id with repository, job, and step identity', () => {
      const item = new StepTreeItem(
        mockScrapedStepCheckout,
        { jobId: 123, jobIndex: 2 },
        42,
        owner,
        repo,
        'https://git.example.com',
        3
      );
      expect(item.id).toBe('workflow-step/https%3A%2F%2Fgit.example.com/test-owner/test-repo/42/123/3/Checkout');
    });
  });

  describe('Provider getChildren - Root level', () => {
    test('groups multiple detected repositories by owner and repo at the root', async () => {
      mockGetForgejoRepositoryConfigs.mockResolvedValue([
        { ...mockConfig, owner: 'maxking', repo: 'forgejo-vscode', label: 'maxking/forgejo-vscode' },
        { ...mockConfig, owner: 'forgejo', repo: 'forgejo', label: 'forgejo/forgejo' }
      ]);

      const children = await provider.getChildren();

      expect(children.map(child => String((child as vscode.TreeItem).label))).toEqual([
        'maxking/forgejo-vscode',
        'forgejo/forgejo'
      ]);
      expect((children[0] as vscode.TreeItem).id).toBe('action-repository/https%3A%2F%2Fgit.example.com/maxking/forgejo-vscode/');
      expect((children[1] as vscode.TreeItem).id).toBe('action-repository/https%3A%2F%2Fgit.example.com/forgejo/forgejo/');
      expect(mockClient.getWorkflowRunsPage).not.toHaveBeenCalled();
    });

    test('should return error message when no config', async () => {
      mockGetForgejoConfig.mockResolvedValue(null as any);
      mockGetForgejoRepositoryConfigs.mockResolvedValue([]);
      mockClient.getWorkflowRunsPage.mockResolvedValue({ items: [], page: 1, limit: 50, hasMore: false });

      const children = await provider.getChildren();

      expect(children).toHaveLength(1);
      const msg = children[0] as any;
      expect(msg.label).toBe('No Forgejo configuration found. Please configure instance URL or open a git repository.');
      expect(msg.contextValue).toBe('error');
    });

    test('should return empty message when no workflow runs', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockClient.getWorkflowRunsPage.mockResolvedValue({ items: [], page: 1, limit: 50, hasMore: false });

      const children = await provider.getChildren();

      expect(children).toHaveLength(1);
      const msg = children[0] as any;
      expect(msg.label).toBe('No workflow runs found');
      expect(msg.contextValue).toBe('info');
    });

    test('should scope empty workflow messages by repository', async () => {
      mockGetForgejoRepositoryConfigs.mockResolvedValue([
        { ...mockConfig, owner: 'maxking', repo: 'forgejo-vscode', label: 'maxking/forgejo-vscode' },
        { ...mockConfig, owner: 'forgejo', repo: 'forgejo', label: 'forgejo/forgejo' }
      ]);
      mockClient.getWorkflowRunsPage.mockResolvedValue({ items: [], page: 1, limit: 50, hasMore: false });

      const repositories = await provider.getChildren();
      const firstMessages = await provider.getChildren(repositories[0] as any);
      const secondMessages = await provider.getChildren(repositories[1] as any);

      expect((firstMessages[0] as vscode.TreeItem).label).toBe('No workflow runs found');
      expect((secondMessages[0] as vscode.TreeItem).label).toBe('No workflow runs found');
      expect((firstMessages[0] as vscode.TreeItem).id).not.toBe((secondMessages[0] as vscode.TreeItem).id);
    });

    test('should group jobs by run_number into WorkflowRunTreeItems', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockClient.getWorkflowRunsPage.mockResolvedValue({ items: mockActionTasksResponse.workflow_runs, page: 1, limit: 50, hasMore: false });

      const children = await provider.getChildren();

      // mockActionTasksResponse has 4 runs with different run_numbers (42, 43, 44, 45)
      expect(children).toHaveLength(4);
      children.forEach(child => {
        expect(child).toBeInstanceOf(WorkflowRunTreeItem);
      });
    });

    test('should sort runs by run_number descending (newest first)', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockClient.getWorkflowRunsPage.mockResolvedValue({ items: mockActionTasksResponse.workflow_runs, page: 1, limit: 50, hasMore: false });

      const children = await provider.getChildren();

      // run_numbers: 45, 44, 43, 42 (descending)
      expect((children[0] as WorkflowRunTreeItem).runNumber).toBe(45);
      expect((children[1] as WorkflowRunTreeItem).runNumber).toBe(44);
      expect((children[2] as WorkflowRunTreeItem).runNumber).toBe(43);
      expect((children[3] as WorkflowRunTreeItem).runNumber).toBe(42);
    });

    test('should fetch only the first workflow run page on initial render', async () => {
      const pageRuns = Array.from({ length: 50 }, (_, index) => ({
        ...mockWorkflowRunSuccess,
        id: index + 1,
        run_number: index + 1
      }));
      mockClient.getWorkflowRunsPage.mockResolvedValue({ items: pageRuns, page: 1, limit: 50, hasMore: true });

      const children = await provider.getChildren();

      expect(mockClient.getWorkflowRunsPage).toHaveBeenCalledTimes(1);
      expect(mockClient.getWorkflowRunsPage).toHaveBeenCalledWith('test-owner', 'test-repo', 1, 50);
      expect(children).toHaveLength(51);
      expect(children[50]).toBeInstanceOf(ActionLoadMoreItem);
    });

    test('should load the next workflow run page through the load more item', async () => {
      mockClient.getWorkflowRunsPage
        .mockResolvedValueOnce({ items: [mockWorkflowRunSuccess], page: 1, limit: 50, hasMore: true })
        .mockResolvedValueOnce({ items: [mockWorkflowRunFailed], page: 2, limit: 50, hasMore: false });

      const initialChildren = await provider.getChildren();
      const loadMoreItem = initialChildren.find(child => child instanceof ActionLoadMoreItem) as ActionLoadMoreItem;

      expect(loadMoreItem).toBeInstanceOf(ActionLoadMoreItem);

      await provider.loadMoreActions(loadMoreItem);
      const loadedChildren = await provider.getChildren();

      expect(mockClient.getWorkflowRunsPage).toHaveBeenCalledTimes(2);
      expect(mockClient.getWorkflowRunsPage).toHaveBeenNthCalledWith(1, 'test-owner', 'test-repo', 1, 50);
      expect(mockClient.getWorkflowRunsPage).toHaveBeenNthCalledWith(2, 'test-owner', 'test-repo', 2, 50);
      expect(loadedChildren.some(child => child instanceof ActionLoadMoreItem)).toBe(false);
      expect(loadedChildren.map(child => child instanceof WorkflowRunTreeItem ? child.runNumber : 0)).toEqual([43, 42]);
    });

    test('should deduplicate overlapping workflow run pages before rendering', async () => {
      mockClient.getWorkflowRunsPage
        .mockResolvedValueOnce({ items: [mockWorkflowRunSuccess], page: 1, limit: 50, hasMore: true })
        .mockResolvedValueOnce({ items: [mockWorkflowRunSuccess, mockWorkflowRunSuccessJob2], page: 2, limit: 50, hasMore: false });

      const initialChildren = await provider.getChildren();
      const loadMoreItem = initialChildren.find(child => child instanceof ActionLoadMoreItem) as ActionLoadMoreItem;

      await provider.loadMoreActions(loadMoreItem);
      const loadedChildren = await provider.getChildren();

      expect(loadedChildren).toHaveLength(1);
      const runItem = loadedChildren[0] as WorkflowRunTreeItem;
      expect(runItem.jobs).toHaveLength(2);
      expect(runItem.jobs.map(job => job.id)).toEqual([123, 127]);
    });

    test('should group multiple jobs with same run_number into one run', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockClient.getWorkflowRunsPage.mockResolvedValue({
        items: [mockWorkflowRunSuccess, mockWorkflowRunSuccessJob2], // both run_number 42
        page: 1,
        limit: 50,
        hasMore: false
      });

      const children = await provider.getChildren();

      expect(children).toHaveLength(1);
      const runItem = children[0] as WorkflowRunTreeItem;
      expect(runItem.runNumber).toBe(42);
      expect(runItem.jobs).toHaveLength(2);
    });

    test('should return error message on fetch failure', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockClient.getWorkflowRunsPage.mockRejectedValue(new Error('Network error'));

      const children = await provider.getChildren();

      expect(children).toHaveLength(1);
      const msg = children[0] as any;
      expect(msg.label).toBe('Network error');
      expect(msg.contextValue).toBe('error');
    });
  });

  describe('Provider getChildren - WorkflowRunTreeItem (jobs from task data)', () => {
    test('should return jobs as JobTreeItem children (no API call needed)', async () => {
      const runItem = new WorkflowRunTreeItem(42, [mockWorkflowRunSuccess, mockWorkflowRunSuccessJob2], 'test-owner', 'test-repo');
      const children = await provider.getChildren(runItem);

      expect(children).toHaveLength(2);
      expect(children[0]).toBeInstanceOf(JobTreeItem);
      expect(children[1]).toBeInstanceOf(JobTreeItem);
      expect((children[0] as JobTreeItem).job.name).toBe('CI');
      expect((children[1] as JobTreeItem).job.name).toBe('deploy');
    });

    test('should assign correct jobIndex to each job', async () => {
      const runItem = new WorkflowRunTreeItem(42, [mockWorkflowRunSuccess, mockWorkflowRunSuccessJob2], 'test-owner', 'test-repo');
      const children = await provider.getChildren(runItem);

      expect((children[0] as JobTreeItem).jobIndex).toBe(0);
      expect((children[1] as JobTreeItem).jobIndex).toBe(1);
    });

    test('should pass owner and repo to JobTreeItem', async () => {
      const runItem = new WorkflowRunTreeItem(42, [mockWorkflowRunSuccess], 'test-owner', 'test-repo');
      const children = await provider.getChildren(runItem);

      expect((children[0] as JobTreeItem).owner).toBe('test-owner');
      expect((children[0] as JobTreeItem).repo).toBe('test-repo');
    });

    test('should return empty array for run with no jobs', async () => {
      const runItem = new WorkflowRunTreeItem(42, [], 'test-owner', 'test-repo');
      const children = await provider.getChildren(runItem);

      expect(children).toHaveLength(0);
    });

    test('should not make any API calls for job children', async () => {
      const runItem = new WorkflowRunTreeItem(42, [mockWorkflowRunSuccess], 'test-owner', 'test-repo');
      await provider.getChildren(runItem);

      // No API calls should be made - jobs come from task data
      expect(mockClient.getJobSteps).not.toHaveBeenCalled();
      expect(mockClient.getWorkflowRunsPage).not.toHaveBeenCalled();
    });
  });

  describe('Provider getChildren - JobTreeItem (lazy step loading via web scraping)', () => {
    test('should fetch steps via getJobSteps when expanding a job', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockClient.getJobSteps.mockResolvedValue(mockScrapedSteps);

      const jobItem = new JobTreeItem(mockWorkflowRunSuccess, 0, 'test-owner', 'test-repo');
      const children = await provider.getChildren(jobItem);

      expect(mockClient.getJobSteps).toHaveBeenCalledWith('test-owner', 'test-repo', 42, {
        jobId: 123,
        jobName: 'CI',
        jobHtmlUrl: undefined,
      });
      expect(children).toHaveLength(3);
      expect(children[0]).toBeInstanceOf(StepTreeItem);
      expect((children[0] as StepTreeItem).step.summary).toBe('Checkout');
      expect((children[1] as StepTreeItem).step.summary).toBe('Build');
      expect((children[2] as StepTreeItem).step.summary).toBe('Test');
    });

    test('should cache fetched steps on the job item', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockClient.getJobSteps.mockResolvedValue(mockScrapedSteps);

      const jobItem = new JobTreeItem(mockWorkflowRunSuccess, 0, 'test-owner', 'test-repo');

      // First call - fetches via web scraping
      await provider.getChildren(jobItem);
      expect(mockClient.getJobSteps).toHaveBeenCalledTimes(1);

      // Second call - uses cache
      jest.clearAllMocks();
      const children2 = await provider.getChildren(jobItem);
      expect(mockClient.getJobSteps).not.toHaveBeenCalled();
      expect(children2).toHaveLength(3);
    });

    test('should return info message when no steps found', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockClient.getJobSteps.mockResolvedValue([]);

      const jobItem = new JobTreeItem(mockWorkflowRunSuccess, 0, 'test-owner', 'test-repo');
      const children = await provider.getChildren(jobItem);

      expect(children).toHaveLength(1);
      expect((children[0] as any).label).toBe('No steps found');
      expect((children[0] as any).contextValue).toBe('info');
    });

    test('should scope empty step messages by job', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockClient.getJobSteps.mockResolvedValue([]);

      const firstJob = new JobTreeItem(mockWorkflowRunSuccess, 0, 'test-owner', 'test-repo', 'https://git.example.com');
      const secondJob = new JobTreeItem(mockWorkflowRunSuccess, 0, 'other-owner', 'other-repo', 'https://git.example.com');
      const firstMessages = await provider.getChildren(firstJob);
      const secondMessages = await provider.getChildren(secondJob);

      expect((firstMessages[0] as vscode.TreeItem).label).toBe('No steps found');
      expect((secondMessages[0] as vscode.TreeItem).label).toBe('No steps found');
      expect((firstMessages[0] as vscode.TreeItem).id).not.toBe((secondMessages[0] as vscode.TreeItem).id);
    });

    test('should return error message when step fetch fails', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockClient.getJobSteps.mockRejectedValue(new Error('Page not found'));

      const jobItem = new JobTreeItem(mockWorkflowRunSuccess, 0, 'test-owner', 'test-repo');
      const children = await provider.getChildren(jobItem);

      expect(children).toHaveLength(1);
      const msg = children[0] as any;
      expect(msg.label).toBe('Page not found');
      expect(msg.contextValue).toBe('error');
    });

    test('should cache error and return it on subsequent calls', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockClient.getJobSteps.mockRejectedValue(new Error('Page not found'));

      const jobItem = new JobTreeItem(mockWorkflowRunSuccess, 0, 'test-owner', 'test-repo');

      // First call - hits web scraping
      await provider.getChildren(jobItem);

      // Second call - returns cached error
      jest.clearAllMocks();
      const children = await provider.getChildren(jobItem);
      expect(mockClient.getJobSteps).not.toHaveBeenCalled();
      expect(children).toHaveLength(1);
      expect((children[0] as any).label).toBe('Page not found');
    });

    test('should return error when no config during step fetch', async () => {
      mockGetForgejoConfig.mockResolvedValue(null as any);

      const jobItem = new JobTreeItem(mockWorkflowRunSuccess, 0, 'test-owner', 'test-repo');
      const children = await provider.getChildren(jobItem);

      expect(children).toHaveLength(1);
      expect((children[0] as any).label).toBe('No Forgejo configuration found');
    });

    test('should pass correct runNumber and jobRef to StepTreeItem', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockClient.getJobSteps.mockResolvedValue([mockScrapedStepCheckout]);

      const jobItem = new JobTreeItem(mockWorkflowRunSuccess, 1, 'test-owner', 'test-repo');
      const children = await provider.getChildren(jobItem);

      const stepItem = children[0] as StepTreeItem;
      expect(stepItem.jobRef).toEqual({
        jobId: 123,
        jobName: 'CI',
        jobHtmlUrl: undefined,
      });
      expect(stepItem.runNumber).toBe(42); // mockWorkflowRunSuccess.run_number
      expect(stepItem.owner).toBe('test-owner');
      expect(stepItem.repo).toBe('test-repo');
    });

    test('should give duplicate step names unique ids by index', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockClient.getJobSteps.mockResolvedValue([
        { summary: 'Run', duration: '1s', status: 'success' },
        { summary: 'Run', duration: '2s', status: 'success' }
      ]);

      const jobItem = new JobTreeItem(mockWorkflowRunSuccess, 0, 'test-owner', 'test-repo', 'https://git.example.com');
      const children = await provider.getChildren(jobItem);

      expect((children[0] as StepTreeItem).id).toBe('workflow-step/https%3A%2F%2Fgit.example.com/test-owner/test-repo/42/123/0/Run');
      expect((children[1] as StepTreeItem).id).toBe('workflow-step/https%3A%2F%2Fgit.example.com/test-owner/test-repo/42/123/1/Run');
    });
  });

  describe('Provider getChildren - StepTreeItem (leaf)', () => {
    test('should return empty array for step items', async () => {
      const stepItem = new StepTreeItem(mockScrapedStepCheckout, { jobId: 123, jobIndex: 0 }, 42, 'test-owner', 'test-repo');
      const children = await provider.getChildren(stepItem);

      expect(children).toHaveLength(0);
    });
  });

  describe('Provider Initialization', () => {
    test('should create provider successfully', () => {
      expect(provider).toBeDefined();
      expect(provider).toBeInstanceOf(ActionsTreeProvider);
    });

    test('should have onDidChangeTreeData event', () => {
      expect(provider.onDidChangeTreeData).toBeDefined();
    });

    test('should have refresh method', () => {
      expect(typeof provider.refresh).toBe('function');
    });

    test('should return element from getTreeItem', () => {
      const item = new JobTreeItem(mockWorkflowRunSuccess, 0, 'owner', 'repo');
      expect(provider.getTreeItem(item)).toBe(item);
    });
  });
});
