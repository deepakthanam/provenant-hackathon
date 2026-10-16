import type { RuleResult, VerdictCode } from '@provenant/schemas';
import { DESCRIPTION_REASONS } from './claim';
import type { AdjudicationSettings, Decision, ModelRun } from './types';

export interface DecideInput {
  reason: string;
  integrity: RuleResult[];
  mandate: RuleResult[];
  /** The mandate rules evaluated on the cart the agent approved (as if captured = cart total). */
  mandateAtCart?: RuleResult[];
  delivery: RuleResult[];
  model: ModelRun | null;
  settings: AdjudicationSettings;
}

const failed = (rs: RuleResult[]) => rs.filter((r) => !r.passed && !r.skipped);
const result = (rs: RuleResult[], rule: string) => rs.find((r) => r.rule === rule);
const because = (r: RuleResult) => ({ text: `${r.rule}: ${r.detail}`, ref: r.field_ref ?? `rule:${r.rule}` });

/**
 * Deterministic mapping from rule results and model findings to a verdict. The model never picks
 * the verdict: its findings only count where a rule allows them to, and when rules and model point
 * different ways, or confidence is low, the answer is INSUFFICIENT_EVIDENCE (human review).
 */
export function decide(d: DecideInput): Decision {
  const decision = decideRaw(d);
  if (decision.verdict !== 'INSUFFICIENT_EVIDENCE' && decision.confidence < d.settings.confidenceThreshold) {
    return {
      verdict: 'INSUFFICIENT_EVIDENCE',
      confidence: decision.confidence,
      reasons: [
        {
          text: `would be ${decision.verdict}, but confidence ${decision.confidence.toFixed(2)} is below the ${d.settings.confidenceThreshold} threshold`,
          ref: 'setting:CONFIDENCE_THRESHOLD',
        },
        ...decision.reasons,
      ],
    };
  }
  return decision;
}

function verdict(v: VerdictCode, confidence: number, reasons: Decision['reasons']): Decision {
  return { verdict: v, confidence: Math.round(confidence * 1000) / 1000, reasons };
}

function decideRaw(d: DecideInput): Decision {
  // 1. Integrity: an untrustworthy or unlinked bundle settles nothing.
  const badIntegrity = failed(d.integrity);
  if (badIntegrity.length) return verdict('INSUFFICIENT_EVIDENCE', 0.95, badIntegrity.map(because));

  // 2. Mandate: the agent spent outside what the user signed. If the cart the agent approved was
  //    inside the mandate and only the captured amount moved, the merchant changed the price.
  const badMandate = failed(d.mandate);
  if (badMandate.length) {
    const priceChange = result(d.mandate, 'captured_equals_cart');
    const agentCartOk = d.mandateAtCart ? failed(d.mandateAtCart).length === 0 : false;
    if (priceChange && !priceChange.passed && !priceChange.skipped && agentCartOk) {
      return verdict('MERCHANT_MISREPRESENTED', 0.9, [
        because(priceChange),
        {
          text: 'the cart the agent approved was inside the mandate; only the charged amount changed',
          ref: 'cart',
        },
      ]);
    }
    return verdict('AGENT_OUT_OF_BOUNDS', 0.95, badMandate.map(because));
  }
  const mandateOk = {
    text: 'the order is inside the signed mandate (budget, category, merchant, confirmation, expiry)',
    ref: 'intent_mandate',
  };

  const shipped = result(d.delivery, 'shipped');
  const delivered = result(d.delivery, 'delivered');
  const window = result(d.delivery, 'delivered_within_window');
  const items = result(d.delivery, 'shipped_items_match_cart');

  // 3. Not received.
  if (d.reason === 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED') {
    if (shipped && !shipped.passed)
      return verdict('MERCHANT_MISREPRESENTED', 0.9, [because(shipped), mandateOk]);
    if (delivered?.passed)
      return verdict('WITHIN_MANDATE', 0.88, [
        because(delivered),
        ...(window ? [because(window)] : []),
        mandateOk,
      ]);
    if (window && !window.passed && !window.skipped)
      return verdict('MERCHANT_MISREPRESENTED', 0.8, [because(window), mandateOk]);
    return verdict('INSUFFICIENT_EVIDENCE', 0.6, [
      {
        text: 'shipped and still inside the promised delivery window: too early to decide',
        ref: 'offer_snapshot.delivery_promise',
      },
    ]);
  }

  // 4. Not as described: what was packed (merchant's own record) and what the buyer reports (model).
  if (DESCRIPTION_REASONS.has(d.reason)) {
    const m = d.model;
    if (!m || m.error) {
      return verdict('INSUFFICIENT_EVIDENCE', 0.5, [
        { text: `claim comparison unavailable${m?.error ? `: ${m.error}` : ''}`, ref: 'model' },
      ]);
    }
    const serious = m.findings.filter((f) => f.severity !== 'minor');
    const minor = m.findings.filter((f) => f.severity === 'minor');
    const cite = (fs: typeof m.findings) =>
      fs.map((f) => ({
        text: `${f.attribute}: listing "${f.snapshot_value}", buyer reports "${f.claimed_value}" (${f.severity})`,
        ref: f.snapshot_field_ref,
      }));
    const packedWrong = items && !items.passed && !items.skipped;
    const packedRight = items?.passed && !items.skipped;

    if (packedWrong) {
      // The merchant's own shipment record says a different item went out.
      if (serious.length) return verdict('MERCHANT_MISREPRESENTED', 0.93, [because(items), ...cite(serious)]);
      return verdict('INSUFFICIENT_EVIDENCE', 0.55, [
        because(items),
        { text: 'but the buyer does not describe a difference: facts conflict', ref: 'model' },
      ]);
    }
    if (serious.length && !m.claimConsistentWithSnapshot) {
      if (packedRight) {
        return verdict('INSUFFICIENT_EVIDENCE', 0.55, [
          {
            text: 'the merchant recorded shipping the cart item, but the buyer reports a different one: facts conflict',
            ref: 'fulfilment.shipped_items',
          },
          ...cite(serious),
        ]);
      }
      return verdict('MERCHANT_MISREPRESENTED', 0.8, cite(serious));
    }
    if (minor.length) {
      return verdict('SHARED_FAULT', 0.8, [
        ...cite(minor),
        {
          text: 'the item matches the listing, but the listing and the mandate left this open to more than one reading',
          ref: 'intent_mandate.text',
        },
      ]);
    }
    return verdict('WITHIN_MANDATE', 0.87, [
      { text: m.notes || 'the buyer describes no difference from the listing', ref: 'offer_snapshot' },
      mandateOk,
      ...(delivered?.passed ? [because(delivered)] : []),
    ]);
  }

  // 5. Unauthorised: the user's signed mandate is the authorisation.
  if (d.reason === 'UNAUTHORISED') {
    return verdict('WITHIN_MANDATE', 0.9, [
      {
        text: 'the purchase was authorised by a mandate the user signed with their key',
        ref: 'intent_mandate.user_sig',
      },
      mandateOk,
    ]);
  }

  // 6. Incorrect amount: the captured amount equals the approved cart (checked above).
  if (d.reason === 'INCORRECT_AMOUNT') {
    const eq = result(d.mandate, 'captured_equals_cart');
    return verdict('WITHIN_MANDATE', 0.85, [...(eq ? [because(eq)] : []), mandateOk]);
  }

  return verdict('INSUFFICIENT_EVIDENCE', 0.5, [
    { text: `Provenant does not adjudicate ${d.reason} disputes automatically`, ref: 'dispute.reason' },
  ]);
}
