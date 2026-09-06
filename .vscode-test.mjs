import { defineConfig } from '@vscode/test-cli';
import { tmpdir } from 'os';
import { join } from 'path';

const userDataDir = process.env.VSCODE_TEST_USER_DATA_DIR ?? join(tmpdir(), `forgejo-vscode-test-user-data-${process.pid}`);

export default defineConfig({
  version: process.env.VSCODE_TEST_VERSION ?? '1.123.0',
  files: 'out/test/**/*.test.js',
  launchArgs: [`--user-data-dir=${userDataDir}`],
  mocha: {
    ui: 'tdd',
    timeout: 20000,
    color: true
  }
});
