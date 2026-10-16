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
  await adminQuery(
    baseUrl,
    `create database ${name} encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0`,
  );
  const u = new URL(baseUrl);
  u.pathname = `/${name}`;
  const url = u.toString();
  const db = createDb(url, { max: 5 });
  await runMigrations(db);
  return {
    db,
    url,
    /** Closes this suite's pool. The databases themselves are dropped in one pass by the global setup. */
    async drop() {
      await db.$client.end();
    },
  };
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
