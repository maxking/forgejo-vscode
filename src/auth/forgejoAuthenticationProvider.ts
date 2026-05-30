import * as vscode from 'vscode';
import { getAllInstances, removeInstance } from '../utils/instanceHelpers';
import { ForgejoInstance } from '../models/instance';

function toSession(instance: ForgejoInstance): vscode.AuthenticationSession {
	return {
		id: instance.id,
		accessToken: instance.token ?? '',
		scopes: ['api'],
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

	private _knownSessions: vscode.AuthenticationSession[] = [];

	constructor() {
		this.onDidChangeSessions = this._emitter.event;
		this._configListener = vscode.workspace.onDidChangeConfiguration(async e => {
			if (e.affectsConfiguration('forgejo.instances')) {
				await this._diffAndFire();
			}
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

	async getSessions(): Promise<vscode.AuthenticationSession[]> {
		const instances = await getAllInstances();
		const sessions = instances.filter(i => i.token).map(toSession);
		this._knownSessions = sessions;
		return sessions;
	}

	async createSession(): Promise<vscode.AuthenticationSession> {
		const oldSessions = await this.getSessions();
		const oldIds = new Set(oldSessions.map(s => s.id));

		await vscode.commands.executeCommand('forgejo.addInstance');

		// The configuration-change listener may already have refreshed and fired.
		const knownBeforeRefresh = this._knownSessions;
		const newSessions = await this.getSessions();
		const session = newSessions.find(s => !oldIds.has(s.id));

		if (!session) throw new Error('No Forgejo instance was added.');

		const alreadyKnown = knownBeforeRefresh.some(s => s.id === session.id);
		if (!alreadyKnown) {
			this._emitter.fire({ added: [session], removed: [], changed: [] });
		}

		return session;
	}

	async removeSession(sessionId: string): Promise<void> {
		const session = this._knownSessions.find(s => s.id === sessionId);
		await removeInstance(sessionId);
		if (session) {
			this._knownSessions = this._knownSessions.filter(s => s.id !== sessionId);
			this._emitter.fire({ added: [], removed: [session], changed: [] });
		}
	}

	dispose(): void {
		this._configListener.dispose();
		this._emitter.dispose();
	}
}
