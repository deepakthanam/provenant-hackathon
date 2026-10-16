import { randomUUID } from 'node:crypto';
import { assertFilesAcceptable, type PayPalClient } from './client';
import { PayPalError, SandboxDisputeCreationUnavailable } from './errors';
import type {
  AcceptClaimInput,
  ActionResult,
  CreateOrderInput,
  Dispute,
  EvidenceFile,
  Link,
  ListDisputesFilter,
  ListDisputesResult,
  MakeOfferInput,
  Order,
  ProvideEvidenceInput,
  SandboxCreateDisputeInput,
  SupportingInfoInput,
  TrackingInput,
  WebhookHeaders,
} from './types';

export interface HttpPayPalOptions {
  /** https://api-m.sandbox.paypal.com, or `<server>/mock-paypal` to drive MockPayPal over HTTP. */
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  webhookId?: string;
  /** Sent as PayPal-Partner-Attribution-Id when set. */
  bnCode?: string;
  mode?: 'sandbox' | 'mock';
  fetch?: typeof fetch;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Refresh the OAuth token this long before PayPal says it expires. */
  tokenSkewMs?: number;
}

interface Response<T> {
  data: T;
  requestId: string;
  debugId?: string;
}

interface RequestOptions {
  json?: unknown;
  /** Rebuilt on every attempt because a FormData body can only be sent once. */
  multipart?: () => FormData;
  /** A pre-serialised JSON body, sent byte-for-byte (webhook verification). */
  rawJson?: string;
  query?: Record<string, string | number | undefined>;
  headers?: Record<string, string>;
  requestId?: string;
}

