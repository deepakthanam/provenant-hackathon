import type { Db } from '@provenant/db';
import { actions, liabilityLedger, verdicts } from '@provenant/db';
import {
  ActionNotAvailableError,
  type ActionResult,
  type Dispute,
  DisputeRel,
  type EvidenceFile,
  findLink,
  type PayPalClient,
  PayPalError,
} from '@provenant/paypal';
import type { PlannedAction } from '@provenant/schemas';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { ulid } from 'ulid';
import { z } from 'zod';
import { HttpError } from '../errors';
import type { AdjudicationService, VerdictRow } from './adjudication';
import type { DisputeIntake } from './intake';

const PayPalMoneyZ = z.object({
  currency_code: z.string().length(3),
  value: z.string().regex(/^\d+(\.\d{1,2})?$/),
});

/** What a merchant may send instead of the planned call. */
export const ActionOverride = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('provide_evidence'), notes: z.string().min(1).max(2000).optional() }),
  z.object({ kind: z.literal('provide_supporting_info'), notes: z.string().min(1).max(2000).optional() }),
  z.object({ kind: z.literal('send_message'), message: z.string().min(1).max(2000) }),
  z.object({
    kind: z.literal('accept_claim'),
    note: z.string().min(1).max(2000).optional(),
    accept_claim_type: z.enum([
      'REFUND',
      'REFUND_WITH_RETURN',
      'PARTIAL_REFUND',
      'REFUND_WITH_RETURN_SHIPMENT_LABEL',
    ]),
    refund_amount: PayPalMoneyZ.optional(),
  }),
  z.object({
    kind: z.literal('make_offer'),
    note: z.string().min(1).max(2000).optional(),
    offer_type: z.enum([
      'REFUND',
      'REFUND_WITH_RETURN',
      'REFUND_WITH_REPLACEMENT',
      'REPLACEMENT_WITHOUT_REFUND',
    ]),
    offer_amount: PayPalMoneyZ.optional(),
  }),
]);
export type ActionOverride = z.infer<typeof ActionOverride>;

const REL: Record<string, string> = {
  provide_evidence: DisputeRel.provideEvidence,
  provide_supporting_info: DisputeRel.provideSupportingInfo,
  send_message: DisputeRel.sendMessage,
  accept_claim: DisputeRel.acceptClaim,
  make_offer: DisputeRel.makeOffer,
};

export interface ExecutionOutcome {
  verdict: VerdictRow;
  action: typeof actions.$inferSelect;
}

/**
 * Turns an approved verdict into exactly one PayPal call. The model never gets here: the call
 * comes from the deterministic plan (or the merchant's explicit override), and it only goes out if
 * PayPal still offers it, judged by the dispute's HATEOAS links fetched at execution time.
 */
export class ActionExecutor {
  constructor(
    private readonly o: {
      db: Db;
      paypal: PayPalClient;
      adjudication: AdjudicationService;
      intake: DisputeIntake;
      log: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;
    },
  ) {}

  async approve(
    disputeId: string,
    opts: { approvedBy: string; override?: ActionOverride },
  ): Promise<ExecutionOutcome> {
    const latest = await this.o.adjudication.latestVerdict(disputeId);
    if (!latest) throw new HttpError(404, 'NOT_FOUND', 'dispute has no verdict yet');
    const planned = latest.recommendedAction as PlannedAction;
    if (!opts.override && planned.kind === 'none') {
      throw new HttpError(
        409,
        'NOTHING_TO_EXECUTE',
        `the verdict plans no PayPal call: ${planned.explanation}`,
      );
    }
    // Claim the verdict atomically so a double click cannot execute twice.
    const [claimed] = await this.o.db
      .update(verdicts)
      .set({ status: 'APPROVED', approvedBy: opts.approvedBy, updatedAt: new Date() })
      .where(and(eq(verdicts.id, latest.id), inArray(verdicts.status, ['PENDING', 'FAILED'])))
      .returning();
    if (!claimed) throw new HttpError(409, 'ALREADY_DECIDED', `verdict ${latest.id} is ${latest.status}`);
    return this.execute(claimed, planned, opts.override);
  }

