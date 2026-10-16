import type { Db } from '@provenant/db';
import { actions, disputeEvents, disputes, verdicts } from '@provenant/db';
import type { PayPalClient } from '@provenant/paypal';
import { ErrorResponse } from '@provenant/schemas';
import { asc, desc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireKind } from '../auth';
import { type ActionExecutor, ActionOverride } from '../disputes/actions';
import type { AdjudicationService, VerdictRow } from '../disputes/adjudication';
import type { DisputeIntake } from '../disputes/intake';
import { HttpError } from '../errors';

const PlannedActionView = z.object({
  kind: z.string(),
  link_rel: z.string().nullable(),
  available: z.boolean(),
  request: z.record(z.string(), z.unknown()).nullable(),
  refund_amount: z.object({ value: z.string(), currency: z.string() }).nullable(),
  liability: z
    .object({ platform_id: z.string(), amount: z.object({ value: z.string(), currency: z.string() }) })
    .nullable(),
  explanation: z.string(),
});

export const VerdictView = z.object({
  id: z.string(),
  verdict: z.string(),
  confidence: z.number(),
  status: z.string(),
  reasons: z.array(z.object({ text: z.string(), ref: z.string() })),
  rule_results: z.array(
    z.object({
      rule: z.string(),
      passed: z.boolean(),
      skipped: z.boolean(),
      detail: z.string(),
      field_ref: z.string().optional(),
    }),
  ),
  model_findings: z.array(z.record(z.string(), z.unknown())),
  model_id: z.string().nullable(),
  model_meta: z.record(z.string(), z.unknown()).nullable(),
  prompt_hash: z.string().nullable(),
  inputs_hash: z.string(),
  /** What the verdict looked at, for display: buyer messages and images by hash. */
  inputs_summary: z.object({
    buyer_messages: z.array(z.string()),
    buyer_images: z.array(z.object({ name: z.string(), sha256: z.string(), content_type: z.string() })),
    snapshot_image_sha256: z.string().nullable(),
    link_basis: z.string().nullable(),
  }),
  recommended_action: PlannedActionView,
  approved_by: z.string().nullable(),
  executed_action: z.record(z.string(), z.unknown()).nullable(),
  paypal_response: z.unknown().nullable(),
  created_at: z.string(),
});

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
  verdict: z.string().nullable(),
  confidence: z.number().nullable(),
  verdict_status: z.string().nullable(),
  planned_action: z.object({ kind: z.string(), available: z.boolean() }).nullable(),
  age_hours: z.number().nullable(),
});

type DisputeRow = typeof disputes.$inferSelect;

function inputsSummary(raw: unknown) {
  const i = raw as {
    buyer?: { messages?: string[]; images?: Array<{ name: string; sha256: string; contentType: string }> };
    snapshotImage?: { sha256: string } | null;
    link?: { basis?: string };
  };
  return {
    buyer_messages: i.buyer?.messages ?? [],
    buyer_images: (i.buyer?.images ?? []).map((x) => ({
      name: x.name,
      sha256: x.sha256,
      content_type: x.contentType,
    })),
    snapshot_image_sha256: i.snapshotImage?.sha256 ?? null,
    link_basis: i.link?.basis ?? null,
  };
}

export function verdictView(v: VerdictRow): z.infer<typeof VerdictView> {
  return {
    id: v.id,
    verdict: v.verdict,
    confidence: Number(v.confidence),
    status: v.status,
    reasons: v.reasons as never,
    rule_results: v.ruleResults as never,
    model_findings: v.modelFindings as never,
    model_id: v.modelId,
    model_meta: (v.modelMeta as Record<string, unknown> | null) ?? null,
    prompt_hash: v.promptHash,
    inputs_hash: v.inputsHash,
    inputs_summary: inputsSummary(v.inputs),
    recommended_action: v.recommendedAction as never,
    approved_by: v.approvedBy,
    executed_action: (v.executedAction as Record<string, unknown> | null) ?? null,
    paypal_response: v.paypalResponse ?? null,
    created_at: v.createdAt.toISOString(),
  };
}

export function summarise(row: DisputeRow, v: VerdictRow | null): z.infer<typeof DisputeSummary> {
  const raw = row.raw as { provenant_link?: { basis?: string } };
  const action = v?.recommendedAction as { kind: string; available: boolean } | undefined;
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
    verdict: v?.verdict ?? null,
    confidence: v ? Number(v.confidence) : null,
    verdict_status: v?.status ?? null,
    planned_action: action ? { kind: action.kind, available: action.available } : null,
    age_hours: row.paypalCreateTime
      ? Math.round(((Date.now() - row.paypalCreateTime.getTime()) / 3_600_000) * 10) / 10
      : null,
  };
}

