import { verdicts } from '@provenant/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runScenario, SCENARIOS, SPECS } from '../src/scenarios';
import { type Stack, startStack } from './stack';

let s: Stack;
beforeAll(async () => {
  s = await startStack({ webhooks: true });
});
afterAll(async () => {
  await s.close();
});

const quiet = () => {};

describe('the five scenarios end to end (mock PayPal, mock LLM, webhooks over HTTP)', () => {
  for (const name of SCENARIOS) {
    it(`${name} → ${SPECS[name].expect.verdict} / ${SPECS[name].expect.action}`, async () => {
      const r = await runScenario(s.env, name, quiet);
      expect({ verdict: r.verdict, action: r.action }).toEqual(SPECS[name].expect);
    });
  }

  it('the same dispute webhook delivered twice yields one dispute and one verdict', async () => {
    const r = await runScenario(s.env, 'remorse', quiet);
    await s.mock.flushWebhooks();
    await s.server.intake.drain();
    const events = await s.mock.listEmittedEvents();
    const created = events.find(
      (e) =>
        e.event_type === 'CUSTOMER.DISPUTE.CREATED' &&
        (e.resource as { dispute_id: string }).dispute_id === r.disputeId,
    )!;
    const again = await fetch(`${s.env.PUBLIC_BASE_URL}/webhooks/paypal`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(created),
    }).then((x) => x.json());
    expect(again).toMatchObject({ duplicate: true });
    await s.server.intake.drain();
    const vs = await s.tdb.db.select().from(verdicts).where(eq(verdicts.disputeId, r.disputeId));
    expect(vs).toHaveLength(1);
  });

  it('serves the evidence PDF for an adjudicated dispute', async () => {
    const r = await runScenario(s.env, 'wrong-item', quiet);
    const res = await fetch(`${s.env.PUBLIC_BASE_URL}/v1/disputes/${r.disputeId}/report.pdf`, {
      headers: { authorization: `Bearer ${s.env.PROVENANT_MERCHANT_API_KEY}` },
    });
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(
      Buffer.from(await res.arrayBuffer())
        .subarray(0, 5)
        .toString(),
    ).toBe('%PDF-');
  });
});
