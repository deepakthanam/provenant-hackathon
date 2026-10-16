import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness';

let up: Harness;
let down: Harness;

beforeAll(async () => {
  [up, down] = await Promise.all([createHarness(), createHarness({ pingDb: async () => false })]);
});
afterAll(async () => {
  await Promise.all([up.close(), down.close()]);
});

describe('GET /healthz', () => {
  it('returns ok when the database answers', async () => {
    const res = await up.app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: 'ok', paypal_mode: 'mock' });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('returns 503 when the database is down', async () => {
    const res = await down.app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'degraded', db: 'down' });
  });

  it('serves the OpenAPI document', async () => {
    const res = await up.app.inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);
    expect(res.json().paths['/healthz']).toBeDefined();
    expect(res.json().paths['/v1/bundles/{id}/seal']).toBeDefined();
  });

  it('echoes a caller-supplied request id', async () => {
    const res = await up.app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { 'x-request-id': 'abc-123' },
    });
    expect(res.headers['x-request-id']).toBe('abc-123');
  });
});
