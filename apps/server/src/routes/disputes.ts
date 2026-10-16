import type { Db } from '@provenant/db';
import { disputeEvents, disputes } from '@provenant/db';
import { ErrorResponse } from '@provenant/schemas';
import { asc, desc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireKind } from '../auth';
import type { DisputeIntake } from '../disputes/intake';
import { HttpError } from '../errors';

export const DisputeSummary = z.object({
  id: z.string(),
  reason: z.string(),
  status: z.string(),
  stage: z.string().nullable(),
  amount: z.object({ value: z.string(), currency: z.string() }).nullable(),
  transaction_id: z.string().nullable(),
  bundle_id: z.string().nullable(),
  link_basis: z.string().nullable(),
  paypal_create_time: z.string().nullable(),
  paypal_update_time: z.string().nullable(),
});

type DisputeRow = typeof disputes.$inferSelect;

export function summarise(row: DisputeRow): z.infer<typeof DisputeSummary> {
  const raw = row.raw as { provenant_link?: { basis?: string } };
  return {
    id: row.id,
    reason: row.reason,
    status: row.status,
    stage: row.stage,
    amount:
      row.amountValue && row.amountCurrency ? { value: row.amountValue, currency: row.amountCurrency } : null,
    transaction_id: row.transactionId,
    bundle_id: row.bundleId,
    link_basis: raw.provenant_link?.basis ?? null,
    paypal_create_time: row.paypalCreateTime?.toISOString() ?? null,
    paypal_update_time: row.paypalUpdateTime?.toISOString() ?? null,
  };
}

const security = [{ bearer: [] }];
const errors = { 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse };

/** Read side of the dispute mirror (merchant / admin). Verdicts and actions join in later milestones. */
export async function disputeRoutes(
  app: FastifyInstance,
  opts: { db: Db; intake: DisputeIntake; authenticate: (req: FastifyRequest) => Promise<void> },
): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.addHook('onRequest', opts.authenticate);

  r.get(
    '/v1/disputes',
    {
      schema: {
        tags: ['disputes'],
        summary: 'List mirrored PayPal disputes',
        security,
        response: { 200: z.object({ items: z.array(DisputeSummary) }), ...errors },
      },
    },
    async (req) => {
      requireKind(req, 'merchant', 'admin');
      const rows = await opts.db.select().from(disputes).orderBy(desc(disputes.paypalUpdateTime));
      return { items: rows.map(summarise) };
    },
  );

  r.get(
    '/v1/disputes/:id',
    {
      schema: {
        tags: ['disputes'],
        summary: 'A dispute with its PayPal details and event timeline',
        security,
        params: z.object({ id: z.string().min(1).max(64) }),
        response: {
          200: DisputeSummary.extend({
            paypal: z.record(z.string(), z.unknown()),
            events: z.array(
              z.object({
                id: z.string(),
                source: z.string(),
                event_type: z.string(),
                created_at: z.string(),
                processed: z.boolean(),
                error: z.string().nullable(),
              }),
            ),
          }),
          ...errors,
        },
      },
    },
    async (req) => {
      requireKind(req, 'merchant', 'admin');
      const [row] = await opts.db.select().from(disputes).where(eq(disputes.id, req.params.id));
      if (!row) throw new HttpError(404, 'NOT_FOUND', `dispute ${req.params.id} not found`);
      const events = await opts.db
        .select()
        .from(disputeEvents)
        .where(eq(disputeEvents.disputeId, row.id))
        .orderBy(asc(disputeEvents.createdAt));
      return {
        ...summarise(row),
        paypal: row.raw as Record<string, unknown>,
        events: events.map((e) => ({
          id: e.id,
          source: e.source,
          event_type: e.eventType,
          created_at: e.createdAt.toISOString(),
          processed: e.processedAt !== null,
          error: e.error,
        })),
      };
    },
  );

  r.post(
    '/v1/disputes/sync',
    {
      schema: {
        tags: ['disputes'],
        summary: 'Poll PayPal for changed disputes now (the background poller does this on an interval)',
        security,
        response: { 200: z.object({ seen: z.number(), refreshed: z.number() }), ...errors },
      },
    },
    async (req) => {
      requireKind(req, 'merchant', 'admin');
      return opts.intake.pollOnce();
    },
  );
}
