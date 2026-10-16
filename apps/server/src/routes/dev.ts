import type { Db } from '@provenant/db';
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
  opts: { db: Db; authenticate: (req: FastifyRequest) => Promise<void> },
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
}
