import type { Money, Verdict } from './types';

export const VERDICTS: Verdict[] = [
  'WITHIN_MANDATE',
  'AGENT_OUT_OF_BOUNDS',
  'MERCHANT_MISREPRESENTED',
  'SHARED_FAULT',
  'INSUFFICIENT_EVIDENCE',
];

export const VERDICT_LABEL: Record<Verdict, string> = {
  WITHIN_MANDATE: 'Within mandate',
  AGENT_OUT_OF_BOUNDS: 'Agent out of bounds',
  MERCHANT_MISREPRESENTED: 'Merchant misrepresented',
  SHARED_FAULT: 'Shared fault',
  INSUFFICIENT_EVIDENCE: 'Insufficient evidence',
};

/** Who carries it, in one line (shown under the stamp). */
export const VERDICT_MEANING: Record<Verdict, string> = {
  WITHIN_MANDATE: 'The agent did what the user signed for and the item arrived as shown. The seller defends.',
  AGENT_OUT_OF_BOUNDS:
    'The agent broke the signed mandate. Refund the buyer; the agent platform carries the cost.',
  MERCHANT_MISREPRESENTED:
    'What arrived (or did not) differs from the offer the agent saw. Accept the claim.',
  SHARED_FAULT: 'Inside the mandate, but the listing and the mandate left room for doubt. Split the refund.',
  INSUFFICIENT_EVIDENCE:
    'The evidence cannot be trusted or the facts conflict. A person decides; no PayPal call.',
};

export const VERDICT_COLOR: Record<Verdict, string> = {
  WITHIN_MANDATE: 'var(--color-v-within)',
  AGENT_OUT_OF_BOUNDS: 'var(--color-v-agent)',
  MERCHANT_MISREPRESENTED: 'var(--color-v-merchant)',
  SHARED_FAULT: 'var(--color-v-shared)',
  INSUFFICIENT_EVIDENCE: 'var(--color-v-insufficient)',
};

export const REASON_LABEL: Record<string, string> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: 'Not received',
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: 'Not as described',
  UNAUTHORISED: 'Unauthorised',
  CREDIT_NOT_PROCESSED: 'Credit not processed',
  DUPLICATE_TRANSACTION: 'Duplicate transaction',
  INCORRECT_AMOUNT: 'Incorrect amount',
  PAYMENT_BY_OTHER_MEANS: 'Paid by other means',
  CANCELED_RECURRING_BILLING: 'Cancelled recurring billing',
  PROBLEM_WITH_REMITTANCE: 'Problem with remittance',
  OTHER: 'Other',
};

export const STATUS_LABEL: Record<string, string> = {
  WAITING_FOR_SELLER_RESPONSE: 'Waiting for seller',
  WAITING_FOR_BUYER_RESPONSE: 'Waiting for buyer',
  UNDER_REVIEW: 'Under PayPal review',
  RESOLVED: 'Resolved',
  OPEN: 'Open',
  OTHER: 'Other',
};

export const ACTION_LABEL: Record<string, string> = {
  provide_evidence: 'Provide evidence',
  provide_supporting_info: 'Provide supporting info',
  send_message: 'Send message',
  accept_claim: 'Accept claim',
  make_offer: 'Make offer',
  none: 'No call (human review)',
};

/** The Disputes API path each action posts to. */
export const ACTION_PATH: Record<string, string> = {
  provide_evidence: 'provide-evidence',
  provide_supporting_info: 'provide-supporting-info',
  send_message: 'send-message',
  accept_claim: 'accept-claim',
  make_offer: 'make-offer',
};

export const VERDICT_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Awaiting approval',
  APPROVED: 'Approved',
  EXECUTED: 'Sent to PayPal',
  REJECTED: 'Rejected',
  FAILED: 'Not sent',
  SUPERSEDED: 'Superseded',
};

export function money(m: Money | null | undefined): string {
  if (!m) return '—';
  const symbol = m.currency === 'USD' ? '$' : `${m.currency} `;
  return `${symbol}${m.value}`;
}

export function label(map: Record<string, string>, key: string | null | undefined): string {
  if (!key) return '—';
  return (
    map[key] ??
    key
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/^\w/, (c) => c.toUpperCase())
  );
}

export function when(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return (
    d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'UTC',
    }) + ' UTC'
  );
}

export function age(hours: number | null): string {
  if (hours === null) return '—';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.round(hours / 24)} d`;
}

export function shortHash(h: string | null | undefined, n = 12): string {
  if (!h) return '—';
  const [algo, hex] = h.includes(':') ? h.split(':') : ['', h];
  return `${algo ? `${algo}:` : ''}${hex!.slice(0, n)}…`;
}
