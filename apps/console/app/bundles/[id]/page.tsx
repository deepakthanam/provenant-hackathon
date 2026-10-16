import { CircleCheck, CircleX, ScrollText } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { Field, Mono, Part } from '@/components/form';
import { TamperTape } from '@/components/tamper-tape';
import { api, apiBase, apiOrNull } from '@/lib/api';
import { money, when } from '@/lib/format';
import type { Bundle, VerifyResult } from '@/lib/types';

export default async function BundlePage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const b = await apiOrNull<Bundle>(`/v1/bundles/${encodeURIComponent(id)}`);
  if (!b) notFound();
  const verify = await api<VerifyResult>(`/v1/bundles/${b.bundle_id}/verify`);
  const base = apiBase();
  const s = b.offer_snapshot;

  return (
    <article>
      <nav className="mb-4 text-[14px]">
        <Link href="/bundles" className="text-ink-2 hover:text-ink">
          Evidence bundles
        </Link>
        <span className="text-ink-3"> / {b.bundle_id}</span>
      </nav>
      <h1 className="font-mono text-[30px] font-semibold tracking-[-0.01em]">{b.bundle_id}</h1>
      <p className="mt-2 text-[16px] text-ink-2">
        {b.status.toLowerCase()} · PayPal order{' '}
        <Mono className="text-ink">{b.paypal_order_id ?? 'not sealed'}</Mono> · capture{' '}
        <Mono className="text-ink">{b.paypal_capture_id ?? '—'}</Mono>
      </p>
      <div className="mt-6">
        <TamperTape verify={verify} />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-10 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0">
          <Part title="Mandate" aside={`signed by ${b.user_ref}`} id="mandate">
            <blockquote className="mb-4 text-[19px] leading-snug">“{b.intent_mandate.text}”</blockquote>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-3">
              <Field label="Spending cap" mono>
                {money(b.intent_mandate.max_amount)}
              </Field>
              <Field label="Ask me above" mono>
                {money(b.intent_mandate.confirm_above)}
              </Field>
              <Field label="Valid until">{when(b.intent_mandate.expires_at)}</Field>
              <Field label="Categories">{b.intent_mandate.allowed_categories.join(', ')}</Field>
              <Field label="Merchants">{b.intent_mandate.allowed_merchants.join(', ') || 'any'}</Field>
              <Field label="Confirmation">
                {b.user_confirmation
                  ? `${money(b.user_confirmation.amount)} at ${when(b.user_confirmation.given_at)}`
                  : 'none'}
              </Field>
            </div>
          </Part>

          {s ? (
            <Part title="Offer snapshot" aside={`captured ${when(s.captured_at)}`} id="offer">
              <div className="poly grid grid-cols-1 gap-4 p-4 md:grid-cols-[260px_1fr]">
                {s.image_sha256 ? (
                  // biome-ignore lint/performance/noImgElement: evidence image served by content hash
                  <img
                    src={`${base}/v1/blobs/${s.image_sha256}`}
                    alt={`Listing as the agent saw it: ${s.title}`}
                    className="aspect-[16/10] w-full border border-poly-edge bg-paper object-contain"
                  />
                ) : null}
                <div>
                  <div className="text-[17px] font-semibold">{s.title}</div>
                  <div className="mt-1 text-[14px] text-ink-2">
                    {Object.entries(s.attributes)
                      .map(([k, v]) => `${k} ${v}`)
                      .join(' · ')}
                  </div>
                  <div className="mt-2 font-mono text-[15px]">{money(s.price)}</div>
                  <div className="mt-1 text-[14px] text-ink-2">
                    delivery {s.delivery_promise.min_days}–{s.delivery_promise.max_days} days ·{' '}
                    {s.merchant_id}
                  </div>
                </div>
              </div>
            </Part>
          ) : null}

          <Part title="Cart, charge and shipment" id="cart">
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-3">
              <Field label="Approved cart" mono>
                {b.cart.map((c) => `${c.qty}× ${c.sku} ${money(c.unit_price)}`).join(', ') || '—'}
              </Field>
              <Field label="Charged by PayPal" mono>
                {money(b.captured_amount)}
              </Field>
              <Field label="Shipment">
                {b.fulfilment
                  ? `${b.fulfilment.carrier} ${b.fulfilment.tracking_number} · ${b.fulfilment.status.toLowerCase()}`
                  : 'not shipped'}
              </Field>
            </div>
          </Part>

          <Part title="Decision trace" id="trace">
            <ol className="space-y-1.5 text-[14.5px]">
              {b.decision_trace.map((t) => (
                <li key={t.at + t.step} className="grid grid-cols-[130px_1fr] gap-3">
                  <Mono className="text-[12.5px] text-ink-3">{t.step}</Mono>
                  <span className="leading-snug">{t.detail}</span>
                </li>
              ))}
            </ol>
          </Part>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-20 xl:self-start">
          <div className="border-2 border-ink bg-paper">
            <div className="border-b border-rule bg-manila px-5 py-3">
              <div className="field-label">Chain verification</div>
              <div className={`mt-1 text-[19px] font-bold ${verify.ok ? 'text-v-within' : 'text-tape'}`}>
                {verify.ok
                  ? 'Every check passes'
                  : `${verify.failures.length} check${verify.failures.length > 1 ? 's' : ''} failed`}
              </div>
            </div>
            <ul className="max-h-[440px] space-y-1.5 overflow-auto px-5 py-4">
              {verify.checks.map((c) => (
                <li key={c.check} className="flex gap-2 text-[13px]">
                  {c.ok ? (
                    <CircleCheck size={16} className="mt-[1px] shrink-0 text-v-within" aria-label="pass" />
                  ) : (
                    <CircleX size={16} className="mt-[1px] shrink-0 text-tape" aria-label="fail" />
                  )}
                  <span className={c.ok ? '' : 'text-tape'}>
                    <Mono className="text-[12.5px]">{c.check}</Mono>
                    {c.detail ? <span className="text-ink-2"> · {c.detail}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
            <div className="space-y-2 border-t border-rule px-5 py-4 text-[12px]">
              <div>
                <div className="text-ink-3">Head hash</div>
                <div className="break-all font-mono">{verify.head_hash}</div>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-3">Signer key</span>
                <span className="font-mono">{verify.signer_fingerprint}</span>
              </div>
            </div>
          </div>
          <a
            href={`${base}/v1/bundles/${b.bundle_id}/receipt`}
            className="flex items-center gap-2 text-[14px] font-semibold text-ink"
          >
            <ScrollText size={16} aria-hidden /> Buyer’s mandate receipt
          </a>
        </aside>
      </div>
    </article>
  );
}
