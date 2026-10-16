import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Db } from './index';
import { agentPlatforms, apiKeys, merchants } from './schema';

export const DEMO_PLATFORM_ID = 'demo-agent';
export const DEMO_MERCHANT_ID = 'demo-store';

export type ApiKeyKind = 'admin' | 'platform' | 'merchant';

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function generateApiKey(kind: ApiKeyKind): string {
  const prefix = { admin: 'pv_admin', platform: 'pv_plat', merchant: 'pv_merch' }[kind];
  return `${prefix}_${randomBytes(24).toString('base64url')}`;
}

export interface SeedKeys {
  admin?: string;
  platform?: string;
  merchant?: string;
}

/**
 * Idempotently creates the demo agent platform and merchant and registers whichever API keys
 * are configured. Safe to run on every server start.
 */
export async function seedDemo(db: Db, keys: SeedKeys): Promise<void> {
  await db
    .insert(agentPlatforms)
    .values({ id: DEMO_PLATFORM_ID, name: 'Provenant demo shopping agent' })
    .onConflictDoNothing();
  await db
    .insert(merchants)
    .values({ id: DEMO_MERCHANT_ID, name: 'Provenant demo store', misrepresentationClaimType: 'REFUND' })
    .onConflictDoNothing();

  const rows = [
    keys.admin && { id: 'key_admin', kind: 'admin', key: keys.admin, label: 'admin (console)' },
    keys.platform && {
      id: 'key_demo_agent',
      kind: 'platform',
      key: keys.platform,
      platformId: DEMO_PLATFORM_ID,
      label: 'demo-agent',
    },
    keys.merchant && {
      id: 'key_demo_store',
      kind: 'merchant',
      key: keys.merchant,
      merchantId: DEMO_MERCHANT_ID,
      label: 'demo-store',
    },
  ].filter(Boolean) as Array<{
    id: string;
    kind: ApiKeyKind;
    key: string;
    platformId?: string;
    merchantId?: string;
    label: string;
  }>;

  for (const r of rows) {
    await db
      .insert(apiKeys)
      .values({
        id: r.id,
        keyHash: hashApiKey(r.key),
        kind: r.kind,
        platformId: r.platformId ?? null,
        merchantId: r.merchantId ?? null,
        label: r.label,
      })
      .onConflictDoUpdate({ target: apiKeys.id, set: { keyHash: sql`excluded.key_hash` } });
  }
}
