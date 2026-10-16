import type { BundleEventType } from '@provenant/schemas';
import { hashCanonical } from './crypto';

/** prev_hash of the very first ledger row. */
export const GENESIS_HASH = `sha256:${'0'.repeat(64)}`;

export interface LedgerEntryBody {
  bundle_id: string;
  type: BundleEventType;
  payload: unknown;
  prev_hash: string;
  created_at: string;
}

/** Hash of one ledger row: SHA-256 over the canonical JSON of everything except the hash and signature. */
export function ledgerEntryHash(body: LedgerEntryBody): string {
  return hashCanonical({
    bundle_id: body.bundle_id,
    type: body.type,
    payload: body.payload,
    prev_hash: body.prev_hash,
    created_at: body.created_at,
  });
}
