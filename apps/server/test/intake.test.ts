import { disputeEvents, disputes } from '@provenant/db';
import type { PayPalClient } from '@provenant/paypal';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { purchase } from './fixtures';
import { bearer, createHarness, type Harness } from './harness';

/** Webhooks the mock emitted, captured so tests can deliver them (once, twice, or never). */
const outbox: string[] = [];
let h: Harness;

beforeAll(async () => {
  h = await createHarness({ webhookSink: async (raw) => void outbox.push(raw) });
});
afterAll(async () => {
  await h.close();
});

const deliver = (raw: string, headers: Record<string, string> = {}) =>
  h.app.inject({
    method: 'POST',
    url: '/webhooks/paypal',
    headers: { 'content-type': 'application/json', ...headers },
    payload: raw,
  });

async function flush() {
  await h.mock.flushWebhooks();
}

function take(eventType: string): string {
  const i = outbox.findIndex((r) => JSON.parse(r).event_type === eventType);
  if (i < 0) throw new Error(`no ${eventType} in outbox`);
  return outbox.splice(i, 1)[0]!;
}

describe('webhook intake', () => {
  it('records the capture on the bundle from PAYMENT.CAPTURE.COMPLETED', async () => {
    const p = await purchase(h);
    await flush();
    const res = await deliver(take('PAYMENT.CAPTURE.COMPLETED'));
    expect(res.statusCode).toBe(200);
    await h.app.intake.drain();
    const b = (
      await h.app.inject({ url: `/v1/bundles/${p.bundleId}`, headers: bearer(h.keys.admin) })
    ).json();
    expect(b.paypal_capture_id).toBe(p.captureId);
    expect(b.captured_amount).toEqual({ value: '84.00', currency: 'USD' });
  });

  it('creates exactly one dispute record when the same webhook arrives twice', async () => {
    const p = await purchase(h);
    await flush();
    await deliver(take('PAYMENT.CAPTURE.COMPLETED'));
    const d = await h.mock.buyerOpenDispute({
      capture_id: p.captureId,
      reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
      message: 'not what I wanted',
    });
    await flush();
    const raw = take('CUSTOMER.DISPUTE.CREATED');
    const first = await deliver(raw);
    const second = await deliver(raw);
    expect(first.json()).toMatchObject({ received: true, duplicate: false });
    expect(second.json()).toMatchObject({ received: true, duplicate: true });
    await h.app.intake.drain();

    const rows = await h.tdb.db.select().from(disputes).where(eq(disputes.id, d.dispute_id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.bundleId).toBe(p.bundleId);
    expect(rows[0]!.status).toBe('WAITING_FOR_SELLER_RESPONSE');
    expect(rows[0]!.stage).toBe('INQUIRY');
    const events = await h.tdb.db
      .select()
      .from(disputeEvents)
      .where(eq(disputeEvents.disputeId, d.dispute_id));
    expect(events).toHaveLength(1);
    expect(events[0]!.processedAt).not.toBeNull();
  });

  it('keeps the mirror current through UPDATED and RESOLVED', async () => {
    const p = await purchase(h);
    const d = await h.mock.buyerOpenDispute({
      capture_id: p.captureId,
      reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
      message: 'nothing came',
    });
    await h.mock.provideEvidence(d.dispute_id, {
      evidences: [{ evidence_type: 'PROOF_OF_FULFILLMENT', notes: 'shipped' }],
    });
    await h.mock.sandboxAdjudicate(d.dispute_id, 'SELLER_FAVOR');
    await flush();
    for (const t of [
      'PAYMENT.CAPTURE.COMPLETED',
      'CUSTOMER.DISPUTE.CREATED',
      'CUSTOMER.DISPUTE.UPDATED',
      'CUSTOMER.DISPUTE.RESOLVED',
    ])
      await deliver(take(t));
    await h.app.intake.drain();
    const detail = (
      await h.app.inject({ url: `/v1/disputes/${d.dispute_id}`, headers: bearer(h.keys.merchant) })
    ).json();
    expect(detail.status).toBe('RESOLVED');
    expect(detail.bundle_id).toBe(p.bundleId);
    expect(detail.link_basis).toMatch(/capture .* and custom_id agree/);
    expect(detail.events.map((e: { event_type: string }) => e.event_type)).toEqual([
      'CUSTOMER.DISPUTE.CREATED',
      'CUSTOMER.DISPUTE.UPDATED',
      'CUSTOMER.DISPUTE.RESOLVED',
    ]);
  });

  it('rejects malformed bodies', async () => {
    expect((await deliver('not json')).statusCode).toBe(400);
    expect((await deliver('{"hello":1}')).statusCode).toBe(400);
  });

  it('re-processes events that were stored but not processed', async () => {
    const p = await purchase(h);
    await h.mock.buyerOpenDispute({
      capture_id: p.captureId,
      reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
      message: 'x',
    });
    await flush();
    const raw = take('CUSTOMER.DISPUTE.CREATED');
    const ev = JSON.parse(raw);
    await h.tdb.db.insert(disputeEvents).values({
      id: ev.id,
      source: 'webhook',
      eventType: ev.event_type,
      disputeId: ev.resource.dispute_id,
      payload: ev,
    });
    expect(await h.app.intake.resumePending()).toBeGreaterThanOrEqual(1);
    await h.app.intake.drain();
    const [row] = await h.tdb.db.select().from(disputes).where(eq(disputes.id, ev.resource.dispute_id));
    expect(row?.bundleId).toBe(p.bundleId);
  });
});

describe('signature verification (sandbox mode)', () => {
  let s: Harness;
  beforeAll(async () => {
    // A sandbox-mode client whose signature check fails: nothing may be stored.
    s = await createHarness({
      paypal: (mock) =>
        Object.assign(Object.create(mock) as PayPalClient, {
          mode: 'sandbox',
          verifyWebhookSignature: async () => false,
        }),
    });
  });
  afterAll(async () => {
    await s.close();
  });

  it('refuses webhooks whose PayPal signature does not verify', async () => {
    const raw = JSON.stringify({
      id: 'WH-FORGED-1',
      event_type: 'CUSTOMER.DISPUTE.CREATED',
      resource: { dispute_id: 'PP-D-1' },
    });
    const res = await s.app.inject({
      method: 'POST',
      url: '/webhooks/paypal',
      headers: { 'content-type': 'application/json' },
      payload: raw,
    });
    expect(res.statusCode).toBe(401);
    expect(await s.tdb.db.select().from(disputeEvents)).toHaveLength(0);
  });
});

describe('polling fallback (webhooks disabled)', () => {
  let q: Harness;
  beforeAll(async () => {
    q = await createHarness(); // no webhook sink: events are never delivered
  });
  afterAll(async () => {
    await q.close();
  });

  it('picks up a dispute created in mock mode and links it to its bundle', async () => {
    const p = await purchase(q);
    await q.app.inject({
      method: 'POST',
      url: `/v1/bundles/${p.bundleId}/capture`,
      headers: bearer(q.keys.platform),
      payload: {},
    });
    const d = await q.mock.buyerOpenDispute({
      capture_id: p.captureId,
      reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
      message: 'blue, not black',
    });

    const first = (
      await q.app.inject({ method: 'POST', url: '/v1/disputes/sync', headers: bearer(q.keys.merchant) })
    ).json();
    expect(first.refreshed).toBeGreaterThanOrEqual(1);
    const list = (await q.app.inject({ url: '/v1/disputes', headers: bearer(q.keys.merchant) })).json();
    const mirrored = list.items.find((x: { id: string }) => x.id === d.dispute_id);
    expect(mirrored).toMatchObject({
      bundle_id: p.bundleId,
      reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
      transaction_id: p.captureId,
    });

    // Nothing changed since: the watermark makes the next poll a no-op.
    const second = (
      await q.app.inject({ method: 'POST', url: '/v1/disputes/sync', headers: bearer(q.keys.merchant) })
    ).json();
    expect(second.refreshed).toBe(0);

    // A later change is picked up again.
    await q.mock.sendMessage(d.dispute_id, 'We are looking into it');
    const third = (
      await q.app.inject({ method: 'POST', url: '/v1/disputes/sync', headers: bearer(q.keys.merchant) })
    ).json();
    expect(third.refreshed).toBe(1);
  });

  it('links nothing when the capture and custom_id point at different bundles', async () => {
    const a = await purchase(q);
    const b = await purchase(q);
    await q.app.inject({
      method: 'POST',
      url: `/v1/bundles/${a.bundleId}/capture`,
      headers: bearer(q.keys.platform),
      payload: {},
    });
    const d = await q.mock.buyerOpenDispute({
      capture_id: a.captureId,
      reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
      message: 'x',
    });
    const dispute = await q.mock.getDispute(d.dispute_id);
    dispute.disputed_transactions![0]!.custom = b.bundleId; // tampered or mis-attributed transaction
    const link = await q.app.intake.linkBundle(dispute);
    expect(link.bundleId).toBeNull();
    expect(link.basis).toMatch(/points at .* but custom_id at/);
  });

  it('only merchants and admins can read disputes', async () => {
    expect((await q.app.inject({ url: '/v1/disputes', headers: bearer(q.keys.platform) })).statusCode).toBe(
      403,
    );
    expect((await q.app.inject({ url: '/v1/disputes' })).statusCode).toBe(401);
  });
});
