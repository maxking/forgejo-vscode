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
	}

	async getRemoteSources(query?: string): Promise<RemoteSource[]> {
		const repos = await this.#client.searchRepositories(query);
		return repos.map(repo => ({
			name: `$(repo) ${repo.full_name}`,
			description: repo.description || undefined,
			url: [repo.ssh_url, repo.clone_url],
		}));
	}
}
