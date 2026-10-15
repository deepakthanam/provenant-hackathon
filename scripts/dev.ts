/** `pnpm dev`: database (embedded if needed) + migrations, then server, console and demo store via Turborepo. */
import { spawn } from 'node:child_process';
import { findRepoRoot, loadEnv } from '@provenant/config';
import { bootDatabase, onShutdown } from './lib/stack';

const env = loadEnv();
const pg = await bootDatabase();

const child = spawn(
  'turbo',
  [
    'run',
    'dev',
    '--filter=@provenant/server',
    '--filter=@provenant/console',
    '--filter=@provenant/demo-store',
  ],
  { cwd: findRepoRoot(), stdio: 'inherit', shell: true },
);

console.log(
  `\n  server   ${env.PUBLIC_BASE_URL}\n  console  ${env.CONSOLE_PUBLIC_URL}\n  store    ${env.DEMO_STORE_URL}\n`,
);

onShutdown(async () => {
  child.kill();
  await pg.stop();
});
child.on('exit', async (code) => {
  await pg.stop();
  process.exit(code ?? 0);
});
