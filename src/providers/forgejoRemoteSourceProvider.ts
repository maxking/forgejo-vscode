import { ForgejoClient } from '../api/forgejoClient';
import { ForgejoInstance } from '../models/instance';
import type { RemoteSource, RemoteSourceProvider } from '../types/git';

export class ForgejoRemoteSourceProvider implements RemoteSourceProvider {
	readonly name: string;
	readonly icon = 'forgejo-logo';
	readonly supportsQuery = true;

	readonly #client: ForgejoClient;
	readonly #sshHost?: string;
	readonly #sshPort?: number;

	constructor(instance: ForgejoInstance) {
		this.name = `Forgejo (${instance.name})`;
		this.#client = new ForgejoClient(instance.instanceUrl, instance.token ?? '');
		this.#sshHost = instance.sshHost;
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
				rewriteSshCloneUrl(repo.ssh_url, this.#sshHost, this.#sshPort),
				repo.clone_url,
			].filter((url): url is string => typeof url === 'string' && url.length > 0),
		}));
	}
}

/**
 * Rewrites an SSH clone URL to match the user's reachable SSH service.
 *
 * `sshHost` and `sshPort` are independent options and compose:
 * - `sshHost` swaps the hostname (for split SSH/HTTPS host deployments,
 *   e.g. SSH as a direct Kubernetes Service and HTTPS behind an API gateway).
 * - `sshPort` injects the port when the clone URL doesn't already specify one.
 * Both may be set at once (e.g. SSH on `ssh.example.com:2222`).
 */
function rewriteSshCloneUrl(sshUrl: string | undefined, sshHost: string | undefined, sshPort: number | undefined): string | undefined {
	if (!sshUrl) {
		return sshUrl;
	}

	let result = sshUrl;
	if (sshHost) {
		result = applySshHost(result, sshHost);
	}

	if (isValidSshPort(sshPort)) {
		result = applySshPort(result, sshPort);
	}

	return result;
}

function applySshHost(sshUrl: string, sshHost: string): string {
	const trimmedHost = sshHost.trim();
	if (!trimmedHost) {
		return sshUrl;
	}

	// ssh:// protocol form: ssh://[user@]host[:port]/path
	try {
		const parsedUrl = new URL(sshUrl);
		if (parsedUrl.protocol === 'ssh:' && parsedUrl.hostname) {
			parsedUrl.hostname = trimmedHost;
			return parsedUrl.toString();
		}
	} catch {
		// Not an ssh:// URL; fall through to scp-style handling.
	}

	// scp-style form: [user@]host:path
	const match = /^([^@\s]*@)?([^:\s]+):(.+)$/.exec(sshUrl);
	if (match) {
		const userPrefix = match[1] || '';
		const path = match[3] || '';
		return `${userPrefix}${trimmedHost}:${path}`;
	}

	return sshUrl;
}

function applySshPort(sshUrl: string, sshPort: number): string {
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

		const user = match[1] || '';
		const host = match[2] || '';
		const path = match[3] || '';
		return `ssh://${user}@${host}:${String(sshPort)}/${path}`;
	}
}

function isValidSshPort(sshPort: number | undefined): sshPort is number {
	return typeof sshPort === 'number' && Number.isInteger(sshPort) && sshPort >= 1 && sshPort <= 65535;
}
