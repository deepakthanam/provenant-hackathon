import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { envSchema } from '@provenant/config';
import { generateApiKey, seedDemo } from '@provenant/db/seed';
import { createTestDatabase, type TestDatabase } from '@provenant/db/testing';
import { generateKeyPairB64, LocalBlobStore, Signer } from '@provenant/evidence';
import { HttpPayPal, MockPayPal } from '@provenant/paypal';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildStore } from '../../demo-store/src/store';
import { buildApp } from '../../server/src/app';
import { runPurchase } from '../src/purchase';

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

let tdb: TestDatabase;
let server: FastifyInstance;
let store: FastifyInstance;
let env: ReturnType<typeof envSchema.parse>;

beforeAll(async () => {
  tdb = await createTestDatabase(inject('databaseUrl'));
  const keys = {
    admin: generateApiKey('admin'),
    platform: generateApiKey('platform'),
    merchant: generateApiKey('merchant'),
  };
  await seedDemo(tdb.db, keys);
  const [apiPort, storePort] = [await freePort(), await freePort()];
  const dataDir = mkdtempSync(join(tmpdir(), 'pv-agent-'));
  env = envSchema.parse({
    NODE_ENV: 'test',
    PUBLIC_BASE_URL: `http://127.0.0.1:${apiPort}`,
    DEMO_STORE_URL: `http://127.0.0.1:${storePort}`,
    PROVENANT_PLATFORM_API_KEY: keys.platform,
    PROVENANT_MERCHANT_API_KEY: keys.merchant,
    DATA_DIR: dataDir,
  });
  server = await buildApp({
    env,
    db: tdb.db,
    signer: Signer.fromB64(generateKeyPairB64().privateKey),
    blobStore: new LocalBlobStore(dataDir),
    paypal: new MockPayPal({ db: tdb.db, baseUrl: `${env.PUBLIC_BASE_URL}/mock-paypal` }),
  });
  await server.listen({ port: apiPort, host: '127.0.0.1' });
  store = await buildStore({
    baseUrl: env.DEMO_STORE_URL,
    provenant: { baseUrl: env.PUBLIC_BASE_URL, apiKey: keys.merchant },
  });
  await store.listen({ port: storePort, host: '127.0.0.1' });
});

afterAll(async () => {
  await store?.close();
  await server?.close();
  await tdb?.drop();
});

const quiet = () => {};

describe('demo agent (mock mode, end to end)', () => {
  it('produces a sealed bundle whose custom_id matches the PayPal order', async () => {
    const r = await runPurchase(env, {
      request: 'black running shoes size 10 under $90, ask me above $50',
      userRef: 'usr_e2e',
      confirm: 'auto',
      log: quiet,
    });
    expect(r.customIdMatches).toBe(true);
    expect(r.verified).toBe(true);
    const paypal = new HttpPayPal({
      baseUrl: `${env.PUBLIC_BASE_URL}/mock-paypal`,
      clientId: 'mock',
      clientSecret: 'mock',
      mode: 'mock',
    });
    const order = await paypal.getOrder(r.orderId);
    expect(order.status).toBe('COMPLETED');
    expect(order.purchase_units?.[0]?.custom_id).toBe(r.bundleId);
    expect(order.purchase_units?.[0]?.payments?.captures?.[0]?.custom_id).toBe(r.bundleId);

    const bundle = (
      await server.inject({
        url: `/v1/bundles/${r.bundleId}`,
        headers: { authorization: `Bearer ${env.PROVENANT_PLATFORM_API_KEY}` },
      })
    ).json();
    expect(bundle.status).toBe('FULFILLED');
    expect(bundle.paypal_order_id).toBe(r.orderId);
    expect(bundle.paypal_capture_id).toBe(r.captureId);
    expect(bundle.captured_amount).toEqual({ value: '65.00', currency: 'USD' });
    expect(bundle.user_confirmation?.required).toBe(true);
    expect(bundle.offer_snapshot.image_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(bundle.decision_trace.map((d: { step: string }) => d.step)).toEqual([
      'compared_offers',
      'selected_offer',
      'rule_check',
    ]);
  });

  it('refuses a request with no budget', async () => {
    await expect(
      runPurchase(env, { request: 'black running shoes size 10', confirm: 'auto', log: quiet }),
    ).rejects.toThrow(/budget/);
  });

  it('stops when the user declines the confirmation', async () => {
    await expect(
      runPurchase(env, {
        request: 'black running shoes size 10 under $90, ask me above $50',
        confirm: 'prompt',
        askUser: async () => false,
        log: quiet,
      }),
    ).rejects.toThrow(/declined/);
  });

  it('scripted mode can force an out-of-mandate purchase without confirmation (for scenarios)', async () => {
    const r = await runPurchase(env, {
      request: 'running shoes size 10 under $50',
      forceSku: 'ROAD-BLK-10',
      confirm: 'never',
      log: quiet,
    });
    expect(r.amount.value).toBe('65.00');
    expect(r.customIdMatches).toBe(true);
  });

  it('ships the substitute when the store’s wrong-item switch is on', async () => {
    await store.inject({ method: 'POST', url: '/admin/wrong-item', payload: { enabled: true } });
    try {
      const r = await runPurchase(env, {
        request: 'black trail running shoes size 10 under $90',
        // A plain "trail" request would also match the cheaper trail/road hybrid (scenario 4's ambiguity).
        forceSku: 'RUN-BLK-10',
        confirm: 'auto',
        log: quiet,
      });
      expect(r.sku).toBe('RUN-BLK-10');
      expect(r.fulfilment?.shipped_items?.[0]?.sku).toBe('RUN-BLU-10');
      expect(r.photoUrl).toContain('/photo/RUN-BLU-10.png');
    } finally {
      await store.inject({ method: 'POST', url: '/admin/wrong-item', payload: { enabled: false } });
    }
  });
});
