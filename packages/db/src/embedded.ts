import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Env } from '@provenant/config';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { ping } from './index';

/** Explicit UTF-8 (template0 allows it whatever the cluster default is). */
export const UTF8_DB = "encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0";

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
    // Windows initdb defaults to the system code page (e.g. WIN1252); evidence text must be UTF-8.
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
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
  if (exists.rowCount === 0) {
    await admin.query(`create database "${database.replace(/"/g, '')}" ${UTF8_DB}`);
  }
  await admin.end();

  return {
    kind: 'embedded',
    stop: async () => {
      // embedded-postgres's own stop() hard-kills on Windows, forcing crash recovery next start;
      // a fast pg_ctl shutdown is clean. Fall back to it only if pg_ctl fails.
      const res = await pgCtlStop(databaseDir);
      if (res.status !== 0) return server.stop();
      // Let the spawned child's handle close so the host process can exit promptly.
      const child = (server as unknown as { process?: import('node:child_process').ChildProcess }).process;
      if (child && child.exitCode === null) {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 5000);
          child.once('exit', () => {
            clearTimeout(t);
            resolve();
          });
        });
      }
      child?.stderr?.destroy();
      child?.stdout?.destroy();
      child?.stdin?.destroy();
      child?.unref();
      // embedded-postgres registers an exit hook that calls its own stop(); with the process already
      // gone that would wait on an exit event that never comes, so mark it stopped.
      (server as unknown as { process?: unknown }).process = undefined;
    },
  };
}

async function pgCtlStop(databaseDir: string): Promise<{ status: number | null; output: string }> {
  // The binaries live in a per-platform package that embedded-postgres depends on; it exports `pg_ctl`.
  const fromEmbedded = createRequire(createRequire(import.meta.url).resolve('embedded-postgres'));
  const os = process.platform === 'win32' ? 'windows' : process.platform;
  const binaries = (await import(
    pathToFileURL(fromEmbedded.resolve(`@embedded-postgres/${os}-${process.arch}`)).href
  )) as { pg_ctl: string };
  const res = spawnSync(binaries.pg_ctl, ['stop', '-D', databaseDir, '-m', 'fast', '-w', '-t', '30'], {
    encoding: 'utf8',
  });
  return { status: res.status, output: (res.stdout || res.stderr || '').trim() };
}

/**
 * Stops an embedded Postgres left running by a process that was killed hard (Windows does not
 * forward termination to children). Uses the bundled pg_ctl so the data dir is shut down cleanly.
 */
export async function stopOrphanedEmbedded(repoRoot: string): Promise<string> {
  const databaseDir = join(repoRoot, 'data', 'pg');
  if (!existsSync(join(databaseDir, 'postmaster.pid'))) return 'embedded Postgres is not running';
  const res = await pgCtlStop(databaseDir);
  if (/No such process|not running/i.test(res.output)) {
    return 'embedded Postgres is not running (stale lock file; Postgres clears it on next start)';
  }
  return res.output;
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
