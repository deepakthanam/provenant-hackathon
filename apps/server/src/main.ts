import { loadEnv } from '@provenant/config';
import { createDb } from '@provenant/db';
import { buildApp } from './app';

const env = loadEnv();
const db = createDb(env.DATABASE_URL);

const app = await buildApp({
  env,
  pingDb: async () => {
    try {
      await db.$client.query('select 1');
      return true;
    } catch {
      return false;
    }
  },
});

const close = async () => {
  await app.close();
  await db.$client.end();
  process.exit(0);
};
process.on('SIGINT', close);
process.on('SIGTERM', close);

await app.listen({ port: env.PORT, host: '0.0.0.0' });
