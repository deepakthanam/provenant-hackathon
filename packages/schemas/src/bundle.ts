import { z } from 'zod';
import { Ed25519Sig, IsoDateTime, Money, Sha256Hex, Sha256Ref, sumMoney } from './common';

/**
 * The user's intent mandate, shaped like an AP2 IntentMandate so a real AP2 credential can
 * replace it later. Every field is required (use null / [] explicitly) because the user's
 * signature covers the canonical form: defaults filled in server-side would break it.
 */
export const IntentMandate = z.object({
  text: z.string().min(1).max(2000),
  max_amount: Money,
  confirm_above: Money.nullable(),
  allowed_categories: z.array(z.string().min(1).max(64)).max(50),
  /** Empty = any merchant. */
  allowed_merchants: z.array(z.string().min(1).max(64)).max(50),
  expires_at: IsoDateTime,
  user_sig: Ed25519Sig,
});
export type IntentMandate = z.infer<typeof IntentMandate>;
export type UnsignedIntentMandate = Omit<IntentMandate, 'user_sig'>;

export const UserConfirmation = z.object({
  required: z.boolean(),
  /** The amount the user approved (normally the cart total). Covered by `sig`. */
  amount: Money,
  given_at: IsoDateTime,
  sig: Ed25519Sig,
});
export type UserConfirmation = z.infer<typeof UserConfirmation>;

export const CartItem = z.object({
  sku: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  qty: z.number().int().min(1).max(1000),
  unit_price: Money,
  category: z.string().min(1).max(64),
});
export type CartItem = z.infer<typeof CartItem>;

export const DeliveryPromise = z.object({
  min_days: z.number().int().min(0).max(365),
  max_days: z.number().int().min(0).max(365),
});

export const OfferSnapshot = z.object({
  merchant_id: z.string().min(1).max(64),
  url: z.url().max(2000),
  title: z.string().min(1).max(300),
  attributes: z.record(z.string().max(64), z.string().max(500)),
  price: Money,
  delivery_promise: DeliveryPromise,
  image_sha256: Sha256Hex.nullable(),
  image_path: z.string().nullable(),
  captured_at: IsoDateTime,
});
export type OfferSnapshot = z.infer<typeof OfferSnapshot>;

export const DecisionStep = z.object({
  step: z.string().min(1).max(64),
  detail: z.string().max(2000),
  at: IsoDateTime,
});
export type DecisionStep = z.infer<typeof DecisionStep>;

export const FulfilmentStatus = z.enum([
  'NOT_SHIPPED',
  'SHIPPED',
  'IN_TRANSIT',
  'DELIVERED',
  'RETURNED',
  'LOST',
]);
export const Fulfilment = z.object({
  carrier: z.string().min(1).max(64),
  tracking_number: z.string().min(1).max(64),
  status: FulfilmentStatus,
  shipped_at: IsoDateTime.nullable(),
  delivered_at: IsoDateTime.nullable(),
  /** What was actually shipped, when it differs from the cart (demo-store "wrong item" switch). */
  shipped_items: z
    .array(z.object({ sku: z.string(), attributes: z.record(z.string(), z.string()) }))
    .nullable(),
});
export type Fulfilment = z.infer<typeof Fulfilment>;

export const BundleStatus = z.enum(['OPEN', 'SEALED', 'FULFILLED']);
export type BundleStatus = z.infer<typeof BundleStatus>;

export const EvidenceBundle = z.object({
  bundle_id: z.string(),
  version: z.literal(1),
  paypal_order_id: z.string().nullable(),
  paypal_capture_id: z.string().nullable(),
  captured_amount: Money.nullable(),
  agent: z.object({ platform_id: z.string(), agent_version: z.string() }),
  user_ref: z.string(),
  intent_mandate: IntentMandate,
  user_confirmation: UserConfirmation.nullable(),
  cart: z.array(CartItem),
  offer_snapshot: OfferSnapshot.nullable(),
  decision_trace: z.array(DecisionStep),
  fulfilment: Fulfilment.nullable(),
  status: BundleStatus,
  created_at: IsoDateTime,
  sealed_at: IsoDateTime.nullable(),
  /** Hash of the previous ledger row before this bundle's latest event. */
  prev_hash: Sha256Ref,
  /** Hash of this bundle's latest ledger event. */
  hash: Sha256Ref,
  /** Provenant's signature over `hash`. */
  bundle_sig: Ed25519Sig,
});
export type EvidenceBundle = z.infer<typeof EvidenceBundle>;

/** The bundle state without the chain fields, which is what the event reducer produces. */
export type BundleState = Omit<EvidenceBundle, 'prev_hash' | 'hash' | 'bundle_sig'>;

export function cartTotal(cart: CartItem[], currency?: string): z.infer<typeof Money> {
  const cur = currency ?? cart[0]?.unit_price.currency ?? 'USD';
  return sumMoney(
    cart.flatMap((i) => Array.from({ length: i.qty }, () => i.unit_price)),
    cur,
  );
}

/** Ledger event payloads, one per bundle change. */
export const BundleEventType = z.enum([
  'created',
  'offer_recorded',
  'decision_recorded',
  'confirmation_recorded',
  'cart_set',
  'sealed',
  'capture_recorded',
  'fulfilment_recorded',
]);
export type BundleEventType = z.infer<typeof BundleEventType>;

export type BundleEventPayload =
  | {
      type: 'created';
      payload: {
        agent: { platform_id: string; agent_version: string };
        user_ref: string;
        intent_mandate: IntentMandate;
      };
    }
  | { type: 'offer_recorded'; payload: { offer_snapshot: OfferSnapshot } }
  | { type: 'decision_recorded'; payload: { step: DecisionStep } }
  | { type: 'confirmation_recorded'; payload: { user_confirmation: UserConfirmation } }
  | { type: 'cart_set'; payload: { cart: CartItem[] } }
  | { type: 'sealed'; payload: { paypal_order_id: string } }
  | { type: 'capture_recorded'; payload: { paypal_capture_id: string; amount: z.infer<typeof Money> } }
  | { type: 'fulfilment_recorded'; payload: { fulfilment: Fulfilment } };
