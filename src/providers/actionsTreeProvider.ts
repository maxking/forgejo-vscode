import * as vscode from 'vscode';
import { ForgejoClient } from '../api/forgejoClient';
import { WorkflowRunListItem, WorkflowJobRef } from '../models/action';
import { ForgejoConfig, ForgejoRepositoryConfig, getForgejoConfig, getForgejoRepositoryConfigs } from '../utils/config';

/**
 * Step data scraped from Forgejo's web page.
 * Forgejo v13 doesn't expose steps via REST API, so we parse the
 * `data-initial-post-response` JSON embedded in the job web page.
 */
export interface ScrapedStep {
  summary: string;
  duration: string;
  status: string;
}

/**
 * Plain serializable arguments passed to the forgejo.viewStepLogs command.
 * Using a plain object instead of StepTreeItem avoids circular JSON references
 * (StepTreeItem.command.arguments[0] → StepTreeItem).
 */
export interface StepLogArgs {
  stepSummary: string;
  owner: string;
  repo: string;
  runNumber: number;
  jobRef: WorkflowJobRef;
}

function createJobRef(job: WorkflowRunListItem): WorkflowJobRef {
  return {
    jobId: job.id,
    jobName: job.name,
    jobHtmlUrl: job.html_url,
  };
}


/**
 * Get a status icon for a workflow status string.
 */
function getStatusIcon(status: string): vscode.ThemeIcon {
  switch (status) {
    case 'in_progress':
    case 'running':
    case 'queued':
    case 'waiting':
      return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.yellow'));
    case 'success':
      return new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
    case 'failure':
      return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
    case 'cancelled':
      return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('disabledForeground'));
    case 'skipped':
      return new vscode.ThemeIcon('debug-step-over', new vscode.ThemeColor('disabledForeground'));
    default:
      return new vscode.ThemeIcon('circle-outline');
  }
}

/**
 * Represents a grouped workflow run (parent of jobs).
 * Jobs come from the /actions/tasks endpoint data, no lazy-loading needed.
 */
export class WorkflowRunTreeItem extends vscode.TreeItem {
  constructor(
    public readonly runNumber: number,
    public readonly jobs: WorkflowRunListItem[],
    public readonly owner: string,
    public readonly repo: string
  ) {
    // Use first job to get run metadata (all jobs in same run share these)
    const firstJob = jobs[0];
    const hasJobs = Boolean(firstJob);
    const label = hasJobs ? `${firstJob.display_title} (#${runNumber})` : `Workflow Run #${runNumber}`;

    super(label, vscode.TreeItemCollapsibleState.Collapsed);

    // Description shows branch and workflow file (more useful than a short SHA)
    this.description = hasJobs ? `${firstJob.head_branch} · ${firstJob.workflow_id}` : 'No jobs';
    this.tooltip = hasJobs ?
      `Workflow: ${firstJob.workflow_id}\nBranch: ${firstJob.head_branch}\nCommit: ${firstJob.head_sha}\nTrigger: ${firstJob.event}\n${firstJob.display_title}\nJobs: ${jobs.length}`
      : `Workflow: #${runNumber}\nJobs: ${jobs.length}`;
    this.contextValue = 'workflowRun';

    // Icon based on aggregate status
    this.iconPath = this.getAggregateStatusIcon(jobs);
  }

  private getAggregateStatusIcon(jobs: WorkflowRunListItem[]): vscode.ThemeIcon {
    // No jobs — show neutral icon (not 'pass' which would be misleading)
    if (jobs.length === 0) {
      return new vscode.ThemeIcon('circle-outline');
    }
    // If any job is running, show running icon
    if (jobs.some(j => j.status === 'in_progress' || j.status === 'queued' || j.status === 'waiting')) {
      return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.yellow'));
    }
    // If any job failed, show failure
    if (jobs.some(j => j.status === 'failure')) {
      return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
    }
    // If all succeeded
    if (jobs.every(j => j.status === 'success')) {
      return new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
    }
    // If any cancelled
    if (jobs.some(j => j.status === 'cancelled')) {
      return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('disabledForeground'));
    }
    return new vscode.ThemeIcon('circle-outline');
  }
}

