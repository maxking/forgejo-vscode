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
      // CI can override the pinned version through VSCODE_TEST_VERSION. Keep
      // local and CI runs deterministic instead of following a moving stable build.
      use: { vscodeVersion: process.env.VSCODE_TEST_VERSION ?? '1.123.0' },
    },
  ],
});
