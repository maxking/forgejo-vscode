/**
 * Minimal type definitions for the VS Code built-in Git extension API.
 * Source: https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts
 * Only the subset needed for RemoteSourcePublisher is included.
 */

import { Uri, Event, Disposable } from 'vscode';

export interface InputBox {
  value: string;
}

export interface RepositoryState {
  readonly HEAD: Branch | undefined;
  readonly remotes: Remote[];
  readonly indexChanges?: Change[];
  readonly workingTreeChanges?: Change[];
  readonly mergeChanges?: Change[];
  readonly onDidChange: Event<void>;
}

export interface Branch {
  readonly name?: string;
  readonly commit?: string;
  readonly upstream?: { name: string; remote: string };
}

export interface Remote {
  readonly name: string;
  readonly fetchUrl?: string;
  readonly pushUrl?: string;
}

export interface Change {
  readonly uri: Uri;
}

export interface CommitOptions {
  all?: boolean | 'tracked';
  amend?: boolean;
  signoff?: boolean;
  signCommit?: boolean;
  empty?: boolean;
}

export interface Repository {
  readonly rootUri: Uri;
  readonly state: RepositoryState;
  readonly inputBox: InputBox;
  add(paths: string[]): Promise<void>;
  commit(message: string, opts?: CommitOptions): Promise<void>;
  addRemote(name: string, url: string): Promise<void>;
  createBranch(name: string, checkout?: boolean, ref?: string): Promise<void>;
  checkout(treeish: string): Promise<void>;
  push(remoteName?: string, branchName?: string, setUpstream?: boolean): Promise<void>;
  fetch(remoteName?: string, ref?: string, depth?: number): Promise<void>;
  getBranch(name: string): Promise<Branch>;
}

export interface RemoteSource {
  readonly name: string;
  readonly description?: string;
  readonly url: string | string[];
}

export interface RemoteSourceProvider {
  readonly name: string;
  readonly icon?: string;
  readonly supportsQuery?: boolean;
  getRemoteSources(query?: string): RemoteSource[] | Promise<RemoteSource[]>;
}

export interface RemoteSourcePublisher {
  readonly name: string;
  readonly icon?: string;
  publishRepository(repository: Repository): Promise<void>;
}

export interface API {
  readonly repositories: Repository[];
  readonly onDidOpenRepository: Event<Repository>;
  readonly onDidCloseRepository: Event<Repository>;
  init(uri: Uri): Promise<Repository | null>;
  registerRemoteSourceProvider(provider: RemoteSourceProvider): Disposable;
  registerRemoteSourcePublisher(publisher: RemoteSourcePublisher): Disposable;
  getRepository(uri: Uri): Repository | null;
}

export interface GitExtension {
  readonly enabled: boolean;
  readonly onDidChangeEnablement: Event<boolean>;
  getAPI(version: 1): API;
}
