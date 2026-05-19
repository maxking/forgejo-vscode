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
			label: `${instance.name} (${instance.instanceUrl})`,
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
		const newSessions = await this.getSessions();
		const oldById = new Map(this._knownSessions.map(s => [s.id, s]));
		const newById = new Map(newSessions.map(s => [s.id, s]));

		const added = newSessions.filter(s => !oldById.has(s.id));
		const removed = this._knownSessions.filter(s => !newById.has(s.id));
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
		await vscode.commands.executeCommand('forgejo.addInstance');
		const instances = await getAllInstances();
		const newest = instances.at(-1);
		if (!newest?.token) throw new Error('No Forgejo instance was added.');
		return toSession(newest);
	}

	async removeSession(sessionId: string): Promise<void> {
		await removeInstance(sessionId);
	}

	dispose(): void {
		this._configListener.dispose();
		this._emitter.dispose();
	}
}
