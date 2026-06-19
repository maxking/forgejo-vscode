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
	/** Optional SSH port to use when cloning repositories from this instance */
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
