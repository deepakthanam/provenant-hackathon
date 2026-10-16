import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const repo = dirname(fileURLToPath(import.meta.url));

/** Every workspace package with tests becomes a project that inherits the root options below. */
const projects = ['apps', 'packages'].flatMap((group) =>
  readdirSync(join(repo, group), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(repo, group, d.name))
    .filter((dir) => {
      try {
        readFileSync(join(dir, 'package.json'));
        return readdirSync(dir).includes('test');
      } catch {
        return false;
      }
    })
    .map((dir) => ({
      extends: true as const,
      test: {
        name: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name as string,
        root: dir,
        // Postgres is started once by the root global setup, not once per project.
        globalSetup: [],
      },
    })),
);

export default defineConfig({
  test: {
    // One process, one Postgres: packages run as projects so DB-backed suites share the global setup.
    projects,
    globalSetup: [fileURLToPath(new URL('./vitest.global-setup.ts', import.meta.url))],
    passWithNoTests: true,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
