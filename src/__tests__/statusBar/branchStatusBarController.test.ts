import * as vscode from 'vscode';
import { BranchStatusBarController } from '../../statusBar/branchStatusBarController';
import { getActiveGitRepository, getGitApi } from '../../utils/gitUtils';
import { getForgejoConfig } from '../../utils/config';
import { ForgejoClient } from '../../api/forgejoClient';
import { CommitStatus } from '../../models/pullRequest';

jest.mock('../../utils/gitUtils');
jest.mock('../../utils/config');
jest.mock('../../api/forgejoClient');

const mockGetActiveGitRepository = getActiveGitRepository as jest.MockedFunction<typeof getActiveGitRepository>;
const mockGetGitApi = getGitApi as jest.MockedFunction<typeof getGitApi>;
const mockGetForgejoConfig = getForgejoConfig as jest.MockedFunction<typeof getForgejoConfig>;
const MockForgejoClient = ForgejoClient as jest.MockedClass<typeof ForgejoClient>;

const config = {
  instanceUrl: 'https://git.example.com',
  token: 'token',
  owner: 'maxking',
  repo: 'forgejo-vscode'
};

function makeRepository(branchName: string, rootPath = '/workspace/repo') {
  const onDidChangeEmitter = new vscode.EventEmitter<void>();
  return {
    rootUri: { fsPath: rootPath },
    state: {
      HEAD: { name: branchName },
      remotes: [],
      onDidChange: onDidChangeEmitter.event
    },
    __fireStateChange: () => onDidChangeEmitter.fire()
  } as any;
}

function makePr(number: number, headRef: string) {
  return {
    number,
    title: `PR ${number}`,
    state: 'open',
    user: { login: 'maxking' },
    html_url: 'https://git.example.com/pulls/1',
    created_at: '2026-01-01T00:00:00Z',
    merged: false,
    draft: false,
    comments: 0,
    head: { ref: headRef, sha: `sha-${headRef}` },
    base: { ref: 'master' }
  };
}

function makeStatus(overrides: Partial<CommitStatus> = {}): CommitStatus {
  return {
    id: 1,
    status: 'success',
    context: 'ci/test',
    description: '',
    target_url: '',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides
  };
}

