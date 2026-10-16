import { CircleCheck, CircleMinus, CircleX, FileDown, ScrollText } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { AutoRefresh } from '@/components/auto-refresh';
import { Decision } from '@/components/decision';
import { Field, Mono, Part } from '@/components/form';
import { Stamp } from '@/components/stamp';
import { TamperTape } from '@/components/tamper-tape';
import { api, apiBase, apiOrNull } from '@/lib/api';
import {
  ACTION_LABEL,
  label,
  money,
  REASON_LABEL,
  STATUS_LABEL,
  shortHash,
  VERDICT_MEANING,
  when,
} from '@/lib/format';
import type { Bundle, DisputeDetail, Finding, RuleResult, VerifyResult } from '@/lib/types';

const RULE_GROUPS: Array<{ title: string; rules: string[] }> = [
  {
    title: 'Integrity',
    rules: [
      'bundle_present',
      'ledger_verified',
      'mandate_signature_valid',
      'transaction_matches_capture',
      'custom_id_matches',
      'dispute_amount_within_capture',
    ],
  },
  {
    title: 'Mandate',
    rules: [
      'within_max_amount',
      'category_allowed',
      'merchant_allowed',
      'confirmation_present',
      'mandate_not_expired',
      'captured_equals_cart',
    ],
  },
  {
    title: 'Delivery',
    rules: [
      'shipped',
      'tracking_present',
      'delivered',
      'delivered_within_window',
      'shipped_items_match_cart',
    ],
  },
];

const RULE_NAME: Record<string, string> = {
  bundle_present: 'Evidence bundle linked',
  ledger_verified: 'Ledger hashes and signatures verify',
  mandate_signature_valid: "User's signature on the mandate",
  transaction_matches_capture: 'Disputed payment is this bundle’s capture',
  custom_id_matches: 'PayPal custom_id names this bundle',
  dispute_amount_within_capture: 'Disputed amount within what was charged',
  within_max_amount: 'Within the spending cap',
  category_allowed: 'Category allowed',
  merchant_allowed: 'Merchant allowed',
  confirmation_present: 'User confirmed above the ask-me limit',
  mandate_not_expired: 'Mandate still valid when ordered',
  captured_equals_cart: 'Charged amount equals the approved cart',
  shipped: 'Shipped',
  tracking_present: 'Tracking number',
  delivered: 'Delivered',
  delivered_within_window: 'Inside the promised delivery window',
  shipped_items_match_cart: 'What was packed matches the cart',
};

function RuleIcon({ r }: { r: RuleResult }) {
  if (r.skipped)
    return <CircleMinus size={18} className="mt-[1px] shrink-0 text-ink-3" aria-label="not applicable" />;
  return r.passed ? (
    <CircleCheck size={18} className="mt-[1px] shrink-0 text-v-within" aria-label="passed" />
  ) : (
    <CircleX size={18} className="mt-[1px] shrink-0 text-tape" aria-label="failed" />
  );
}

