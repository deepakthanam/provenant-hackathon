import type { Env } from '@provenant/config';
import { createRemoteBuyer, type DisputeReason, type EvidenceFile } from '@provenant/paypal';
import { type PurchaseOptions, runPurchase } from './purchase';

export const SCENARIOS = ['remorse', 'overspend', 'wrong-item', 'ambiguous', 'tampered'] as const;
export type ScenarioName = (typeof SCENARIOS)[number];

interface ScenarioSpec {
  title: string;
  purchase: Omit<PurchaseOptions, 'log'>;
  wrongItemSwitch?: boolean;
  tamper?: boolean;
  dispute: { reason: DisputeReason; message: string; attachPhoto?: boolean };
  expect: { verdict: string; action: string };
  /** After approval: what the scenario does next and the PayPal state it should end in. */
  settle: {
    followUp?: 'seller_wins' | 'buyer_accepts_offer';
    final: { status: string; outcome: string | null; refunded?: string; liability?: string };
  };
}

export const SPECS: Record<ScenarioName, ScenarioSpec> = {
  remorse: {
    title: 'Buyer remorse: inside the mandate, delivered as shown',
    purchase: {
      request: 'black running shoes size 10 under $90, ask me above $50',
      userRef: 'usr_remorse',
      confirm: 'auto',
    },
    dispute: {
      reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
      message: "I never wanted these. The agent bought them and I don't like them.",
    },
    expect: { verdict: 'WITHIN_MANDATE', action: 'provide_evidence' },
    settle: { followUp: 'seller_wins', final: { status: 'RESOLVED', outcome: 'RESOLVED_SELLER_FAVOUR' } },
  },
  overspend: {
    title: 'Overspend: $50 cap, no confirmation, agent buys $65',
    purchase: {
      request: 'running shoes size 10 under $50',
      userRef: 'usr_overspend',
      forceSku: 'ROAD-BLK-10',
      confirm: 'never',
    },
    dispute: { reason: 'UNAUTHORISED', message: 'I set a $50 limit. The agent spent $65 without asking me.' },
    expect: { verdict: 'AGENT_OUT_OF_BOUNDS', action: 'accept_claim' },
    settle: {
      final: { status: 'RESOLVED', outcome: 'RESOLVED_BUYER_FAVOUR', refunded: '65.00', liability: '65.00' },
    },
  },
  'wrong-item': {
    title: 'Wrong item: snapshot shows black, buyer photo shows blue',
    purchase: {
      request: 'black trail running shoes size 10 under $90',
      userRef: 'usr_wrongitem',
      forceSku: 'RUN-BLK-10',
      confirm: 'auto',
    },
    wrongItemSwitch: true,
    dispute: {
      reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
      message: 'They sent blue shoes. The listing said black. Photo attached.',
      attachPhoto: true,
    },
    expect: { verdict: 'MERCHANT_MISREPRESENTED', action: 'accept_claim' },
    settle: { final: { status: 'RESOLVED', outcome: 'RESOLVED_BUYER_FAVOUR', refunded: '84.00' } },
  },
  ambiguous: {
    title: 'Ambiguous: mandate "running shoes", listing "trail/road hybrid", buyer wanted road',
    purchase: {
      request: 'running shoes size 10 under $90',
      userRef: 'usr_ambiguous',
      forceSku: 'HYB-BLK-10',
      confirm: 'auto',
    },
    dispute: {
      reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
      message: 'I wanted road running shoes; these are trail/road hybrids.',
    },
    expect: { verdict: 'SHARED_FAULT', action: 'make_offer' },
    settle: {
      followUp: 'buyer_accepts_offer',
      final: { status: 'RESOLVED', outcome: 'ACCEPTED', refunded: '36.00' },
    },
  },
  tampered: {
    title: 'Tampered: a sealed ledger row is edited in the database',
    purchase: { request: 'black running shoes size 10 under $90', userRef: 'usr_tampered', confirm: 'auto' },
    tamper: true,
    dispute: {
      reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
      message: 'The shoes are the wrong colour.',
    },
    expect: { verdict: 'INSUFFICIENT_EVIDENCE', action: 'none' },
    settle: { final: { status: 'WAITING_FOR_SELLER_RESPONSE', outcome: null } },
  },
};

