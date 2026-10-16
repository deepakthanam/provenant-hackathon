import { join } from 'node:path';
import { findRepoRoot, loadEnv } from '@provenant/config';
import { createDb } from '@provenant/db';
import { seedDemo } from '@provenant/db/seed';
import { LocalBlobStore, Signer } from '@provenant/evidence';
import { createServerPayPal, httpWebhookSink } from '@provenant/paypal';
import { buildApp } from './app';

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const dataDir = env.DATA_DIR ?? join(findRepoRoot(), 'data');

await seedDemo(db, {
  admin: env.PROVENANT_ADMIN_API_KEY,
  platform: env.PROVENANT_PLATFORM_API_KEY,
  merchant: env.PROVENANT_MERCHANT_API_KEY,
});

const app = await buildApp({
  env,
  db,
  signer: Signer.fromB64(env.PROVENANT_SIGNING_PRIVATE_KEY),
  blobStore: new LocalBlobStore(dataDir),
  paypal: createServerPayPal(
    env,
    db,
    env.MOCK_PAYPAL_WEBHOOKS ? httpWebhookSink(`${env.PUBLIC_BASE_URL}/webhooks/paypal`) : undefined,
  ),
});

const close = async () => {
  await app.close();
  await db.$client.end();
  process.exit(0);
};
process.on('SIGINT', close);
process.on('SIGTERM', close);

await app.listen({ port: env.PORT, host: '0.0.0.0' });
