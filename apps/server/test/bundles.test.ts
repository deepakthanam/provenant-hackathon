import { generateApiKey } from '@provenant/db/seed';
import { generateKeyPairB64, signConfirmation, signMandate } from '@provenant/evidence';
import type { EvidenceBundle, UnsignedIntentMandate } from '@provenant/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createHarness, type Harness } from './harness';

let h: Harness;
const user = generateKeyPairB64();
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPj/HwADAgH/eL9GtQAAAABJRU5ErkJggg==';

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

function signedMandate(userRef: string) {
  const unsigned: UnsignedIntentMandate = {
    text: 'Buy black running shoes, size 10, under $90. Ask me above $50.',
    max_amount: { value: '90.00', currency: 'USD' },
    confirm_above: { value: '50.00', currency: 'USD' },
    allowed_categories: ['footwear'],
    allowed_merchants: ['demo-store'],
    expires_at: '2026-11-30T00:00:00Z',
  };
  return { ...unsigned, user_sig: signMandate(user.privateKey, userRef, unsigned) };
}

async function call(method: 'GET' | 'POST' | 'PUT', url: string, key: string | null, payload?: unknown) {
  return h.app.inject({ method, url, headers: key ? bearer(key) : {}, payload: payload as object });
}

async function createBundle(userRef = 'usr_alice'): Promise<EvidenceBundle> {
  const res = await call('POST', '/v1/bundles', h.keys.platform, {
    user_ref: userRef,
    user_public_key: user.publicKey,
    agent_version: '0.1.0',
    intent_mandate: signedMandate(userRef),
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

async function sealedBundle(orderId: string): Promise<string> {
  const { bundle_id: id } = await createBundle();
  const p = h.keys.platform;
  expect(
    (
      await call('POST', `/v1/bundles/${id}/offer`, p, {
        merchant_id: 'demo-store',
        url: 'http://localhost:4100/p/RUN-BLK-10',
        title: 'Trail runner, black',
        attributes: { color: 'black', size: '10' },
        price: { value: '84.00', currency: 'USD' },
        delivery_promise: { min_days: 3, max_days: 5 },
        image_base64: PNG_B64,
        image_content_type: 'image/png',
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await call('POST', `/v1/bundles/${id}/decision`, p, { step: 'compared_offers', detail: '3 candidates' }))
      .statusCode,
  ).toBe(200);
  expect(
    (
      await call('PUT', `/v1/bundles/${id}/cart`, p, {
        cart: [
          {
            sku: 'RUN-BLK-10',
            name: 'Trail runner',
            qty: 1,
            unit_price: { value: '84.00', currency: 'USD' },
            category: 'footwear',
          },
        ],
      })
    ).statusCode,
  ).toBe(200);
  const amount = { value: '84.00', currency: 'USD' };
  const given_at = new Date().toISOString();
  const conf = await call('POST', `/v1/bundles/${id}/confirmation`, p, {
    amount,
    given_at,
    sig: signConfirmation(user.privateKey, id, amount, given_at),
  });
  expect(conf.statusCode, conf.body).toBe(200);
  const prep = await call('POST', `/v1/bundles/${id}/prepare-order`, p);
  expect(prep.json()).toEqual({ custom_id: id, amount });
  const seal = await call('POST', `/v1/bundles/${id}/seal`, p, { paypal_order_id: orderId });
  expect(seal.statusCode, seal.body).toBe(200);
  return id;
}

describe('bundle API', () => {
  it('runs mandate → offer → decision → cart → confirmation → prepare → seal', async () => {
    const id = await sealedBundle('5O190127TN364715T');
    const res = await call('GET', `/v1/bundles/${id}`, h.keys.platform);
    const b = res.json() as EvidenceBundle;
    expect(b.status).toBe('SEALED');
    expect(b.paypal_order_id).toBe('5O190127TN364715T');
    expect(b.agent.platform_id).toBe('demo-agent');
    expect(b.hash).toMatch(/^sha256:/);
    expect(b.bundle_sig).toMatch(/^ed25519:/);

    const v = (await call('GET', `/v1/bundles/${id}/verify`, h.keys.platform)).json();
    expect(v.ok).toBe(true);
    expect(v.events).toBe(6);

    const byOrder = await call('GET', '/v1/bundles/by-order/5O190127TN364715T', h.keys.merchant);
    expect(byOrder.json().bundle_id).toBe(id);
  });

  it('serves the snapshot image by hash', async () => {
    const id = await sealedBundle('ORDER-IMG');
    const b = (await call('GET', `/v1/bundles/${id}`, h.keys.admin)).json() as EvidenceBundle;
    const img = await call('GET', `/v1/blobs/${b.offer_snapshot?.image_sha256}`, null);
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.rawPayload.equals(Buffer.from(PNG_B64, 'base64'))).toBe(true);
  });

  it('records fulfilment from the merchant', async () => {
    const id = await sealedBundle('ORDER-FUL');
    const res = await call('POST', `/v1/bundles/${id}/fulfilment`, h.keys.merchant, {
      carrier: 'UPS',
      tracking_number: '1Z999',
      status: 'DELIVERED',
      shipped_at: '2026-10-17T10:00:00Z',
      delivered_at: '2026-10-20T10:00:00Z',
      shipped_items: null,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().status).toBe('FULFILLED');
  });

  it('renders a public receipt that reflects integrity', async () => {
    const id = await sealedBundle('ORDER-RCPT');
    const ok = await call('GET', `/v1/bundles/${id}/receipt`, null);
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toContain('text/html');
    expect(ok.body).toContain('Record intact and signed');
    expect(ok.body).toContain('Buy black running shoes');

    await h.tdb.db.$client.query(
      `update bundle_events set payload = jsonb_set(payload, '{paypal_order_id}', '"OTHER"') where bundle_id = $1 and type = 'sealed'`,
      [id],
    );
    const tampered = await call('GET', `/v1/bundles/${id}/receipt`, null);
    expect(tampered.body).toContain('Integrity check failed');
    const v = (await call('GET', `/v1/bundles/${id}/verify`, h.keys.admin)).json();
    expect(v.ok).toBe(false);
  });

  it('escapes user-controlled text in the receipt', async () => {
    const userRef = 'usr_xss';
    const unsigned: UnsignedIntentMandate = { ...signedMandate(userRef), text: '<script>alert(1)</script>' };
    delete (unsigned as { user_sig?: string }).user_sig;
    const res = await call('POST', '/v1/bundles', h.keys.platform, {
      user_ref: userRef,
      user_public_key: user.publicKey,
      agent_version: '0.1.0',
      intent_mandate: { ...unsigned, user_sig: signMandate(user.privateKey, userRef, unsigned) },
    });
    const page = await call('GET', `/v1/bundles/${res.json().bundle_id}/receipt`, null);
    expect(page.body).not.toContain('<script>alert(1)</script>');
    expect(page.body).toContain('&lt;script&gt;');
  });
});

describe('bundle API auth and validation', () => {
  it('rejects missing and unknown keys', async () => {
    expect((await call('POST', '/v1/bundles', null, {})).statusCode).toBe(401);
    expect(
      (await call('GET', '/v1/bundles/apb_01J00000000000000000000000', generateApiKey('admin'))).statusCode,
    ).toBe(401);
  });

  it('only lets platforms create bundles', async () => {
    const res = await call('POST', '/v1/bundles', h.keys.merchant, {
      user_ref: 'usr_alice',
      agent_version: '0.1.0',
      intent_mandate: signedMandate('usr_alice'),
    });
    expect(res.statusCode).toBe(403);
  });

  it('stops merchants from editing agent evidence and hides other merchants’ bundles', async () => {
    const { bundle_id: id } = await createBundle();
    // no offer yet → no merchant attached → merchant cannot even see it
    expect((await call('GET', `/v1/bundles/${id}`, h.keys.merchant)).statusCode).toBe(404);
    const sealedId = await sealedBundle('ORDER-SCOPE');
    expect((await call('GET', `/v1/bundles/${sealedId}`, h.keys.merchant)).statusCode).toBe(200);
    expect(
      (await call('POST', `/v1/bundles/${sealedId}/decision`, h.keys.merchant, { step: 'x', detail: 'y' }))
        .statusCode,
    ).toBe(403);
  });

  it('returns 400 with details for schema violations', async () => {
    const res = await call('POST', '/v1/bundles', h.keys.platform, { user_ref: 'alice' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION_FAILED');
    expect(res.json().request_id).toBeTruthy();
  });

  it('returns 422 for a forged mandate signature', async () => {
    const m = signedMandate('usr_alice');
    const res = await call('POST', '/v1/bundles', h.keys.platform, {
      user_ref: 'usr_alice',
      agent_version: '0.1.0',
      intent_mandate: { ...m, max_amount: { value: '999.00', currency: 'USD' } },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('INVALID_SIGNATURE');
  });

  it('returns 409 for edits after sealing and for double-sealing an order', async () => {
    const id = await sealedBundle('ORDER-409');
    expect(
      (
        await call('PUT', `/v1/bundles/${id}/cart`, h.keys.platform, {
          cart: [
            {
              sku: 'A',
              name: 'A',
              qty: 1,
              unit_price: { value: '1.00', currency: 'USD' },
              category: 'footwear',
            },
          ],
        })
      ).statusCode,
    ).toBe(409);
    await expect(sealedBundle('ORDER-409')).rejects.toThrow();
  });

  it('returns 422 when a new user sends no public key', async () => {
    const res = await call('POST', '/v1/bundles', h.keys.platform, {
      user_ref: 'usr_nobody',
      agent_version: '0.1.0',
      intent_mandate: signedMandate('usr_nobody'),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('UNKNOWN_USER');
  });
});
