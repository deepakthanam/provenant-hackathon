import { z } from 'zod';
import { IsoDateTime, Money } from './common';

export const VerdictCode = z.enum([
  /** Order matches what the user authorised and was delivered as shown. Provide evidence (seller wins). */
  'WITHIN_MANDATE',
  /** Agent broke the mandate. Refund buyer; liability against the agent platform. */
  'AGENT_OUT_OF_BOUNDS',
  /** Delivered item differs from the snapshot, or never shipped. Accept claim. */
  'MERCHANT_MISREPRESENTED',
  /** Inside mandate but ambiguous, or both sides erred. Partial refund. */
  'SHARED_FAULT',
  /** Bundle missing, signature broken, or conflicting facts. Human review only. */
  'INSUFFICIENT_EVIDENCE',
]);
export type VerdictCode = z.infer<typeof VerdictCode>;

export const RuleResult = z.object({
  rule: z.string(),
  passed: z.boolean(),
  /** Rules that did not apply (e.g. delivery window when nothing shipped) are skipped, not passed. */
  skipped: z.boolean().default(false),
  detail: z.string(),
  /** Bundle field the rule rests on, e.g. `intent_mandate.max_amount`. */
  field_ref: z.string().optional(),
});
export type RuleResult = z.infer<typeof RuleResult>;

export const Severity = z.enum(['minor', 'material', 'critical']);

export const ModelDifference = z.object({
  attribute: z.string(),
  snapshot_value: z.string(),
  claimed_value: z.string(),
  /** Must point at a real field in the offer snapshot, or the difference is dropped. */
  snapshot_field_ref: z.string(),
  severity: Severity,
});
export type ModelDifference = z.infer<typeof ModelDifference>;

export const ModelFindings = z.object({
  differences: z.array(ModelDifference),
  claim_consistent_with_snapshot: z.boolean(),
  notes: z.string(),
});
export type ModelFindings = z.infer<typeof ModelFindings>;

export const Reason = z.object({ text: z.string(), ref: z.string() });

export const PlannedActionKind = z.enum([
  'provide_evidence',
  'send_message',
  'provide_supporting_info',
  'accept_claim',
  'make_offer',
  'none',
]);
export type PlannedActionKind = z.infer<typeof PlannedActionKind>;

export const PlannedAction = z.object({
  kind: PlannedActionKind,
  /** HATEOAS rel the call depends on. */
  link_rel: z.string().nullable(),
  available: z.boolean(),
  /** Exact JSON body that will be sent (files listed by name). */
  request: z.record(z.string(), z.unknown()).nullable(),
  refund_amount: Money.nullable(),
  liability: z.object({ platform_id: z.string(), amount: Money }).nullable(),
  explanation: z.string(),
});
export type PlannedAction = z.infer<typeof PlannedAction>;

export const VerdictRecord = z.object({
  id: z.string(),
  dispute_id: z.string(),
  bundle_id: z.string().nullable(),
  verdict: VerdictCode,
  confidence: z.number().min(0).max(1),
  reasons: z.array(Reason),
  rule_results: z.array(RuleResult),
  model_findings: z.array(ModelDifference),
  model_id: z.string().nullable(),
  prompt_hash: z.string().nullable(),
  inputs_hash: z.string(),
  recommended_action: PlannedAction,
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'EXECUTED', 'FAILED', 'SUPERSEDED']),
  created_at: IsoDateTime,
  approved_by: z.string().nullable(),
  executed_action: z.record(z.string(), z.unknown()).nullable(),
  paypal_response: z.unknown().nullable(),
});
export type VerdictRecord = z.infer<typeof VerdictRecord>;
