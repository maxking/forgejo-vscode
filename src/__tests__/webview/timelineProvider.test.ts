import { IssueDetailWebviewProvider } from '../../webview/issueDetail/provider';
import { PRDetailWebviewProvider } from '../../webview/prDetail/provider';
import { mockCommit } from '../fixtures/prActivities';

describe('detail webview timeline activity normalization', () => {
  test('issue details skip duplicate timeline comments and preserve Forgejo type actions', async () => {
    const provider = new IssueDetailWebviewProvider({} as never);
    const client = {
      getIssueComments: jest.fn().mockResolvedValue([
        {
          id: 17186162,
          type: 'comment',
          body: 'Real comment',
          created_at: '2026-06-10T11:08:13+02:00'
        }
      ]),
      getIssueTimeline: jest.fn().mockResolvedValue([
        {
          id: 17186162,
          type: 'comment',
          body: 'Real comment',
          created_at: '2026-06-10T11:08:13+02:00'
        },
        {
          id: 17123210,
          type: 'label',
          label: { name: 'problem' },
          created_at: '2026-06-09T15:53:54+02:00'
        },
        {
          id: 17123211,
          type: '',
          created_at: '2026-06-09T15:53:55+02:00'
        }
      ])
    };

    const { items: activities } = await (provider as any)._fetchActivities(client, 'forgejo', 'forgejo', 13020);

    expect(activities).toHaveLength(2);
    expect(activities.map((activity: { type: string }) => activity.type)).toEqual(['comment', 'timeline']);
    expect(activities[1]).toMatchObject({
      id: 17123210,
      type: 'timeline',
      event: 'label',
      label: { name: 'problem' }
    });
  });

  test('issue details build time tracking data for the current running stopwatch', async () => {
    const provider = new IssueDetailWebviewProvider({} as never);
    const client = {
      getIssueTrackedTimes: jest.fn().mockResolvedValue([
        { id: 1, time: 600, user_name: 'alice' },
        { id: 2, time: 1200, user_name: 'bob' }
      ]),
      getUserStopwatches: jest.fn().mockResolvedValue([
        {
          issue_index: 13020,
          issue_title: 'Current issue',
          repo_name: 'forgejo',
          repo_owner_name: 'forgejo',
          seconds: 90
        },
        {
          issue_index: 99,
          issue_title: 'Other issue',
          repo_name: 'forgejo',
          repo_owner_name: 'forgejo',
          seconds: 30
        }
      ])
    };

    const timeTracking = await (provider as any)._fetchTimeTracking(client, 'forgejo', 'forgejo', 13020, true);

    expect(timeTracking).toMatchObject({
      canTrack: true,
      totalSeconds: 1800,
      currentStopwatch: {
        issue_index: 13020,
        issue_title: 'Current issue'
      },
      otherStopwatch: {
        issue_index: 99,
        issue_title: 'Other issue'
      }
    });
  });

  test('issue details do not fetch user stopwatches without authentication', async () => {
    const provider = new IssueDetailWebviewProvider({} as never);
    const client = {
      getIssueTrackedTimes: jest.fn().mockResolvedValue([{ id: 1, time: 300 }]),
      getUserStopwatches: jest.fn()
    };

    const timeTracking = await (provider as any)._fetchTimeTracking(client, 'forgejo', 'forgejo', 13020, false);

    expect(timeTracking).toMatchObject({
      canTrack: false,
      totalSeconds: 300,
      entries: [{ id: 1, time: 300 }]
    });
    expect(client.getUserStopwatches).not.toHaveBeenCalled();
  });

  test('tracked-time pagination deduplicates overlapping ids before totals', async () => {
    const provider = new IssueDetailWebviewProvider({} as never);
    const pageOne = Array.from({ length: 50 }, (_, index) => ({ id: index + 1, time: 60 }));
    const client = {
      getIssueTrackedTimes: jest.fn()
        .mockResolvedValueOnce(pageOne)
        .mockResolvedValueOnce([{ id: 50, time: 60 }, { id: 51, time: 120 }]),
      getUserStopwatches: jest.fn().mockResolvedValue([])
    };

    const result = await (provider as any)._fetchTimeTracking(client, 'owner', 'repo', 1, true);

    expect(result.entries).toHaveLength(51);
    expect(result.totalSeconds).toBe(3120);
  });

  test('tracked-time safety cap marks the displayed total incomplete', async () => {
    const provider = new IssueDetailWebviewProvider({} as never);
    const fullPage = Array.from({ length: 50 }, (_, index) => ({ id: index + 1, time: 60 }));
    const client = { getIssueTrackedTimes: jest.fn().mockResolvedValue(fullPage), getUserStopwatches: jest.fn().mockResolvedValue([]) };

    const result = await (provider as any)._fetchTimeTracking(client, 'owner', 'repo', 1, true);

    expect(client.getIssueTrackedTimes).toHaveBeenCalledTimes(4);
    expect(result.error).toContain('incomplete');
  });

  test('bounded activity pages report when older history is available', async () => {
    const provider = new IssueDetailWebviewProvider({} as never);
    const client = {
      getIssueCommentsPage: jest.fn().mockResolvedValue({ items: [], hasMore: true }),
      getIssueTimelinePage: jest.fn().mockResolvedValue({ items: [], hasMore: false })
    };

    const result = await (provider as any)._fetchActivities(client, 'owner', 'repo', 1);

    expect(result).toEqual({ items: [], truncated: true });
  });

  test('issue details fetch the last activity page when the API reports a total', async () => {
    const provider = new IssueDetailWebviewProvider({} as never);
    const getIssueCommentsPage = jest.fn((_owner, _repo, _number, { page }) => Promise.resolve(page === 1
      ? { items: [{ id: 1, created_at: '2020-01-01' }], hasMore: true, totalCount: 101 }
      : { items: [{ id: 101, created_at: '2026-01-01' }], hasMore: false, totalCount: 101 }));
    const client = { getIssueCommentsPage, getIssueTimelinePage: jest.fn().mockResolvedValue({ items: [], hasMore: false, totalCount: 0 }) };

    const result = await (provider as any)._fetchActivities(client, 'owner', 'repo', 1);

    expect(getIssueCommentsPage).toHaveBeenLastCalledWith('owner', 'repo', 1, { page: 3, limit: 50 });
    expect(result.items.map((item: any) => item.id)).toEqual([101]);
  });

  test('PR details skip duplicate timeline comments and preserve Forgejo type actions', async () => {
    const provider = new PRDetailWebviewProvider({} as never);
    const client = {
      getIssueComments: jest.fn().mockResolvedValue([
        {
          id: 101,
          type: 'comment',
          body: 'PR comment',
          created_at: '2026-06-10T11:08:13+02:00'
        }
      ]),
      getPullRequestReviews: jest.fn().mockResolvedValue([]),
      getPullRequestCommits: jest.fn().mockResolvedValue([]),
      getIssueTimeline: jest.fn().mockResolvedValue([
        {
          id: 101,
          type: 'comment',
          body: 'PR comment',
          created_at: '2026-06-10T11:08:13+02:00'
        },
        {
          id: 102,
          type: 'merge_pull',
          created_at: '2026-06-09T15:53:54+02:00'
        }
      ])
    };

    const { items: activities } = await (provider as any)._fetchActivities(client, 'owner', 'repo', 42);

    expect(activities).toHaveLength(2);
    expect(activities.map((activity: { type: string }) => activity.type)).toEqual(['comment', 'timeline']);
    expect(activities.find((activity: { id?: number; type: string }) => activity.id === 101 && activity.type === 'timeline')).toBeUndefined();
    expect(activities[1]).toMatchObject({
      id: 102,
      type: 'timeline',
      event: 'merge_pull'
    });
  });

  test('PR details normalize nested forgejo-ts commit payloads', async () => {
    const provider = new PRDetailWebviewProvider({} as never);
    const client = {
      getIssueComments: jest.fn().mockResolvedValue([]),
      getPullRequestReviews: jest.fn().mockResolvedValue([]),
      getPullRequestCommits: jest.fn().mockResolvedValue([mockCommit]),
      getIssueTimeline: jest.fn().mockResolvedValue([])
    };

    const { items: activities } = await (provider as any)._fetchActivities(client, 'owner', 'repo', 42);

    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      type: 'commit',
      sha: mockCommit.sha,
      committed_at: mockCommit.commit.author.date,
      message: mockCommit.commit.message,
      user: {
        login: mockCommit.author.login,
        avatar_url: mockCommit.author.avatar_url
      },
      html_url: mockCommit.html_url
    });
    expect(activities[0]).not.toHaveProperty('commit');
  });

  test('PR details retain the newest page from each bounded activity stream', async () => {
    const provider = new PRDetailWebviewProvider({} as never);
    const page = (type: string) => jest.fn((_owner, _repo, _number, options) => Promise.resolve(options.page === 1
      ? { items: [], hasMore: true, totalCount: 51 }
      : { items: [{ id: 51, body: type, created_at: '2026-01-01' }], hasMore: false, totalCount: 51 }));
    const client = {
      getIssueCommentsPage: page('comment'),
      getPullRequestReviewsPage: page('review'),
      getPullRequestCommitsPage: page('commit'),
      getIssueTimelinePage: jest.fn().mockResolvedValue({ items: [], hasMore: false, totalCount: 0 })
    };

    const result = await (provider as any)._fetchActivities(client, 'owner', 'repo', 42);

    expect(result.truncated).toBe(true);
    expect(result.items.map((item: any) => item.type).sort()).toEqual(['comment', 'commit', 'review']);
    expect(client.getPullRequestCommitsPage).toHaveBeenLastCalledWith('owner', 'repo', 42, { page: 2, limit: 50 });
  });
});
