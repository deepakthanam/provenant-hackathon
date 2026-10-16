import { actions } from '@provenant/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { purchase } from './fixtures';
import { bearer, createHarness, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

const api = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
  h.app.inject({ method, url, headers: bearer(h.keys.merchant), payload: payload as object });

/** Purchase + capture sync + dispute + adjudication, returning the dispute id. */
async function disputed(message: string, opts: { shipped?: boolean } = {}) {
  const p = await purchase(h);
  await h.app.inject({
    method: 'POST',
    url: `/v1/bundles/${p.bundleId}/capture`,
    headers: bearer(h.keys.platform),
    payload: {},
  });
  if (opts.shipped !== false) {
    await h.app.inject({
      method: 'POST',
      url: `/v1/bundles/${p.bundleId}/fulfilment`,
      headers: bearer(h.keys.merchant),
      payload: {
        carrier: 'UPS',
        tracking_number: '1Z1',
        status: 'DELIVERED',
        shipped_at: new Date().toISOString(),
        delivered_at: new Date().toISOString(),
        shipped_items: [{ sku: 'RUN-BLK-10', attributes: { color: 'black' } }],
      },
    });
  }
  const d = await h.mock.buyerOpenDispute({
    capture_id: p.captureId,
    reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
    message,
  });
  await api('POST', '/v1/disputes/sync');
  return { ...p, disputeId: d.dispute_id };
}

describe('approve → execute', () => {
  it('uploads the evidence PDF through provide-evidence and records the call', async () => {
    const d = await disputed('I never wanted these.');
    const before = (await api('GET', `/v1/disputes/${d.disputeId}`)).json();
    expect(before.latest_verdict.verdict).toBe('WITHIN_MANDATE');
    expect(before.actions).toEqual([
      expect.objectContaining({ kind: 'provide_evidence', status: 'PLANNED' }),
    ]);

    const res = await api('POST', `/v1/disputes/${d.disputeId}/approve`, { approved_by: 'merchant@demo' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().action).toMatchObject({ kind: 'provide_evidence', status: 'EXECUTED' });
    expect(res.json().action.request_id).toBeTruthy();
    expect(res.json().verdict).toMatchObject({ status: 'EXECUTED', approved_by: 'merchant@demo' });

    const paypal = await h.mock.getDispute(d.disputeId);
    expect(paypal.status).toBe('UNDER_REVIEW');
    const doc = paypal.evidences?.find((e) => e.source === 'SUBMITTED_BY_SELLER')?.documents?.[0];
    expect(doc?.name).toBe(`provenant-evidence-${d.disputeId}.pdf`);
    const pdf = await h.mock.downloadDocument(doc!.url!);
    expect(Buffer.from(pdf.bytes).subarray(0, 5).toString()).toBe('%PDF-');

    const after = (await api('GET', `/v1/disputes/${d.disputeId}`)).json();
    expect(after.status).toBe('UNDER_REVIEW');
    expect(after.verdict_history).toHaveLength(1); // our own action's effect is not re-adjudicated
    expect(after.actions).toEqual([
      expect.objectContaining({ kind: 'provide_evidence', status: 'EXECUTED' }),
    ]);

    // sandbox helper: PayPal settles for the seller
    const settled = await api('POST', `/v1/disputes/${d.disputeId}/sandbox/adjudicate`, {
      outcome: 'SELLER_FAVOR',
    });
    expect(settled.json()).toEqual({ status: 'RESOLVED', outcome: 'RESOLVED_SELLER_FAVOUR' });
  });

  it('executes once even when approved twice', async () => {
    const d = await disputed('meh');
    const [a, b] = await Promise.all([
      api('POST', `/v1/disputes/${d.disputeId}/approve`),
      api('POST', `/v1/disputes/${d.disputeId}/approve`),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const rows = await h.tdb.db.select().from(actions).where(eq(actions.disputeId, d.disputeId));
    expect(rows.filter((r) => r.status === 'EXECUTED')).toHaveLength(1);
  });

  it('records ACTION_NOT_AVAILABLE and makes no call when the link has gone', async () => {
    const d = await disputed('meh');
    // Someone already answered PayPal outside Provenant: the dispute is under review now.
    await h.mock.provideEvidence(d.disputeId, { evidences: [{ evidence_type: 'OTHER', notes: 'manual' }] });
    const before = (await h.mock.getDispute(d.disputeId)).evidences?.length;
    const res = await api('POST', `/v1/disputes/${d.disputeId}/approve`);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('ACTION_NOT_AVAILABLE');
    expect(res.json().message).toMatch(/status UNDER_REVIEW, stage INQUIRY/);
    expect((await h.mock.getDispute(d.disputeId)).evidences?.length).toBe(before);
    const detail = (await api('GET', `/v1/disputes/${d.disputeId}`)).json();
    expect(detail.latest_verdict.status).toBe('FAILED');
    expect(detail.actions.at(-1)).toMatchObject({ status: 'ACTION_NOT_AVAILABLE' });
  });

  it('rejects without calling PayPal, and a rejected verdict cannot be approved', async () => {
    const d = await disputed('meh');
    const r = await api('POST', `/v1/disputes/${d.disputeId}/reject`, {
      reason: 'I will call the buyer myself',
    });
    expect(r.json().verdict.status).toBe('REJECTED');
    expect((await api('POST', `/v1/disputes/${d.disputeId}/approve`)).statusCode).toBe(409);
    expect((await h.mock.getDispute(d.disputeId)).status).toBe('WAITING_FOR_SELLER_RESPONSE');
  });

  it('refuses to execute a verdict that plans no call', async () => {
    const p = await purchase(h); // no capture recorded, no fulfilment: still adjudicable
    const dd = await h.mock.buyerOpenDispute({
      capture_id: p.captureId,
      reason: 'CREDIT_NOT_PROCESSED',
      message: 'x',
    });
    await api('POST', '/v1/disputes/sync');
    const res = await api('POST', `/v1/disputes/${dd.dispute_id}/approve`);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('NOTHING_TO_EXECUTE');
  });

  it('lets the merchant override the plan, within PayPal’s allowed options', async () => {
    const d = await disputed('meh');
    const bad = await api('POST', `/v1/disputes/${d.disputeId}/approve`, {
      action_override: { kind: 'make_offer', offer_type: 'REPLACEMENT_WITHOUT_REFUND' },
    });
    expect(bad.statusCode).toBe(409);
    expect(bad.json().error).toBe('ACTION_NOT_AVAILABLE');
    const ok = await api('POST', `/v1/disputes/${d.disputeId}/approve`, {
      action_override: {
        kind: 'make_offer',
        offer_type: 'REFUND',
        offer_amount: { currency_code: 'USD', value: '20.00' },
        note: 'goodwill',
      },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await h.mock.getDispute(d.disputeId)).offer?.seller_offered_amount?.value).toBe('20.00');
  });
});

describe('liability ledger', () => {
  it('books an out-of-mandate refund against the agent platform', async () => {
    const p = await purchase(h, h.mock, '95.00'); // cap is $90
    await h.app.inject({
      method: 'POST',
      url: `/v1/bundles/${p.bundleId}/capture`,
      headers: bearer(h.keys.platform),
      payload: {},
    });
    const d = await h.mock.buyerOpenDispute({
      capture_id: p.captureId,
      reason: 'UNAUTHORISED',
      message: 'over my limit',
    });
    await api('POST', '/v1/disputes/sync');
    const res = await api('POST', `/v1/disputes/${d.dispute_id}/approve`);
    expect(res.json().verdict.verdict).toBe('AGENT_OUT_OF_BOUNDS');
    expect((await h.mock.getDispute(d.dispute_id)).dispute_outcome).toMatchObject({
      outcome_code: 'RESOLVED_BUYER_FAVOUR',
      amount_refunded: { value: '95.00' },
    });
    const ledger = (await api('GET', '/v1/liability')).json();
    expect(ledger.entries.find((e: { dispute_id: string }) => e.dispute_id === d.dispute_id)).toMatchObject({
      platform_id: 'demo-agent',
      amount: { value: '95.00' },
    });
    expect(ledger.platforms[0]).toMatchObject({
      platform_id: 'demo-agent',
      name: 'Provenant demo shopping agent',
    });
    // the platform sees its own liability
    const own = await h.app.inject({ url: '/v1/liability', headers: bearer(h.keys.platform) });
    expect(own.json().entries.length).toBeGreaterThanOrEqual(1);
  });
});

describe('AUTO_ACTION', () => {
  let auto: Harness;
  beforeAll(async () => {
    auto = await createHarness({ envOverrides: { AUTO_ACTION: 'true' } });
  });
  afterAll(async () => {
    await auto.close();
  });

  it('executes a confident, actionable verdict without a human', async () => {
    const p = await purchase(auto);
    await auto.app.inject({
      method: 'POST',
      url: `/v1/bundles/${p.bundleId}/capture`,
      headers: bearer(auto.keys.platform),
      payload: {},
    });
    const d = await auto.mock.buyerOpenDispute({
      capture_id: p.captureId,
      reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
      message: 'never came',
    });
    await auto.app.inject({ method: 'POST', url: '/v1/disputes/sync', headers: bearer(auto.keys.merchant) });
    const detail = (
      await auto.app.inject({ url: `/v1/disputes/${d.dispute_id}`, headers: bearer(auto.keys.merchant) })
    ).json();
    // Not shipped → merchant misrepresented → accept claim, approved by "auto".
    expect(detail.latest_verdict).toMatchObject({
      verdict: 'MERCHANT_MISREPRESENTED',
      status: 'EXECUTED',
      approved_by: 'auto',
    });
    expect((await auto.mock.getDispute(d.dispute_id)).status).toBe('RESOLVED');
  });
});
