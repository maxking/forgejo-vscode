import * as vscode from 'vscode';
import {
  addCustomSavedQuery,
  BUILTIN_SAVED_QUERIES,
  CustomSavedQueryConfig,
  getCustomSavedQueries,
  getSavedQueryGroups,
  isBuiltinSavedQuery,
  moveCustomSavedQuery,
  removeCustomSavedQuery,
  updateCustomSavedQuery
} from '../../utils/savedQueries';

describe('savedQueries', () => {
  let stored: CustomSavedQueryConfig[];
  let updateMock: jest.Mock;

  beforeEach(() => {
    stored = [];
    updateMock = jest.fn().mockImplementation(async (_key: string, value: CustomSavedQueryConfig[]) => {
      stored = value;
    });

    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn((_key: string, defaultValue: unknown) => (stored.length > 0 ? stored : defaultValue)),
      update: updateMock
    });
  });

  describe('BUILTIN_SAVED_QUERIES', () => {
    test('exposes exactly the five built-in defaults from #187 in a stable order', () => {
      expect(BUILTIN_SAVED_QUERIES.map(group => group.kind)).toEqual([
        'review',
        'assigned',
        'created',
        'mentioned',
        'recentlyUpdated'
      ]);
      expect(BUILTIN_SAVED_QUERIES.map(group => group.label)).toEqual([
        'Waiting for my review',
        'Assigned to me',
        'Created by me',
        'Mentioned me',
        'Recently updated'
      ]);
    });

    test('only "Waiting for my review" is scoped to pull requests only', () => {
      const targets = Object.fromEntries(BUILTIN_SAVED_QUERIES.map(group => [group.kind, group.target]));
      expect(targets.review).toBe('pullRequests');
      expect(targets.assigned).toBe('both');
      expect(targets.created).toBe('both');
      expect(targets.mentioned).toBe('both');
      expect(targets.recentlyUpdated).toBe('both');
    });

    test('only "Recently updated" is available without authentication', () => {
      const requiresAuth = Object.fromEntries(BUILTIN_SAVED_QUERIES.map(group => [group.kind, group.requiresAuth]));
      expect(requiresAuth.review).toBe(true);
      expect(requiresAuth.assigned).toBe(true);
      expect(requiresAuth.created).toBe(true);
      expect(requiresAuth.mentioned).toBe(true);
      expect(requiresAuth.recentlyUpdated).toBe(false);
    });

    test('isBuiltinSavedQuery distinguishes built-ins from custom queries', () => {
      expect(isBuiltinSavedQuery(BUILTIN_SAVED_QUERIES[0])).toBe(true);
      expect(isBuiltinSavedQuery({ id: 'x', label: 'x', target: 'both', query: 'x', builtin: false })).toBe(false);
    });
  });

  describe('custom saved query CRUD', () => {
    test('getCustomSavedQueries returns an empty list by default', () => {
      expect(getCustomSavedQueries()).toEqual([]);
    });

    test('getSavedQueryGroups returns built-ins followed by custom queries', async () => {
      await addCustomSavedQuery({ label: 'Needs triage', target: 'issues', query: 'label:needs-triage' });

      const groups = getSavedQueryGroups();
      expect(groups.slice(0, 5)).toEqual(BUILTIN_SAVED_QUERIES);
      expect(groups).toHaveLength(6);
      expect(groups[5]).toMatchObject({ label: 'Needs triage', target: 'issues', query: 'label:needs-triage', builtin: false });
    });

    test('addCustomSavedQuery persists a new entry with a generated id', async () => {
      const created = await addCustomSavedQuery({ label: 'Needs triage', target: 'issues', query: 'label:needs-triage' });

      expect(created.id).toEqual(expect.any(String));
      expect(created.id.length).toBeGreaterThan(0);
      expect(updateMock).toHaveBeenCalledWith('savedQueries', [created], vscode.ConfigurationTarget.Global);
      expect(getCustomSavedQueries()).toEqual([{ ...created, builtin: false }]);
    });

    test('updateCustomSavedQuery patches an existing entry by id', async () => {
      const created = await addCustomSavedQuery({ label: 'Needs triage', target: 'issues', query: 'label:needs-triage' });

      const updated = await updateCustomSavedQuery(created.id, { label: 'Triage queue' });

      expect(updated).toBe(true);
      expect(getCustomSavedQueries()[0]).toMatchObject({ label: 'Triage queue', target: 'issues', query: 'label:needs-triage' });
    });

    test('updateCustomSavedQuery returns false for an unknown id', async () => {
      await expect(updateCustomSavedQuery('does-not-exist', { label: 'x' })).resolves.toBe(false);
    });

    test('removeCustomSavedQuery deletes an existing entry by id', async () => {
      const created = await addCustomSavedQuery({ label: 'Needs triage', target: 'issues', query: 'label:needs-triage' });

      await expect(removeCustomSavedQuery(created.id)).resolves.toBe(true);
      expect(getCustomSavedQueries()).toEqual([]);
    });

    test('removeCustomSavedQuery returns false and leaves settings untouched for an unknown id', async () => {
      await addCustomSavedQuery({ label: 'Needs triage', target: 'issues', query: 'label:needs-triage' });
      updateMock.mockClear();

      await expect(removeCustomSavedQuery('does-not-exist')).resolves.toBe(false);
      expect(updateMock).not.toHaveBeenCalled();
      expect(getCustomSavedQueries()).toHaveLength(1);
    });

    test('moveCustomSavedQuery reorders adjacent entries', async () => {
      const first = await addCustomSavedQuery({ label: 'First', target: 'both', query: 'a' });
      const second = await addCustomSavedQuery({ label: 'Second', target: 'both', query: 'b' });

      await expect(moveCustomSavedQuery(second.id, 'up')).resolves.toBe(true);
      expect(getCustomSavedQueries().map(query => query.id)).toEqual([second.id, first.id]);
    });

    test('moveCustomSavedQuery is a no-op at the top boundary', async () => {
      const first = await addCustomSavedQuery({ label: 'First', target: 'both', query: 'a' });
      await addCustomSavedQuery({ label: 'Second', target: 'both', query: 'b' });
      updateMock.mockClear();

      await expect(moveCustomSavedQuery(first.id, 'up')).resolves.toBe(false);
      expect(updateMock).not.toHaveBeenCalled();
    });

    test('moveCustomSavedQuery is a no-op at the bottom boundary', async () => {
      await addCustomSavedQuery({ label: 'First', target: 'both', query: 'a' });
      const second = await addCustomSavedQuery({ label: 'Second', target: 'both', query: 'b' });
      updateMock.mockClear();

      await expect(moveCustomSavedQuery(second.id, 'down')).resolves.toBe(false);
      expect(updateMock).not.toHaveBeenCalled();
    });

    test('moveCustomSavedQuery returns false for an unknown id', async () => {
      await addCustomSavedQuery({ label: 'First', target: 'both', query: 'a' });

      await expect(moveCustomSavedQuery('does-not-exist', 'up')).resolves.toBe(false);
    });
  });
});
