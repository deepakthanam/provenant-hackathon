import type { BundleRecord, BundleStore } from '@provenant/evidence';
import type { PayPalClient } from '@provenant/paypal';
import { HttpError } from './errors';

/**
 * Records a bundle's capture from PayPal's own data, never from the caller's claim: re-reads the
 * sealed order, finds the COMPLETED capture, checks its custom_id is this bundle, and stores the
 * amount PayPal actually captured. Idempotent. Used by the capture route and the
 * PAYMENT.CAPTURE.COMPLETED webhook.
 */
export async function syncCapture(
  store: BundleStore,
  paypal: PayPalClient,
  bundleId: string,
  captureId?: string,
): Promise<BundleRecord> {
  const rec = await store.get(bundleId);
  if (!rec) throw new HttpError(404, 'NOT_FOUND', `bundle ${bundleId} not found`);
  const orderId = rec.bundle.paypal_order_id;
  if (!orderId) throw new HttpError(409, 'INVALID_STATE', 'bundle is not sealed to a PayPal order');
  if (rec.bundle.paypal_capture_id && (!captureId || rec.bundle.paypal_capture_id === captureId)) return rec;

  const order = await paypal.getOrder(orderId);
  const pu = order.purchase_units?.[0];
  const captures = pu?.payments?.captures ?? [];
  const capture = captureId
    ? captures.find((c) => c.id === captureId)
    : captures.find((c) => c.status === 'COMPLETED');
  if (!capture)
    throw new HttpError(409, 'CAPTURE_NOT_FOUND', `PayPal order ${orderId} has no matching capture`);
  if (capture.status !== 'COMPLETED')
    throw new HttpError(409, 'CAPTURE_NOT_COMPLETED', `capture ${capture.id} is ${capture.status}`);
  const customId = capture.custom_id ?? pu?.custom_id;
  if (customId !== bundleId) {
    throw new HttpError(
      409,
      'CUSTOM_ID_MISMATCH',
      `order ${orderId} carries custom_id ${customId ?? '(none)'}, not ${bundleId}`,
    );
  }
  if (rec.bundle.paypal_capture_id && rec.bundle.paypal_capture_id !== capture.id) {
    throw new HttpError(409, 'CONFLICT', `bundle already has capture ${rec.bundle.paypal_capture_id}`);
  }
  return store.recordCapture(bundleId, capture.id, {
    value: capture.amount.value,
    currency: capture.amount.currency_code,
  });
}
