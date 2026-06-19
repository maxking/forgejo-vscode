import { ForgejoClient } from '../api/forgejoClient';
import { ForgejoInstance } from '../models/instance';
import type { RemoteSource, RemoteSourceProvider } from '../types/git';

export class ForgejoRemoteSourceProvider implements RemoteSourceProvider {
	readonly name: string;
	readonly icon = 'forgejo-logo';
	readonly supportsQuery = true;

	readonly #client: ForgejoClient;
	readonly #sshPort?: number;

	constructor(instance: ForgejoInstance) {
		this.name = `Forgejo (${instance.name})`;
		this.#client = new ForgejoClient(instance.instanceUrl, instance.token ?? '');
		this.#sshPort = instance.sshPort;
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
			url: [
				applySshPort(repo.ssh_url, this.#sshPort),
				repo.clone_url,
			].filter((url): url is string => typeof url === 'string' && url.length > 0),
		}));
	}
}

function applySshPort(sshUrl: string | undefined, sshPort: number | undefined): string | undefined {
	if (!sshUrl || !isValidSshPort(sshPort)) {
		return sshUrl;
	}

	try {
		const parsedUrl = new URL(sshUrl);
		if (parsedUrl.protocol !== 'ssh:' || !parsedUrl.hostname || parsedUrl.port) {
			return sshUrl;
		}

		parsedUrl.port = String(sshPort);
		return parsedUrl.toString();
	} catch {
		const match = /^([^@\s]+)@([^:\s]+):(.+)$/.exec(sshUrl);
		if (!match) {
			return sshUrl;
		}

		const [, user, host, path] = match;
		return `ssh://${user}@${host}:${String(sshPort)}/${path}`;
	}
}

function isValidSshPort(sshPort: number | undefined): sshPort is number {
	return typeof sshPort === 'number' && Number.isInteger(sshPort) && sshPort >= 1 && sshPort <= 65535;
}
