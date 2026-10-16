/**
 * `pnpm dev:stop` — stops anything still listening on the dev ports and shuts down the embedded
 * Postgres. Needed on Windows when a terminal is closed (children are not signalled).
 */
import { execSync } from 'node:child_process';
import { findRepoRoot, loadEnv } from '@provenant/config';
import { stopOrphanedEmbedded } from '@provenant/db/embedded';

const env = loadEnv();
const ports = [env.PORT, env.CONSOLE_PORT, env.DEMO_STORE_PORT];

function pidsOn(port: number): string[] {
  try {
    if (process.platform === 'win32') {
      return execSync('netstat -ano -p tcp', { encoding: 'utf8' })
        .split(/\r?\n/)
        .filter((l) => /LISTENING/.test(l) && new RegExp(`:${port}\\s`).test(l))
        .map((l) => l.trim().split(/\s+/).pop()!)
        .filter((pid) => pid && pid !== '0');
    }
    return execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: 'utf8' }).split(/\s+/).filter(Boolean);
  } catch {
    return [];
  }
}

for (const port of ports) {
  for (const pid of new Set(pidsOn(port))) {
    try {
      if (process.platform === 'win32') execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
      else process.kill(Number(pid), 'SIGTERM');
      console.log(`stopped pid ${pid} on :${port}`);
    } catch {
      /* already gone */
    }
  }
}
console.log(await stopOrphanedEmbedded(findRepoRoot()));
