import { ForgejoClient } from '../api/forgejoClient';
import { ForgejoInstance } from '../models/instance';
import type { RemoteSource, RemoteSourceProvider } from '../types/git';

export class ForgejoRemoteSourceProvider implements RemoteSourceProvider {
	readonly name: string;
	readonly supportsQuery = true;

	readonly #client: ForgejoClient;

	constructor(instance: ForgejoInstance) {
		this.name = `Forgejo (${instance.name})`;
		this.#client = new ForgejoClient(instance.instanceUrl, instance.token ?? '');
	}

	async getRemoteSources(query?: string): Promise<RemoteSource[]> {
		if (query && /^(https?:\/\/|git@|ssh:\/\/)/.test(query)) {
			return [{ name: query, url: query }];
		}

		const repos = query && query.length >= 2
			? await this.#client.listUserRepos(query, 30)
			: await this.#client.listUserRepos();
		return repos.map(repo => ({
			name: `$(repo) ${repo.full_name}`,
			description: repo.description || undefined,
			url: [repo.ssh_url, repo.clone_url].filter((url): url is string => typeof url === 'string' && url.length > 0),
		}));
	}
}
