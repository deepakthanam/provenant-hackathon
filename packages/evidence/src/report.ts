import {
  cartTotal,
  type EvidenceBundle,
  type ModelDifference,
  type Money,
  type PlannedAction,
  type RuleResult,
  type VerifyResult,
} from '@provenant/schemas';
import PDFDocument from 'pdfkit';

export interface ReportInput {
  dispute: {
    id: string;
    reason: string;
    status: string;
    stage: string | null;
    amount: Money | null;
    transactionId: string | null;
    createdAt: string | null;
  };
  verdict: {
    code: string;
    confidence: number;
    reasons: Array<{ text: string; ref: string }>;
    ruleResults: RuleResult[];
    findings: ModelDifference[];
    modelId: string | null;
    plannedAction: PlannedAction;
  };
  bundle: EvidenceBundle | null;
  verify: VerifyResult | null;
  /** The offer image as the agent saw it (PNG/JPEG bytes). */
  snapshotImage: Uint8Array | null;
  generatedAt: string;
  /** For tests: uncompressed streams make the text searchable. */
  compress?: boolean;
}

/** The section titles, in order (also used by tests to check every section is present). */
export const REPORT_SECTIONS = [
  'Dispute summary',
  'Verdict and reasons',
  'Mandate',
  'Approved cart vs captured amount',
  'Offer snapshot',
  'Decision trace',
  'Fulfilment',
  'Integrity proof',
] as const;

/** Standard PDF fonts cover WinAnsi only; map the symbols our rule texts use, drop the rest. */
const SYMBOLS: Record<string, string> = {
  '≠': '!=', // ≠
  '≤': '<=', // ≤
  '≥': '>=', // ≥
  '→': '->', // →
  '⊆': 'within', // ⊆
  '✓': 'OK', // ✓
  '✔': 'OK', // ✔
  '✗': 'X', // ✗
  '✘': 'X', // ✘
};
const WINANSI_EXTRA = new Set([0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2026, 0x00d7]);

