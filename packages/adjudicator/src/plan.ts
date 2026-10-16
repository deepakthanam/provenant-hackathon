import { type AcceptClaimType, type Dispute, DisputeRel, findLink } from '@provenant/paypal';
import {
  type EvidenceBundle,
  fromMinor,
  type PlannedAction,
  toMinor,
  type VerdictCode,
} from '@provenant/schemas';
import type { AdjudicationSettings, Decision } from './types';

const LATE_STAGES = new Set(['CHARGEBACK', 'PRE_ARBITRATION', 'ARBITRATION']);

export function reportFileName(disputeId: string): string {
  return `provenant-evidence-${disputeId}.pdf`;
}

function evidenceTypeFor(reason: string): string {
  if (reason === 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED') return 'PROOF_OF_FULFILLMENT';
  if (reason === 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED') return 'ITEM_DESCRIPTION';
  return 'OTHER';
}

function summaryNote(decision: Decision, bundle: EvidenceBundle | null): string {
  const lines = [
    `Provenant evidence ${bundle?.bundle_id ?? ''}: ${decision.verdict.replace(/_/g, ' ').toLowerCase()} (confidence ${decision.confidence.toFixed(2)}).`,
    ...decision.reasons.slice(0, 4).map((r) => `- ${r.text}`),
    bundle ? `Signed record hash ${bundle.hash}. Full report attached.` : '',
  ];
  return lines.filter(Boolean).join('\n').slice(0, 2000);
}

/**
 * Picks the PayPal call from the verdict and the dispute's current stage, status, HATEOAS links
 * and allowed_response_options. A call whose link (or response type) is absent is planned as
 * unavailable (ACTION_NOT_AVAILABLE) rather than attempted.
 */
export function planAction(args: {
  decision: Decision;
  dispute: Dispute;
  bundle: EvidenceBundle | null;
  settings: AdjudicationSettings;
}): PlannedAction {
  const { decision, dispute, bundle, settings } = args;
  const v: VerdictCode = decision.verdict;
  const stage = dispute.dispute_life_cycle_stage ?? 'INQUIRY';
  const status = dispute.status;
  const has = (rel: string) => findLink(dispute.links, rel) !== undefined;
  const claimTypes = dispute.allowed_response_options?.accept_claim?.accept_claim_types ?? [];
  const offerTypes = dispute.allowed_response_options?.make_offer?.offer_types ?? [];
  const amount = { value: dispute.dispute_amount.value, currency: dispute.dispute_amount.currency_code };
  const note = summaryNote(decision, bundle);
  const where = `status ${status}, stage ${stage}`;
  const none = (explanation: string): PlannedAction => ({
    kind: 'none',
    link_rel: null,
    available: false,
    request: null,
    refund_amount: null,
    liability: null,
    explanation,
  });
  const unavailable = (kind: PlannedAction['kind'], rel: string, why: string): PlannedAction => ({
    kind,
    link_rel: rel,
    available: false,
    request: null,
    refund_amount: null,
    liability: null,
    explanation: `ACTION_NOT_AVAILABLE: ${why} (${where})`,
  });

  if (dispute.status === 'RESOLVED')
    return none(`dispute is already resolved (${dispute.dispute_outcome?.outcome_code ?? 'no outcome'})`);

  switch (v) {
    case 'WITHIN_MANDATE': {
      if (status === 'WAITING_FOR_SELLER_RESPONSE' && has(DisputeRel.provideEvidence)) {
        const tracking = bundle?.fulfilment
          ? [{ carrier_name: bundle.fulfilment.carrier, tracking_number: bundle.fulfilment.tracking_number }]
          : undefined;
        return {
          kind: 'provide_evidence',
          link_rel: DisputeRel.provideEvidence,
          available: true,
          request: {
            evidences: [
              {
                evidence_type: evidenceTypeFor(dispute.reason),
                ...(tracking && dispute.reason === 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED'
                  ? { evidence_info: { tracking_info: tracking } }
                  : {}),
                notes: note,
              },
            ],
            files: [reportFileName(dispute.dispute_id)],
          },
          refund_amount: null,
          liability: null,
          explanation: 'PayPal is waiting for the seller: submit the signed evidence report',
        };
      }
      if (LATE_STAGES.has(stage) && has(DisputeRel.provideSupportingInfo)) {
        return {
          kind: 'provide_supporting_info',
          link_rel: DisputeRel.provideSupportingInfo,
          available: true,
          request: { notes: note, files: [reportFileName(dispute.dispute_id)] },
          refund_amount: null,
          liability: null,
          explanation: `${stage}: submit supporting information with the evidence report`,
        };
      }
      if (stage === 'INQUIRY' && has(DisputeRel.sendMessage)) {
        return {
          kind: 'send_message',
          link_rel: DisputeRel.sendMessage,
          available: true,
          request: {
            message:
              `This order was placed by your shopping agent under a mandate you signed: "${bundle?.intent_mandate.text ?? ''}". It stayed inside that mandate and matches the listing you were shown. Receipt: ${bundle?.bundle_id ?? ''}. Evidence follows when PayPal requests it.`.slice(
                0,
                2000,
              ),
          },
          refund_amount: null,
          liability: null,
          explanation: 'inquiry: explain the mandate to the buyer; evidence follows when PayPal requests it',
        };
      }
      return unavailable(
        'provide_evidence',
        DisputeRel.provideEvidence,
        'no evidence, supporting-info or message link',
      );
    }

    case 'AGENT_OUT_OF_BOUNDS':
    case 'MERCHANT_MISREPRESENTED': {
      const wanted: AcceptClaimType =
        v === 'MERCHANT_MISREPRESENTED' ? settings.misrepresentationClaimType : 'REFUND';
      const type: AcceptClaimType | undefined = claimTypes.includes(wanted)
        ? wanted
        : claimTypes.includes('REFUND')
          ? 'REFUND'
          : undefined;
      if (!has(DisputeRel.acceptClaim))
        return unavailable('accept_claim', DisputeRel.acceptClaim, 'no accept_claim link');
      if (!type)
        return unavailable(
          'accept_claim',
          DisputeRel.acceptClaim,
          `accept_claim types allowed: ${claimTypes.join(', ') || 'none'}`,
        );
      const liability =
        v === 'AGENT_OUT_OF_BOUNDS' && bundle ? { platform_id: bundle.agent.platform_id, amount } : null;
      return {
        kind: 'accept_claim',
        link_rel: DisputeRel.acceptClaim,
        available: true,
        request: { note, accept_claim_type: type },
        refund_amount: amount,
        liability,
        explanation:
          v === 'AGENT_OUT_OF_BOUNDS'
            ? `refund the buyer; ${amount.currency} ${amount.value} is booked against agent platform ${bundle?.agent.platform_id}`
            : `accept the claim (${type}): the merchant's item or shipment did not match the offer`,
      };
    }

    case 'SHARED_FAULT': {
      const partial = fromMinor(
        Math.round((toMinor(amount) * settings.sharedFaultRefundPct) / 100),
        amount.currency,
      );
      const payPalPartial = { currency_code: partial.currency, value: partial.value };
      if (stage === 'INQUIRY') {
        if (!has(DisputeRel.makeOffer))
          return unavailable('make_offer', DisputeRel.makeOffer, 'no make_offer link');
        if (!offerTypes.includes('REFUND'))
          return unavailable(
            'make_offer',
            DisputeRel.makeOffer,
            `offer types allowed: ${offerTypes.join(', ') || 'none'}`,
          );
        return {
          kind: 'make_offer',
          link_rel: DisputeRel.makeOffer,
          available: true,
          // PayPal's offer_type has no PARTIAL_REFUND: a partial refund is REFUND with a smaller offer_amount.
          request: { note, offer_type: 'REFUND', offer_amount: payPalPartial },
          refund_amount: partial,
          liability: null,
          explanation: `offer a ${settings.sharedFaultRefundPct}% refund (${partial.currency} ${partial.value})`,
        };
      }
      if (has(DisputeRel.acceptClaim) && claimTypes.includes('PARTIAL_REFUND')) {
        return {
          kind: 'accept_claim',
          link_rel: DisputeRel.acceptClaim,
          available: true,
          request: { note, accept_claim_type: 'PARTIAL_REFUND', refund_amount: payPalPartial },
          refund_amount: partial,
          liability: null,
          explanation: `${stage}: accept a ${settings.sharedFaultRefundPct}% partial refund`,
        };
      }
      return none(`${stage}: PARTIAL_REFUND is not an allowed response here; human review`);
    }

    case 'INSUFFICIENT_EVIDENCE':
      return none('insufficient or conflicting evidence: human review, no PayPal call');
  }
}
