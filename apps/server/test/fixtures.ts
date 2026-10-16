import { generateKeyPairB64, signMandate } from '@provenant/evidence';
import type { MockPayPal } from '@provenant/paypal';
import type { UnsignedIntentMandate } from '@provenant/schemas';
import { bearer, type Harness } from './harness';

const user = generateKeyPairB64();
let n = 0;

/**
 * A complete agent purchase against the harness: signed mandate → offer → cart → PayPal order
 * (custom_id = bundle) → sealed → approved → captured. The capture is not yet on the bundle;
 * tests decide whether it arrives by webhook, sync or not at all.
 */
export async function purchase(h: Harness, mock: MockPayPal = h.mock, price = '84.00') {
  const userRef = `usr_fx${n++}`;
  const unsigned: UnsignedIntentMandate = {
    text: 'Buy black running shoes, size 10, under $90.',
    max_amount: { value: '90.00', currency: 'USD' },
    confirm_above: null,
    allowed_categories: ['footwear'],
    allowed_merchants: ['demo-store'],
    expires_at: '2026-11-30T00:00:00Z',
  };
  const call = async (method: 'POST' | 'PUT', url: string, payload: unknown) => {
    const res = await h.app.inject({
      method,
      url,
      headers: bearer(h.keys.platform),
      payload: payload as object,
    });
    if (res.statusCode >= 300) throw new Error(`${method} ${url} → ${res.statusCode} ${res.body}`);
    return res.json();
  };
  const b = await call('POST', '/v1/bundles', {
    user_ref: userRef,
    user_public_key: user.publicKey,
    agent_version: '0.1.0',
    intent_mandate: { ...unsigned, user_sig: signMandate(user.privateKey, userRef, unsigned) },
  });
  const id = b.bundle_id as string;
  await call('POST', `/v1/bundles/${id}/offer`, {
    merchant_id: 'demo-store',
    url: 'http://localhost:4100/p/RUN-BLK-10',
    title: 'Trail runner, black',
    attributes: { color: 'black', size: '10' },
    price: { value: price, currency: 'USD' },
    delivery_promise: { min_days: 3, max_days: 5 },
  });
  await call('PUT', `/v1/bundles/${id}/cart`, {
    cart: [
      {
        sku: 'RUN-BLK-10',
        name: 'Trail runner',
        qty: 1,
        unit_price: { value: price, currency: 'USD' },
        category: 'footwear',
      },
    ],
  });
  const order = await mock.createOrder({ custom_id: id, amount: { currency_code: 'USD', value: price } });
  await call('POST', `/v1/bundles/${id}/seal`, { paypal_order_id: order.id });
  await mock.buyerApproveOrder(order.id);
  const captured = await mock.captureOrder(order.id);
  const captureId = captured.purchase_units![0]!.payments!.captures![0]!.id;
  return { bundleId: id, orderId: order.id, captureId };
}
