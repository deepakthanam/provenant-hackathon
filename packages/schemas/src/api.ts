import { z } from 'zod';
import { CartItem, DecisionStep, Fulfilment, IntentMandate, OfferSnapshot } from './bundle';
import { Ed25519Sig, IsoDateTime, Money } from './common';

export const UserRef = z.string().regex(/^usr_[A-Za-z0-9_-]{3,64}$/, 'expected usr_<id>');

/** Base64 of an Ed25519 public key in SPKI PEM form. */
export const PublicKeyB64 = z.string().min(40).max(1000);

export const CreateBundleRequest = z.object({
  user_ref: UserRef,
  /** Registers the user's key on first use; must match the stored key afterwards. */
  user_public_key: PublicKeyB64.optional(),
  agent_version: z.string().min(1).max(32),
  intent_mandate: IntentMandate,
});
export type CreateBundleRequest = z.infer<typeof CreateBundleRequest>;

export const RecordOfferRequest = OfferSnapshot.omit({
  image_sha256: true,
  image_path: true,
  captured_at: true,
}).extend({
  captured_at: IsoDateTime.optional(),
  /** Product image bytes, base64. Stored content-addressed; the bundle keeps the hash. */
  image_base64: z.string().max(4_000_000).optional(),
  image_content_type: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']).optional(),
});
export type RecordOfferRequest = z.infer<typeof RecordOfferRequest>;

export const RecordDecisionRequest = DecisionStep.omit({ at: true }).extend({ at: IsoDateTime.optional() });
export type RecordDecisionRequest = z.infer<typeof RecordDecisionRequest>;

export const RecordConfirmationRequest = z.object({ amount: Money, given_at: IsoDateTime, sig: Ed25519Sig });
export type RecordConfirmationRequest = z.infer<typeof RecordConfirmationRequest>;

export const SetCartRequest = z.object({ cart: z.array(CartItem).min(1).max(50) });
export type SetCartRequest = z.infer<typeof SetCartRequest>;

export const SealRequest = z.object({ paypal_order_id: z.string().min(1).max(64) });
export type SealRequest = z.infer<typeof SealRequest>;

export const RecordFulfilmentRequest = Fulfilment;
export type RecordFulfilmentRequest = z.infer<typeof RecordFulfilmentRequest>;

export const PrepareOrderResponse = z.object({ custom_id: z.string(), amount: Money });

export const VerifyResult = z.object({
  ok: z.boolean(),
  bundle_id: z.string(),
  events: z.number().int(),
  head_hash: z.string().nullable(),
  chain_position: z.number().int().nullable(),
  signer_fingerprint: z.string(),
  checks: z.array(z.object({ check: z.string(), ok: z.boolean(), detail: z.string().optional() })),
  failures: z.array(z.string()),
});
export type VerifyResult = z.infer<typeof VerifyResult>;

export const ErrorResponse = z.object({
  error: z.string(),
  message: z.string(),
  request_id: z.string().optional(),
});
