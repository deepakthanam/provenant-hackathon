/** Runs `next dev|start` on CONSOLE_PORT from the root .env (Next only reads PORT, which the API server owns). */
import { spawn } from 'node:child_process';
import { loadEnv } from '@provenant/config';

const env = loadEnv();
const cmd = process.argv[2] ?? 'dev';
const child = spawn('next', [cmd, '-p', String(env.CONSOLE_PORT)], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, NEXT_PUBLIC_API_BASE_URL: env.PUBLIC_BASE_URL },
});
child.on('exit', (code) => process.exit(code ?? 0));
