import { findRepoRoot, loadEnv } from '@provenant/config';
import { ensurePostgres } from '@provenant/db/embedded';
import { dropTestDatabases } from '@provenant/db/testing';
import type { TestProject } from 'vitest/node';

/** Starts (or reuses) Postgres once for the whole run. Suites create their own databases on it. */
export default async function setup(project: TestProject) {
  const env = loadEnv();
  const pg = await ensurePostgres(env, findRepoRoot(), () => {});
  await dropTestDatabases(env.DATABASE_URL);
  project.provide('databaseUrl', env.DATABASE_URL);
  return async () => {
    await dropTestDatabases(env.DATABASE_URL).catch(() => 0);
    await pg.stop();
  };
}