export interface ScenarioResult {
  name: ScenarioName;
  title: string;
  bundleId: string;
  orderId: string;
  disputeId: string;
  verdict: string;
  confidence: number;
  action: string;
  actionAvailable: boolean;
  expected: ScenarioSpec['expect'];
  ok: boolean;
  reasons: string[];
}

async function api<T>(env: Env, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${env.PUBLIC_BASE_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${env.PROVENANT_ADMIN_API_KEY}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as T & { message?: string };
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${json.message ?? ''}`);
  return json;
}

interface DisputeDetail {
  status: string;
  stage: string | null;
  latest_verdict: null | {
    id: string;
    verdict: string;
    confidence: number;
    status: string;
    reasons: Array<{ text: string }>;
    recommended_action: { kind: string; available: boolean; explanation: string };
  };
}

/** Waits for the webhook path to produce a verdict; falls back to polling and an explicit run. */
export async function waitForVerdict(
  env: Env,
  disputeId: string,
  timeoutMs = 15_000,
): Promise<NonNullable<DisputeDetail['latest_verdict']>> {
  const deadline = Date.now() + timeoutMs;
  let nudged = false;
  while (Date.now() < deadline) {
    const d = await api<DisputeDetail>(env, 'GET', `/v1/disputes/${disputeId}`).catch(() => null);
    if (d?.latest_verdict) return d.latest_verdict;
    if (!nudged && Date.now() > deadline - timeoutMs / 2) {
      nudged = true;
      await api(env, 'POST', '/v1/disputes/sync').catch(() => undefined);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return (
    await api<{ verdict: NonNullable<DisputeDetail['latest_verdict']> }>(
      env,
      'POST',
      `/v1/disputes/${disputeId}/adjudicate`,
    )
  ).verdict;
}

/**
 * One scenario end to end in mock mode: mandate → purchase → fulfilment → dispute → verdict.
 * (Approval, the PayPal action and sandbox adjudication follow in `settleScenario`.)
 */
export async function runScenario(
  env: Env,
  name: ScenarioName,
  log: (s: string) => void = console.log,
): Promise<ScenarioResult> {
  const spec = SPECS[name];
  if (env.PAYPAL_MODE !== 'mock')
    throw new Error('scripted scenarios need PAYPAL_MODE=mock (the buyer side is simulated)');
  const buyer = createRemoteBuyer(env)!;
  log(`\n▶ ${name}: ${spec.title}`);

  await fetch(`${env.DEMO_STORE_URL}/admin/wrong-item`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: Boolean(spec.wrongItemSwitch) }),
  });
  let purchase: Awaited<ReturnType<typeof runPurchase>>;
  try {
    purchase = await runPurchase(env, { ...spec.purchase, log });
  } finally {
    if (spec.wrongItemSwitch) {
      await fetch(`${env.DEMO_STORE_URL}/admin/wrong-item`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"enabled":false}',
      });
    }
  }

  if (spec.tamper) {
    const t = await api<{ edit: string }>(env, 'POST', `/dev/tamper/${purchase.bundleId}`);
    log(`  ! tampered: ${t.edit}`);
  }

  const documents: EvidenceFile[] = [];
  if (spec.dispute.attachPhoto && purchase.photoUrl) {
    const bytes = new Uint8Array(await (await fetch(purchase.photoUrl)).arrayBuffer());
    documents.push({ name: 'what-arrived.png', contentType: 'image/png', bytes });
  }
  const d = await buyer.openDispute({
    capture_id: purchase.captureId,
    reason: spec.dispute.reason,
    message: spec.dispute.message,
    documents,
  });
  log(
    `  ✓ buyer opened ${d.dispute_id} (${spec.dispute.reason}): "${spec.dispute.message}"${documents.length ? ' + photo' : ''}`,
  );

  const v = await waitForVerdict(env, d.dispute_id);
  const ok = v.verdict === spec.expect.verdict && v.recommended_action.kind === spec.expect.action;
  log(
    `  ${ok ? '✓' : '✘'} verdict ${v.verdict} (${v.confidence.toFixed(2)}) → ${v.recommended_action.kind}${v.recommended_action.available ? '' : ' (n/a)'}: ${v.recommended_action.explanation}`,
  );
  for (const r of v.reasons.slice(0, 3)) log(`      · ${r.text}`);
  if (!ok) log(`      expected ${spec.expect.verdict} → ${spec.expect.action}`);
  return {
    name,
    title: spec.title,
    bundleId: purchase.bundleId,
    orderId: purchase.orderId,
    disputeId: d.dispute_id,
    verdict: v.verdict,
    confidence: v.confidence,
    action: v.recommended_action.kind,
    actionAvailable: v.recommended_action.available,
    expected: spec.expect,
    ok,
    reasons: v.reasons.map((r) => r.text),
  };
}

export interface SettleResult {
  approved: boolean;
  status: string;
  outcome: string | null;
  refunded: string | null;
  liability: string | null;
  ok: boolean;
}

/**
 * Approval and what follows: the merchant approves the planned call (Provenant executes it against
 * PayPal), then PayPal's side plays out: a sandbox adjudication, or the buyer accepting the offer.
 */
export async function settleScenario(
  env: Env,
  r: ScenarioResult,
  log: (s: string) => void = console.log,
): Promise<SettleResult> {
  const spec = SPECS[r.name];
  const buyer = createRemoteBuyer(env)!;
  let approved = false;
  if (r.action !== 'none') {
    const out = await api<{ action: { kind: string; status: string; request_id: string | null } }>(
      env,
      'POST',
      `/v1/disputes/${r.disputeId}/approve`,
      {
        approved_by: 'scenario-runner',
      },
    );
    approved = true;
    log(
      `  ✓ approved → ${out.action.kind} ${out.action.status} (PayPal-Request-Id ${out.action.request_id})`,
    );
  } else {
    log('  · nothing to approve: left for human review');
  }
  if (spec.settle.followUp === 'seller_wins') {
    await api(env, 'POST', `/v1/disputes/${r.disputeId}/sandbox/adjudicate`, { outcome: 'SELLER_FAVOR' });
    log('  ✓ PayPal (sandbox adjudicate) settles for the seller');
  } else if (spec.settle.followUp === 'buyer_accepts_offer') {
    await buyer.acceptOffer(r.disputeId);
    await api(env, 'POST', '/v1/disputes/sync');
    log('  ✓ buyer accepts the partial-refund offer');
  }
  const d = await api<{
    status: string;
    paypal: { dispute_outcome?: { outcome_code: string; amount_refunded?: { value: string } } };
  }>(env, 'GET', `/v1/disputes/${r.disputeId}`);
  const liability = await api<{ entries: Array<{ dispute_id: string; amount: { value: string } }> }>(
    env,
    'GET',
    '/v1/liability',
  );
  const mine = liability.entries.find((e) => e.dispute_id === r.disputeId);
  const result = {
    approved,
    status: d.status,
    outcome: d.paypal.dispute_outcome?.outcome_code ?? null,
    refunded: d.paypal.dispute_outcome?.amount_refunded?.value ?? null,
    liability: mine?.amount.value ?? null,
  };
  const f = spec.settle.final;
  const ok =
    result.status === f.status &&
    result.outcome === f.outcome &&
    (f.refunded === undefined || result.refunded === f.refunded) &&
    (f.liability ?? null) === result.liability;
  log(
    `  ${ok ? '✓' : '✘'} PayPal: ${result.status}${result.outcome ? ` ${result.outcome}` : ''}${result.refunded ? `, refunded ${result.refunded}` : ''}${result.liability ? `; liability ${result.liability} → ${r.bundleId ? 'demo-agent' : ''}` : ''}`,
  );
  return { ...result, ok };
}