/** Real PayPal REST client: OAuth with caching, idempotency keys, typed errors, retries on 5xx/429. */
export class HttpPayPal implements PayPalClient {
  readonly mode: 'mock' | 'sandbox';
  private token: { value: string; expiresAt: number } | null = null;
  private tokenInflight: Promise<string> | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: HttpPayPalOptions) {
    this.mode = opts.mode ?? 'sandbox';
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  // ------------------------------------------------------------------ OAuth

  async accessToken(force = false): Promise<string> {
    if (!force && this.token && Date.now() < this.token.expiresAt) return this.token.value;
    if (this.tokenInflight) return this.tokenInflight;
    this.tokenInflight = (async () => {
      const basic = Buffer.from(`${this.opts.clientId}:${this.opts.clientSecret}`).toString('base64');
      const res = await this.fetchImpl(`${this.opts.baseUrl}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          authorization: `Basic ${basic}`,
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: 'grant_type=client_credentials',
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        throw new PayPalError(
          res.status,
          String(body.error ?? 'AUTHENTICATION_FAILURE'),
          String(body.error_description ?? 'OAuth token request failed'),
          res.headers.get('paypal-debug-id') ?? undefined,
        );
      }
      const ttlMs = Number(body.expires_in ?? 3600) * 1000;
      const skew = this.opts.tokenSkewMs ?? 5 * 60_000;
      this.token = {
        value: String(body.access_token),
        expiresAt: Date.now() + Math.max(ttlMs - skew, ttlMs / 2),
      };
      return this.token.value;
    })();
    try {
      return await this.tokenInflight;
    } finally {
      this.tokenInflight = null;
    }
  }

  // ------------------------------------------------------------------ core request

  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    o: RequestOptions = {},
  ): Promise<Response<T>> {
    const url = new URL(path.startsWith('http') ? path : `${this.opts.baseUrl}${path}`);
    for (const [k, v] of Object.entries(o.query ?? {}))
      if (v !== undefined) url.searchParams.set(k, String(v));
    // One idempotency key for every retry of this logical call, so PayPal never applies it twice.
    const requestId = o.requestId ?? randomUUID();
    const maxRetries = this.opts.maxRetries ?? 3;
    let refreshedToken = false;

    for (let attempt = 0; ; attempt++) {
      const headers: Record<string, string> = { accept: 'application/json', ...o.headers };
      headers.authorization = `Bearer ${await this.accessToken()}`;
      if (method !== 'GET') headers['paypal-request-id'] = requestId;
      if (this.opts.bnCode) headers['paypal-partner-attribution-id'] = this.opts.bnCode;
      let body: RequestInit['body'];
      if (o.multipart) body = o.multipart();
      else if (o.rawJson !== undefined) {
        body = o.rawJson;
        headers['content-type'] = 'application/json';
      } else if (o.json !== undefined) {
        body = JSON.stringify(o.json);
        headers['content-type'] = 'application/json';
      }

      let res: globalThis.Response;
      try {
        res = await this.fetchImpl(url, { method, headers, body });
      } catch (networkErr) {
        if (attempt >= maxRetries) throw networkErr;
        await this.sleep(backoff(attempt));
        continue;
      }

      const debugId = res.headers.get('paypal-debug-id') ?? undefined;
      if (res.ok) {
        const text = await res.text();
        return { data: (text ? JSON.parse(text) : {}) as T, requestId, debugId };
      }
      if (res.status === 401 && !refreshedToken) {
        refreshedToken = true;
        this.token = null;
        continue;
      }
      const err = await toPayPalError(res, debugId);
      if (err.retryable && attempt < maxRetries) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await this.sleep(
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(attempt),
        );
        continue;
      }
      throw err;
    }
  }

  private async action(
    path: string,
    json: unknown,
    files?: EvidenceFile[],
    headers?: Record<string, string>,
  ): Promise<ActionResult> {
    assertFilesAcceptable(files);
    const opts: RequestOptions = files?.length ? { multipart: () => multipart(json, files) } : { json };
    const r = await this.request<{ links?: Link[] }>('POST', path, { ...opts, headers });
    return { links: r.data.links ?? [], request_id: r.requestId, debug_id: r.debugId };
  }

  // ------------------------------------------------------------------ Orders v2

  async createOrder(input: CreateOrderInput): Promise<Order> {
    const body = {
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: 'default',
          custom_id: input.custom_id,
          invoice_id: input.invoice_id,
          description: input.description,
          amount: input.items?.length
            ? { ...input.amount, breakdown: { item_total: input.amount } }
            : input.amount,
          items: input.items,
        },
      ],
      payment_source: input.payment_source ?? {
        paypal: {
          experience_context: {
            user_action: 'PAY_NOW',
            return_url: input.return_url ?? 'https://example.com/return',
            cancel_url: input.cancel_url ?? 'https://example.com/cancel',
          },
        },
      },
    };
    return (
      await this.request<Order>('POST', '/v2/checkout/orders', {
        json: body,
        headers: { prefer: 'return=representation' },
      })
    ).data;
  }

  async setOrderCustomId(orderId: string, customId: string): Promise<void> {
    await this.request('PATCH', `/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
      json: [{ op: 'add', path: "/purchase_units/@reference_id=='default'/custom_id", value: customId }],
    });
  }

  async getOrder(orderId: string): Promise<Order> {
    return (await this.request<Order>('GET', `/v2/checkout/orders/${encodeURIComponent(orderId)}`)).data;
  }

  async captureOrder(orderId: string): Promise<Order> {
    return (
      await this.request<Order>('POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
        json: {},
        headers: { prefer: 'return=representation' },
      })
    ).data;
  }

  async addTracking(orderId: string, tracking: TrackingInput): Promise<Order> {
    return (
      await this.request<Order>('POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/track`, {
        json: tracking,
      })
    ).data;
  }

  // ------------------------------------------------------------------ Disputes v1

  async listDisputes(filter: ListDisputesFilter = {}): Promise<ListDisputesResult> {
    const r = await this.request<{ items?: ListDisputesResult['items']; links?: Link[] }>(
      'GET',
      '/v1/customer/disputes',
      {
        query: { ...filter },
      },
    );
    const next = r.data.links?.find((l) => l.rel === 'next')?.href;
    const token = next
      ? (new URL(next, this.opts.baseUrl).searchParams.get('next_page_token') ?? undefined)
      : undefined;
    return { items: r.data.items ?? [], next_page_token: token };
  }

  async getDispute(id: string): Promise<Dispute> {
    return (await this.request<Dispute>('GET', `/v1/customer/disputes/${encodeURIComponent(id)}`)).data;
  }

  provideEvidence(id: string, input: ProvideEvidenceInput): Promise<ActionResult> {
    // PayPal requires multipart for provide-evidence even without files.
    const files = input.files ?? [];
    assertFilesAcceptable(files);
    return this.request<{ links?: Link[] }>(
      'POST',
      `/v1/customer/disputes/${encodeURIComponent(id)}/provide-evidence`,
      {
        multipart: () => multipart({ evidences: input.evidences }, files),
      },
    ).then((r) => ({ links: r.data.links ?? [], request_id: r.requestId, debug_id: r.debugId }));
  }

  makeOffer(id: string, input: MakeOfferInput): Promise<ActionResult> {
    return this.action(`/v1/customer/disputes/${encodeURIComponent(id)}/make-offer`, input);
  }

  sendMessage(id: string, message: string, files?: EvidenceFile[]): Promise<ActionResult> {
    return this.action(`/v1/customer/disputes/${encodeURIComponent(id)}/send-message`, { message }, files);
  }

  acceptClaim(id: string, input: AcceptClaimInput): Promise<ActionResult> {
    const { files, ...json } = input;
    return this.action(`/v1/customer/disputes/${encodeURIComponent(id)}/accept-claim`, json, files);
  }

  provideSupportingInfo(id: string, input: SupportingInfoInput): Promise<ActionResult> {
    const { files, ...json } = input;
    return this.action(
      `/v1/customer/disputes/${encodeURIComponent(id)}/provide-supporting-info`,
      json,
      files,
    );
  }

  async downloadDocument(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    const res = await this.fetchImpl(url, {
      headers: { authorization: `Bearer ${await this.accessToken()}` },
    });
    if (!res.ok) throw await toPayPalError(res, res.headers.get('paypal-debug-id') ?? undefined);
    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      contentType: res.headers.get('content-type') ?? 'application/octet-stream',
    };
  }

  // ------------------------------------------------------------------ sandbox helpers

  async sandboxCreateDispute(input: SandboxCreateDisputeInput): Promise<Dispute> {
    const headers: Record<string, string> = {};
    if (input.buyer_email)
      headers['paypal-auth-assertion'] = authAssertion(this.opts.clientId, input.buyer_email);
    try {
      const r = await this.action(
        '/v1/customer/disputes',
        {
          disputed_transactions: [{ buyer_transaction_id: input.buyer_transaction_id }],
          reason: input.reason,
          dispute_amount: input.dispute_amount,
          extensions: {
            merchant_contacted: false,
            merchandize_dispute_properties: { issue_type: 'PRODUCT' },
          },
        },
        [],
        headers,
      );
      const self = r.links.find((l) => l.rel === 'self')?.href;
      const id = self?.split('/').pop();
      if (!id) throw new Error('create dispute returned no self link');
      if (input.message) await this.sendMessage(id, input.message).catch(() => {});
      return this.getDispute(id);
    } catch (e) {
      if (e instanceof PayPalError && (e.isPermissionError || e.status === 404 || e.status === 422)) {
        throw new SandboxDisputeCreationUnavailable(e);
      }
      throw e;
    }
  }

  sandboxRequireEvidence(id: string, action: 'SELLER_EVIDENCE' | 'BUYER_EVIDENCE'): Promise<ActionResult> {
    return this.action(`/v1/customer/disputes/${encodeURIComponent(id)}/require-evidence`, { action });
  }

  sandboxAdjudicate(id: string, outcome: 'BUYER_FAVOR' | 'SELLER_FAVOR'): Promise<ActionResult> {
    return this.action(`/v1/customer/disputes/${encodeURIComponent(id)}/adjudicate`, {
      adjudication_outcome: outcome,
    });
  }

  // ------------------------------------------------------------------ webhooks

  async verifyWebhookSignature(headers: WebhookHeaders, rawBody: string): Promise<boolean> {
    if (!this.opts.webhookId) throw new Error('PAYPAL_WEBHOOK_ID is required to verify webhook signatures');
    const h = (name: string) => {
      const v = headers[name] ?? headers[name.toLowerCase()];
      return Array.isArray(v) ? v[0] : v;
    };
    const fields = {
      auth_algo: h('paypal-auth-algo'),
      cert_url: h('paypal-cert-url'),
      transmission_id: h('paypal-transmission-id'),
      transmission_sig: h('paypal-transmission-sig'),
      transmission_time: h('paypal-transmission-time'),
      webhook_id: this.opts.webhookId,
    };
    if (Object.values(fields).some((v) => !v)) return false;
    // PayPal requires webhook_event to be the event exactly as received; re-serialising can break verification.
    const rawJson = `${JSON.stringify(fields).slice(0, -1)},"webhook_event":${rawBody}}`;
    const r = await this.request<{ verification_status?: string }>(
      'POST',
      '/v1/notifications/verify-webhook-signature',
      { rawJson },
    );
    return r.data.verification_status === 'SUCCESS';
  }
}

function backoff(attempt: number): number {
  return Math.min(250 * 2 ** attempt, 4000) + Math.floor(Math.random() * 100);
}

async function toPayPalError(res: globalThis.Response, debugId?: string): Promise<PayPalError> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return new PayPalError(
    res.status,
    String(body.name ?? body.error ?? `HTTP_${res.status}`),
    String(body.message ?? body.error_description ?? res.statusText ?? 'request failed'),
    String(body.debug_id ?? debugId ?? '') || undefined,
    Array.isArray(body.details) ? (body.details as PayPalError['details']) : [],
  );
}

/** PayPal's multipart convention: a JSON part named `input`, then `file1..n`. */
function multipart(json: unknown, files: EvidenceFile[]): FormData {
  const form = new FormData();
  form.append('input', new Blob([JSON.stringify(json)], { type: 'application/json' }), 'input.json');
  for (const [i, f] of files.entries()) {
    form.append(`file${i + 1}`, new Blob([f.bytes], { type: f.contentType }), f.name);
  }
  return form;
}

/** Unsigned JWT ({"alg":"none"}) naming the client and the buyer, as PayPal's sandbox guide shows. */
export function authAssertion(clientId: string, buyerEmail: string): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ iss: clientId, email: buyerEmail })}.`;
}
