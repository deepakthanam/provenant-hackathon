import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '@provenant/db';
import {
  confirmationSigningMessage,
  generateKeyPairB64,
  mandateSigningMessage,
  privateKeyFromB64,
  signMessage,
} from '@provenant/evidence';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireKind } from '../auth';
import { HttpError } from '../errors';

/**
 * Development-only helpers (never registered in production or sandbox mode). `tamper` edits a
 * sealed bundle's ledger row directly in the database, the way an attacker with DB access would,
 * so the "tampered" scenario can show integrity verification catching it.
 */
export async function devRoutes(
  app: FastifyInstance,
  opts: { db: Db; dataDir: string; authenticate: (req: FastifyRequest) => Promise<void> },
): Promise<void> {
  app.addHook('onRequest', opts.authenticate);

  app.post<{ Params: { bundleId: string } }>(
    '/dev/tamper/:bundleId',
    { schema: { hide: true } as never },
    async (req) => {
      requireKind(req, 'admin');
      const res = await opts.db.$client.query(
        `update bundle_events
            set payload = jsonb_set(payload, '{cart,0,unit_price,value}', '"1.00"')
          where bundle_id = $1 and type = 'cart_set'`,
        [req.params.bundleId],
      );
      if (res.rowCount === 0) throw new HttpError(404, 'NOT_FOUND', 'no cart_set ledger row for that bundle');
      return {
        tampered: true,
        rows: res.rowCount,
        edit: 'cart[0].unit_price.value → "1.00" in the signed cart_set ledger row',
      };
    },
  );

  /**
   * Signs as a demo user (keys kept beside the demo agent's), so tools that cannot do Ed25519,
   * like Postman, can drive the full flow. In production the user's own device signs.
   */
  app.post<{
    Body: {
      user_ref: string;
      mandate?: Record<string, unknown>;
      confirmation?: { bundle_id: string; amount: { value: string; currency: string }; given_at: string };
    };
  }>('/dev/demo-user/sign', { schema: { hide: true } as never }, async (req) => {
    requireKind(req, 'admin', 'platform');
    const ref = req.body?.user_ref;
    if (!ref || !/^usr_[A-Za-z0-9_-]{3,64}$/.test(ref))
      throw new HttpError(400, 'VALIDATION_FAILED', 'user_ref like usr_x is required');
    const dir = join(opts.dataDir, 'agent-users');
    const file = join(dir, `${ref}.json`);
    let user: { publicKey: string; privateKey: string };
    if (existsSync(file)) user = JSON.parse(readFileSync(file, 'utf8'));
    else {
      mkdirSync(dir, { recursive: true });
      user = { ...generateKeyPairB64() };
      writeFileSync(file, JSON.stringify({ userRef: ref, ...user }, null, 2), { mode: 0o600 });
    }
    const key = privateKeyFromB64(user.privateKey);
    return {
      user_ref: ref,
      user_public_key: user.publicKey,
      ...(req.body.mandate
        ? { user_sig: signMessage(key, mandateSigningMessage(ref, req.body.mandate as never)) }
        : {}),
      ...(req.body.confirmation
        ? {
            confirmation_sig: signMessage(
              key,
              confirmationSigningMessage(
                req.body.confirmation.bundle_id,
                req.body.confirmation.amount,
                req.body.confirmation.given_at,
              ),
            ),
          }
        : {}),
    };
  });
}
