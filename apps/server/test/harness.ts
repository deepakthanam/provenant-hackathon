import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { envSchema } from '@provenant/config';
import { generateApiKey, seedDemo } from '@provenant/db/seed';
import { createTestDatabase, type TestDatabase } from '@provenant/db/testing';
import { generateKeyPairB64, LocalBlobStore, Signer } from '@provenant/evidence';
import { MockPayPal, type PayPalClient, type WebhookSink } from '@provenant/paypal';
import type { FastifyInstance } from 'fastify';
import { inject } from 'vitest';
import { buildApp } from '../src/app';

export interface Harness {
  app: FastifyInstance;
  tdb: TestDatabase;
  keys: { admin: string; platform: string; merchant: string };
  /** The in-process mock (unless a custom client was passed). */
  mock: MockPayPal;
  close(): Promise<void>;
}

export async function createHarness(
  opts: {
    pingDb?: () => Promise<boolean>;
    webhookSink?: WebhookSink;
    paypal?: (mock: MockPayPal) => PayPalClient;
  } = {},
): Promise<Harness> {
  const tdb = await createTestDatabase(inject('databaseUrl'));
  const keys = {
    admin: generateApiKey('admin'),
    platform: generateApiKey('platform'),
    merchant: generateApiKey('merchant'),
  };
  await seedDemo(tdb.db, keys);
  const env = envSchema.parse({ NODE_ENV: 'test' });
  const mock = new MockPayPal({
    db: tdb.db,
    baseUrl: 'http://localhost/mock-paypal',
    webhookSink: opts.webhookSink,
  });
  const app = await buildApp({
    env,
    db: tdb.db,
    signer: Signer.fromB64(generateKeyPairB64().privateKey),
    blobStore: new LocalBlobStore(mkdtempSync(join(tmpdir(), 'pv-srv-'))),
    paypal: opts.paypal ? opts.paypal(mock) : mock,
    pingDb: opts.pingDb,
  });
  return {
    app,
    tdb,
    keys,
    mock,
    async close() {
      await app.close();
      await tdb.drop();
    },
  };
}

export const bearer = (key: string) => ({ authorization: `Bearer ${key}` });
