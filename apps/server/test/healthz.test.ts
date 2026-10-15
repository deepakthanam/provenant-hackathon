import { envSchema } from '@provenant/config';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';

const env = envSchema.parse({ NODE_ENV: 'test' });

describe('GET /healthz', () => {
  it('returns ok when the database answers', async () => {
    const app = await buildApp({ env, pingDb: async () => true });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: 'ok', paypal_mode: 'mock' });
    await app.close();
  });

  it('returns 503 when the database is down', async () => {
    const app = await buildApp({ env, pingDb: async () => false });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'degraded', db: 'down' });
    await app.close();
  });

  it('serves the OpenAPI document', async () => {
    const app = await buildApp({ env, pingDb: async () => true });
    const res = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);
    expect(res.json().paths['/healthz']).toBeDefined();
    await app.close();
  });
});
