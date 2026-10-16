import { describe, expect, it } from 'vitest';
import { PayPalError, SandboxDisputeCreationUnavailable } from '../src/errors';
import { authAssertion, HttpPayPal } from '../src/http';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Scripted fetch: OAuth always succeeds; API responses are popped from `script` in order. */
function fakeFetch(script: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>) {
  const calls: Call[] = [];
  let tokens = 0;
  const fn = (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const headers = Object.fromEntries(
      Object.entries((init.headers as Record<string, string>) ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    );
    calls.push({ url, method: init.method ?? 'GET', headers, body: init.body });
    if (url.endsWith('/v1/oauth2/token')) {
      tokens++;
      return new Response(JSON.stringify({ access_token: `tok${tokens}`, expires_in: 32400 }), {
        status: 200,
      });
    }
    const next = script.shift() ?? { status: 200, body: {} };
    return new Response(next.body === undefined ? '' : JSON.stringify(next.body), {
      status: next.status,
      headers: next.headers,
    });
  }) as typeof fetch;
  return { fn, calls, tokenCount: () => tokens };
}

const make = (
  f: ReturnType<typeof fakeFetch>,
  extra: Partial<ConstructorParameters<typeof HttpPayPal>[0]> = {},
) =>
  new HttpPayPal({
    baseUrl: 'https://api.test',
    clientId: 'cid',
    clientSecret: 'sec',
    fetch: f.fn,
    sleep: async () => {},
    ...extra,
  });

