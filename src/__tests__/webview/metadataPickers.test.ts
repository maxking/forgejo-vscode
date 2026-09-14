import * as vscode from 'vscode';
import { ForgejoClient } from '../../api/forgejoClient';
import { pickLabels, pickAssignees, pickMilestone } from '../../webview/shared/metadataPickers';

jest.mock('../../api/forgejoClient');

const MockForgejoClient = ForgejoClient as jest.MockedClass<typeof ForgejoClient>;

describe('metadataPickers', () => {
  let client: ForgejoClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new MockForgejoClient('https://git.example.com', 'token');
  });

  describe('pickLabels', () => {
    it('pre-checks the entity\'s current labels by name and returns the selected IDs', async () => {
      (client.listRepoLabels as jest.Mock).mockResolvedValue([
        { id: 1, name: 'bug', color: 'ff0000' },
        { id: 2, name: 'feature', color: '00ff00' },
        { id: 3, name: 'docs', color: '0000ff' }
      ]);
      const showQuickPickMock = vscode.window.showQuickPick as jest.Mock;
      showQuickPickMock.mockImplementation(async (items) => {
        // Simulate the user confirming exactly what was pre-checked, plus adding docs.
        return items.filter((item: any) => item.picked || item.label === 'docs');
      });

      const result = await pickLabels(client, 'owner', 'repo', ['bug']);

      expect(showQuickPickMock).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ label: 'bug', picked: true, labelId: 1 }),
          expect.objectContaining({ label: 'feature', picked: false, labelId: 2 }),
          expect.objectContaining({ label: 'docs', picked: false, labelId: 3 })
        ]),
        expect.objectContaining({ canPickMany: true })
      );
      expect(result).toEqual([1, 3]);
    });

    it('matches current labels case-insensitively', async () => {
      (client.listRepoLabels as jest.Mock).mockResolvedValue([{ id: 1, name: 'Bug', color: 'ff0000' }]);
      const showQuickPickMock = vscode.window.showQuickPick as jest.Mock;
      showQuickPickMock.mockResolvedValue([]);

      await pickLabels(client, 'owner', 'repo', ['bug']);

      expect(showQuickPickMock).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ label: 'Bug', picked: true })]),
        expect.any(Object)
      );
    });

    it('returns undefined when the user cancels', async () => {
      (client.listRepoLabels as jest.Mock).mockResolvedValue([{ id: 1, name: 'bug', color: 'ff0000' }]);
      (vscode.window.showQuickPick as jest.Mock).mockResolvedValue(undefined);

      const result = await pickLabels(client, 'owner', 'repo', []);

      expect(result).toBeUndefined();
    });

    it('returns undefined and informs the user when the repo has no labels', async () => {
      (client.listRepoLabels as jest.Mock).mockResolvedValue([]);

      const result = await pickLabels(client, 'owner', 'repo', []);

      expect(result).toBeUndefined();
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('This repository has no labels defined.');
      expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    });

    it('returns an empty array (clears all labels) when the user confirms with nothing selected', async () => {
      (client.listRepoLabels as jest.Mock).mockResolvedValue([{ id: 1, name: 'bug', color: 'ff0000' }]);
      (vscode.window.showQuickPick as jest.Mock).mockResolvedValue([]);

      const result = await pickLabels(client, 'owner', 'repo', ['bug']);

      expect(result).toEqual([]);
    });
  });

  describe('pickAssignees', () => {
    it('pre-checks current assignees by login and returns selected logins', async () => {
      (client.listAssignableUsers as jest.Mock).mockResolvedValue([
        { id: 1, login: 'alice' },
        { id: 2, login: 'bob' }
      ]);
      const showQuickPickMock = vscode.window.showQuickPick as jest.Mock;
      showQuickPickMock.mockResolvedValue([{ label: 'alice', picked: true, login: 'alice' }]);

      const result = await pickAssignees(client, 'owner', 'repo', ['alice']);

      expect(showQuickPickMock).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ label: 'alice', picked: true, login: 'alice' }),
          expect.objectContaining({ label: 'bob', picked: false, login: 'bob' })
        ]),
        expect.objectContaining({ canPickMany: true })
      );
      expect(result).toEqual(['alice']);
    });

    it('returns undefined when the user cancels', async () => {
      (client.listAssignableUsers as jest.Mock).mockResolvedValue([{ id: 1, login: 'alice' }]);
      (vscode.window.showQuickPick as jest.Mock).mockResolvedValue(undefined);

      const result = await pickAssignees(client, 'owner', 'repo', []);

      expect(result).toBeUndefined();
    });

    it('returns undefined and informs the user when there are no assignable users', async () => {
      (client.listAssignableUsers as jest.Mock).mockResolvedValue([]);

      const result = await pickAssignees(client, 'owner', 'repo', []);

      expect(result).toBeUndefined();
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('No assignable users found for this repository.');
    });
  });

  describe('pickMilestone', () => {
    it('always includes a "No milestone" option alongside open milestones', async () => {
      (client.listMilestones as jest.Mock).mockResolvedValue([{ id: 5, title: 'v1.0', state: 'open' }]);
      const showQuickPickMock = vscode.window.showQuickPick as jest.Mock;
      showQuickPickMock.mockResolvedValue({ label: 'v1.0', milestoneId: 5 });

      const result = await pickMilestone(client, 'owner', 'repo', undefined);

      expect(client.listMilestones).toHaveBeenCalledWith('owner', 'repo', { state: 'open' });
      expect(showQuickPickMock).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ label: 'No milestone', milestoneId: 0 }),
          expect.objectContaining({ label: 'v1.0', milestoneId: 5 })
        ]),
        expect.any(Object)
      );
      expect(result).toBe(5);
    });

    it('marks the current milestone as "Current" in its description', async () => {
      (client.listMilestones as jest.Mock).mockResolvedValue([{ id: 5, title: 'v1.0', state: 'open' }]);
      const showQuickPickMock = vscode.window.showQuickPick as jest.Mock;
      showQuickPickMock.mockResolvedValue(undefined);

      await pickMilestone(client, 'owner', 'repo', 5);

      expect(showQuickPickMock).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ label: 'v1.0', description: 'Current' })]),
        expect.any(Object)
      );
    });

    it('returns 0 (unset) when "No milestone" is selected', async () => {
      (client.listMilestones as jest.Mock).mockResolvedValue([{ id: 5, title: 'v1.0', state: 'open' }]);
      (vscode.window.showQuickPick as jest.Mock).mockResolvedValue({ label: 'No milestone', milestoneId: 0 });

      const result = await pickMilestone(client, 'owner', 'repo', 5);

      expect(result).toBe(0);
    });

    it('returns undefined when the user cancels', async () => {
      (client.listMilestones as jest.Mock).mockResolvedValue([]);
      (vscode.window.showQuickPick as jest.Mock).mockResolvedValue(undefined);

      const result = await pickMilestone(client, 'owner', 'repo', null);

      expect(result).toBeUndefined();
    });
  });
});
