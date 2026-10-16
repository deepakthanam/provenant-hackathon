import {
  type AdjudicationInput,
  type AdjudicationResult,
  adjudicate,
  type BuyerImage,
  CLAIM_TASK,
  inputsHash,
  mockClaimHandler,
  storableInputs,
} from '@provenant/adjudicator';
import type { Env } from '@provenant/config';
import type { Db } from '@provenant/db';
import { actions, disputes, merchants, verdicts } from '@provenant/db';
import { type BundleStore, renderEvidenceReport } from '@provenant/evidence';
import { createLlm, type LlmProvider } from '@provenant/llm';
import type { Dispute, PayPalClient } from '@provenant/paypal';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { ulid } from 'ulid';
import { syncCapture } from '../capture';
import { HttpError } from '../errors';

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export type VerdictRow = typeof verdicts.$inferSelect;

export interface AdjudicationServiceOptions {
  db: Db;
  store: BundleStore;
  paypal: PayPalClient;
  env: Env;
  log: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;
  /** Defaults to createLlm(env) with the deterministic claim handler for mock mode. */
  llm?: LlmProvider;
}

/** Glue between the dispute mirror, the evidence store, PayPal and the pure adjudicator. */
export class AdjudicationService {
  readonly llm: LlmProvider;

  constructor(private readonly o: AdjudicationServiceOptions) {
    this.llm = o.llm ?? createLlm(o.env, { [CLAIM_TASK]: mockClaimHandler });
  }

  /** Assembles everything the adjudicator looks at, from Provenant's records and PayPal's. */
  async gatherInput(disputeId: string): Promise<AdjudicationInput> {
    const [row] = await this.o.db.select().from(disputes).where(eq(disputes.id, disputeId));
    if (!row) throw new HttpError(404, 'NOT_FOUND', `dispute ${disputeId} not found`);
    const { provenant_link, ...dispute } = row.raw as Dispute & {
      provenant_link?: { bundleId: string | null; basis: string };
    };
    const link = provenant_link ?? { bundleId: row.bundleId, basis: 'stored link' };

    let rec = row.bundleId ? await this.o.store.get(row.bundleId) : null;
    if (rec && rec.bundle.paypal_order_id && !rec.bundle.paypal_capture_id) {
      // The capture webhook may never have arrived (no tunnel): fetch it from PayPal now.
      rec = await syncCapture(this.o.store, this.o.paypal, rec.bundle.bundle_id).catch(() => rec);
    }
    const bundle = rec?.bundle ?? null;
    const verify = bundle ? await this.o.store.verify(bundle.bundle_id) : null;

    let snapshotImage: BuyerImage | null = null;
    const imgSha = bundle?.offer_snapshot?.image_sha256;
    if (imgSha) {
      const blob = await this.o.store.getBlob(imgSha);
      if (blob && IMAGE_TYPES.has(blob.contentType)) {
        snapshotImage = {
          name: 'offer-snapshot',
          contentType: blob.contentType as BuyerImage['contentType'],
          sha256: imgSha,
          base64: Buffer.from(blob.bytes).toString('base64'),
        };
      }
    }

    const messages = new Set<string>();
    const docs: Array<{ name: string; url: string }> = [];
    for (const m of dispute.messages ?? []) {
      if (m.posted_by === 'BUYER') {
        if (m.content) messages.add(m.content);
        for (const d of m.documents ?? []) if (d.url) docs.push({ name: d.name, url: d.url });
      }
    }
    for (const e of dispute.evidences ?? []) {
      if (e.source?.startsWith('SUBMITTED_BY_BUYER')) {
        if (e.notes) messages.add(e.notes);
        for (const d of e.documents ?? []) if (d.url) docs.push({ name: d.name, url: d.url });
      }
    }
    const images: BuyerImage[] = [];
    for (const d of docs) {
      try {
        const file = await this.o.paypal.downloadDocument(d.url);
        const type = file.contentType.split(';')[0]!.trim();
        if (!IMAGE_TYPES.has(type)) continue;
        const { sha256 } = await this.o.store.putBlob(file.bytes, type);
        if (!images.some((i) => i.sha256 === sha256)) {
          images.push({
            name: d.name,
            contentType: type as BuyerImage['contentType'],
            sha256,
            base64: Buffer.from(file.bytes).toString('base64'),
          });
        }
      } catch (e) {
        this.o.log.warn(
          { disputeId, doc: d.name, err: e instanceof Error ? e.message : String(e) },
          'could not download buyer evidence',
        );
      }
    }

    const merchantId = bundle?.offer_snapshot?.merchant_id;
    const [merchant] = merchantId
      ? await this.o.db.select().from(merchants).where(eq(merchants.id, merchantId))
      : [];
    return {
      dispute,
      link,
      bundle,
      verify,
      snapshotImage,
      buyer: { messages: [...messages], images },
      settings: {
        confidenceThreshold: this.o.env.CONFIDENCE_THRESHOLD,
        sharedFaultRefundPct: this.o.env.SHARED_FAULT_REFUND_PCT,
        misrepresentationClaimType:
          merchant?.misrepresentationClaimType === 'REFUND_WITH_RETURN' ? 'REFUND_WITH_RETURN' : 'REFUND',
      },
    };
  }

  async latestVerdict(disputeId: string): Promise<VerdictRow | null> {
    const [v] = await this.o.db
      .select()
      .from(verdicts)
      .where(eq(verdicts.disputeId, disputeId))
      .orderBy(desc(verdicts.createdAt))
      .limit(1);
    return v ?? null;
  }

