import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestDatabase, type TestDatabase } from '@provenant/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { directBuyer } from '../src/buyer';
import { MockPayPal } from '../src/mock';
import type { WebhookEvent } from '../src/types';

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', name), 'utf8')) as WebhookEvent;

let tdb: TestDatabase;
let mock: MockPayPal;
const received: Array<{ raw: string; event: WebhookEvent }> = [];

beforeAll(async () => {
  tdb = await createTestDatabase(inject('databaseUrl'));
  mock = new MockPayPal({
    db: tdb.db,
    baseUrl: 'http://mock.local/mock-paypal',
    webhookSink: async (raw, event) => void received.push({ raw, event }),
  });
});
afterAll(async () => {
  await tdb.drop();
});

/** Every key PayPal's documented payload has must be present in what the mock sends. */
function expectSameKeys(actual: Record<string, unknown>, documented: Record<string, unknown>, path = '') {
  for (const key of Object.keys(documented)) {
    expect(actual, `${path}${key}`).toHaveProperty(key);
  }
}

describe('MockPayPal webhooks', () => {
  it('emits PAYMENT.CAPTURE.COMPLETED and CUSTOMER.DISPUTE.* shaped like PayPal’s payloads', async () => {
    const buyer = directBuyer(mock);
    const order = await mock.createOrder({
      custom_id: 'apb_WH',
      amount: { currency_code: 'USD', value: '84.00' },
    });
    await buyer.approveOrder(order.id);
    const captured = await mock.captureOrder(order.id);
    const captureId = captured.purchase_units![0]!.payments!.captures![0]!.id;
    const d = await buyer.openDispute({
      capture_id: captureId,
      reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
      message: 'no box',
    });
    await mock.provideEvidence(d.dispute_id, {
      evidences: [{ evidence_type: 'PROOF_OF_FULFILLMENT', notes: 'shipped' }],
    });
    await mock.sandboxAdjudicate(d.dispute_id, 'SELLER_FAVOR');
    await mock.flushWebhooks();

    expect(received.map((r) => r.event.event_type)).toEqual([
      'PAYMENT.CAPTURE.COMPLETED',
      'CUSTOMER.DISPUTE.CREATED',
      'CUSTOMER.DISPUTE.UPDATED',
      'CUSTOMER.DISPUTE.RESOLVED',
    ]);

    const [cap, created, updated, resolved] = received.map((r) => r.event);
    const capFixture = fixture('webhook-payment-capture-completed.json');
    expectSameKeys(cap as never, capFixture as never);
    const capRes = cap!.resource as Record<string, any>;
    for (const k of ['id', 'status', 'amount', 'final_capture', 'supplementary_data', 'links', 'create_time'])
      expect(capRes).toHaveProperty(k);
    expect(capRes.custom_id).toBe('apb_WH');
    expect(capRes.supplementary_data.related_ids.order_id).toBe(order.id);

    const disputeFixture = fixture('webhook-customer-dispute-created.json');
    expectSameKeys(created as never, disputeFixture as never);
    const res = created!.resource as Record<string, unknown>;
    for (const k of [
      'dispute_id',
      'create_time',
      'update_time',
      'disputed_transactions',
      'reason',
      'status',
      'dispute_amount',
      'dispute_life_cycle_stage',
      'links',
    ]) {
      expect(res).toHaveProperty(k);
    }
    expect((updated!.resource as Record<string, unknown>).status).toBe('UNDER_REVIEW');
    expect((resolved!.resource as Record<string, any>).dispute_outcome.outcome_code).toBe(
      'RESOLVED_SELLER_FAVOUR',
    );
    expect(new Set(received.map((r) => r.event.id)).size).toBe(4);
    expect(JSON.parse(received[0]!.raw)).toEqual(received[0]!.event);
  });

  it('records events without delivering when no sink is configured (polling-only mode)', async () => {
    const quiet = new MockPayPal({ db: tdb.db, baseUrl: 'http://mock.local/mock-paypal' });
    const before = (await quiet.listEmittedEvents()).length;
    const o = await quiet.createOrder({ amount: { currency_code: 'USD', value: '1.00' } });
    await quiet.buyerApproveOrder(o.id);
    await quiet.captureOrder(o.id);
    expect((await quiet.listEmittedEvents()).length).toBe(before + 1);
  });
});
