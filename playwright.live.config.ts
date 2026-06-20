import type {
  VSCodeTestOptions,
  VSCodeWorkerOptions,
} from '@mshanemc/vscode-test-playwright';
import { defineConfig } from '@playwright/test';
import path from 'path';

export default defineConfig<VSCodeTestOptions, VSCodeWorkerOptions>({
  testDir: path.join(__dirname, 'src', 'test', 'e2e-vscode'),
  testMatch: '**/*-live.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    extensionDevelopmentPath: __dirname,
    vscodeTrace: 'on',
  },
  projects: [
    {
      name: 'stable',
      // In CI the live-test Docker image bakes a pinned VS Code at
      // /opt/vscode-test and exports VSCODE_TEST_VERSION; @vscode/test-electron
      // then reuses that install and skips the 241 MB download. Locally this
      // falls back to 'stable' (downloaded/cached under .vscode-test as usual).
      use: { vscodeVersion: process.env.VSCODE_TEST_VERSION ?? 'stable' },
    },
  ],
});
