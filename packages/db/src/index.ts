import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as schema from './schema';

export * from './schema';
export { schema };
export type Db = NodePgDatabase<typeof schema> & { $client: pg.Pool };

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

export function createDb(databaseUrl: string, opts: { max?: number } = {}): Db {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: opts.max ?? 10 });
  return drizzle(pool, { schema }) as Db;
}

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder });
}

/** Resolves true when a trivial query succeeds within `timeoutMs`. */
export async function ping(databaseUrl: string, timeoutMs = 2000): Promise<boolean> {
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: timeoutMs });
  try {
    await client.connect();
    await client.query('select 1');
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}
