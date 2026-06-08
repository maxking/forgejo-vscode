import * as vscode from 'vscode';
import type { GitExtension } from '../types/git';
import { logInfo } from './logger';

export async function activateGitExtension(): Promise<GitExtension | undefined> {
  const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
  if (!ext) {
    logInfo('Git extension not found, clone/publish features disabled');
    return undefined;
  }

  try {
    return await ext.activate();
  } catch (error) {
    logInfo('Git extension activation failed, clone/publish features disabled', error);
    return undefined;
  }
}
