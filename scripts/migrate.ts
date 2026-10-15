/** `pnpm db:migrate`: apply Drizzle migrations (starting embedded Postgres for the duration if needed). */
import { bootDatabase } from './lib/stack';

const pg = await bootDatabase();
await pg.stop();