const security = [{ bearer: [] }];
const errors = { 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse };
const Params = z.object({ id: z.string().min(1).max(64) });

/** Disputes: the PayPal mirror, its verdicts and planned actions (merchant / admin). */
export async function disputeRoutes(
  app: FastifyInstance,
  opts: {
    db: Db;
    intake: DisputeIntake;
    adjudication: AdjudicationService;
    executor: ActionExecutor;
    /** Sandbox-only PayPal helpers are exposed when PayPal is the mock or the sandbox. */
    sandboxHelpers: boolean;
    paypal: PayPalClient;
    authenticate: (req: FastifyRequest) => Promise<void>;
  },
): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.addHook('onRequest', opts.authenticate);
  // Body-less POSTs (approve, sync) may still carry content-type: application/json.
  r.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, String(body).trim() === '' ? undefined : JSON.parse(String(body)));
    } catch (e) {
      done(Object.assign(e as Error, { statusCode: 400 }), undefined);
    }
  });

  r.get(
    '/v1/disputes',
    {
      schema: {
        tags: ['disputes'],
        summary: 'List disputes with their latest verdict and planned action',
        security,
        response: { 200: z.object({ items: z.array(DisputeSummary) }), ...errors },
      },
    },
    async (req) => {
      requireKind(req, 'merchant', 'admin');
      const rows = await opts.db.select().from(disputes).orderBy(desc(disputes.paypalCreateTime));
      const all = await opts.db.select().from(verdicts).orderBy(desc(verdicts.createdAt));
      const latest = new Map<string, VerdictRow>();
      for (const v of all) if (!latest.has(v.disputeId)) latest.set(v.disputeId, v);
      return { items: rows.map((row) => summarise(row, latest.get(row.id) ?? null)) };
    },
  );

  r.get(
    '/v1/disputes/:id',
    {
      schema: {
        tags: ['disputes'],
        summary: 'A dispute with PayPal details, latest verdict, actions and event timeline',
        security,
        params: Params,
        response: {
          200: DisputeSummary.extend({
            paypal: z.record(z.string(), z.unknown()),
            latest_verdict: VerdictView.nullable(),
            verdict_history: z.array(
              z.object({ id: z.string(), verdict: z.string(), status: z.string(), created_at: z.string() }),
            ),
            actions: z.array(
              z.object({
                id: z.string(),
                verdict_id: z.string().nullable(),
                kind: z.string(),
                status: z.string(),
                request: z.unknown().nullable(),
                response: z.unknown().nullable(),
                debug_id: z.string().nullable(),
                request_id: z.string().nullable(),
                created_at: z.string(),
                executed_at: z.string().nullable(),
              }),
            ),
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
      const [events, vs, acts] = await Promise.all([
        opts.db
          .select()
          .from(disputeEvents)
          .where(eq(disputeEvents.disputeId, row.id))
          .orderBy(asc(disputeEvents.createdAt)),
        opts.db
          .select()
          .from(verdicts)
          .where(eq(verdicts.disputeId, row.id))
          .orderBy(desc(verdicts.createdAt)),
        opts.db.select().from(actions).where(eq(actions.disputeId, row.id)).orderBy(asc(actions.createdAt)),
      ]);
      const latest = vs[0] ?? null;
      return {
        ...summarise(row, latest),
        paypal: row.raw as Record<string, unknown>,
        latest_verdict: latest ? verdictView(latest) : null,
        verdict_history: vs.map((v) => ({
          id: v.id,
          verdict: v.verdict,
          status: v.status,
          created_at: v.createdAt.toISOString(),
        })),
        actions: acts.map((a) => ({
          id: a.id,
          verdict_id: a.verdictId,
          kind: a.kind,
          status: a.status,
          request: a.request ?? null,
          response: a.response ?? null,
          debug_id: a.debugId,
          request_id: a.requestId,
          created_at: a.createdAt.toISOString(),
          executed_at: a.executedAt?.toISOString() ?? null,
        })),
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
    '/v1/disputes/:id/adjudicate',
    {
      schema: {
        tags: ['disputes'],
        summary: '(Re)run adjudication; identical inputs return the existing verdict unless force=true',
        security,
        params: Params,
        querystring: z.object({ force: z.enum(['true', 'false']).optional() }),
        response: { 200: z.object({ created: z.boolean(), verdict: VerdictView }), ...errors },
      },
    },
    async (req) => {
      requireKind(req, 'merchant', 'admin');
      await opts.intake.refreshDispute(req.params.id).catch(() => undefined);
      const r2 = await opts.adjudication.adjudicate(req.params.id, { force: req.query.force === 'true' });
      return { created: r2.created, verdict: verdictView(r2.verdict) };
    },
  );

  r.get(
    '/v1/disputes/:id/report.pdf',
    {
      schema: {
        tags: ['disputes'],
        summary: 'The evidence report PDF (what provide-evidence uploads)',
        security,
        params: Params,
        produces: ['application/pdf'],
      },
    },
    async (req, reply) => {
      requireKind(req, 'merchant', 'admin');
      const pdf = await opts.adjudication.report(req.params.id);
      return reply
        .type('application/pdf')
        .header('content-disposition', `inline; filename="provenant-evidence-${req.params.id}.pdf"`)
        .send(pdf);
    },
  );

  const ActionView = z.object({
    id: z.string(),
    kind: z.string(),
    status: z.string(),
    request_id: z.string().nullable(),
    debug_id: z.string().nullable(),
  });

  r.post(
    '/v1/disputes/:id/approve',
    {
      schema: {
        tags: ['disputes'],
        summary: 'Approve the latest verdict and execute its PayPal call (or an override)',
        description:
          'Re-fetches the dispute and only calls PayPal if the needed HATEOAS link is still offered; otherwise records ACTION_NOT_AVAILABLE. Files (the evidence PDF) are sent as multipart.',
        security,
        params: Params,
        body: z
          .object({
            approved_by: z.string().min(1).max(100).optional(),
            action_override: ActionOverride.optional(),
          })
          .nullish(),
        response: {
          200: z.object({ verdict: VerdictView, action: ActionView }),
          ...errors,
          502: ErrorResponse,
        },
      },
    },
    async (req) => {
      const p = requireKind(req, 'merchant', 'admin');
      const out = await opts.executor.approve(req.params.id, {
        approvedBy: req.body?.approved_by ?? p.keyId,
        override: req.body?.action_override,
      });
      return {
        verdict: verdictView(out.verdict),
        action: {
          id: out.action.id,
          kind: out.action.kind,
          status: out.action.status,
          request_id: out.action.requestId,
          debug_id: out.action.debugId,
        },
      };
    },
  );

  r.post(
    '/v1/disputes/:id/reject',
    {
      schema: {
        tags: ['disputes'],
        summary: 'Reject the latest verdict: no PayPal call is made',
        security,
        params: Params,
        body: z.object({
          reason: z.string().min(1).max(500),
          rejected_by: z.string().min(1).max(100).optional(),
        }),
        response: { 200: z.object({ verdict: VerdictView }), ...errors },
      },
    },
    async (req) => {
      const p = requireKind(req, 'merchant', 'admin');
      const v = await opts.executor.reject(req.params.id, {
        reason: req.body.reason,
        rejectedBy: req.body.rejected_by ?? p.keyId,
      });
      return { verdict: verdictView(v) };
    },
  );

  if (opts.sandboxHelpers) {
    r.post(
      '/v1/disputes/:id/sandbox/adjudicate',
      {
        schema: {
          tags: ['sandbox'],
          summary:
            "Sandbox only: settle the dispute as PayPal's agents would (needs UNDER_REVIEW and the adjudicate link)",
          security,
          params: Params,
          body: z.object({ outcome: z.enum(['BUYER_FAVOR', 'SELLER_FAVOR']) }),
          response: {
            200: z.object({ status: z.string(), outcome: z.string().nullable() }),
            ...errors,
            502: ErrorResponse,
          },
        },
      },
      async (req) => {
        requireKind(req, 'merchant', 'admin');
        await opts.paypal.sandboxAdjudicate(req.params.id, req.body.outcome);
        const { dispute } = await opts.intake.refreshDispute(req.params.id);
        return { status: dispute.status, outcome: dispute.dispute_outcome?.outcome_code ?? null };
      },
    );

    r.post(
      '/v1/disputes/:id/sandbox/require-evidence',
      {
        schema: {
          tags: ['sandbox'],
          summary: 'Sandbox only: move UNDER_REVIEW back to waiting for seller or buyer evidence',
          security,
          params: Params,
          body: z.object({ action: z.enum(['SELLER_EVIDENCE', 'BUYER_EVIDENCE']) }),
          response: { 200: z.object({ status: z.string() }), ...errors, 502: ErrorResponse },
        },
      },
      async (req) => {
        requireKind(req, 'merchant', 'admin');
        await opts.paypal.sandboxRequireEvidence(req.params.id, req.body.action);
        const { dispute } = await opts.intake.refreshDispute(req.params.id);
        return { status: dispute.status };
      },
    );
  }

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
