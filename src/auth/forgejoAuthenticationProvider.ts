import * as vscode from 'vscode';
import { getAllInstances } from '../utils/instanceHelpers';
import { deleteToken, onDidChangeToken } from '../utils/secretStorage';
import { ForgejoInstance } from '../models/instance';

const DEFAULT_SCOPES = ['api'];

function normalizeScopes(scopes?: readonly string[]): string[] {
	return scopes && scopes.length > 0 ? [...scopes] : DEFAULT_SCOPES;
}

function toSession(instance: ForgejoInstance, scopes?: readonly string[]): vscode.AuthenticationSession {
	return {
		id: instance.id,
		accessToken: instance.token ?? '',
		scopes: normalizeScopes(scopes),
		account: {
			id: instance.id,
			label: `${instance.username ?? instance.name} - ${instance.instanceUrl}`,
		},
	};
}

export class ForgejoAuthenticationProvider implements vscode.AuthenticationProvider, vscode.Disposable {
	readonly onDidChangeSessions: vscode.Event<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>;

	private readonly _emitter =
		new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();

	private readonly _configListener: vscode.Disposable;
	private readonly _tokenListener: vscode.Disposable;

	private _knownSessions: vscode.AuthenticationSession[] = [];
	private _tokenMutationInProgress = false;

	constructor() {
		this.onDidChangeSessions = this._emitter.event;
		this._configListener = vscode.workspace.onDidChangeConfiguration(async e => {
			if (e.affectsConfiguration('forgejo.instances')) {
				await this._diffAndFire();
			}
		});
		this._tokenListener = onDidChangeToken(() => {
			if (!this._tokenMutationInProgress) void this._diffAndFire();
		});
	}

	private async _diffAndFire(): Promise<void> {
		const oldSessions = this._knownSessions;
		const newSessions = await this.getSessions();
		const oldById = new Map(oldSessions.map(s => [s.id, s]));
		const newById = new Map(newSessions.map(s => [s.id, s]));

		const added = newSessions.filter(s => !oldById.has(s.id));
		const removed = oldSessions.filter(s => !newById.has(s.id));
		const changed = newSessions.filter(s => {
			const old = oldById.get(s.id);
			return old && (old.accessToken !== s.accessToken || old.account.label !== s.account.label);
		});

		if (added.length || removed.length || changed.length) {
			this._emitter.fire({ added, removed, changed });
		}
	}

	async getSessions(scopes?: readonly string[]): Promise<vscode.AuthenticationSession[]> {
		const instances = await getAllInstances();
		const sessionInstances = instances.filter(i => i.token);
		const defaultSessions = sessionInstances.map(i => toSession(i));
		this._knownSessions = defaultSessions;
		return sessionInstances.map(i => toSession(i, scopes));
	}

	async createSession(scopes: readonly string[] = DEFAULT_SCOPES): Promise<vscode.AuthenticationSession> {
		const oldSessions = await this.getSessions();
		const oldIds = new Set(oldSessions.map(s => s.id));

		await vscode.commands.executeCommand('forgejo.addInstance');

		// The configuration-change listener may already have refreshed and fired.
		const knownBeforeRefresh = this._knownSessions;
		const newSessions = await this.getSessions();
		const defaultSession = newSessions.find(s => !oldIds.has(s.id));

		if (!defaultSession) throw new Error('No Forgejo instance was added.');

		const session = { ...defaultSession, scopes: normalizeScopes(scopes) };
		const alreadyKnown = knownBeforeRefresh.some(s => s.id === session.id);
		if (!alreadyKnown) {
			this._emitter.fire({ added: [session], removed: [], changed: [] });
		}

		return session;
	}

	async removeSession(sessionId: string): Promise<void> {
		this._tokenMutationInProgress = true;
		try {
			await deleteToken(sessionId);
		} finally {
			this._tokenMutationInProgress = false;
		}
		await this._diffAndFire();
	}

	dispose(): void {
		this._configListener.dispose();
		this._tokenListener.dispose();
		this._emitter.dispose();
	}
}
