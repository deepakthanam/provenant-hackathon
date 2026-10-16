import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // One process, one Postgres: packages run as projects so DB-backed suites share the global setup.
    projects: ['packages/*', 'apps/*'],
    globalSetup: ['./vitest.global-setup.ts'],
    passWithNoTests: true,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