  async reject(disputeId: string, opts: { rejectedBy: string; reason: string }): Promise<VerdictRow> {
    const latest = await this.o.adjudication.latestVerdict(disputeId);
    if (!latest) throw new HttpError(404, 'NOT_FOUND', 'dispute has no verdict yet');
    const [row] = await this.o.db
      .update(verdicts)
      .set({
        status: 'REJECTED',
        approvedBy: opts.rejectedBy,
        executedAction: { rejected: true, reason: opts.reason },
        updatedAt: new Date(),
      })
      .where(and(eq(verdicts.id, latest.id), inArray(verdicts.status, ['PENDING', 'FAILED'])))
      .returning();
    if (!row) throw new HttpError(409, 'ALREADY_DECIDED', `verdict ${latest.id} is ${latest.status}`);
    await this.o.db
      .update(actions)
      .set({ status: 'REJECTED', response: { rejected_by: opts.rejectedBy, reason: opts.reason } })
      .where(
        and(
          eq(actions.verdictId, row.id),
          inArray(actions.status, ['PLANNED', 'ACTION_NOT_AVAILABLE', 'HUMAN_REVIEW']),
        ),
      );
    return row;
  }

  private async execute(
    verdict: VerdictRow,
    planned: PlannedAction,
    override?: ActionOverride,
  ): Promise<ExecutionOutcome> {
    const disputeId = verdict.disputeId;
    const kind = override?.kind ?? planned.kind;
    const rel = REL[kind]!;
    const actionId = `act_${ulid()}`;
    let request: Record<string, unknown> = {};
    try {
      // Fresh details: the links PayPal offers *now* decide whether the call may go out.
      const dispute = await this.o.paypal.getDispute(disputeId);
      if (!findLink(dispute.links, rel))
        throw new ActionNotAvailableError(rel, dispute.status, dispute.dispute_life_cycle_stage);
      request = this.buildRequest(kind, planned, override, dispute);
      const files = 'files' in request ? await this.files(disputeId) : [];
      const sent = { ...request, ...(files.length ? { files: files.map((f) => f.name) } : {}) };

      const result = await this.call(kind, disputeId, request, files);
      const action = await this.recordAttempt(verdict, actionId, {
        kind,
        status: 'EXECUTED',
        request: sent,
        response: { links: result.links },
        requestId: result.request_id,
        debugId: result.debug_id ?? null,
      });
      if (kind === 'accept_claim' && planned.liability && !override) {
        await this.o.db
          .insert(liabilityLedger)
          .values({
            id: `lia_${ulid()}`,
            platformId: planned.liability.platform_id,
            disputeId,
            verdictId: verdict.id,
            amountValue: planned.liability.amount.value,
            currency: planned.liability.amount.currency,
            note: `refund accepted on ${disputeId}: agent acted outside the user's mandate`,
          })
          .onConflictDoNothing();
      }
      const [v] = await this.o.db
        .update(verdicts)
        .set({
          status: 'EXECUTED',
          executedAction: { kind, request: sent, override: Boolean(override) },
          paypalResponse: result,
          updatedAt: new Date(),
        })
        .where(eq(verdicts.id, verdict.id))
        .returning();
      this.o.log.info({ disputeId, kind, requestId: result.request_id }, 'PayPal action executed');
      // Pull PayPal's new state into the mirror (it also arrives by webhook).
      await this.o.intake.refreshDispute(disputeId).catch(() => undefined);
      return { verdict: v!, action: action! };
    } catch (e) {
      const notAvailable = e instanceof ActionNotAvailableError;
      const error =
        e instanceof PayPalError
          ? e.toJSON()
          : notAvailable
            ? { name: 'ACTION_NOT_AVAILABLE', message: e.message }
            : { message: e instanceof Error ? e.message : String(e) };
      const action = await this.recordAttempt(verdict, actionId, {
        kind,
        status: notAvailable ? 'ACTION_NOT_AVAILABLE' : 'FAILED',
        request,
        response: error,
        requestId: null,
        debugId: e instanceof PayPalError ? (e.debugId ?? null) : null,
      });
      const [v] = await this.o.db
        .update(verdicts)
        .set({ status: 'FAILED', paypalResponse: error, updatedAt: new Date() })
        .where(eq(verdicts.id, verdict.id))
        .returning();
      this.o.log.warn({ disputeId, kind, error }, 'PayPal action not executed');
      throw Object.assign(
        new HttpError(
          notAvailable ? 409 : 502,
          notAvailable ? 'ACTION_NOT_AVAILABLE' : 'PAYPAL_ERROR',
          (e as Error).message,
        ),
        { outcome: { verdict: v!, action: action! } },
      );
    }
  }

