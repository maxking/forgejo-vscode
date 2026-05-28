import { ForgejoClient } from '../api/forgejoClient';
import { ForgejoInstance } from '../models/instance';
import type { RemoteSource, RemoteSourceProvider } from '../types/git';

export class ForgejoRemoteSourceProvider implements RemoteSourceProvider {
	readonly name: string;
	readonly icon = 'forgejo-logo';
	readonly supportsQuery = true;

	readonly #client: ForgejoClient;

	constructor(instance: ForgejoInstance) {
		this.name = `Forgejo (${instance.name})`;
		this.#client = new ForgejoClient(instance.instanceUrl, instance.token ?? '');
		// Pre-warm TLS connection so the first clone dialog open is instant
		void this.#client.listUserRepos(undefined, 1);
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
			url: [repo.ssh_url, repo.clone_url],
		}));
	}
}
