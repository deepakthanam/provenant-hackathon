import { describe, expect, it } from 'vitest';
import { pdfSafe, REPORT_SECTIONS, renderEvidenceReport } from '../src/report';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPj/HwADAgH/eL9GtQAAAABJRU5ErkJggg==',
  'base64',
);

/** Text in an uncompressed pdfkit PDF is written as hex strings inside TJ arrays. */
function extractText(pdf: Buffer): string {
  const body = pdf.toString('latin1');
  return [...body.matchAll(/<([0-9a-fA-F]+)>/g)]
    .map((m) => Buffer.from(m[1]!, 'hex').toString('latin1'))
    .join('');
}

describe('evidence report', () => {
  it('renders a PDF containing every section', async () => {
    const pdf = await renderEvidenceReport({
      compress: false,
      generatedAt: '2026-10-16T12:00:00Z',
      dispute: {
        id: 'PP-D-1',
        reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
        status: 'WAITING_FOR_SELLER_RESPONSE',
        stage: 'INQUIRY',
        amount: { value: '84.00', currency: 'USD' },
        transactionId: 'CAP1',
        createdAt: '2026-10-15T10:00:00Z',
      },
      verdict: {
        code: 'WITHIN_MANDATE',
        confidence: 0.87,
        reasons: [{ text: 'charged USD 84.00 ≤ cap USD 90.00', ref: 'intent_mandate.max_amount' }],
        ruleResults: [{ rule: 'within_max_amount', passed: true, skipped: false, detail: 'ok' }],
        findings: [],
        modelId: 'mock-deterministic-v1',
        plannedAction: {
          kind: 'provide_evidence',
          link_rel: 'provide_evidence',
          available: true,
          request: {},
          refund_amount: null,
          liability: null,
          explanation: 'submit the report',
        },
      },
      bundle: null,
      verify: null,
      snapshotImage: PNG,
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.subarray(-6).toString()).toContain('%%EOF');
    const text = extractText(pdf);
    for (const s of REPORT_SECTIONS) expect(text, s).toContain(s);
    expect(text).toContain('WITHIN MANDATE');
    expect(text).toContain('<= cap');
  });

  it('maps symbols the standard fonts cannot draw', () => {
    expect(pdfSafe('blue ≠ black → ✓ 日本')).toBe('blue != black -> OK ??');
  });
});