export default async function DisputePage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const d = await apiOrNull<DisputeDetail>(`/v1/disputes/${encodeURIComponent(id)}`);
  if (!d) notFound();
  const [bundle, verify] = d.bundle_id
    ? await Promise.all([
        api<Bundle>(`/v1/bundles/${d.bundle_id}`).catch(() => null),
        api<VerifyResult>(`/v1/bundles/${d.bundle_id}/verify`).catch(() => null),
      ])
    : [null, null];
  const v = d.latest_verdict;
  const base = apiBase();
  const snap = bundle?.offer_snapshot ?? null;
  const findings = v?.model_findings ?? [];
  const cited = new Map<string, Finding>(
    findings.map((f) => [f.snapshot_field_ref.replace(/^offer_snapshot\./, ''), f]),
  );
  const outcome = d.paypal.dispute_outcome;

  // The custody log: everything that touched this dispute, in order.
  const log = [
    ...(bundle
      ? [
          {
            at: bundle.created_at,
            who: bundle.agent.platform_id,
            what: `Mandate signed by ${bundle.user_ref}; evidence bundle opened`,
          },
        ]
      : []),
    ...(bundle?.sealed_at
      ? [
          {
            at: bundle.sealed_at,
            who: bundle.agent.platform_id,
            what: `Bundle sealed to PayPal order ${bundle.paypal_order_id}`,
          },
        ]
      : []),
    ...(bundle?.fulfilment?.shipped_at
      ? [
          {
            at: bundle.fulfilment.shipped_at,
            who: bundle.offer_snapshot?.merchant_id ?? 'merchant',
            what: `Shipped ${bundle.fulfilment.carrier} ${bundle.fulfilment.tracking_number}`,
          },
        ]
      : []),
    ...d.events.map((e) => ({
      at: e.created_at,
      who: e.source === 'poll' ? 'PayPal (poll)' : 'PayPal (webhook)',
      what: `${e.event_type}${e.error ? ` · failed: ${e.error}` : ''}`,
    })),
    ...d.verdict_history.map((h) => ({
      at: h.created_at,
      who: 'Provenant',
      what: `Verdict ${h.verdict.replace(/_/g, ' ').toLowerCase()} · ${h.status.toLowerCase()}`,
    })),
    ...d.actions
      .filter((a) => a.executed_at)
      .map((a) => ({
        at: a.executed_at!,
        who: a.status === 'EXECUTED' ? 'Provenant → PayPal' : 'Provenant',
        what: `${label(ACTION_LABEL, a.kind)} · ${a.status.replace(/_/g, ' ').toLowerCase()}${a.request_id ? ` · request ${a.request_id.slice(0, 8)}` : ''}${a.debug_id ? ` · debug_id ${a.debug_id}` : ''}`,
      })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <article>
      <AutoRefresh />
      <nav className="mb-4 text-[14px]">
        <Link href="/" className="text-ink-2 hover:text-ink">
          Dispute queue
        </Link>
        <span className="text-ink-3"> / {d.id}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <h1 className="font-stencil text-[38px] leading-[0.95] tracking-[0.02em] sm:text-[56px]">{d.id}</h1>
          <p className="mt-3 text-[17px] text-ink-2">
            <span className="font-semibold text-ink">{label(REASON_LABEL, d.reason)}</span> ·{' '}
            <Mono className="text-[16px]">{money(d.amount)}</Mono> · {d.stage ?? '—'} ·{' '}
            {label(STATUS_LABEL, d.status)}
            {outcome ? (
              <>
                {' '}
                ·{' '}
                <span className="font-semibold text-ink">
                  {outcome.outcome_code.replace(/_/g, ' ').toLowerCase()}
                </span>
              </>
            ) : null}
          </p>
        </div>
        {v ? (
          <div className="flex flex-col items-end gap-2 text-right">
            <Stamp verdict={v.verdict} size="lg" />
            <div className="text-[14px] text-ink-2">
              confidence <Mono className="text-ink">{v.confidence.toFixed(2)}</Mono>
            </div>
          </div>
        ) : null}
      </header>

      <div className="mt-6">
        <TamperTape verify={verify} />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-10 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0">
          {v ? (
            <p className="mb-8 max-w-[70ch] text-[17px] leading-relaxed">{VERDICT_MEANING[v.verdict]}</p>
          ) : null}

          <Part
            title="Claim against the snapshot"
            aside={snap ? `snapshot captured ${when(snap.captured_at)}` : undefined}
            id="claim"
          >
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="poly p-4">
                <div className="field-label">What the agent saw</div>
                {snap ? (
                  <>
                    {snap.image_sha256 ? (
                      // biome-ignore lint/performance/noImgElement: evidence images are served by the API by content hash
                      <img
                        src={`${base}/v1/blobs/${snap.image_sha256}`}
                        alt={`Listing as the agent saw it: ${snap.title}`}
                        className="mt-2 aspect-[16/10] w-full border border-poly-edge bg-paper object-contain"
                      />
                    ) : null}
                    <div className="mt-3 text-[17px] font-semibold">{snap.title}</div>
                    <dl className="mt-2 divide-y divide-poly-edge text-[14.5px]">
                      {Object.entries(snap.attributes).map(([k, val]) => {
                        const f = cited.get(`attributes.${k}`);
                        return (
                          <div
                            key={k}
                            className={`flex justify-between gap-3 py-1.5 ${f ? '-mx-2 bg-[#fbe3e0] px-2' : ''}`}
                          >
                            <dt className="text-ink-2">{k}</dt>
                            <dd className={`font-medium ${f ? 'text-tape' : ''}`}>{val}</dd>
                          </div>
                        );
                      })}
                      <div className="flex justify-between gap-3 py-1.5">
                        <dt className="text-ink-2">price</dt>
                        <dd className="font-mono">{money(snap.price)}</dd>
                      </div>
                      <div className="flex justify-between gap-3 py-1.5">
                        <dt className="text-ink-2">delivery</dt>
                        <dd>
                          {snap.delivery_promise.min_days}–{snap.delivery_promise.max_days} days
                        </dd>
                      </div>
                    </dl>
                    <a href={snap.url} className="mt-2 block truncate font-mono text-[12px] text-ink-3">
                      {snap.url}
                    </a>
                  </>
                ) : (
                  <p className="mt-2 text-ink-2">No offer snapshot on record.</p>
                )}
              </div>
              <div className="border border-rule bg-paper-2 p-4">
                <div className="field-label">What the buyer says</div>
                {v?.inputs_summary.buyer_images.length ? (
                  <div className="mt-2 grid grid-cols-1 gap-2">
                    {v.inputs_summary.buyer_images.map((img) => (
                      <figure key={img.sha256}>
                        {/* biome-ignore lint/performance/noImgElement: buyer evidence served by content hash */}
                        <img
                          src={`${base}/v1/blobs/${img.sha256}`}
                          alt={`What the buyer received (${img.name})`}
                          className="aspect-[16/10] w-full border border-rule bg-paper object-contain"
                        />
                        <figcaption className="mt-1 font-mono text-[12px] text-ink-3">
                          {img.name} · sha256 {img.sha256.slice(0, 10)}…
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                ) : null}
                <div className="mt-3 space-y-3">
                  {(v?.inputs_summary.buyer_messages ?? []).map((m) => (
                    <blockquote
                      key={m}
                      className="border-l-[3px] border-ink-3 pl-3 text-[16px] italic leading-relaxed"
                    >
                      “{m}”
                    </blockquote>
                  ))}
                  {!v?.inputs_summary.buyer_messages.length ? (
                    <p className="text-ink-2">The buyer has not written anything yet.</p>
                  ) : null}
                </div>
              </div>
            </div>
            {v?.model_findings.length || v?.model_id ? (
              <div className="mt-4">
                <h3 className="text-[15px] font-bold">Differences the model reported</h3>
                {findings.length ? (
                  <ul className="mt-2 space-y-1.5">
                    {findings.map((f) => (
                      <li
                        key={f.snapshot_field_ref + f.claimed_value}
                        className="flex flex-wrap items-baseline gap-x-2 text-[15px]"
                      >
                        <span className="font-semibold">{f.attribute}</span>
                        <span>
                          listing “{f.snapshot_value}”, buyer reports “{f.claimed_value}”
                        </span>
                        <span className="rounded-[2px] border border-rule px-1 text-[12px] uppercase tracking-[0.05em] text-ink-2">
                          {f.severity}
                        </span>
                        <Mono className="text-[12.5px] text-ink-3">→ {f.snapshot_field_ref}</Mono>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-[15px] text-ink-2">{v?.model_meta?.notes ?? 'None.'}</p>
                )}
                {v?.model_meta?.dropped?.length ? (
                  <p className="mt-2 text-[13px] text-ink-2">
                    {v.model_meta.dropped.length} uncited claim{v.model_meta.dropped.length > 1 ? 's' : ''}{' '}
                    dropped: {v.model_meta.dropped.map((x) => x.why).join('; ')}
                  </p>
                ) : null}
                <p className="mt-2 text-[12.5px] text-ink-3">
                  Model <Mono className="text-[12.5px]">{v?.model_id}</Mono> reports structured differences
                  only; it cannot choose the verdict. Prompt{' '}
                  <Mono className="text-[12.5px]">{shortHash(v?.prompt_hash)}</Mono>
                </p>
              </div>
            ) : null}
          </Part>

          {v ? (
            <Part title="Why this verdict" id="why">
              <ol className="space-y-2.5">
                {v.reasons.map((r) => (
                  <li
                    key={r.text}
                    className="grid grid-cols-[1fr_auto] gap-x-4 border-b border-rule pb-2 text-[15.5px] leading-snug"
                  >
                    <span>{r.text}</span>
                    <Mono className="self-start text-[12.5px] text-ink-3">{r.ref}</Mono>
                  </li>
                ))}
              </ol>
            </Part>
          ) : null}

          {v ? (
            <Part
              title="Checks"
              aside={`${v.rule_results.filter((r) => r.passed && !r.skipped).length} passed · ${v.rule_results.filter((r) => !r.passed && !r.skipped).length} failed · ${v.rule_results.filter((r) => r.skipped).length} not applicable`}
              id="checks"
            >
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                {RULE_GROUPS.map((g) => {
                  const rs = g.rules
                    .map((name) => v.rule_results.find((r) => r.rule === name))
                    .filter(Boolean) as RuleResult[];
                  return (
                    <div key={g.title}>
                      <h3 className="field-label mb-2">{g.title}</h3>
                      {rs.length ? (
                        <ul className="space-y-2.5">
                          {rs.map((r) => (
                            <li key={r.rule} className="flex gap-2">
                              <RuleIcon r={r} />
                              <div>
                                <div
                                  className={`text-[14.5px] font-semibold leading-snug ${!r.passed && !r.skipped ? 'text-tape' : ''}`}
                                >
                                  {RULE_NAME[r.rule] ?? r.rule}
                                </div>
                                <div className="text-[13px] leading-snug text-ink-2 [overflow-wrap:anywhere]">
                                  {r.detail}
                                </div>
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[14px] text-ink-3">
                          Not checked: the evidence could not be trusted.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </Part>
          ) : null}

          {bundle ? (
            <Part
              title="The signed mandate"
              aside={`user ${bundle.user_ref} · agent ${bundle.agent.platform_id} ${bundle.agent.agent_version}`}
              id="mandate"
            >
              <blockquote className="mb-4 text-[19px] leading-snug">
                “{bundle.intent_mandate.text}”
              </blockquote>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-3">
                <Field label="Spending cap" mono>
                  {money(bundle.intent_mandate.max_amount)}
                </Field>
                <Field label="Ask me above" mono>
                  {money(bundle.intent_mandate.confirm_above)}
                </Field>
                <Field label="Valid until">{when(bundle.intent_mandate.expires_at)}</Field>
                <Field label="Categories">
                  {bundle.intent_mandate.allowed_categories.join(', ') || 'any'}
                </Field>
                <Field label="Merchants">{bundle.intent_mandate.allowed_merchants.join(', ') || 'any'}</Field>
                <Field label="User confirmation">
                  {bundle.user_confirmation
                    ? `${money(bundle.user_confirmation.amount)} at ${when(bundle.user_confirmation.given_at)}`
                    : 'none given'}
                </Field>
                <Field label="Approved cart" mono>
                  {bundle.cart.map((c) => `${c.qty}× ${c.sku} ${money(c.unit_price)}`).join(', ')}
                </Field>
                <Field label="Charged by PayPal" mono>
                  {money(bundle.captured_amount)}
                </Field>
                <Field label="What was packed" mono>
                  {bundle.fulfilment?.shipped_items?.map((s) => s.sku).join(', ') ?? 'not recorded'}
                </Field>
              </div>
              <h3 className="mt-6 text-[15px] font-bold">How the agent decided</h3>
              <ol className="mt-2 space-y-1.5 text-[14.5px]">
                {bundle.decision_trace.map((s) => (
                  <li key={s.at + s.step} className="grid grid-cols-1 gap-x-3 sm:grid-cols-[130px_1fr]">
                    <Mono className="text-[12.5px] text-ink-3">{s.step}</Mono>
                    <span className="leading-snug">{s.detail}</span>
                  </li>
                ))}
              </ol>
            </Part>
          ) : null}

          <Part title="Custody log" aside={`${log.length} entries`} id="custody">
            <ol className="relative">
              {log.map((e) => (
                <li
                  key={`${e.at}-${e.who}-${e.what}`}
                  className="grid grid-cols-1 gap-x-3 border-b border-rule py-2 text-[14px] sm:grid-cols-[150px_150px_1fr]"
                >
                  <Mono className="text-[12.5px] text-ink-2">{when(e.at)}</Mono>
                  <span className="font-semibold">{e.who}</span>
                  <span className="leading-snug">{e.what}</span>
                </li>
              ))}
            </ol>
          </Part>
        </div>

        <aside className="order-first space-y-6 xl:sticky xl:top-20 xl:order-none xl:self-start">
          {v ? (
            <Decision
              disputeId={d.id}
              verdict={v}
              disputeAmount={d.amount ? (Number(d.amount.value) / 2).toFixed(2) : '0.00'}
            />
          ) : (
            <div className="border-2 border-dashed border-ink-3 px-5 py-6 text-[15px] text-ink-2">
              Not judged yet. The verdict appears once the evidence has been checked.
            </div>
          )}

          <div className="border border-rule bg-paper-2 px-5 py-4">
            <div className="field-label">Integrity proof</div>
            {bundle && verify ? (
              <dl className="mt-2 space-y-2 text-[13px]">
                <div>
                  <dt className="text-ink-3">Bundle hash</dt>
                  <dd className="break-all font-mono text-[12px]">{bundle.hash}</dd>
                </div>
                <div>
                  <dt className="text-ink-3">Previous ledger entry</dt>
                  <dd className="break-all font-mono text-[12px]">{bundle.prev_hash}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-3">Chain position</dt>
                  <dd className="font-mono">#{verify.chain_position}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-3">Checks</dt>
                  <dd className={verify.ok ? 'text-v-within' : 'text-tape'}>
                    {verify.checks.filter((c) => c.ok).length}/{verify.checks.length} pass
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-3">Linked by</dt>
                  <dd>{d.link_basis}</dd>
                </div>
              </dl>
            ) : (
              <p className="mt-2 text-[14px] text-ink-2">
                No bundle linked: {d.link_basis ?? 'unknown transaction'}.
              </p>
            )}
            <div className="mt-4 flex flex-col gap-2 text-[14px]">
              {v ? (
                <a
                  href={`/api/v1/disputes/${d.id}/report.pdf`}
                  className="flex items-center gap-2 font-semibold text-ink"
                >
                  <FileDown size={16} aria-hidden /> Evidence report (PDF)
                </a>
              ) : null}
              {bundle ? (
                <>
                  <a
                    href={`${base}/v1/bundles/${bundle.bundle_id}/receipt`}
                    className="flex items-center gap-2 text-ink"
                  >
                    <ScrollText size={16} aria-hidden /> Buyer’s mandate receipt
                  </a>
                  <Link href={`/bundles/${bundle.bundle_id}`} className="font-mono text-[12.5px] text-ink-2">
                    {bundle.bundle_id}
                  </Link>
                </>
              ) : null}
            </div>
          </div>
        </aside>
      </div>
    </article>
  );
}
