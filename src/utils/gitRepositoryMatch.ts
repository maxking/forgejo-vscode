import type { Remote, Repository } from '../types/git';
import { parseRemoteUrl } from './gitUtils';

export type { Repository, Remote } from '../types/git';

/**
 * Returns the first non-empty remote URL (fetch, then push) for a Git remote.
 * Filters out missing/empty URL strings so they satisfy strict typing.
 */
export function remoteUrl(remote: Remote): string | undefined {
	return [remote.fetchUrl, remote.pushUrl].find(
		(url): url is string => typeof url === 'string' && url.length > 0
	);
}

/**
 * Parses an instance URL into its host/hostname for matching against git remotes
 * that may use a different transport (e.g. SSH) on the same host.
 */
export function hostForInstanceUrl(instanceUrl?: string): { host: string; hostname: string } | undefined {
	if (!instanceUrl) {
		return undefined;
	}

	try {
		const parsed = new URL(instanceUrl);
		return { host: parsed.host, hostname: parsed.hostname };
	} catch {
		return undefined;
	}
}

/**
 * Whether a VS Code Git repository's remotes point at the given Forgejo
 * owner/repo (and instance URL when one is known).
 *
 * Used to keep branch/PR operations bound to the same local checkout that the
 * resolved Forgejo config came from, instead of shelling out in an unrelated
 * workspace folder.
 */
export function repositoryMatchesConfig(
	repository: Repository,
	owner: string,
	repo: string,
	instanceUrl?: string
): boolean {
	const expectedHost = hostForInstanceUrl(instanceUrl);

	return repository.state.remotes.some(remote => {
		const url = remoteUrl(remote);
		const parsed = url ? parseRemoteUrl(url) : null;
		if (!parsed || parsed.owner !== owner || parsed.repo !== repo) {
			return false;
		}

		return !expectedHost
			|| parsed.instanceUrl === instanceUrl
			|| parsed.remoteHost === expectedHost.host
			|| parsed.remoteHost === expectedHost.hostname;
	});
}
