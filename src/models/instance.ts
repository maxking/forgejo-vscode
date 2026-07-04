/**
 * Represents a configured Forgejo instance
 */
export interface ForgejoInstance {
	/** Unique identifier for the instance */
	id: string;
	/** User-friendly name for the instance */
	name: string;
	/** Base URL of the Forgejo instance */
	instanceUrl: string;
	/** Optional hostname used by SSH git remotes for this instance, when it
	 *  differs from the web/API host (`instanceUrl`). Used both for matching an
	 *  SSH git remote to this instance and for rewriting SSH clone URLs so they
	 *  point at the SSH service host instead of the web host. Leave unset when
	 *  SSH and HTTPS share the same host.
	 */
	sshHost?: string;

	/** Optional SSH port to use when cloning repositories from this instance.
	 *  @deprecated Prefer `sshHost` for split-host deployments. When `sshHost`
	 *  is set, `sshPort` is ignored. Kept for backward compatibility with
	 *  existing configurations where only the SSH port differs from the web
	 *  host.
	 */
	sshPort?: number;
	/** Personal access token for authentication (hydrated from SecretStorage at runtime) */
	token?: string;
	/** Forgejo username of the authenticated account */
	username?: string;
	/** Whether this is the default instance */
	isDefault?: boolean;
	/** Last connection test result */
	lastConnectionTest?: {
		success: boolean;
		timestamp: number;
		error?: string;
	};
}

/**
 * Result of instance matching algorithm
 */
export interface InstanceMatch {
	instance: ForgejoInstance;
	confidence: 'exact' | 'domain' | 'default' | 'first';
}
