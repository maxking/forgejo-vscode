import * as fs from 'fs';
import * as path from 'path';
import packageJson from '../../../package.json';

describe('package manifest', () => {
  test('uses a single commandPalette menu contribution', () => {
    const packageJsonPath = path.join(__dirname, '../../../package.json');
    const packageJsonText = fs.readFileSync(packageJsonPath, 'utf8');
    const commandPaletteKeys = packageJsonText.match(/"commandPalette"\s*:/g) ?? [];

    expect(commandPaletteKeys).toHaveLength(1);
  });

  test('hides context-only commands from the command palette', () => {
    expect(packageJson.contributes.menus.commandPalette).toEqual(expect.arrayContaining([
      {
        command: 'forgejo.selectRemoteRepositoryBranch',
        when: 'false',
      },
      {
        command: 'forgejo.openRemoteFile',
        when: 'false',
      },
      {
        command: 'forgejo.createIssueFromTodo',
        when: 'false',
      },
    ]));
  });
});
