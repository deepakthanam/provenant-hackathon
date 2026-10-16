/**
 * `pnpm demo [--no-approve]` — runs the five scenarios. If the stack is not already running it
 * starts it (`pnpm dev`, logs in data/dev.log), waits until it is healthy, runs the scenarios, and
 * keeps everything up so the console shows the results. Ctrl+C stops it.
 */
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot, loadEnv } from '@provenant/config';

const root = findRepoRoot();
const env = loadEnv();
const passThrough = process.argv.slice(2);

async function up(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitFor(urls: string[], timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await Promise.all(urls.map(up))).every(Boolean)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`the stack did not become healthy within ${timeoutMs / 1000}s; see data/dev.log`);
}

const api = `${env.PUBLIC_BASE_URL}/healthz`;
const store = `${env.DEMO_STORE_URL}/healthz`;
const consoleUrl = env.CONSOLE_PUBLIC_URL;
let dev: ChildProcess | null = null;

if (!(await up(api)) || !(await up(store))) {
  mkdirSync(join(root, 'data'), { recursive: true });
  const log = openSync(join(root, 'data', 'dev.log'), 'a');
  console.log('Starting Provenant (API, demo store, console); logs in data/dev.log …');
  dev = spawn('npx', ['tsx', 'scripts/dev.ts'], { cwd: root, stdio: ['ignore', log, log], shell: true });
  await waitFor([api, store], 180_000);
  console.log(`API ${env.PUBLIC_BASE_URL} and store ${env.DEMO_STORE_URL} are up.`);
}

const run = spawn('npx', ['tsx', 'apps/demo-agent/src/scenario-cli.ts', 'all', ...passThrough], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});
const code: number = await new Promise((resolve) => run.on('exit', (c) => resolve(c ?? 1)));

if (!dev) process.exit(code);

// Keep the stack up for the console; make sure the console itself has compiled.
await waitFor([consoleUrl], 120_000).catch(() => undefined);
console.log(`\nThe stack keeps running so you can explore: ${consoleUrl}  (Ctrl+C to stop)`);
const stop = () => {
  dev?.kill('SIGINT');
  // Windows does not pass the signal to the shell's children: stop the ports and Postgres explicitly.
  spawnSync('npx', ['tsx', 'scripts/dev-stop.ts'], { cwd: root, stdio: 'ignore', shell: true });
  process.exit(code);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
dev.on('exit', () => process.exit(code));
