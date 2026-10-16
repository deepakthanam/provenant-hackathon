import type {
  CartItem,
  EvidenceBundle,
  Fulfilment,
  Money,
  OfferSnapshot,
  VerifyResult,
} from '@provenant/schemas';

export {
  confirmationSigningMessage,
  generateKeyPairB64,
  mandateSigningMessage,
  signConfirmation,
  signMandate,
} from '@provenant/evidence/crypto';
export type { CartItem, EvidenceBundle, Fulfilment, Money, OfferSnapshot, VerifyResult };

export interface ProvenantOptions {
  baseUrl: string;
  /** The agent platform's API key. */
  apiKey: string;
  /** Informational; the server derives the platform from the API key. */
  platformId?: string;
  agentVersion?: string;
  fetch?: typeof fetch;
}

export interface RecordMandateInput {
  userRef: string;
  /** Base64 Ed25519 SPKI PEM; required the first time a user is seen. */
  userPublicKey?: string;
  text: string;
  maxAmount: Money;
  confirmAbove: Money | null;
  allowedCategories: string[];
  allowedMerchants: string[];
  expiresAt: string;
  /** The user's signature over the mandate; see `signMandate`. */
  userSig: string;
}

export interface RecordOfferInput {
  merchantId: string;
  url: string;
  title: string;
  attributes: Record<string, string>;
  price: Money;
  deliveryPromise: { minDays: number; maxDays: number };
  imageBytes?: Uint8Array;
  imageContentType?: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml';
  capturedAt?: string;
}

export class ProvenantApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'ProvenantApiError';
  }
}

/** Unsigned mandate in the exact shape the user signs (see `signMandate`). */
export function mandateForSigning(m: Omit<RecordMandateInput, 'userRef' | 'userPublicKey' | 'userSig'>) {
  return {
    text: m.text,
    max_amount: m.maxAmount,
    confirm_above: m.confirmAbove,
    allowed_categories: m.allowedCategories,
    allowed_merchants: m.allowedMerchants,
    expires_at: m.expiresAt,
  };
}

/**
 * Client for agent platforms: records the user's mandate, what the agent saw and decided, and
 * seals the bundle to the PayPal order. Every call appends a signed entry to Provenant's ledger.
 */
