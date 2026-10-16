import type { Env } from '@provenant/config';
import type { Db } from '@provenant/db';
import { httpBuyer, type MockBuyer } from './buyer';
import type { PayPalClient } from './client';
import { HttpPayPal } from './http';
import { MockPayPal, type WebhookSink } from './mock';

/** Path the server mounts the mock under, and where remote mock clients point. */
export const MOCK_PAYPAL_PREFIX = '/mock-paypal';

export function mockBaseUrl(env: Env): string {
  return `${env.PUBLIC_BASE_URL.replace(/\/$/, '')}${MOCK_PAYPAL_PREFIX}`;
}

function sandboxClient(env: Env): HttpPayPal {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    throw new Error('PAYPAL_MODE=sandbox needs PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env');
  }
  return new HttpPayPal({
    baseUrl: env.PAYPAL_API_BASE,
    clientId: env.PAYPAL_CLIENT_ID,
    clientSecret: env.PAYPAL_CLIENT_SECRET,
    webhookId: env.PAYPAL_WEBHOOK_ID,
    bnCode: env.PAYPAL_BN_CODE,
    mode: 'sandbox',
  });
}

/** For the server process, which owns the mock's state in mock mode. */
export function createServerPayPal(env: Env, db: Db, webhookSink?: WebhookSink): PayPalClient {
  if (env.PAYPAL_MODE === 'sandbox') return sandboxClient(env);
  return new MockPayPal({ db, baseUrl: mockBaseUrl(env), webhookSink });
}

/** For every other process (agent, scenarios, MCP): sandbox directly, or the server's mock over HTTP. */
export function createRemotePayPal(env: Env): PayPalClient {
  if (env.PAYPAL_MODE === 'sandbox') return sandboxClient(env);
  return new HttpPayPal({ baseUrl: mockBaseUrl(env), clientId: 'mock', clientSecret: 'mock', mode: 'mock' });
}

/** Buyer simulation is mock-only; in sandbox the buyer acts through the PayPal website. */
export function createRemoteBuyer(env: Env): MockBuyer | null {
  return env.PAYPAL_MODE === 'mock' ? httpBuyer(mockBaseUrl(env)) : null;
}
