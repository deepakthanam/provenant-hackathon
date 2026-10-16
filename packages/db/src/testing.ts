import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createDb, type Db, runMigrations } from './index';

export interface TestDatabase {
  db: Db;
  url: string;
  drop(): Promise<void>;
}

/** Creates an isolated, migrated database on the server at `baseUrl`. Call `drop()` in afterAll. */
export async function createTestDatabase(baseUrl: string): Promise<TestDatabase> {
  const name = `pv_test_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  // Cloned from the migrated template prepared once per run (see prepareTestTemplate).
  await adminQuery(baseUrl, `create database ${name} template ${TEMPLATE_DB}`);
  const u = new URL(baseUrl);
  u.pathname = `/${name}`;
  const url = u.toString();
  const db = createDb(url, { max: 5 });
  return {
    db,
    url,
    /** Closes this suite's pool. The databases themselves are dropped in one pass by the global setup. */
    async drop() {
      await db.$client.end();
    },
  };
}

export const TEMPLATE_DB = 'pv_test_template';

/** Creates and migrates the template every test database is cloned from. Run once per test run. */
export async function prepareTestTemplate(baseUrl: string): Promise<void> {
  await adminQuery(baseUrl, `drop database if exists ${TEMPLATE_DB} with (force)`);
  await adminQuery(
    baseUrl,
    `create database ${TEMPLATE_DB} encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0`,
  );
  const u = new URL(baseUrl);
  u.pathname = `/${TEMPLATE_DB}`;
  const db = createDb(u.toString(), { max: 1 });
  try {
    await runMigrations(db);
  } finally {
    await db.$client.end();
  }
}

/** Drops every per-suite test database (run before and after the whole test run). */
export async function dropTestDatabases(baseUrl: string): Promise<number> {
  const client = new pg.Client({ connectionString: baseUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ datname: string }>(
      "select datname from pg_database where datname like 'pv_test_%'",
    );
    for (const r of rows) await client.query(`drop database if exists ${r.datname} with (force)`);
    return rows.length;
  } finally {
    await client.end();
  }
}

async function adminQuery(baseUrl: string, sql: string): Promise<void> {
  const client = new pg.Client({ connectionString: baseUrl });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}
