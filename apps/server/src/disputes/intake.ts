import type { Db } from '@provenant/db';
import { disputeEvents, disputes, kv } from '@provenant/db';
import type { BundleStore } from '@provenant/evidence';
import type { Capture, Dispute, PayPalClient, WebhookEvent, WebhookHeaders } from '@provenant/paypal';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { syncCapture } from '../capture';

const WATERMARK_KEY = 'dispute_poll.update_time_after';
/** On a first poll, look back this far. */
const FIRST_POLL_LOOKBACK_MS = 30 * 86_400_000;

export interface IntakeOptions {
  db: Db;
  paypal: PayPalClient;
  store: BundleStore;
  log: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;
  /** Signature checks are skipped only in mock mode (the mock has no PayPal certificate). */
  verifySignatures: boolean;
  /** Called after a dispute's mirror changes; M5 hangs adjudication here. */
  onDisputeChanged?: (disputeId: string) => Promise<void>;
}

export type WebhookOutcome =
  | { status: 'accepted'; eventId: string }
  | { status: 'duplicate'; eventId: string }
  | { status: 'rejected'; reason: string };

export interface DisputeLink {
  bundleId: string | null;
  /** Why the link is what it is (shown in the console). */
  basis: string;
}

/**
 * Brings PayPal dispute and capture events into Provenant, from webhooks or polling, exactly once
 * per PayPal event: every event is stored under its PayPal id before it is processed.
 */
export class DisputeIntake {
  private queue: Promise<void> = Promise.resolve();
  private pollTimer: NodeJS.Timeout | null = null;
  private polling = false;

  constructor(private readonly o: IntakeOptions) {}

  // ---------------------------------------------------------------- webhooks

  async handleWebhook(rawBody: string, headers: WebhookHeaders): Promise<WebhookOutcome> {
    let event: WebhookEvent;
    try {
      event = JSON.parse(rawBody) as WebhookEvent;
    } catch {
      return { status: 'rejected', reason: 'body is not JSON' };
    }
    if (!event?.id || !event.event_type) return { status: 'rejected', reason: 'not a PayPal webhook event' };
    if (this.o.verifySignatures && !(await this.o.paypal.verifyWebhookSignature(headers, rawBody))) {
      this.o.log.warn({ eventId: event.id }, 'webhook signature verification failed');
      return { status: 'rejected', reason: 'signature verification failed' };
    }
    const inserted = await this.o.db
      .insert(disputeEvents)
      .values({
        id: event.id,
        source: 'webhook',
        eventType: event.event_type,
        disputeId: disputeIdOf(event),
        payload: event,
      })
      .onConflictDoNothing()
      .returning({ id: disputeEvents.id });
    if (inserted.length === 0) return { status: 'duplicate', eventId: event.id };
    this.enqueue(event.id);
    return { status: 'accepted', eventId: event.id };
  }

  /** Processes stored events one at a time, in arrival order. */
  private enqueue(eventId: string): void {
    this.queue = this.queue.then(() => this.processEvent(eventId)).catch(() => {});
  }

  /** Waits until every queued event has been processed (tests, scenarios, shutdown). */
  async drain(): Promise<void> {
    let last: Promise<void>;
    do {
      last = this.queue;
      await last;
    } while (last !== this.queue);
  }

  /** Re-queues events stored but never processed (e.g. the server stopped mid-way). */
  async resumePending(): Promise<number> {
    const rows = await this.o.db
      .select({ id: disputeEvents.id })
      .from(disputeEvents)
      .where(and(isNull(disputeEvents.processedAt), eq(disputeEvents.source, 'webhook')));
    for (const r of rows) this.enqueue(r.id);
    return rows.length;
  }