/**
 * Represents a single job within a workflow run (parent of steps).
 * Steps are lazy-loaded by scraping the Forgejo web page.
 */
export class JobTreeItem extends vscode.TreeItem {
  /** Cached steps fetched from web scraping */
  fetchedSteps?: ScrapedStep[];
  /** Error from the last step fetch attempt */
  fetchError?: string;

  constructor(
    public readonly job: WorkflowRunListItem,
    public readonly jobIndex: number,
    public readonly owner: string,
    public readonly repo: string
  ) {
    super(job.name, vscode.TreeItemCollapsibleState.Collapsed);

    this.description = job.status;
    this.tooltip = `Job: ${job.name}\nStatus: ${job.status}\nRun: #${job.run_number}\nJob ID: ${job.id}`;
    this.contextValue = 'workflowJob';

    // Set icon based on status
    this.iconPath = getStatusIcon(job.status);
  }

  get jobRef(): WorkflowJobRef {
    return createJobRef(this.job);
  }
}

/**
 * Represents a single step within a workflow job (leaf node).
 * Data comes from Forgejo web page scraping.
 */
export class StepTreeItem extends vscode.TreeItem {
  constructor(
    public readonly step: ScrapedStep,
    public readonly jobRef: WorkflowJobRef,
    public readonly runNumber: number,
    public readonly owner: string,
    public readonly repo: string
  ) {
    super(step.summary, vscode.TreeItemCollapsibleState.None);

    this.description = step.duration || undefined;
    this.tooltip = `Step: ${step.summary}\nStatus: ${step.status}${step.duration ? `\nDuration: ${step.duration}` : ''}`;
    this.contextValue = 'workflowStep';

    this.iconPath = getStatusIcon(step.status);

    // Click to view step logs — pass a plain serializable object to avoid
    // circular JSON (StepTreeItem.command.arguments[0] → StepTreeItem).
    const args: StepLogArgs = {
      stepSummary: step.summary,
      owner,
      repo,
      runNumber,
      jobRef
    };
    this.command = {
      command: 'forgejo.viewStepLogs',
      title: 'View Step Logs',
      arguments: [args]
    };
  }
}

/**
 * Message item for errors or info
 */
class ActionRepositoryItem extends vscode.TreeItem {
  constructor(public readonly config: ForgejoRepositoryConfig) {
    super(config.label, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = config.rootPath;
    this.tooltip = config.rootPath ? `${config.label}\n${config.rootPath}` : config.label;
    this.contextValue = 'forgejoRepository';
    this.iconPath = new vscode.ThemeIcon('repo');
  }
}

class ActionMessageItem extends vscode.TreeItem {
  constructor(
    public readonly message: string,
    public readonly isError = false
  ) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(isError ? 'error' : 'info');
    this.contextValue = isError ? 'error' : 'info';
  }
}

type ActionTreeElement = ActionRepositoryItem | WorkflowRunTreeItem | JobTreeItem | StepTreeItem | ActionMessageItem;

export class ActionsTreeProvider implements vscode.TreeDataProvider<ActionTreeElement> {
  private _onDidChangeTreeData: vscode.EventEmitter<ActionTreeElement | undefined | null | void> = new vscode.EventEmitter<ActionTreeElement | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<ActionTreeElement | undefined | null | void> = this._onDidChangeTreeData.event;

  private workflowRuns = new Map<string, WorkflowRunListItem[]>();
  private error: string | null = null;
  private owner = '';
  private repo = '';