  /**
   * The first attempt turns the verdict's PLANNED row into the outcome; later attempts (after a
   * failure) are added as new rows so the history of tries is kept.
   */
  private async recordAttempt(
    verdict: VerdictRow,
    actionId: string,
    v: {
      kind: string;
      status: string;
      request: unknown;
      response: unknown;
      requestId: string | null;
      debugId: string | null;
    },
  ) {
    const fields = { ...v, executedAt: new Date() };
    const [updated] = await this.o.db
      .update(actions)
      .set(fields)
      .where(and(eq(actions.verdictId, verdict.id), eq(actions.status, 'PLANNED')))
      .returning();
    if (updated) return updated;
    const [inserted] = await this.o.db
      .insert(actions)
      .values({ id: actionId, disputeId: verdict.disputeId, verdictId: verdict.id, ...fields })
      .returning();
    return inserted!;
  }

  /** The exact body PayPal receives: the plan's, or the override checked against PayPal's allowed options. */
  private buildRequest(
    kind: string,
    planned: PlannedAction,
    override: ActionOverride | undefined,
    dispute: Dispute,
  ): Record<string, unknown> {
    if (!override) return { ...(planned.request ?? {}) };
    const note =
      planned.request && typeof planned.request.note === 'string'
        ? planned.request.note
        : 'Resolved by the merchant after review in Provenant.';
    switch (override.kind) {
      case 'provide_evidence':
        return { evidences: [{ evidence_type: 'OTHER', notes: override.notes ?? note }], files: ['report'] };
      case 'provide_supporting_info':
        return { notes: override.notes ?? note, files: ['report'] };
      case 'send_message':
        return { message: override.message };
      case 'accept_claim': {
        const allowed = dispute.allowed_response_options?.accept_claim?.accept_claim_types ?? [];
        if (!allowed.includes(override.accept_claim_type)) {
          throw new ActionNotAvailableError(
            `accept_claim:${override.accept_claim_type}`,
            dispute.status,
            dispute.dispute_life_cycle_stage,
          );
        }
        return {
          note: override.note ?? note,
          accept_claim_type: override.accept_claim_type,
          ...(override.refund_amount ? { refund_amount: override.refund_amount } : {}),
        };
      }
      case 'make_offer': {
        const allowed = dispute.allowed_response_options?.make_offer?.offer_types ?? [];
        if (!allowed.includes(override.offer_type)) {
          throw new ActionNotAvailableError(
            `make_offer:${override.offer_type}`,
            dispute.status,
            dispute.dispute_life_cycle_stage,
          );
        }
        return {
          note: override.note ?? note,
          offer_type: override.offer_type,
          ...(override.offer_amount ? { offer_amount: override.offer_amount } : {}),
        };
      }
    }
    throw new Error(`unknown action ${kind}`);
  }

  private async files(disputeId: string): Promise<EvidenceFile[]> {
    const pdf = await this.o.adjudication.report(disputeId);
    return [{ name: `provenant-evidence-${disputeId}.pdf`, contentType: 'application/pdf', bytes: pdf }];
  }

  private call(
    kind: string,
    id: string,
    req: Record<string, unknown>,
    files: EvidenceFile[],
  ): Promise<ActionResult> {
    const { files: _names, ...body } = req as Record<string, unknown> & { files?: unknown };
    switch (kind) {
      case 'provide_evidence':
        return this.o.paypal.provideEvidence(id, { evidences: body.evidences as never, files });
      case 'provide_supporting_info':
        return this.o.paypal.provideSupportingInfo(id, { notes: String(body.notes ?? ''), files });
      case 'send_message':
        return this.o.paypal.sendMessage(id, String(body.message ?? ''));
      case 'accept_claim':
        return this.o.paypal.acceptClaim(id, body as never);
      case 'make_offer':
        return this.o.paypal.makeOffer(id, body as never);
      default:
        throw new Error(`cannot execute ${kind}`);
    }
  }
}
