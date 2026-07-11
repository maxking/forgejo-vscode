import { matchingRemote } from '../../utils/gitRepositoryMatch';

describe('matchingRemote', () => {
  it('returns the repository remote whose Forgejo identity matches instead of preferring origin', () => {
    const upstream = { name: 'upstream', fetchUrl: 'git@git.example.com:owner/repo.git' };
    const repository = {
      state: { remotes: [{ name: 'origin', fetchUrl: 'git@other.example.com:fork/repo.git' }, upstream] }
    } as any;

    expect(matchingRemote(repository, 'owner', 'repo', 'https://git.example.com')).toBe(upstream);
  });
});
