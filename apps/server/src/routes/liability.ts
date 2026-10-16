import type { Db } from '@provenant/db';
import { agentPlatforms, liabilityLedger } from '@provenant/db';
import { fromMinor, toMinor } from '@provenant/schemas';
import { desc } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireKind } from '../auth';

const Money = z.object({ value: z.string(), currency: z.string() });

/** Refunds caused by agents acting outside their users' mandates, attributed to each agent platform. */
export async function liabilityRoutes(
  app: FastifyInstance,
  opts: { db: Db; authenticate: (req: FastifyRequest) => Promise<void> },
): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.addHook('onRequest', opts.authenticate);
  r.get(
    '/v1/liability',
    {
      schema: {
        tags: ['liability'],
        summary: 'Liability ledger by agent platform',
        security: [{ bearer: [] }],
        response: {
          200: z.object({
            platforms: z.array(
              z.object({
                platform_id: z.string(),
                name: z.string().nullable(),
                total: Money,
                disputes: z.number(),
              }),
            ),
            entries: z.array(
              z.object({
                id: z.string(),
                platform_id: z.string(),
                dispute_id: z.string(),
                verdict_id: z.string(),
                amount: Money,
                note: z.string().nullable(),
                created_at: z.string(),
              }),
            ),
          }),
        },
      },
    },
    async (req) => {
      const p = requireKind(req, 'merchant', 'admin', 'platform');
      let rows = await opts.db.select().from(liabilityLedger).orderBy(desc(liabilityLedger.createdAt));
      if (p.kind === 'platform') rows = rows.filter((e) => e.platformId === p.platformId);
      const names = new Map((await opts.db.select().from(agentPlatforms)).map((x) => [x.id, x.name]));
      const totals = new Map<string, { minor: number; currency: string; count: number }>();
      for (const e of rows) {
        const t = totals.get(e.platformId) ?? { minor: 0, currency: e.currency, count: 0 };
        t.minor += toMinor({ value: e.amountValue, currency: e.currency });
        t.count += 1;
        totals.set(e.platformId, t);
      }
      return {
        platforms: [...totals].map(([id, t]) => ({
          platform_id: id,
          name: names.get(id) ?? null,
          total: fromMinor(t.minor, t.currency),
          disputes: t.count,
        })),
        entries: rows.map((e) => ({
          id: e.id,
          platform_id: e.platformId,
          dispute_id: e.disputeId,
          verdict_id: e.verdictId,
          amount: { value: e.amountValue, currency: e.currency },
          note: e.note,
          created_at: e.createdAt.toISOString(),
        })),
      };
    },
  );
}
