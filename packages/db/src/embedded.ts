import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Env } from '@provenant/config';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { ping } from './index';

export interface PostgresHandle {
  /** 'external' when DATABASE_URL was already reachable, 'embedded' when we started one. */
  kind: 'external' | 'embedded';
  stop(): Promise<void>;
}

function isLocalHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

/**
 * Makes sure DATABASE_URL points at a running Postgres.
 * In `auto` mode an existing server wins; otherwise a Postgres 16 binary (via the
 * `embedded-postgres` package) is started with its data under `<repo>/data/pg`.
 */
export async function ensurePostgres(env: Env, repoRoot: string, log = console.log): Promise<PostgresHandle> {
  const noop: PostgresHandle = { kind: 'external', stop: async () => {} };
  if (env.DATABASE_MODE !== 'embedded' && (await ping(env.DATABASE_URL))) return noop;
  if (env.DATABASE_MODE === 'external') {
    throw new Error(`DATABASE_MODE=external but ${redact(env.DATABASE_URL)} is not reachable.`);
  }

  const url = new URL(env.DATABASE_URL);
  if (!isLocalHost(url.hostname)) {
    throw new Error(`Cannot start embedded Postgres for non-local host ${url.hostname}.`);
  }
  const user = decodeURIComponent(url.username || 'provenant');
  const password = decodeURIComponent(url.password || 'provenant');
  const database = url.pathname.replace(/^\//, '') || 'provenant';
  const port = Number(url.port || 5432);
  const databaseDir = join(repoRoot, 'data', 'pg');

  const server = new EmbeddedPostgres({
    databaseDir,
    user,
    password,
    port,
    persistent: true,
    onLog: () => {},
    onError: (e: unknown) => log(`[postgres] ${String(e).trim()}`),
  });

  if (!existsSync(join(databaseDir, 'PG_VERSION'))) {
    mkdirSync(join(repoRoot, 'data'), { recursive: true });
    log(`[postgres] initialising embedded Postgres 16 in ${databaseDir}`);
    await server.initialise();
  }
  log(`[postgres] starting embedded Postgres on port ${port}`);
  await server.start();

  const admin = new pg.Client({ host: '127.0.0.1', port, user, password, database: 'postgres' });
  await admin.connect();
  const exists = await admin.query('select 1 from pg_database where datname = $1', [database]);
  if (exists.rowCount === 0) await admin.query(`create database "${database.replace(/"/g, '')}"`);
  await admin.end();

  return {
    kind: 'embedded',
    stop: async () => {
      await server.stop();
    },
  };
}

/**
 * Stops an embedded Postgres left running by a process that was killed hard (Windows does not
 * forward termination to children). Uses the bundled pg_ctl so the data dir is shut down cleanly.
 */
export async function stopOrphanedEmbedded(repoRoot: string): Promise<string> {
  const databaseDir = join(repoRoot, 'data', 'pg');
  if (!existsSync(join(databaseDir, 'postmaster.pid'))) return 'embedded Postgres is not running';
  // The binaries live in a per-platform package that embedded-postgres depends on; it exports `pg_ctl`.
  const fromEmbedded = createRequire(createRequire(import.meta.url).resolve('embedded-postgres'));
  const os = process.platform === 'win32' ? 'windows' : process.platform;
  const binaries = (await import(
    pathToFileURL(fromEmbedded.resolve(`@embedded-postgres/${os}-${process.arch}`)).href
  )) as { pg_ctl: string };
  const res = spawnSync(binaries.pg_ctl, ['stop', '-D', databaseDir, '-m', 'fast'], { encoding: 'utf8' });
  return (res.stdout || res.stderr || '').trim();
}

export function redact(databaseUrl: string): string {
  try {
    const u = new URL(databaseUrl);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '<invalid DATABASE_URL>';
  }
}
