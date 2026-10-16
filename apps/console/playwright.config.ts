import { defineConfig } from '@playwright/test';

/**
 * Smoke test against the running stack (`pnpm dev`). The global setup places a fresh
 * agent purchase and dispute (`pnpm scenario remorse --no-approve`) so there is something to approve.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: process.env.CONSOLE_URL ?? 'http://localhost:3001',
    viewport: { width: 1440, height: 900 },
  },
  reporter: [['list']],
});