export class Provenant {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: ProvenantOptions) {
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.opts.baseUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.opts.apiKey}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new ProvenantApiError(
        res.status,
        String(json.error ?? 'ERROR'),
        String(json.message ?? res.statusText),
        json.request_id as string | undefined,
      );
    }
    return json as T;
  }

  async recordMandate(m: RecordMandateInput): Promise<{ bundleId: string; bundle: EvidenceBundle }> {
    const bundle = await this.call<EvidenceBundle>('POST', '/v1/bundles', {
      user_ref: m.userRef,
      user_public_key: m.userPublicKey,
      agent_version: this.opts.agentVersion ?? '0.1.0',
      intent_mandate: { ...mandateForSigning(m), user_sig: m.userSig },
    });
    return { bundleId: bundle.bundle_id, bundle };
  }

  recordOffer(bundleId: string, o: RecordOfferInput): Promise<EvidenceBundle> {
    return this.call('POST', `/v1/bundles/${bundleId}/offer`, {
      merchant_id: o.merchantId,
      url: o.url,
      title: o.title,
      attributes: o.attributes,
      price: o.price,
      delivery_promise: { min_days: o.deliveryPromise.minDays, max_days: o.deliveryPromise.maxDays },
      captured_at: o.capturedAt,
      image_base64: o.imageBytes ? Buffer.from(o.imageBytes).toString('base64') : undefined,
      image_content_type: o.imageBytes ? (o.imageContentType ?? 'image/png') : undefined,
    });
  }

  recordDecision(bundleId: string, d: { step: string; detail: string }): Promise<EvidenceBundle> {
    return this.call('POST', `/v1/bundles/${bundleId}/decision`, d);
  }

  recordConfirmation(
    bundleId: string,
    c: { amount: Money; givenAt: string; sig: string },
  ): Promise<EvidenceBundle> {
    return this.call('POST', `/v1/bundles/${bundleId}/confirmation`, {
      amount: c.amount,
      given_at: c.givenAt,
      sig: c.sig,
    });
  }

  setCart(bundleId: string, cart: CartItem[]): Promise<EvidenceBundle> {
    return this.call('PUT', `/v1/bundles/${bundleId}/cart`, { cart });
  }

  /** Returns the value to put in purchase_units[0].custom_id (and the amount to charge). */
  async prepareOrder(bundleId: string): Promise<{ customId: string; amount: Money }> {
    const r = await this.call<{ custom_id: string; amount: Money }>(
      'POST',
      `/v1/bundles/${bundleId}/prepare-order`,
    );
    return { customId: r.custom_id, amount: r.amount };
  }

  sealOrder(bundleId: string, s: { paypalOrderId: string }): Promise<EvidenceBundle> {
    return this.call('POST', `/v1/bundles/${bundleId}/seal`, { paypal_order_id: s.paypalOrderId });
  }

  /** Asks Provenant to record the capture; the server verifies it against PayPal. */
  syncCapture(bundleId: string, paypalCaptureId?: string): Promise<EvidenceBundle> {
    return this.call('POST', `/v1/bundles/${bundleId}/capture`, { paypal_capture_id: paypalCaptureId });
  }

  recordFulfilment(bundleId: string, f: Fulfilment): Promise<EvidenceBundle> {
    return this.call('POST', `/v1/bundles/${bundleId}/fulfilment`, f);
  }

  getBundle(bundleId: string): Promise<EvidenceBundle> {
    return this.call('GET', `/v1/bundles/${bundleId}`);
  }

  verify(bundleId: string): Promise<VerifyResult> {
    return this.call('GET', `/v1/bundles/${bundleId}/verify`);
  }

  receiptUrl(bundleId: string): string {
    return `${this.opts.baseUrl.replace(/\/$/, '')}/v1/bundles/${bundleId}/receipt`;
  }
}

/** The bits of an AI-SDK-style tool this wrapper needs: an async `execute`. */
// biome-ignore lint/suspicious/noExplicitAny: tool signatures vary by framework; the wrapper preserves them.
export type ExecutableTool = { execute?: (...args: any[]) => Promise<unknown> };

export interface CustomIdInjectorDeps {
  pv: Provenant;
  /** Sets purchase_units[0].custom_id on a PayPal order (PATCH /v2/checkout/orders/{id}). */
  setOrderCustomId: (orderId: string, customId: string) => Promise<void>;
  /** The bundle backing the purchase currently in progress. */
  currentBundleId: () => string;
  /** Pulls the PayPal order id out of the tool's result. */
  extractOrderId?: (result: unknown) => string | undefined;
}

/**
 * Wraps the PayPal Agent Toolkit's `create_order` tool so every order it creates carries the
 * bundle id in purchase_units[0].custom_id and is sealed to that bundle. The toolkit's tool has
 * no custom_id parameter, so the wrapper patches the order right after creation.
 */
export function withProvenantCustomId<T extends ExecutableTool>(tool: T, deps: CustomIdInjectorDeps): T {
  const original = tool.execute;
  if (!original) throw new Error('tool has no execute function');
  const extract = deps.extractOrderId ?? defaultExtractOrderId;
  return {
    ...tool,
    execute: async (...args: unknown[]) => {
      const bundleId = deps.currentBundleId();
      const { customId } = await deps.pv.prepareOrder(bundleId);
      const result = await original(...args);
      const orderId = extract(result);
      if (!orderId) throw new Error('create_order returned no order id; cannot attach custom_id');
      await deps.setOrderCustomId(orderId, customId);
      await deps.pv.sealOrder(bundleId, { paypalOrderId: orderId });
      return result;
    },
  };
}

function defaultExtractOrderId(result: unknown): string | undefined {
  const obj = typeof result === 'string' ? safeJson(result) : result;
  if (obj && typeof obj === 'object') {
    const id = (obj as { id?: unknown }).id;
    if (typeof id === 'string') return id;
  }
  if (typeof result === 'string') return result.match(/\b[0-9A-Z]{17}\b/)?.[0];
  return undefined;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}
