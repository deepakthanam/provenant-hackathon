import { MockPayPal } from '@provenant/paypal';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from '../../../apps/server/test/harness';
import {
  generateKeyPairB64,
  mandateForSigning,
  Provenant,
  ProvenantApiError,
  signConfirmation,
  signMandate,
  withProvenantCustomId,
} from '../src';

let h: Harness;
let pv: Provenant;
const user = generateKeyPairB64();

/** fetch → Fastify inject, so the SDK talks to a real server without opening a port. */
function injectFetch(app: Harness['app']): typeof fetch {
  return (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const res = await app.inject({
      method: (init.method ?? 'GET') as 'GET',
      url: url.pathname + url.search,
      headers: init.headers as Record<string, string>,
      payload: init.body as string | undefined,
    });
    return new Response(res.body, { status: res.statusCode, headers: res.headers as Record<string, string> });
  }) as typeof fetch;
}

beforeAll(async () => {
  h = await createHarness();
  pv = new Provenant({
    baseUrl: 'http://provenant.test',
    apiKey: h.keys.platform,
    fetch: injectFetch(h.app),
  });
});
afterAll(async () => {
  await h.close();
});

async function readyBundle(userRef: string) {
  const draft = {
    text: 'Buy black running shoes, size 10, under $90.',
    maxAmount: { value: '90.00', currency: 'USD' },
    confirmAbove: null,
    allowedCategories: ['footwear'],
    allowedMerchants: ['demo-store'],
    expiresAt: '2026-11-30T00:00:00Z',
  };
  const { bundleId } = await pv.recordMandate({
    ...draft,
    userRef,
    userPublicKey: user.publicKey,
    userSig: signMandate(user.privateKey, userRef, mandateForSigning(draft)),
  });
  await pv.recordOffer(bundleId, {
    merchantId: 'demo-store',
    url: 'http://localhost:4100/p/RUN-BLK-10',
    title: 'Trail runner, black',
    attributes: { color: 'black', size: '10' },
    price: { value: '84.00', currency: 'USD' },
    deliveryPromise: { minDays: 3, maxDays: 5 },
  });
  await pv.recordDecision(bundleId, { step: 'compared_offers', detail: '3 candidates' });
  await pv.setCart(bundleId, [
    {
      sku: 'RUN-BLK-10',
      name: 'Trail runner',
      qty: 1,
      unit_price: { value: '84.00', currency: 'USD' },
      category: 'footwear',
    },
  ]);
  return bundleId;
}

describe('@provenant/sdk', () => {
  it('records a full purchase and seals it', async () => {
    const id = await readyBundle('usr_sdk1');
    const { customId, amount } = await pv.prepareOrder(id);
    expect(customId).toBe(id);
    expect(amount).toEqual({ value: '84.00', currency: 'USD' });
    const sealed = await pv.sealOrder(id, { paypalOrderId: 'ORDERSDK00000001' });
    expect(sealed.status).toBe('SEALED');
    expect((await pv.verify(id)).ok).toBe(true);
    expect(pv.receiptUrl(id)).toBe(`http://provenant.test/v1/bundles/${id}/receipt`);
  });

  it('records a signed confirmation', async () => {
    const id = await readyBundle('usr_sdk2');
    const amount = { value: '84.00', currency: 'USD' };
    const givenAt = new Date().toISOString();
    const b = await pv.recordConfirmation(id, {
      amount,
      givenAt,
      sig: signConfirmation(user.privateKey, id, amount, givenAt),
    });
    expect(b.user_confirmation?.given_at).toBe(givenAt);
  });

  it('raises typed API errors', async () => {
    const err = await pv.getBundle('apb_01J00000000000000000000000').catch((e) => e);
    expect(err).toBeInstanceOf(ProvenantApiError);
    expect(err.status).toBe(404);
  });

  it('wraps a create_order tool so the order carries custom_id and the bundle is sealed', async () => {
    const paypal = new MockPayPal({ db: h.tdb.db, baseUrl: 'http://mock/mock-paypal' });
    const id = await readyBundle('usr_sdk3');
    // Shaped like the Agent Toolkit's create_order: no custom_id parameter, returns the order.
    const toolkitCreateOrder = {
      description: 'Create an order in PayPal system based on provided details',
      execute: async (args: { amount: string }) =>
        paypal.createOrder({ amount: { currency_code: 'USD', value: args.amount } }),
    };
    const wrapped = withProvenantCustomId(toolkitCreateOrder, {
      pv,
      setOrderCustomId: (orderId, customId) => paypal.setOrderCustomId(orderId, customId),
      currentBundleId: () => id,
    });
    const order = await wrapped.execute!({ amount: '84.00' });
    expect((await paypal.getOrder(order.id)).purchase_units?.[0]?.custom_id).toBe(id);
    const b = await pv.getBundle(id);
    expect(b.status).toBe('SEALED');
    expect(b.paypal_order_id).toBe(order.id);
  });
});
