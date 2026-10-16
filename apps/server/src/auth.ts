import type { Db } from '@provenant/db';
import { apiKeys } from '@provenant/db';
import { hashApiKey } from '@provenant/db/seed';
import type { BundleRecord } from '@provenant/evidence';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { HttpError } from './errors';

export interface Principal {
  kind: 'admin' | 'platform' | 'merchant';
  keyId: string;
  platformId: string | null;
  merchantId: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal;
  }
}

const CACHE_MS = 30_000;

/** Bearer API keys, looked up by SHA-256 hash. Results are cached briefly to keep hot paths off the DB. */
export function createAuthenticator(db: Db) {
  const cache = new Map<string, { p: Principal | null; at: number }>();

  async function resolve(key: string): Promise<Principal | null> {
    const hash = hashApiKey(key);
    const hit = cache.get(hash);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.p;
    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, hash));
    const p: Principal | null = row
      ? {
          kind: row.kind as Principal['kind'],
          keyId: row.id,
          platformId: row.platformId,
          merchantId: row.merchantId,
        }
      : null;
    cache.set(hash, { p, at: Date.now() });
    return p;
  }

  return async function authenticate(req: FastifyRequest): Promise<void> {
    const header = req.headers.authorization;
    const match = header?.match(/^Bearer\s+(\S+)$/i);
    if (!match?.[1]) throw new HttpError(401, 'UNAUTHENTICATED', 'missing bearer API key');
    const principal = await resolve(match[1]);
    if (!principal) throw new HttpError(401, 'UNAUTHENTICATED', 'unknown API key');
    req.principal = principal;
  };
}

export function principalOf(req: FastifyRequest): Principal {
  if (!req.principal) throw new HttpError(401, 'UNAUTHENTICATED', 'not authenticated');
  return req.principal;
}

export function requireKind(req: FastifyRequest, ...kinds: Principal['kind'][]): Principal {
  const p = principalOf(req);
  if (!kinds.includes(p.kind)) throw new HttpError(403, 'FORBIDDEN', `requires a ${kinds.join(' or ')} key`);
  return p;
}

/** Platforms see their own bundles, merchants see bundles for their offers, admins see all. */
export function canRead(p: Principal, rec: BundleRecord): boolean {
  if (p.kind === 'admin') return true;
  if (p.kind === 'platform') return rec.platformId === p.platformId;
  return rec.merchantId !== null && rec.merchantId === p.merchantId;
}

/** Only the owning platform (or an admin) may change a bundle's agent-side evidence. */
export function canWrite(p: Principal, rec: BundleRecord): boolean {
  return p.kind === 'admin' || (p.kind === 'platform' && rec.platformId === p.platformId);
}

/** Fulfilment can come from the owning platform, the bundle's merchant, or an admin. */
export function canFulfil(p: Principal, rec: BundleRecord): boolean {
  return canWrite(p, rec) || (p.kind === 'merchant' && rec.merchantId === p.merchantId);
}
