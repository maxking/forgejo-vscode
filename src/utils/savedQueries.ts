import * as vscode from 'vscode';
import { ForgejoItemQueryOptions } from '../api/forgejoClient';

export type SavedQueryTarget = 'pullRequests' | 'issues' | 'both';
export type BuiltinSavedQueryKind = 'review' | 'assigned' | 'created' | 'mentioned' | 'recentlyUpdated';

export interface BuiltinSavedQueryDefinition {
  readonly id: string;
  readonly label: string;
  readonly emptyLabel: string;
  readonly target: SavedQueryTarget;
  readonly kind: BuiltinSavedQueryKind;
  readonly icon: string;
  /** Query-options field populated with the signed-in user's login. Absent for queries that aren't user-scoped. */
  readonly filterField?: keyof Pick<ForgejoItemQueryOptions, 'assignedBy' | 'createdBy' | 'mentionedBy' | 'reviewRequestedBy'>;
  /** Server-side sort order, used instead of a user filter. */
  readonly sort?: string;
  readonly requiresAuth: boolean;
  readonly builtin: true;
}

export interface CustomSavedQueryConfig {
  id: string;
  label: string;
  target: SavedQueryTarget;
  query: string;
}

export interface CustomSavedQuery extends CustomSavedQueryConfig {
  readonly builtin: false;
}

export type SavedQueryGroup = BuiltinSavedQueryDefinition | CustomSavedQuery;

/**
 * Fixed, non-persisted built-in query groups. Users can view them but cannot
 * add/edit/remove/reorder them (only custom groups support that, per #187's
 * acceptance criteria distinguishing "view built-in" from "add/edit/remove/
 * reorder custom").
 */
export const BUILTIN_SAVED_QUERIES: readonly BuiltinSavedQueryDefinition[] = [
  {
    id: 'builtin-review',
    label: 'Waiting for my review',
    emptyLabel: 'waiting for my review',
    target: 'pullRequests',
    kind: 'review',
    icon: 'eye',
    filterField: 'reviewRequestedBy',
    requiresAuth: true,
    builtin: true
  },
  {
    id: 'builtin-assigned',
    label: 'Assigned to me',
    emptyLabel: 'assigned to me',
    target: 'both',
    kind: 'assigned',
    icon: 'account',
    filterField: 'assignedBy',
    requiresAuth: true,
    builtin: true
  },
  {
    id: 'builtin-created',
    label: 'Created by me',
    emptyLabel: 'created by me',
    target: 'both',
    kind: 'created',
    icon: 'person',
    filterField: 'createdBy',
    requiresAuth: true,
    builtin: true
  },
  {
    id: 'builtin-mentioned',
    label: 'Mentioned me',
    emptyLabel: 'mentioning me',
    target: 'both',
    kind: 'mentioned',
    icon: 'mention',
    filterField: 'mentionedBy',
    requiresAuth: true,
    builtin: true
  },
  {
    id: 'builtin-recently-updated',
    label: 'Recently updated',
    emptyLabel: 'recently updated',
    target: 'both',
    kind: 'recentlyUpdated',
    icon: 'history',
    sort: 'recentupdate',
    requiresAuth: false,
    builtin: true
  }
];

const SAVED_QUERIES_SETTING = 'savedQueries';

function readCustomSavedQueryConfigs(): CustomSavedQueryConfig[] {
  const config = vscode.workspace.getConfiguration('forgejo');
  const stored = config.get<CustomSavedQueryConfig[]>(SAVED_QUERIES_SETTING, []);
  return Array.isArray(stored) ? stored : [];
}

async function writeCustomSavedQueryConfigs(queries: CustomSavedQueryConfig[]): Promise<void> {
  const config = vscode.workspace.getConfiguration('forgejo');
  await config.update(SAVED_QUERIES_SETTING, queries, vscode.ConfigurationTarget.Global);
}

export function getCustomSavedQueries(): CustomSavedQuery[] {
  return readCustomSavedQueryConfigs().map(query => ({ ...query, builtin: false as const }));
}

export function getSavedQueryGroups(): SavedQueryGroup[] {
  return [...BUILTIN_SAVED_QUERIES, ...getCustomSavedQueries()];
}

export function isBuiltinSavedQuery(group: SavedQueryGroup): group is BuiltinSavedQueryDefinition {
  return group.builtin;
}

function generateCustomSavedQueryId(): string {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface CustomSavedQueryInput {
  label: string;
  target: SavedQueryTarget;
  query: string;
}

export async function addCustomSavedQuery(input: CustomSavedQueryInput): Promise<CustomSavedQueryConfig> {
  const queries = readCustomSavedQueryConfigs();
  const newQuery: CustomSavedQueryConfig = {
    id: generateCustomSavedQueryId(),
    label: input.label,
    target: input.target,
    query: input.query
  };
  queries.push(newQuery);
  await writeCustomSavedQueryConfigs(queries);
  return newQuery;
}

export async function updateCustomSavedQuery(
  id: string,
  patch: Partial<CustomSavedQueryInput>
): Promise<boolean> {
  const queries = readCustomSavedQueryConfigs();
  const index = queries.findIndex(query => query.id === id);
  if (index === -1) {
    return false;
  }

  queries[index] = { ...queries[index], ...patch };
  await writeCustomSavedQueryConfigs(queries);
  return true;
}

export async function removeCustomSavedQuery(id: string): Promise<boolean> {
  const queries = readCustomSavedQueryConfigs();
  const filtered = queries.filter(query => query.id !== id);
  if (filtered.length === queries.length) {
    return false;
  }

  await writeCustomSavedQueryConfigs(filtered);
  return true;
}

export type SavedQueryMoveDirection = 'up' | 'down';

export async function moveCustomSavedQuery(id: string, direction: SavedQueryMoveDirection): Promise<boolean> {
  const queries = readCustomSavedQueryConfigs();
  const index = queries.findIndex(query => query.id === id);
  if (index === -1) {
    return false;
  }

  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= queries.length) {
    return false;
  }

  const reordered = [...queries];
  [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
  await writeCustomSavedQueryConfigs(reordered);
  return true;
}
