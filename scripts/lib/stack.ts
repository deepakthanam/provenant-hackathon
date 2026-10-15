import { findRepoRoot, loadEnv } from '@provenant/config';
import { createDb, runMigrations } from '@provenant/db';
import { ensurePostgres, type PostgresHandle, redact } from '@provenant/db/embedded';

/** Starts (or finds) Postgres and applies migrations. Callers own `handle.stop()`. */
export async function bootDatabase(): Promise<PostgresHandle> {
  const env = loadEnv();
  const handle = await ensurePostgres(env, findRepoRoot());
  console.log(`[postgres] ${handle.kind} database at ${redact(env.DATABASE_URL)}`);
  const db = createDb(env.DATABASE_URL, { max: 1 });
  try {
    await runMigrations(db);
    console.log('[postgres] migrations applied');
  } finally {
    await db.$client.end();
  }
  return handle;
}

/** Runs `stop` once on Ctrl+C / termination, then exits. */
export function onShutdown(stop: () => Promise<void>): void {
  let stopping = false;
  const handler = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await stop();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', handler);
  process.on('SIGTERM', handler);
  process.on('SIGHUP', handler);
}