  private async processEvent(eventId: string): Promise<void> {
    const [row] = await this.o.db.select().from(disputeEvents).where(eq(disputeEvents.id, eventId));
    if (!row || row.processedAt) return;
    const event = row.payload as WebhookEvent;
    try {
      if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
        await this.onCaptureCompleted(event.resource as Capture);
      } else if (event.event_type.startsWith('CUSTOMER.DISPUTE.')) {
        const id = disputeIdOf(event);
        if (id) await this.refreshDispute(id);
      }
      await this.o.db
        .update(disputeEvents)
        .set({ processedAt: new Date(), error: null })
        .where(eq(disputeEvents.id, eventId));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.o.log.error({ eventId, err: msg }, 'webhook processing failed');
      await this.o.db.update(disputeEvents).set({ error: msg }).where(eq(disputeEvents.id, eventId));
    }
  }

  private async onCaptureCompleted(capture: Capture): Promise<void> {
    const bundleId = capture.custom_id;
    if (!bundleId?.startsWith('apb_')) return; // not an agent order Provenant backs
    const rec = await this.o.store.get(bundleId);
    if (!rec) {
      this.o.log.warn({ captureId: capture.id, bundleId }, 'capture names an unknown bundle');
      return;
    }
    await syncCapture(this.o.store, this.o.paypal, bundleId, capture.id);
  }

  // ---------------------------------------------------------------- the mirror

  /** Fetches full details (with HATEOAS links) from PayPal and upserts the mirror. */
  async refreshDispute(
    disputeId: string,
  ): Promise<{ dispute: Dispute; link: DisputeLink; changed: boolean }> {
    const dispute = await this.o.paypal.getDispute(disputeId);
    const link = await this.linkBundle(dispute);
    const tx = dispute.disputed_transactions?.[0];
    const [existing] = await this.o.db.select().from(disputes).where(eq(disputes.id, disputeId));
    const changed =
      !existing || existing.paypalUpdateTime?.toISOString() !== new Date(dispute.update_time).toISOString();
    const values = {
      reason: dispute.reason,
      status: dispute.status,
      stage: dispute.dispute_life_cycle_stage ?? null,
      amountValue: dispute.dispute_amount?.value ?? null,
      amountCurrency: dispute.dispute_amount?.currency_code ?? null,
      transactionId: tx?.seller_transaction_id ?? null,
      bundleId: link.bundleId,
      raw: { ...dispute, provenant_link: link },
      links: dispute.links ?? [],
      paypalCreateTime: new Date(dispute.create_time),
      paypalUpdateTime: new Date(dispute.update_time),
      updatedAt: new Date(),
    };
    await this.o.db
      .insert(disputes)
      .values({ id: disputeId, ...values })
      .onConflictDoUpdate({ target: disputes.id, set: values });
    if (changed && this.o.onDisputeChanged) await this.o.onDisputeChanged(disputeId);
    return { dispute, link, changed };
  }

  /**
   * A dispute names the capture (seller_transaction_id) and carries the order's custom_id
   * (`custom`). Both must point at the same bundle; a disagreement links nothing, which later
   * becomes INSUFFICIENT_EVIDENCE rather than a guess.
   */
  async linkBundle(dispute: Dispute): Promise<DisputeLink> {
    const tx = dispute.disputed_transactions?.[0];
    if (!tx) return { bundleId: null, basis: 'dispute lists no transaction' };
    const byCapture = tx.seller_transaction_id
      ? await this.o.store.getByCaptureId(tx.seller_transaction_id)
      : null;
    const byCustom = tx.custom?.startsWith('apb_') ? await this.o.store.get(tx.custom) : null;
    if (byCapture && byCustom && byCapture.bundle.bundle_id !== byCustom.bundle.bundle_id) {
      return {
        bundleId: null,
        basis: `capture points at ${byCapture.bundle.bundle_id} but custom_id at ${byCustom.bundle.bundle_id}`,
      };
    }
    if (byCapture)
      return {
        bundleId: byCapture.bundle.bundle_id,
        basis: `capture ${tx.seller_transaction_id}` + (byCustom ? ' and custom_id agree' : ''),
      };
    if (byCustom) {
      return {
        bundleId: byCustom.bundle.bundle_id,
        basis: byCustom.bundle.paypal_capture_id
          ? `custom_id only (bundle capture ${byCustom.bundle.paypal_capture_id} ≠ disputed ${tx.seller_transaction_id})`
          : 'custom_id (capture not yet recorded on the bundle)',
      };
    }
    return { bundleId: null, basis: 'no bundle for this transaction' };
  }

  // ---------------------------------------------------------------- polling fallback

  /** One pass over disputes changed since the watermark. Safe to run alongside webhooks. */
  async pollOnce(): Promise<{ seen: number; refreshed: number }> {
    if (this.polling) return { seen: 0, refreshed: 0 };
    this.polling = true;
    try {
      const [mark] = await this.o.db.select().from(kv).where(eq(kv.key, WATERMARK_KEY));
      const after =
        (mark?.value as string | undefined) ?? new Date(Date.now() - FIRST_POLL_LOOKBACK_MS).toISOString();
      let token: string | undefined;
      let newest = after;
      let seen = 0;
      let refreshed = 0;
      do {
        const page = await this.o.paypal.listDisputes({
          update_time_after: after,
          page_size: 50,
          next_page_token: token,
        });
        for (const summary of page.items) {
          seen++;
          const pollEventId = `poll:${summary.dispute_id}:${summary.update_time}`;
          const inserted = await this.o.db
            .insert(disputeEvents)
            .values({
              id: pollEventId,
              source: 'poll',
              eventType: 'POLL.DISPUTE.CHANGED',
              disputeId: summary.dispute_id,
              payload: summary,
            })
            .onConflictDoNothing()
            .returning({ id: disputeEvents.id });
          if (inserted.length > 0) {
            const r = await this.refreshDispute(summary.dispute_id);
            if (r.changed) refreshed++;
            await this.o.db
              .update(disputeEvents)
              .set({ processedAt: new Date() })
              .where(eq(disputeEvents.id, pollEventId));
          }
          if (summary.update_time > newest) newest = summary.update_time;
        }
        token = page.next_page_token;
      } while (token);
      await this.o.db
        .insert(kv)
        .values({ key: WATERMARK_KEY, value: newest })
        .onConflictDoUpdate({ target: kv.key, set: { value: newest, updatedAt: new Date() } });
      return { seen, refreshed };
    } finally {
      this.polling = false;
    }
  }

  startPolling(intervalSec: number): void {
    if (intervalSec <= 0 || this.pollTimer) return;
    const tick = () =>
      this.pollOnce().catch((e: unknown) =>
        this.o.log.warn({ err: e instanceof Error ? e.message : String(e) }, 'dispute poll failed'),
      );
    this.pollTimer = setInterval(tick, intervalSec * 1000);
    this.pollTimer.unref();
    void tick();
  }

  stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }
}

function disputeIdOf(event: WebhookEvent): string | null {
  const r = event.resource as { dispute_id?: string } | undefined;
  return event.event_type.startsWith('CUSTOMER.DISPUTE.') ? (r?.dispute_id ?? null) : null;
}
