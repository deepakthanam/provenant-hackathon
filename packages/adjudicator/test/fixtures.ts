import type { Dispute } from '@provenant/paypal';
import type { EvidenceBundle, VerifyResult } from '@provenant/schemas';
import type { AdjudicationInput } from '../src/types';

const at = (iso: string) => new Date(iso).toISOString();
export const SEALED_AT = at('2026-10-10T10:00:00Z');

/** A sealed, captured, delivered bundle that is inside its mandate. Override pieces per test. */
export function bundle(over: Partial<EvidenceBundle> = {}): EvidenceBundle {
  return {
    bundle_id: 'apb_01TESTBUNDLE0000000000000A',
    version: 1,
    paypal_order_id: 'ORDER1',
    paypal_capture_id: 'CAP1',
    captured_amount: { value: '84.00', currency: 'USD' },
    agent: { platform_id: 'demo-agent', agent_version: '0.1.0' },
    user_ref: 'usr_a',
    intent_mandate: {
      text: 'Buy black running shoes, size 10, under $90. Ask me above $50.',
      max_amount: { value: '90.00', currency: 'USD' },
      confirm_above: { value: '50.00', currency: 'USD' },
      allowed_categories: ['footwear'],
      allowed_merchants: ['demo-store'],
      expires_at: '2026-11-30T00:00:00Z',
      user_sig: 'ed25519:AAAA',
    },
    user_confirmation: {
      required: true,
      amount: { value: '84.00', currency: 'USD' },
      given_at: SEALED_AT,
      sig: 'ed25519:BBBB',
    },
    cart: [
      {
        sku: 'RUN-BLK-10',
        name: 'Trail runner',
        qty: 1,
        unit_price: { value: '84.00', currency: 'USD' },
        category: 'footwear',
      },
    ],
    offer_snapshot: {
      merchant_id: 'demo-store',
      url: 'http://localhost:4100/p/RUN-BLK-10',
      title: 'Trail runner, black',
      attributes: { color: 'black', size: '10', style: 'trail' },
      price: { value: '84.00', currency: 'USD' },
      delivery_promise: { min_days: 3, max_days: 5 },
      image_sha256: null,
      image_path: null,
      captured_at: SEALED_AT,
    },
    decision_trace: [{ step: 'rule_check', detail: 'within budget', at: SEALED_AT }],
    fulfilment: {
      carrier: 'UPS',
      tracking_number: '1Z999',
      status: 'DELIVERED',
      shipped_at: at('2026-10-11T10:00:00Z'),
      delivered_at: at('2026-10-14T10:00:00Z'),
      shipped_items: [{ sku: 'RUN-BLK-10', attributes: { color: 'black', size: '10' } }],
    },
    status: 'FULFILLED',
    created_at: SEALED_AT,
    sealed_at: SEALED_AT,
    prev_hash: `sha256:${'1'.repeat(64)}`,
    hash: `sha256:${'2'.repeat(64)}`,
    bundle_sig: 'ed25519:CCCC',
    ...over,
  };
}

export function verifyOk(b: EvidenceBundle): VerifyResult {
  return {
    ok: true,
    bundle_id: b.bundle_id,
    events: 9,
    head_hash: b.hash,
    chain_position: 42,
    signer_fingerprint: 'abcdef0123456789',
    checks: [
      { check: 'mandate_user_signature', ok: true },
      { check: 'confirmation_user_signature', ok: true },
    ],
    failures: [],
  };
}

const links = (id: string, rels: string[]) => [
  { href: `https://api.test/v1/customer/disputes/${id}`, rel: 'self', method: 'GET' },
  ...rels.map((rel) => ({
    href: `https://api.test/v1/customer/disputes/${id}/${rel.replace(/_/g, '-')}`,
    rel,
    method: 'POST',
  })),
];

export const INQUIRY_LINKS = ['send_message', 'escalate', 'make_offer', 'accept_claim', 'provide_evidence'];

export function dispute(over: Partial<Dispute> & { rels?: string[] } = {}): Dispute {
  const { rels, ...rest } = over;
  const id = rest.dispute_id ?? 'PP-D-1';
  return {
    dispute_id: id,
    create_time: at('2026-10-15T10:00:00Z'),
    update_time: at('2026-10-15T10:00:00Z'),
    disputed_transactions: [
      {
        seller_transaction_id: 'CAP1',
        custom: 'apb_01TESTBUNDLE0000000000000A',
        gross_amount: { currency_code: 'USD', value: '84.00' },
      },
    ],
    reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
    status: 'WAITING_FOR_SELLER_RESPONSE',
    dispute_amount: { currency_code: 'USD', value: '84.00' },
    dispute_life_cycle_stage: 'INQUIRY',
    allowed_response_options: {
      accept_claim: { accept_claim_types: ['REFUND', 'PARTIAL_REFUND', 'REFUND_WITH_RETURN'] },
      make_offer: { offer_types: ['REFUND', 'REFUND_WITH_RETURN'] },
    },
    links: links(id, rels ?? INQUIRY_LINKS),
    ...rest,
  };
}

export function input(
  over: {
    bundle?: EvidenceBundle | null;
    dispute?: Dispute;
    messages?: string[];
    verify?: VerifyResult | null;
  } = {},
): AdjudicationInput {
  const b = over.bundle === undefined ? bundle() : over.bundle;
  return {
    dispute: over.dispute ?? dispute(),
    link: {
      bundleId: b?.bundle_id ?? null,
      basis: b ? 'capture CAP1 and custom_id agree' : 'no bundle for this transaction',
    },
    bundle: b,
    verify: over.verify === undefined ? (b ? verifyOk(b) : null) : over.verify,
    snapshotImage: null,
    buyer: { messages: over.messages ?? [], images: [] },
    settings: { confidenceThreshold: 0.75, sharedFaultRefundPct: 50, misrepresentationClaimType: 'REFUND' },
  };
}
