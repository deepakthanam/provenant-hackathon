import { cartTotal, type EvidenceBundle, type Money, type VerifyResult } from '@provenant/schemas';

const esc = (s: unknown): string =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

const money = (m: Money | null | undefined) => (m ? `${esc(m.currency)} ${esc(m.value)}` : '—');
const when = (iso: string | null | undefined) => (iso ? esc(new Date(iso).toUTCString()) : '—');

/** Buyer-facing receipt: what the user authorised, what the agent bought, and whether the record is intact. */
export function renderReceipt(b: EvidenceBundle, v: VerifyResult): string {
  const m = b.intent_mandate;
  const o = b.offer_snapshot;
  const rows = b.cart
    .map(
      (i) =>
        `<tr><td>${esc(i.name)}<div class="muted">${esc(i.sku)} · ${esc(i.category)}</div></td><td>${i.qty}</td><td>${money(i.unit_price)}</td></tr>`,
    )
    .join('');
  const trace = b.decision_trace
    .map(
      (d) =>
        `<li><strong>${esc(d.step)}</strong> — ${esc(d.detail)} <span class="muted">${when(d.at)}</span></li>`,
    )
    .join('');
  const attrs = o
    ? Object.entries(o.attributes)
        .map(([k, val]) => `<span class="chip">${esc(k)}: ${esc(val)}</span>`)
        .join(' ')
    : '';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Purchase receipt ${esc(b.bundle_id)}</title>
<style>
  body{font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;color:#0f172a;background:#f8fafc}
  section{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:1rem 1.25rem;margin:1rem 0}
  h1{font-size:1.4rem;margin:.2rem 0} h2{font-size:1rem;margin:0 0 .5rem;color:#334155}
  .muted{color:#64748b;font-size:.85em} table{width:100%;border-collapse:collapse} td,th{padding:.35rem 0;text-align:left;border-bottom:1px solid #f1f5f9}
  .badge{display:inline-block;padding:.2rem .6rem;border-radius:99px;font-weight:600;font-size:.85rem}
  .ok{background:#dcfce7;color:#166534} .bad{background:#fee2e2;color:#991b1b}
  .chip{display:inline-block;background:#f1f5f9;border-radius:6px;padding:0 .4rem;margin:.1rem;font-size:.85em}
  code{font-size:.8em;word-break:break-all}
  dl{display:grid;grid-template-columns:max-content 1fr;gap:.25rem 1rem;margin:0} dt{color:#64748b}
</style></head><body>
<p class="muted">Provenant purchase receipt</p>
<h1>${esc(o?.title ?? 'Purchase in progress')}</h1>
<span class="badge ${v.ok ? 'ok' : 'bad'}">${v.ok ? 'Record intact and signed' : 'Integrity check failed'}</span>
<span class="badge" style="background:#e0e7ff;color:#3730a3">${esc(b.status)}</span>

<section><h2>What you authorised</h2>
<blockquote>${esc(m.text)}</blockquote>
<dl>
<dt>Spending limit</dt><dd>${money(m.max_amount)}</dd>
<dt>Ask me above</dt><dd>${money(m.confirm_above)}</dd>
<dt>Categories</dt><dd>${m.allowed_categories.map(esc).join(', ') || 'any'}</dd>
<dt>Merchants</dt><dd>${m.allowed_merchants.map(esc).join(', ') || 'any'}</dd>
<dt>Valid until</dt><dd>${when(m.expires_at)}</dd>
<dt>Your confirmation</dt><dd>${b.user_confirmation ? `given ${when(b.user_confirmation.given_at)} for ${money(b.user_confirmation.amount)}` : 'not given'}</dd>
</dl></section>

<section><h2>What the agent bought</h2>
<table><thead><tr><th>Item</th><th>Qty</th><th>Price</th></tr></thead><tbody>${rows || '<tr><td colspan="3" class="muted">No cart yet</td></tr>'}</tbody></table>
<p>Cart total <strong>${b.cart.length ? money(cartTotal(b.cart)) : '—'}</strong> · Charged <strong>${money(b.captured_amount)}</strong></p>
${o ? `<p>From <strong>${esc(o.merchant_id)}</strong> · <a href="${esc(o.url)}" rel="noopener noreferrer">listing</a> · promised in ${o.delivery_promise.min_days}–${o.delivery_promise.max_days} days</p><p>${attrs}</p>` : ''}
${o?.image_sha256 ? `<img src="/v1/blobs/${esc(o.image_sha256)}" alt="Product as shown to the agent" style="max-width:220px;border-radius:8px;border:1px solid #e2e8f0">` : ''}
</section>

<section><h2>How the agent decided</h2><ol>${trace || '<li class="muted">No steps recorded</li>'}</ol></section>

<section><h2>Delivery</h2>
${b.fulfilment ? `<p>${esc(b.fulfilment.carrier)} ${esc(b.fulfilment.tracking_number)} — <strong>${esc(b.fulfilment.status)}</strong> ${b.fulfilment.delivered_at ? `on ${when(b.fulfilment.delivered_at)}` : ''}</p>` : '<p class="muted">Not shipped yet</p>'}
</section>

<section><h2>Integrity</h2>
<dl>
<dt>Receipt id</dt><dd><code>${esc(b.bundle_id)}</code></dd>
<dt>PayPal order</dt><dd><code>${esc(b.paypal_order_id ?? '—')}</code></dd>
<dt>Record hash</dt><dd><code>${esc(b.hash)}</code></dd>
<dt>Ledger position</dt><dd>${esc(v.chain_position ?? '—')} (${v.events} signed entries)</dd>
<dt>Signed by</dt><dd><code>${esc(v.signer_fingerprint)}</code></dd>
${v.ok ? '' : `<dt>Problems</dt><dd>${v.failures.map(esc).join('<br>')}</dd>`}
</dl></section>
</body></html>`;
}
