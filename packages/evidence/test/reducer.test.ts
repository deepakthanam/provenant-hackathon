import type { IntentMandate } from '@provenant/schemas';
import { describe, expect, it } from 'vitest';
import { applyEvent, type BundleEventInput, BundleStateError, replay } from '../src/reducer';

const mandate: IntentMandate = {
  text: 'shoes',
  max_amount: { value: '90.00', currency: 'USD' },
  confirm_above: null,
  allowed_categories: ['footwear'],
  allowed_merchants: [],
  expires_at: '2026-11-30T00:00:00Z',
  user_sig: 'ed25519:AAAA',
};
const at = '2026-10-16T10:00:00.000Z';
const ev = (e: Omit<BundleEventInput, 'bundle_id' | 'created_at'>): BundleEventInput =>
  ({ ...e, bundle_id: 'apb_1', created_at: at }) as BundleEventInput;

const created = ev({
  type: 'created',
  payload: {
    agent: { platform_id: 'demo-agent', agent_version: '0.1.0' },
    user_ref: 'usr_a',
    intent_mandate: mandate,
  },
});
const offer = ev({
  type: 'offer_recorded',
  payload: {
    offer_snapshot: {
      merchant_id: 'demo-store',
      url: 'http://localhost:4100/p/RUN-BLK-10',
      title: 'Trail runner, black',
      attributes: { color: 'black' },
      price: { value: '84.00', currency: 'USD' },
      delivery_promise: { min_days: 3, max_days: 5 },
      image_sha256: null,
      image_path: null,
      captured_at: at,
    },
  },
});
const cart = ev({
  type: 'cart_set',
  payload: {
    cart: [
      {
        sku: 'RUN-BLK-10',
        name: 'Trail runner',
        qty: 1,
        unit_price: { value: '84.00', currency: 'USD' },
        category: 'footwear',
      },
    ],
  },
});
const seal = ev({ type: 'sealed', payload: { paypal_order_id: 'ORDER1' } });

describe('bundle reducer', () => {
  it('walks OPEN → SEALED → FULFILLED', () => {
    const s = replay([
      created,
      offer,
      ev({
        type: 'decision_recorded',
        payload: { step: { step: 'rule_check', detail: 'within budget', at } },
      }),
      cart,
      seal,
      ev({
        type: 'capture_recorded',
        payload: { paypal_capture_id: 'CAP1', amount: { value: '84.00', currency: 'USD' } },
      }),
      ev({
        type: 'fulfilment_recorded',
        payload: {
          fulfilment: {
            carrier: 'UPS',
            tracking_number: '1Z',
            status: 'DELIVERED',
            shipped_at: at,
            delivered_at: at,
            shipped_items: null,
          },
        },
      }),
    ]);
    expect(s.status).toBe('FULFILLED');
    expect(s.paypal_order_id).toBe('ORDER1');
    expect(s.paypal_capture_id).toBe('CAP1');
    expect(s.decision_trace).toHaveLength(1);
    expect(s.sealed_at).toBe(at);
  });

  it('refuses edits after sealing', () => {
    const sealed = replay([created, offer, cart, seal]);
    expect(() => applyEvent(sealed, cart)).toThrow(BundleStateError);
    expect(() => applyEvent(sealed, offer)).toThrow(/needs OPEN/);
  });

  it('refuses to seal without an offer or a cart', () => {
    expect(() => replay([created, seal])).toThrow(/offer snapshot/);
    expect(() => replay([created, offer, seal])).toThrow(/empty cart/);
  });

  it('refuses events before creation and double creation', () => {
    expect(() => applyEvent(null, offer)).toThrow(/before created/);
    expect(() => replay([created, created])).toThrow(/already exists/);
  });
});