  /**
   * Adjudicates a dispute. Idempotent: identical inputs return the existing verdict, and once a
   * verdict has been approved, rejected or executed, only a change in the dispute's status or
   * stage (PayPal asking for something new) or `force` produces a new one.
   */
  async adjudicate(
    disputeId: string,
    opts: { force?: boolean } = {},
  ): Promise<{ verdict: VerdictRow; created: boolean }> {
    const input = await this.gatherInput(disputeId);
    const hash = inputsHash(input);
    const latest = await this.latestVerdict(disputeId);
    if (latest && !opts.force) {
      if (latest.inputsHash === hash) return { verdict: latest, created: false };
      if (latest.status !== 'PENDING' && !this.newRequestFromPayPal(latest, input.dispute)) {
        return { verdict: latest, created: false };
      }
    }

    const result = await adjudicate(input, this.llm);
    const verdict = await this.store(disputeId, input, result);
    this.o.log.info(
      {
        disputeId,
        verdict: result.verdict,
        confidence: result.confidence,
        action: result.plannedAction.kind,
      },
      'dispute adjudicated',
    );
    if (this.onVerdict) await this.onVerdict(verdict);
    return { verdict, created: true };
  }

  /** Set by the app: runs after a new verdict is stored (AUTO_ACTION executes from here). */
  onVerdict?: (v: VerdictRow) => Promise<void>;

  /**
   * After a decision has been acted on, the dispute is only re-adjudicated when PayPal asks the
   * seller for something new: the stage moved (e.g. INQUIRY → CHARGEBACK) or the dispute came back
   * to WAITING_FOR_SELLER_RESPONSE. Our own action's consequences (UNDER_REVIEW, RESOLVED) are not.
   */
  private newRequestFromPayPal(latest: VerdictRow, now: Dispute): boolean {
    if (now.status === 'RESOLVED') return false;
    const prev = (latest.inputs as { dispute?: Dispute }).dispute;
    if (prev?.dispute_life_cycle_stage !== now.dispute_life_cycle_stage) return true;
    return (
      now.status === 'WAITING_FOR_SELLER_RESPONSE' &&
      latest.status === 'EXECUTED' &&
      prev?.status !== now.status
    );
  }

  private async store(
    disputeId: string,
    input: AdjudicationInput,
    r: AdjudicationResult,
  ): Promise<VerdictRow> {
    const id = `vrd_${ulid()}`;
    return this.o.db.transaction(async (tx) => {
      await tx
        .update(verdicts)
        .set({ status: 'SUPERSEDED', updatedAt: new Date() })
        .where(and(eq(verdicts.disputeId, disputeId), eq(verdicts.status, 'PENDING')));
      const [row] = await tx
        .insert(verdicts)
        .values({
          id,
          disputeId,
          bundleId: input.bundle?.bundle_id ?? null,
          verdict: r.verdict,
          confidence: r.confidence.toFixed(3),
          reasons: r.reasons,
          ruleResults: r.ruleResults,
          modelFindings: r.model?.findings ?? [],
          modelId: r.model?.modelId ?? null,
          promptHash: r.model?.promptHash ?? null,
          inputsHash: r.inputsHash,
          rawModelOutput: r.model?.raw ?? null,
          modelMeta: r.model
            ? {
                notes: r.model.notes,
                claim_consistent_with_snapshot: r.model.claimConsistentWithSnapshot,
                dropped: r.model.dropped,
                error: r.model.error,
              }
            : null,
          inputs: storableInputs(input),
          recommendedAction: r.plannedAction,
          status: 'PENDING',
        })
        .returning();
      await tx.insert(actions).values({
        id: `act_${ulid()}`,
        disputeId,
        verdictId: id,
        kind: r.plannedAction.kind,
        status:
          r.plannedAction.kind === 'none'
            ? 'HUMAN_REVIEW'
            : r.plannedAction.available
              ? 'PLANNED'
              : 'ACTION_NOT_AVAILABLE',
        request: r.plannedAction.request,
      });
      return row!;
    });
  }

  /** The evidence PDF for a dispute's latest verdict (what provide-evidence uploads). */
  async report(disputeId: string): Promise<Buffer> {
    const v = await this.latestVerdict(disputeId);
    if (!v) throw new HttpError(404, 'NOT_FOUND', 'dispute has no verdict yet');
    const [row] = await this.o.db.select().from(disputes).where(eq(disputes.id, disputeId));
    const rec = v.bundleId ? await this.o.store.get(v.bundleId) : null;
    const verify = rec ? await this.o.store.verify(rec.bundle.bundle_id) : null;
    const imgSha = rec?.bundle.offer_snapshot?.image_sha256;
    const img = imgSha ? await this.o.store.getBlob(imgSha) : null;
    return renderEvidenceReport({
      generatedAt: new Date().toISOString(),
      dispute: {
        id: disputeId,
        reason: row!.reason,
        status: row!.status,
        stage: row!.stage,
        amount:
          row!.amountValue && row!.amountCurrency
            ? { value: row!.amountValue, currency: row!.amountCurrency }
            : null,
        transactionId: row!.transactionId,
        createdAt: row!.paypalCreateTime?.toISOString() ?? null,
      },
      verdict: {
        code: v.verdict,
        confidence: Number(v.confidence),
        reasons: v.reasons as Array<{ text: string; ref: string }>,
        ruleResults: v.ruleResults as never,
        findings: v.modelFindings as never,
        modelId: v.modelId,
        plannedAction: v.recommendedAction as never,
      },
      bundle: rec?.bundle ?? null,
      verify,
      snapshotImage: img?.contentType === 'image/png' || img?.contentType === 'image/jpeg' ? img.bytes : null,
    });
  }
}
