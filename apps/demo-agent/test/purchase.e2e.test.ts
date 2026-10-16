import { HttpPayPal } from '@provenant/paypal';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runPurchase } from '../src/purchase';
import { type Stack, startStack } from './stack';

let stack: Stack;
let env: Stack['env'];
let server: Stack['server'];
let store: Stack['store'];

beforeAll(async () => {
  stack = await startStack({ webhooks: false });
  ({ env, server, store } = stack);
});

afterAll(async () => {
  await stack?.close();
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
