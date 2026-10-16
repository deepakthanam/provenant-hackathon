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
    async drop() {
      await db.$client.end();
      await adminQuery(baseUrl, `drop database if exists ${name} with (force)`);
    },
  };
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