describe('HttpPayPal', () => {
  it('caches the OAuth token across calls', async () => {
    const f = fakeFetch([
      { status: 200, body: { id: 'O1' } },
      { status: 200, body: { id: 'O2' } },
    ]);
    const pp = make(f);
    await pp.getOrder('O1');
    await pp.getOrder('O2');
    expect(f.tokenCount()).toBe(1);
    expect(f.calls[1]?.headers.authorization).toBe('Bearer tok1');
  });

  it('retries 5xx with the same PayPal-Request-Id', async () => {
    const f = fakeFetch([
      { status: 503, body: { name: 'SERVICE_UNAVAILABLE', message: 'x' } },
      { status: 201, body: { id: 'O1', status: 'CREATED' } },
    ]);
    const order = await make(f).createOrder({
      amount: { currency_code: 'USD', value: '84.00' },
      custom_id: 'apb_X',
    });
    expect(order.id).toBe('O1');
    const posts = f.calls.filter((c) => c.url.endsWith('/v2/checkout/orders'));
    expect(posts).toHaveLength(2);
    expect(posts[0]?.headers['paypal-request-id']).toBeTruthy();
    expect(posts[0]?.headers['paypal-request-id']).toBe(posts[1]?.headers['paypal-request-id']);
    const sent = JSON.parse(String(posts[0]?.body));
    expect(sent.purchase_units[0].custom_id).toBe('apb_X');
    expect(sent.intent).toBe('CAPTURE');
  });

  it('honours Retry-After on 429', async () => {
    const waits: number[] = [];
    const f = fakeFetch([
      { status: 429, body: { name: 'RATE_LIMIT_REACHED', message: 'slow' }, headers: { 'retry-after': '2' } },
      { status: 200, body: { id: 'O1' } },
    ]);
    await make(f, { sleep: async (ms) => void waits.push(ms) }).getOrder('O1');
    expect(waits).toEqual([2000]);
  });

  it('never retries 4xx and maps the error with debug_id', async () => {
    const f = fakeFetch([
      {
        status: 422,
        body: {
          name: 'UNPROCESSABLE_ENTITY',
          message: 'bad',
          debug_id: 'dbg123',
          details: [{ issue: 'ORDER_NOT_APPROVED' }],
        },
      },
    ]);
    const err = await make(f)
      .captureOrder('O1')
      .catch((e) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect(err.status).toBe(422);
    expect(err.debugId).toBe('dbg123');
    expect(err.details[0].issue).toBe('ORDER_NOT_APPROVED');
    expect(f.calls.filter((c) => c.url.includes('/capture'))).toHaveLength(1);
  });

  it('gives up after maxRetries on persistent 5xx', async () => {
    const f = fakeFetch(
      Array.from({ length: 5 }, () => ({
        status: 500,
        body: { name: 'INTERNAL_SERVER_ERROR', message: 'boom' },
      })),
    );
    await expect(make(f, { maxRetries: 2 }).getOrder('O1')).rejects.toMatchObject({ status: 500 });
    expect(f.calls.filter((c) => c.url.includes('/orders/'))).toHaveLength(3);
  });

  it('refreshes the token once on 401', async () => {
    const f = fakeFetch([
      { status: 401, body: { name: 'AUTHENTICATION_FAILURE', message: 'expired' } },
      { status: 200, body: { id: 'O1' } },
    ]);
    await make(f).getOrder('O1');
    expect(f.tokenCount()).toBe(2);
  });

  it('sends partner attribution when configured', async () => {
    const f = fakeFetch([{ status: 200, body: {} }]);
    await make(f, { bnCode: 'BN-123' }).getOrder('O1');
    expect(f.calls[1]?.headers['paypal-partner-attribution-id']).toBe('BN-123');
  });

  it('patches custom_id with the documented JSON Patch path', async () => {
    const f = fakeFetch([{ status: 204 }]);
    await make(f).setOrderCustomId('O1', 'apb_1');
    expect(f.calls[1]?.method).toBe('PATCH');
    expect(JSON.parse(String(f.calls[1]?.body))).toEqual([
      { op: 'add', path: "/purchase_units/@reference_id=='default'/custom_id", value: 'apb_1' },
    ]);
  });

  it('sends dispute actions as multipart with an `input` JSON part when files are attached', async () => {
    const f = fakeFetch([{ status: 200, body: { links: [{ rel: 'self', href: 'x' }] } }]);
    const r = await make(f).provideEvidence('PP-D-1', {
      evidences: [{ evidence_type: 'PROOF_OF_FULFILLMENT', notes: 'see report' }],
      files: [
        { name: 'report.pdf', contentType: 'application/pdf', bytes: new Uint8Array([37, 80, 68, 70]) },
      ],
    });
    expect(r.request_id).toBeTruthy();
    const form = f.calls[1]?.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    const input = form.get('input') as Blob;
    expect(JSON.parse(await input.text())).toEqual({
      evidences: [{ evidence_type: 'PROOF_OF_FULFILLMENT', notes: 'see report' }],
    });
    expect((form.get('file1') as File).name).toBe('report.pdf');
  });

  it('sends JSON for actions without files', async () => {
    const f = fakeFetch([{ status: 200, body: { links: [] } }]);
    await make(f).acceptClaim('PP-D-1', { note: 'refund', accept_claim_type: 'REFUND' });
    expect(f.calls[1]?.headers['content-type']).toBe('application/json');
    expect(JSON.parse(String(f.calls[1]?.body))).toEqual({ note: 'refund', accept_claim_type: 'REFUND' });
  });

  it('rejects unsupported evidence files before calling PayPal', async () => {
    const f = fakeFetch([]);
    await expect(
      make(f).sendMessage('PP-D-1', 'hi', [
        { name: 'x.txt', contentType: 'text/plain' as never, bytes: new Uint8Array(1) },
      ]),
    ).rejects.toThrow(/unsupported/);
    expect(f.calls).toHaveLength(0);
  });

  it('reads next_page_token from the next link', async () => {
    const f = fakeFetch([
      {
        status: 200,
        body: {
          items: [{ dispute_id: 'PP-D-1' }],
          links: [{ rel: 'next', href: 'https://api.test/v1/customer/disputes?next_page_token=abc' }],
        },
      },
    ]);
    const r = await make(f).listDisputes({ update_time_after: '2026-10-01T00:00:00Z' });
    expect(r.next_page_token).toBe('abc');
    expect(f.calls[1]?.url).toContain('update_time_after=2026-10-01T00%3A00%3A00Z');
  });

  it('verifies webhooks by splicing the raw event body in verbatim', async () => {
    const f = fakeFetch([{ status: 200, body: { verification_status: 'SUCCESS' } }]);
    const raw = '{"id":"WH-1",  "event_type":"CUSTOMER.DISPUTE.CREATED","resource":{"a":1.10}}';
    const ok = await make(f, { webhookId: 'WHID' }).verifyWebhookSignature(
      {
        'paypal-auth-algo': 'SHA256withRSA',
        'paypal-cert-url': 'https://api.sandbox.paypal.com/cert',
        'paypal-transmission-id': 't1',
        'paypal-transmission-sig': 'sig',
        'paypal-transmission-time': '2026-10-16T00:00:00Z',
      },
      raw,
    );
    expect(ok).toBe(true);
    const body = String(f.calls[1]?.body);
    expect(body.endsWith(`"webhook_event":${raw}}`)).toBe(true);
    expect(JSON.parse(body).webhook_id).toBe('WHID');
  });

  it('fails verification when PayPal headers are missing', async () => {
    const f = fakeFetch([]);
    expect(await make(f, { webhookId: 'W' }).verifyWebhookSignature({}, '{}')).toBe(false);
  });

  it('turns a refused sandbox dispute creation into a clear fallback message', async () => {
    const f = fakeFetch([{ status: 403, body: { name: 'PERMISSION_DENIED', message: 'no scope' } }]);
    const err = await make(f)
      .sandboxCreateDispute({
        buyer_transaction_id: 'T',
        reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
        dispute_amount: { currency_code: 'USD', value: '1.00' },
        buyer_email: 'b@x',
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(SandboxDisputeCreationUnavailable);
    expect(err.message).toMatch(/sandbox personal/);
    expect(f.calls[1]?.headers['paypal-auth-assertion']).toBe(authAssertion('cid', 'b@x'));
  });
});