  constructor() {
    this.refresh();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ActionTreeElement): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ActionTreeElement): Promise<ActionTreeElement[]> {
    if (!element) {
      const configs = await getForgejoRepositoryConfigs();
      if (configs.length > 1) {
        return configs.map(config => new ActionRepositoryItem(config));
      }

      const config = configs[0] ?? await getForgejoConfig();
      if (!config) {
        return [new ActionMessageItem('No Forgejo configuration found. Please configure instance URL or open a git repository.', true)];
      }

      return this.getRunsForConfig(config);
    } else if (element instanceof ActionRepositoryItem) {
      return this.getRunsForConfig(element.config);
    } else if (element instanceof WorkflowRunTreeItem) {
      // Show jobs within this run (data already available from /actions/tasks)
      return element.jobs.map((job, index) =>
        new JobTreeItem(job, index, element.owner, element.repo)
      );
    } else if (element instanceof JobTreeItem) {
      // Lazy-load steps by scraping the Forgejo web page
      return this.getJobSteps(element);
    }

    return [];
  }

  /**
   * Lazy-load steps for a job by scraping the Forgejo web page.
   * Results are cached on the JobTreeItem.
   */
  private async getJobSteps(jobItem: JobTreeItem): Promise<ActionTreeElement[]> {
    // Return cached result if available
    if (jobItem.fetchedSteps) {
      return jobItem.fetchedSteps.map(step =>
        new StepTreeItem(step, jobItem.jobRef, jobItem.job.run_number, jobItem.owner, jobItem.repo)
      );
    }
    if (jobItem.fetchError) {
      return [new ActionMessageItem(jobItem.fetchError, true)];
    }

    try {
      const config = await getForgejoConfig();
      if (!config) {
        const err = 'No Forgejo configuration found';
        jobItem.fetchError = err;
        return [new ActionMessageItem(err, true)];
      }

      const client = new ForgejoClient(config.instanceUrl, config.token);
      const steps = await client.getJobSteps(jobItem.owner, jobItem.repo, jobItem.job.run_number, jobItem.jobRef);

      jobItem.fetchedSteps = steps;

      if (steps.length === 0) {
        return [new ActionMessageItem('No steps found', false)];
      }

      return steps.map(step =>
        new StepTreeItem(step, jobItem.jobRef, jobItem.job.run_number, jobItem.owner, jobItem.repo)
      );
    } catch (error) {
      const is404 = error instanceof Error && error.message.includes('404');
      const errMsg = is404
        ? 'Steps and logs not available (private repo action logs are not supported due to auth limitations)'
        : error instanceof Error ? error.message : 'Failed to fetch steps';
      jobItem.fetchError = errMsg;
      console.error('[Forgejo] Error fetching steps for job:', error);
      return [new ActionMessageItem(errMsg, true)];
    }
  }

  private configKey(config: ForgejoConfig): string {
    return `${config.instanceUrl}/${config.owner}/${config.repo}`;
  }

  private async getRunsForConfig(config: ForgejoConfig): Promise<ActionTreeElement[]> {
    try {
      const workflowRuns = await this.fetchWorkflowRuns(config);

      if (this.error) {
        console.error('[Forgejo] Actions fetch error:', this.error);
        return [new ActionMessageItem(this.error, true)];
      }

      if (workflowRuns.length === 0) {
        return [new ActionMessageItem('No workflow runs found', false)];
      }

      const runsByNumber = new Map<number, WorkflowRunListItem[]>();
      for (const job of workflowRuns) {
        const existing = runsByNumber.get(job.run_number) ?? [];
        existing.push(job);
        runsByNumber.set(job.run_number, existing);
      }

      const sortedRuns = Array.from(runsByNumber.entries()).sort((a, b) => b[0] - a[0]);
      return sortedRuns.map(([runNumber, jobs]) =>
        new WorkflowRunTreeItem(runNumber, jobs, config.owner, config.repo)
      );
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Unknown error';
      return [new ActionMessageItem(this.error, true)];
    }
  }

  private async fetchWorkflowRuns(config: ForgejoConfig): Promise<WorkflowRunListItem[]> {
    console.log('[Forgejo] Fetching workflow runs...');
    const key = this.configKey(config);

    this.owner = config.owner;
    this.repo = config.repo;

    console.log('[Forgejo] Using config for Actions:', {
      instanceUrl: config.instanceUrl,
      owner: config.owner,
      repo: config.repo,
      hasToken: !!config.token
    });

    try {
      const client = new ForgejoClient(config.instanceUrl, config.token);
      const response = await client.getWorkflowRuns(config.owner, config.repo);
      this.workflowRuns.set(key, response.workflow_runs);
      this.error = null;
      console.log(`[Forgejo] Fetched ${response.workflow_runs.length} workflow runs`);
      return response.workflow_runs;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Failed to fetch workflow runs';
      this.workflowRuns.set(key, []);
      console.error('[Forgejo] Error fetching workflow runs:', error);
      throw error;
    }
  }
}
