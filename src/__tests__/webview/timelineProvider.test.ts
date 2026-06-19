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

    const activities = await (provider as any)._fetchActivities(client, 'forgejo', 'forgejo', 13020);

    expect(activities).toHaveLength(2);
    expect(activities.map((activity: { type: string }) => activity.type)).toEqual(['comment', 'timeline']);
    expect(activities[1]).toMatchObject({
      id: 17123210,
      type: 'timeline',
      event: 'label',
      label: { name: 'problem' }
    });
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

    const activities = await (provider as any)._fetchActivities(client, 'owner', 'repo', 42);

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

    const activities = await (provider as any)._fetchActivities(client, 'owner', 'repo', 42);

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
});