describe('BranchStatusBarController', () => {
  let statusBarItem: any;
  let getPullRequestsPage: jest.Mock;
  let getCommitStatusesPage: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();

    statusBarItem = {
      text: '',
      tooltip: undefined,
      command: undefined,
      show: jest.fn(),
      hide: jest.fn(),
      dispose: jest.fn()
    };
    (vscode.window.createStatusBarItem as jest.Mock).mockReturnValue(statusBarItem);
    (vscode.window.onDidChangeActiveTextEditor as jest.Mock).mockReturnValue({ dispose: jest.fn() });
    (vscode.workspace.onDidChangeConfiguration as jest.Mock).mockReturnValue({ dispose: jest.fn() });
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({ get: jest.fn(() => true) });
    (vscode.commands.executeCommand as jest.Mock).mockReset();
    (vscode.window.showQuickPick as jest.Mock).mockReset();

    mockGetGitApi.mockReturnValue(null);

    getPullRequestsPage = jest.fn().mockResolvedValue({ items: [], page: 1, limit: 50, hasMore: false });
    getCommitStatusesPage = jest.fn().mockResolvedValue({ items: [], page: 1, limit: 30, hasMore: false, totalCount: 0 });
    MockForgejoClient.mockImplementation(() => ({
      getPullRequestsPage,
      getCommitStatusesPage
    } as any));
  });

  describe('refresh', () => {
    it('hides the item and makes no network calls when there is no active repository', async () => {
      mockGetActiveGitRepository.mockReturnValue(null);

      const controller = new BranchStatusBarController();
      await controller.refresh();

      expect(statusBarItem.hide).toHaveBeenCalled();
      expect(mockGetForgejoConfig).not.toHaveBeenCalled();
      expect(getPullRequestsPage).not.toHaveBeenCalled();
    });

    it('hides the item and makes no network calls when no Forgejo config resolves (no-config)', async () => {
      mockGetActiveGitRepository.mockReturnValue(makeRepository('feature-branch'));
      mockGetForgejoConfig.mockResolvedValue(null);

      const controller = new BranchStatusBarController();
      await controller.refresh();

      expect(statusBarItem.hide).toHaveBeenCalled();
      expect(getPullRequestsPage).not.toHaveBeenCalled();
    });

    it('hides the item and makes no network calls when forgejo.statusBar.enabled is false', async () => {
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({ get: jest.fn(() => false) });
      mockGetActiveGitRepository.mockReturnValue(makeRepository('feature-branch'));

      const controller = new BranchStatusBarController();
      await controller.refresh();

      expect(statusBarItem.hide).toHaveBeenCalled();
      expect(mockGetActiveGitRepository).not.toHaveBeenCalled();
      expect(getPullRequestsPage).not.toHaveBeenCalled();
    });

    it('fetches PRs/CI once and reuses the cache on a second refresh for the same branch (TTL cache)', async () => {
      mockGetActiveGitRepository.mockReturnValue(makeRepository('feature-branch'));
      mockGetForgejoConfig.mockResolvedValue(config);
      getPullRequestsPage.mockResolvedValue({
        items: [makePr(42, 'feature-branch')],
        page: 1,
        limit: 50,
        hasMore: false
      });

      const controller = new BranchStatusBarController();
      await controller.refresh();
      await controller.refresh();

      expect(getPullRequestsPage).toHaveBeenCalledTimes(1);
      expect(statusBarItem.text).toContain('#42');
    });

    it('re-fetches when the branch changes (cache key changes)', async () => {
      mockGetForgejoConfig.mockResolvedValue(config);
      getPullRequestsPage.mockResolvedValue({ items: [], page: 1, limit: 50, hasMore: false });

      const controller = new BranchStatusBarController();

      mockGetActiveGitRepository.mockReturnValue(makeRepository('branch-a'));
      await controller.refresh();

      mockGetActiveGitRepository.mockReturnValue(makeRepository('branch-b'));
      await controller.refresh();

      expect(getPullRequestsPage).toHaveBeenCalledTimes(2);
    });

    it('shows the PR number and fetches commit statuses for the matching open PR', async () => {
      mockGetActiveGitRepository.mockReturnValue(makeRepository('feature-branch'));
      mockGetForgejoConfig.mockResolvedValue(config);
      getPullRequestsPage.mockResolvedValue({
        items: [makePr(7, 'feature-branch')],
        page: 1,
        limit: 50,
        hasMore: false
      });
      getCommitStatusesPage.mockResolvedValue({
        items: [makeStatus({ status: 'success' })],
        page: 1,
        limit: 30,
        hasMore: false,
        totalCount: 1
      });

      const controller = new BranchStatusBarController();
      await controller.refresh();

      expect(getCommitStatusesPage).toHaveBeenCalledWith('maxking', 'forgejo-vscode', 'sha-feature-branch', {
        page: 1,
        limit: 30
      });
      expect(statusBarItem.text).toContain('#7');
      expect(statusBarItem.show).toHaveBeenCalled();
    });

    it('surfaces an error presentation instead of throwing when the API call fails', async () => {
      mockGetActiveGitRepository.mockReturnValue(makeRepository('feature-branch'));
      mockGetForgejoConfig.mockResolvedValue(config);
      getPullRequestsPage.mockRejectedValue(new Error('boom'));

      const controller = new BranchStatusBarController();
      await expect(controller.refresh()).resolves.not.toThrow();

      expect(statusBarItem.tooltip).toContain('boom');
    });

    it('reflects the active repository, not the first configured repository (multi-root)', async () => {
      mockGetForgejoConfig.mockResolvedValue(config);
      getPullRequestsPage.mockResolvedValue({
        items: [makePr(99, 'repo-two-branch')],
        page: 1,
        limit: 50,
        hasMore: false
      });

      // getActiveGitRepository is the seam that already picks the active
      // repository over the first one (see gitUtils.test.ts); this asserts
      // the controller actually calls it once per refresh and renders
      // whatever it resolves, rather than caching a "first repository" answer.
      mockGetActiveGitRepository.mockReturnValue(makeRepository('repo-two-branch', '/workspace/repo-two'));

      const controller = new BranchStatusBarController();
      await controller.refresh();

      expect(statusBarItem.text).toContain('#99');
    });
  });

  describe('debounced triggers', () => {
    it('activate() schedules exactly one bounded refresh after the debounce, and none before it', () => {
      jest.useFakeTimers();
      mockGetActiveGitRepository.mockReturnValue(null);

      const controller = new BranchStatusBarController();
      const refreshSpy = jest.spyOn(controller, 'refresh');
      const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;

      controller.activate(context);

      // activate() itself must not fetch/refresh synchronously.
      expect(refreshSpy).not.toHaveBeenCalled();

      // Before the debounce elapses, still nothing.
      jest.advanceTimersByTime(200);
      expect(refreshSpy).not.toHaveBeenCalled();

      // Once the debounce elapses, exactly one gated/cached refresh runs.
      jest.advanceTimersByTime(200);
      expect(refreshSpy).toHaveBeenCalledTimes(1);

      // No further refreshes happen on their own (no polling).
      jest.advanceTimersByTime(60_000);
      expect(refreshSpy).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });

    it('collapses rapid-fire trigger events into a single refresh', () => {
      jest.useFakeTimers();
      mockGetActiveGitRepository.mockReturnValue(null);

      const controller = new BranchStatusBarController();
      const refreshSpy = jest.spyOn(controller, 'refresh');
      const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
      controller.activate(context);
      refreshSpy.mockClear();

      const editorChangeHandler = (vscode.window.onDidChangeActiveTextEditor as jest.Mock).mock.calls[0][0];
      editorChangeHandler();
      editorChangeHandler();
      editorChangeHandler();

      jest.advanceTimersByTime(1000);

      expect(refreshSpy).toHaveBeenCalledTimes(1);
      jest.useRealTimers();
    });
  });

  describe('handleClick', () => {
    it('creates a pull request when the branch has no open PR', async () => {
      mockGetActiveGitRepository.mockReturnValue(makeRepository('feature-branch'));
      mockGetForgejoConfig.mockResolvedValue(config);
      getPullRequestsPage.mockResolvedValue({ items: [], page: 1, limit: 50, hasMore: false });

      const controller = new BranchStatusBarController();
      await controller.refresh();
      await controller.handleClick();

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith('forgejo.createPullRequest');
      expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    });

    it('opens PR details directly when a PR exists with no CI data (no quick pick)', async () => {
      mockGetActiveGitRepository.mockReturnValue(makeRepository('feature-branch'));
      mockGetForgejoConfig.mockResolvedValue(config);
      getPullRequestsPage.mockResolvedValue({
        items: [makePr(3, 'feature-branch')],
        page: 1,
        limit: 50,
        hasMore: false
      });
      getCommitStatusesPage.mockResolvedValue({ items: [], page: 1, limit: 30, hasMore: false, totalCount: 0 });

      const controller = new BranchStatusBarController();
      await controller.refresh();
      await controller.handleClick();

      expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'forgejo.showPrDetails',
        expect.objectContaining({ number: 3 }),
        'maxking',
        'forgejo-vscode',
        'https://git.example.com'
      );
    });

    it('offers a quick pick between PR details and CI details when both are available, and dispatches "Open Pull Request Details"', async () => {
      mockGetActiveGitRepository.mockReturnValue(makeRepository('feature-branch'));
      mockGetForgejoConfig.mockResolvedValue(config);
      getPullRequestsPage.mockResolvedValue({
        items: [makePr(3, 'feature-branch')],
        page: 1,
        limit: 50,
        hasMore: false
      });
      getCommitStatusesPage.mockResolvedValue({
        items: [makeStatus({ status: 'failure' })],
        page: 1,
        limit: 30,
        hasMore: false,
        totalCount: 1
      });
      (vscode.window.showQuickPick as jest.Mock).mockResolvedValue({ action: 'pr' });

      const controller = new BranchStatusBarController();
      await controller.refresh();
      await controller.handleClick();

      expect(vscode.window.showQuickPick).toHaveBeenCalled();
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'forgejo.showPrDetails',
        expect.objectContaining({ number: 3 }),
        'maxking',
        'forgejo-vscode',
        'https://git.example.com'
      );
    });

    it('dispatches to viewCIStatusLogs with the representative failing status when the user picks "Open CI Details"', async () => {
      mockGetActiveGitRepository.mockReturnValue(makeRepository('feature-branch'));
      mockGetForgejoConfig.mockResolvedValue(config);
      getPullRequestsPage.mockResolvedValue({
        items: [makePr(3, 'feature-branch')],
        page: 1,
        limit: 50,
        hasMore: false
      });
      const failingStatus = makeStatus({ status: 'failure', context: 'ci/failing' });
      getCommitStatusesPage.mockResolvedValue({
        items: [makeStatus({ status: 'success', context: 'ci/passing' }), failingStatus],
        page: 1,
        limit: 30,
        hasMore: false,
        totalCount: 2
      });
      (vscode.window.showQuickPick as jest.Mock).mockResolvedValue({ action: 'ci' });

      const controller = new BranchStatusBarController();
      await controller.refresh();
      await controller.handleClick();

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'forgejo.viewCIStatusLogs',
        failingStatus,
        'maxking',
        'forgejo-vscode',
        'https://git.example.com'
      );
    });

    it('does nothing when the user dismisses the quick pick', async () => {
      mockGetActiveGitRepository.mockReturnValue(makeRepository('feature-branch'));
      mockGetForgejoConfig.mockResolvedValue(config);
      getPullRequestsPage.mockResolvedValue({
        items: [makePr(3, 'feature-branch')],
        page: 1,
        limit: 50,
        hasMore: false
      });
      getCommitStatusesPage.mockResolvedValue({
        items: [makeStatus({ status: 'failure' })],
        page: 1,
        limit: 30,
        hasMore: false,
        totalCount: 1
      });
      (vscode.window.showQuickPick as jest.Mock).mockResolvedValue(undefined);

      const controller = new BranchStatusBarController();
      await controller.refresh();
      await controller.handleClick();

      expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    });
  });
});
