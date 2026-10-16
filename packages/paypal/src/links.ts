import { ActionNotAvailableError } from './errors';
import type { Dispute, Link } from './types';

/**
 * HATEOAS link relations on dispute details. PayPal uses underscores (see the "Show dispute
 * details" sample in the Disputes API guide); the sandbox-only actions use hyphens in its docs,
 * so lookups accept either.
 */
export const DisputeRel = {
  self: 'self',
  acceptClaim: 'accept_claim',
  makeOffer: 'make_offer',
  sendMessage: 'send_message',
  provideEvidence: 'provide_evidence',
  provideSupportingInfo: 'provide_supporting_info',
  escalate: 'escalate',
  acknowledgeReturnItem: 'acknowledge_return_item',
  adjudicate: 'adjudicate',
  requireEvidence: 'require_evidence',
} as const;
export type DisputeRel = (typeof DisputeRel)[keyof typeof DisputeRel];

const norm = (rel: string) => rel.toLowerCase().replace(/-/g, '_');

export function findLink(links: Link[] | undefined, rel: string): Link | undefined {
  return links?.find((l) => norm(l.rel) === norm(rel));
}

export function hasLink(dispute: Pick<Dispute, 'links'>, rel: string): boolean {
  return findLink(dispute.links, rel) !== undefined;
}

/** Returns the link or throws ActionNotAvailableError carrying the dispute's status and stage. */
export function requireLink(dispute: Dispute, rel: string): Link {
  const link = findLink(dispute.links, rel);
  if (!link) throw new ActionNotAvailableError(rel, dispute.status, dispute.dispute_life_cycle_stage);
  return link;
}
