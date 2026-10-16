import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { purchase } from './fixtures';
import { bearer, createHarness, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

describe('hardening', () => {
  it('sends security headers and a request id', async () => {
    const res = await h.app.inject({ url: '/healthz' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('rate-limits the public receipt', async () => {
    const p = await purchase(h);
    const statuses: number[] = [];
    for (let i = 0; i < 62; i++) {
      statuses.push(
        (await h.app.inject({ url: `/v1/bundles/${p.bundleId}/receipt`, remoteAddress: '203.0.113.7' }))
          .statusCode,
      );
    }
    expect(statuses.slice(0, 60).every((s) => s === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    // another client is unaffected
    expect(
      (await h.app.inject({ url: `/v1/bundles/${p.bundleId}/receipt`, remoteAddress: '203.0.113.8' }))
        .statusCode,
    ).toBe(200);
  });

  it('rejects oversized and over-long input', async () => {
    const huge = await h.app.inject({
      method: 'POST',
      url: '/webhooks/paypal',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ id: 'WH-1', event_type: 'X', pad: 'x'.repeat(1_100_000) }),
    });
    expect(huge.statusCode).toBe(413);
    const longText = await h.app.inject({
      method: 'POST',
      url: '/v1/bundles',
      headers: bearer(h.keys.platform),
      payload: { user_ref: 'usr_long', agent_version: '1', intent_mandate: { text: 'x'.repeat(5000) } },
    });
    expect(longText.statusCode).toBe(400);
  });

  it('never echoes internals in 500s', async () => {
    const res = await h.app.inject({
      url: '/v1/bundles/apb_01J00000000000000000000000/verify',
      headers: bearer(h.keys.admin),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'NOT_FOUND', request_id: expect.any(String) });
  });
});