export function pdfSafe(s: string): string {
  let out = '';
  for (const ch of s) {
    const mapped = SYMBOLS[ch];
    if (mapped) {
      out += mapped;
      continue;
    }
    const c = ch.codePointAt(0)!;
    const printable =
      c === 0x0a || (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WINANSI_EXTRA.has(c);
    out += printable ? ch : '?';
  }
  return out;
}

const $ = (m: Money | null | undefined) => (m ? `${m.currency} ${m.value}` : '-');

/**
 * One- to two-page evidence report for provide-evidence / provide-supporting-info: the dispute,
 * the verdict with its reasons, the signed mandate, cart vs capture, the offer snapshot (with the
 * image the agent saw), the agent's decision trace, fulfilment, and the integrity proof.
 */
export function renderEvidenceReport(r: ReportInput): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 42, bottom: 42, left: 48, right: 48 },
    compress: r.compress ?? true,
    info: {
      Title: `Provenant evidence ${r.dispute.id}`,
      Author: 'Provenant',
      Subject: 'AI-agent purchase evidence',
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const ink = '#0f172a';
  const muted = '#64748b';
  const width = doc.page.width - 96;
  const text = (s: string, opts: PDFKit.Mixins.TextOptions = {}) => doc.text(pdfSafe(s), opts);
  const heading = (title: (typeof REPORT_SECTIONS)[number]) => {
    if (doc.y > doc.page.height - 120) doc.addPage();
    doc.moveDown(0.6).font('Helvetica-Bold').fontSize(11).fillColor(ink);
    text(title);
    doc
      .moveTo(48, doc.y + 1)
      .lineTo(48 + width, doc.y + 1)
      .strokeColor('#e2e8f0')
      .stroke();
    doc.moveDown(0.3).font('Helvetica').fontSize(9).fillColor(ink);
  };
  const kv = (k: string, v: string) => {
    doc.font('Helvetica-Bold').fillColor(muted);
    text(`${k}: `, { continued: true });
    doc.font('Helvetica').fillColor(ink);
    text(v);
  };

  const b = r.bundle;
  const v = r.verdict;

  doc.font('Helvetica-Bold').fontSize(16).fillColor(ink);
  text('Provenant evidence report');
  doc.font('Helvetica').fontSize(9).fillColor(muted);
  text(`Dispute ${r.dispute.id} · generated ${r.generatedAt} · signed bundle ${b?.bundle_id ?? 'none'}`);

  heading('Dispute summary');
  kv('Reason', r.dispute.reason);
  kv('Stage / status', `${r.dispute.stage ?? '-'} / ${r.dispute.status}`);
  kv('Disputed amount', $(r.dispute.amount));
  kv('Disputed transaction (capture)', r.dispute.transactionId ?? '-');
  kv('Opened', r.dispute.createdAt ?? '-');

  heading('Verdict and reasons');
  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(
      v.code === 'WITHIN_MANDATE' ? '#166534' : v.code === 'INSUFFICIENT_EVIDENCE' ? '#92400e' : '#991b1b',
    );
  text(`${v.code.replace(/_/g, ' ')}  (confidence ${v.confidence.toFixed(2)})`);
  doc.font('Helvetica').fontSize(9).fillColor(ink);
  for (const reason of v.reasons) text(`• ${reason.text}  [${reason.ref}]`, { indent: 6 });
  if (v.findings.length) {
    doc.moveDown(0.2);
    text(
      `Claim vs snapshot (${v.modelId ?? 'model'}; structured findings only, each citing a snapshot field):`,
    );
    for (const f of v.findings)
      text(
        `• ${f.attribute}: listing "${f.snapshot_value}", buyer "${f.claimed_value}" (${f.severity}) [${f.snapshot_field_ref}]`,
        { indent: 6 },
      );
  }
  doc.moveDown(0.2);
  const checks = v.ruleResults.filter((x) => !x.skipped);
  text(
    `Rule checks: ${checks.filter((x) => x.passed).length}/${checks.length} passed. ${
      v.ruleResults
        .filter((x) => !x.passed && !x.skipped)
        .map((x) => x.rule)
        .join(', ') || 'No failures.'
    }`,
  );
  text(
    `Planned PayPal action: ${v.plannedAction.kind}${v.plannedAction.available ? '' : ' (not available)'}: ${v.plannedAction.explanation}`,
  );

  heading('Mandate');
  if (b) {
    const m = b.intent_mandate;
    text(`"${m.text}"`, { oblique: true });
    kv('Spending cap', $(m.max_amount));
    kv('Ask the user above', $(m.confirm_above));
    kv('Categories', m.allowed_categories.join(', ') || 'any');
    kv('Merchants', m.allowed_merchants.join(', ') || 'any');
    kv('Valid until', m.expires_at);
    const sig = r.verify?.checks.find((c) => c.check === 'mandate_user_signature');
    kv('User signature (Ed25519)', sig ? (sig.ok ? 'verified' : 'DOES NOT VERIFY') : 'not checked');
    kv(
      'User confirmation',
      b.user_confirmation ? `${$(b.user_confirmation.amount)} at ${b.user_confirmation.given_at}` : 'none',
    );
  } else text('No evidence bundle is linked to this dispute.');

  heading('Approved cart vs captured amount');
  if (b) {
    for (const i of b.cart)
      text(`• ${i.qty} × ${i.name} (${i.sku}, ${i.category}) @ ${$(i.unit_price)}`, { indent: 6 });
    kv('Cart total', b.cart.length ? $(cartTotal(b.cart)) : '-');
    kv(
      'Captured by PayPal',
      `${$(b.captured_amount)} (capture ${b.paypal_capture_id ?? '-'}, order ${b.paypal_order_id ?? '-'})`,
    );
  }

  heading('Offer snapshot');
  const snap = b?.offer_snapshot;
  if (snap) {
    const top = doc.y;
    if (r.snapshotImage) {
      try {
        doc.image(Buffer.from(r.snapshotImage), 48, top, { fit: [150, 94] });
      } catch {
        /* unreadable image: the hash below still identifies it */
      }
    }
    doc.y = top;
    const x = r.snapshotImage ? 210 : 48;
    const w = r.snapshotImage ? width - 162 : width;
    doc.font('Helvetica-Bold').text(pdfSafe(snap.title), x, doc.y, { width: w });
    doc.font('Helvetica');
    for (const line of [
      `Price ${$(snap.price)} · delivery ${snap.delivery_promise.min_days}–${snap.delivery_promise.max_days} days`,
      Object.entries(snap.attributes)
        .map(([k, val]) => `${k}: ${val}`)
        .join(' · '),
      `Merchant ${snap.merchant_id} · ${snap.url}`,
      `Captured ${snap.captured_at}`,
      `Image sha256 ${snap.image_sha256 ?? 'none'}`,
    ]) {
      doc.text(pdfSafe(line), x, doc.y, { width: w });
    }
    doc.x = 48;
    doc.y = Math.max(doc.y, top + 100);
  }

  heading('Decision trace');
  if (b?.decision_trace.length)
    for (const s of b.decision_trace) text(`• ${s.at}  ${s.step}: ${s.detail}`, { indent: 6 });
  else text('No decision steps recorded.');

  heading('Fulfilment');
  const f = b?.fulfilment;
  if (f) {
    kv('Carrier / tracking', `${f.carrier} ${f.tracking_number}`);
    kv('Status', `${f.status}${f.delivered_at ? ` (delivered ${f.delivered_at})` : ''}`);
    kv('Shipped', f.shipped_at ?? '-');
    if (f.shipped_items)
      kv(
        'Packed items (merchant record)',
        f.shipped_items
          .map(
            (i) =>
              `${i.sku} ${Object.entries(i.attributes)
                .map(([k, val]) => `${k}=${val}`)
                .join(' ')}`,
          )
          .join('; '),
      );
  } else text('No shipment recorded.');

  heading('Integrity proof');
  if (b && r.verify) {
    kv('Bundle hash (latest ledger entry)', b.hash);
    kv('Previous ledger hash', b.prev_hash);
    kv(
      'Chain position',
      `${r.verify.chain_position ?? '-'} (${r.verify.events} signed entries for this bundle)`,
    );
    kv('Provenant signature', `${b.bundle_sig.slice(0, 40)}… (key ${r.verify.signer_fingerprint})`);
    kv(
      'Verification',
      r.verify.ok
        ? 'all hashes, signatures and chain links verify'
        : `FAILED: ${r.verify.failures.join('; ')}`,
    );
    doc.fontSize(8).fillColor(muted);
    text(
      "Every change to the bundle is an append-only ledger entry: SHA-256 over canonical JSON, chained to the previous entry of the whole ledger and signed with Provenant's Ed25519 key. Recompute with GET /v1/bundles/{id}/verify.",
    );
  } else text('No bundle to verify.');

  doc.end();
  return done;
}
