/** `pnpm db`: run Postgres (embedded if nothing is listening) in the foreground until Ctrl+C. */
import { bootDatabase, onShutdown } from './lib/stack';

const pg = await bootDatabase();
if (pg.kind === 'external') {
  console.log('an external Postgres is already running; nothing to keep alive.');
  process.exit(0);
}
console.log('embedded Postgres is running. Press Ctrl+C to stop.');
onShutdown(() => pg.stop());
setInterval(() => {}, 1 << 30);
