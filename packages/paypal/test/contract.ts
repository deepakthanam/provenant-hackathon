import { describe, expect, it } from 'vitest';
import type { MockBuyer } from '../src/buyer';
import type { PayPalClient } from '../src/client';
import { PayPalError } from '../src/errors';
import { DisputeRel, hasLink } from '../src/links';
import type { Order } from '../src/types';

export interface ContractTarget {
  name: string;
  client: () => PayPalClient;
  /** Buyer simulation; null for the real sandbox (no programmatic buyer approval). */
  buyer: () => MockBuyer | null;
  /** Known at collection time so buyer-dependent tests can be skipped up front. */
  hasBuyer: boolean;
  /** Waits for webhooks/state to settle (no-op for sandbox). */
  settle?: () => Promise<void>;
  skip?: boolean;
}

const usd = (value: string) => ({ currency_code: 'USD', value });

/** One behavioural suite, run against every PayPalClient implementation. */
export function contractSuite(t: ContractTarget): void {
  describe.skipIf(t.skip)(`PayPalClient contract: ${t.name}`, () => {
    const pp = () => t.client();

    async function capturedOrder(customId: string): Promise<{ order: Order; captureId: string }> {
      const order = await pp().createOrder({
        custom_id: customId,
        amount: usd('84.00'),
        items: [
          {
            name: 'Trail runner',
            quantity: '1',
            unit_amount: usd('84.00'),
            sku: 'RUN-BLK-10',
            category: 'PHYSICAL_GOODS',
          },
        ],
      });
      await t.buyer()!.approveOrder(order.id);
      const done = await pp().captureOrder(order.id);
      const captureId = done.purchase_units?.[0]?.payments?.captures?.[0]?.id;
      expect(captureId).toBeTruthy();
      return { order: done, captureId: captureId! };
    }

    it('creates an order carrying custom_id and reads it back', async () => {
      const order = await pp().createOrder({ custom_id: 'apb_CONTRACT1', amount: usd('12.50') });
      expect(order.id).toMatch(/^[A-Z0-9]{10,}$/);
      const read = await pp().getOrder(order.id);
      expect(read.purchase_units?.[0]?.custom_id).toBe('apb_CONTRACT1');
      expect(read.purchase_units?.[0]?.amount?.value).toBe('12.50');
    });

    it('patches custom_id onto an existing order', async () => {
      const order = await pp().createOrder({ amount: usd('5.00') });
      await pp().setOrderCustomId(order.id, 'apb_PATCHED');
      expect((await pp().getOrder(order.id)).purchase_units?.[0]?.custom_id).toBe('apb_PATCHED');
    });

    it('refuses to capture an order the payer has not approved', async () => {
      const order = await pp().createOrder({ amount: usd('5.00') });
      const err = await pp()
        .captureOrder(order.id)
        .catch((e) => e);
      expect(err).toBeInstanceOf(PayPalError);
      expect(err.status).toBe(422);
      expect(JSON.stringify(err.details)).toContain('ORDER_NOT_APPROVED');
    });

    it('returns a typed 404 for an unknown dispute', async () => {
      const err = await pp()
        .getDispute('PP-D-000000000')
        .catch((e) => e);
      expect(err).toBeInstanceOf(PayPalError);
      expect([404, 422, 400]).toContain(err.status);
    });

    it('lists disputes', async () => {
      const r = await pp().listDisputes({ page_size: 5 });
      expect(Array.isArray(r.items)).toBe(true);
    });

    describe.skipIf(!t.hasBuyer)('with buyer simulation', () => {
      it('captures with custom_id on the capture and accepts tracking', async () => {
        const { order, captureId } = await capturedOrder('apb_CAPTURE');
        expect(order.status).toBe('COMPLETED');
        expect(order.purchase_units?.[0]?.payments?.captures?.[0]?.custom_id).toBe('apb_CAPTURE');
        const tracked = await pp().addTracking(order.id, {
          capture_id: captureId,
          tracking_number: '1Z999',
          carrier: 'UPS',
          notify_payer: false,
        });
        expect(tracked.id).toBe(order.id);
      });

      it('runs inquiry → evidence → under review → adjudicated for the seller', async () => {
        const { captureId } = await capturedOrder('apb_LIFECYCLE');
        const opened = await t.buyer()!.openDispute({
          capture_id: captureId,
          reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
          message: 'Changed my mind',
        });
        const d = await pp().getDispute(opened.dispute_id);
        expect(d.status).toBe('WAITING_FOR_SELLER_RESPONSE');
        expect(d.dispute_life_cycle_stage).toBe('INQUIRY');
        expect(d.disputed_transactions?.[0]?.seller_transaction_id).toBe(captureId);
        expect(d.disputed_transactions?.[0]?.custom).toBe('apb_LIFECYCLE');
        for (const rel of [
          DisputeRel.provideEvidence,
          DisputeRel.acceptClaim,
          DisputeRel.makeOffer,
          DisputeRel.sendMessage,
        ]) {
          expect(hasLink(d, rel), rel).toBe(true);
        }
        expect(hasLink(d, DisputeRel.adjudicate)).toBe(false);

        const ev = await pp().provideEvidence(d.dispute_id, {
          evidences: [{ evidence_type: 'PROOF_OF_FULFILLMENT', notes: 'Within mandate' }],
          files: [
            {
              name: 'provenant-report.pdf',
              contentType: 'application/pdf',
              bytes: Buffer.from('%PDF-1.4 test'),
            },
          ],
        });
        expect(ev.request_id).toBeTruthy();
        const review = await pp().getDispute(d.dispute_id);
        expect(review.status).toBe('UNDER_REVIEW');
        expect(hasLink(review, DisputeRel.provideEvidence)).toBe(false);
        expect(hasLink(review, DisputeRel.adjudicate)).toBe(true);

        await pp().sandboxAdjudicate(d.dispute_id, 'SELLER_FAVOR');
        const done = await pp().getDispute(d.dispute_id);
        expect(done.status).toBe('RESOLVED');
        expect(done.dispute_outcome?.outcome_code).toBe('RESOLVED_SELLER_FAVOUR');
      });

      it('rejects an action whose HATEOAS link is absent', async () => {
        const { captureId } = await capturedOrder('apb_NOLINK');
        const d = await t.buyer()!.openDispute({
          capture_id: captureId,
          reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
          message: 'Where is it?',
        });
        await pp().acceptClaim(d.dispute_id, { note: 'Refunding', accept_claim_type: 'REFUND' });
        const err = await pp()
          .provideEvidence(d.dispute_id, { evidences: [{ evidence_type: 'OTHER', notes: 'late' }] })
          .catch((e) => e);
        expect(err).toBeInstanceOf(PayPalError);
        expect(err.status).toBe(422);
        const resolved = await pp().getDispute(d.dispute_id);
        expect(resolved.dispute_outcome?.outcome_code).toBe('RESOLVED_BUYER_FAVOUR');
        expect(resolved.dispute_outcome?.amount_refunded?.value).toBe('84.00');
      });

      it('makes a partial-refund offer at INQUIRY that the buyer accepts', async () => {
        const { captureId } = await capturedOrder('apb_OFFER');
        const d = await t.buyer()!.openDispute({
          capture_id: captureId,
          reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
          message: 'Wanted road shoes',
        });
        expect(d.allowed_response_options?.make_offer?.offer_types).toContain('REFUND');
        await pp().makeOffer(d.dispute_id, {
          note: 'Half back',
          offer_type: 'REFUND',
          offer_amount: usd('42.00'),
        });
        const waiting = await pp().getDispute(d.dispute_id);
        expect(waiting.status).toBe('WAITING_FOR_BUYER_RESPONSE');
        expect(waiting.offer?.seller_offered_amount?.value).toBe('42.00');
        await t.buyer()!.acceptOffer(d.dispute_id);
        const done = await pp().getDispute(d.dispute_id);
        expect(done.status).toBe('RESOLVED');
        expect(done.dispute_outcome?.amount_refunded?.value).toBe('42.00');
      });

      it('moves to CHARGEBACK on escalation, where offers vanish and supporting info appears', async () => {
        const { captureId } = await capturedOrder('apb_ESC');
        const d = await t.buyer()!.openDispute({
          capture_id: captureId,
          reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
          message: 'x',
        });
        await t.buyer()!.escalate(d.dispute_id);
        const c = await pp().getDispute(d.dispute_id);
        expect(c.dispute_life_cycle_stage).toBe('CHARGEBACK');
        expect(hasLink(c, DisputeRel.makeOffer)).toBe(false);
        expect(hasLink(c, DisputeRel.sendMessage)).toBe(false);
        expect(hasLink(c, DisputeRel.provideSupportingInfo)).toBe(true);
        expect(c.allowed_response_options?.accept_claim?.accept_claim_types).not.toContain('PARTIAL_REFUND');
        await pp().provideSupportingInfo(c.dispute_id, { notes: 'Mandate attached' });
        expect((await pp().getDispute(c.dispute_id)).supporting_info?.[0]?.notes).toBe('Mandate attached');
      });

      it('picks up changes with update_time_after', async () => {
        const before = new Date(Date.now() - 1).toISOString();
        const { captureId } = await capturedOrder('apb_POLL');
        const d = await t.buyer()!.openDispute({
          capture_id: captureId,
          reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
          message: 'Nothing came',
        });
        const r = await pp().listDisputes({ update_time_after: before, page_size: 50 });
        expect(r.items.map((i) => i.dispute_id)).toContain(d.dispute_id);
        const later = await pp().listDisputes({
          update_time_after: (await pp().getDispute(d.dispute_id)).update_time,
          page_size: 50,
        });
        expect(later.items.map((i) => i.dispute_id)).not.toContain(d.dispute_id);
      });

      it('serves buyer evidence documents', async () => {
        const { captureId } = await capturedOrder('apb_DOCS');
        const png = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPj/HwADAgH/eL9GtQAAAABJRU5ErkJggg==',
          'base64',
        );
        const d = await t.buyer()!.openDispute({
          capture_id: captureId,
          reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
          message: 'It is blue',
          documents: [{ name: 'what-arrived.png', contentType: 'image/png', bytes: png }],
        });
        const url = (await pp().getDispute(d.dispute_id)).evidences?.[0]?.documents?.[0]?.url;
        expect(url).toBeTruthy();
        const doc = await pp().downloadDocument(url!);
        expect(Buffer.from(doc.bytes).equals(png)).toBe(true);
        expect(doc.contentType).toContain('image/png');
      });
    });
  });
}
