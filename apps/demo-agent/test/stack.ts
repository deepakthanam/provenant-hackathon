import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Env, envSchema } from '@provenant/config';
import { generateApiKey, seedDemo } from '@provenant/db/seed';
import { createTestDatabase, type TestDatabase } from '@provenant/db/testing';
import { generateKeyPairB64, LocalBlobStore, Signer } from '@provenant/evidence';
import { httpWebhookSink, MockPayPal } from '@provenant/paypal';
import type { FastifyInstance } from 'fastify';
import { inject } from 'vitest';
import { buildStore } from '../../demo-store/src/store';
import { buildApp } from '../../server/src/app';

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

export interface Stack {
  env: Env;
  server: FastifyInstance;
  store: FastifyInstance;
  mock: MockPayPal;
  tdb: TestDatabase;
  close(): Promise<void>;
}

/**
 * The whole system on real ports: API server (with mock PayPal at /mock-paypal and, optionally,
 * webhooks delivered to its own /webhooks/paypal over HTTP) and the demo store.
 */
export async function startStack(opts: { webhooks?: boolean } = {}): Promise<Stack> {
  const tdb = await createTestDatabase(inject('databaseUrl'));
  const keys = {
    admin: generateApiKey('admin'),
    platform: generateApiKey('platform'),
    merchant: generateApiKey('merchant'),
  };
  await seedDemo(tdb.db, keys);
  const [apiPort, storePort] = [await freePort(), await freePort()];
  const dataDir = mkdtempSync(join(tmpdir(), 'pv-stack-'));
  const env = envSchema.parse({
    NODE_ENV: 'test',
    PUBLIC_BASE_URL: `http://127.0.0.1:${apiPort}`,
    DEMO_STORE_URL: `http://127.0.0.1:${storePort}`,
    PROVENANT_ADMIN_API_KEY: keys.admin,
    PROVENANT_PLATFORM_API_KEY: keys.platform,
    PROVENANT_MERCHANT_API_KEY: keys.merchant,
    DATA_DIR: dataDir,
  });
  const mock = new MockPayPal({
    db: tdb.db,
    baseUrl: `${env.PUBLIC_BASE_URL}/mock-paypal`,
    webhookSink:
      opts.webhooks === false ? undefined : httpWebhookSink(`${env.PUBLIC_BASE_URL}/webhooks/paypal`),
  });
  const server = await buildApp({
    env,
    db: tdb.db,
    signer: Signer.fromB64(generateKeyPairB64().privateKey),
    blobStore: new LocalBlobStore(dataDir),
    paypal: mock,
  });
  await server.listen({ port: apiPort, host: '127.0.0.1' });
  const store = await buildStore({
    baseUrl: env.DEMO_STORE_URL,
    provenant: { baseUrl: env.PUBLIC_BASE_URL, apiKey: keys.merchant },
  });
  await store.listen({ port: storePort, host: '127.0.0.1' });
  return {
    env,
    server,
    store,
    mock,
    tdb,
    async close() {
      await mock.flushWebhooks();
      await server.intake.drain();
      await store.close();
      await server.close();
      await tdb.drop();
    },
  };
}
