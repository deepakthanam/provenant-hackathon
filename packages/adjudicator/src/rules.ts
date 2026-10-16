import { cartTotal, type EvidenceBundle, type Money, type RuleResult, toMinor } from '@provenant/schemas';
import type { AdjudicationInput } from './types';

const pass = (rule: string, detail: string, field_ref?: string): RuleResult => ({
  rule,
  passed: true,
  skipped: false,
  detail,
  field_ref,
});
const fail = (rule: string, detail: string, field_ref?: string): RuleResult => ({
  rule,
  passed: false,
  skipped: false,
  detail,
  field_ref,
});
const skip = (rule: string, detail: string, field_ref?: string): RuleResult => ({
  rule,
  passed: true,
  skipped: true,
  detail,
  field_ref,
});
const $ = (m: Money | null | undefined) => (m ? `${m.currency} ${m.value}` : '—');
const DAY = 86_400_000;

/** Step 1 — can the bundle be trusted, and is it the bundle for this dispute? */
export function integrityRules(input: AdjudicationInput): RuleResult[] {
  const { bundle, verify, dispute, link } = input;
  const tx = dispute.disputed_transactions?.[0];
  const out: RuleResult[] = [];
  if (!bundle) {
    out.push(fail('bundle_present', `no evidence bundle linked (${link.basis})`));
    return out;
  }
  out.push(pass('bundle_present', `bundle ${bundle.bundle_id} (${link.basis})`, 'bundle_id'));
  if (!verify) out.push(fail('ledger_verified', 'verification did not run'));
  else if (verify.ok)
    out.push(
      pass(
        'ledger_verified',
        `${verify.events} signed ledger entries verify; head ${verify.head_hash}`,
        'hash',
      ),
    );
  else out.push(fail('ledger_verified', verify.failures.join('; '), 'hash'));

  const sigCheck = verify?.checks.find((c) => c.check === 'mandate_user_signature');
  if (sigCheck) {
    out.push(
      sigCheck.ok
        ? pass('mandate_signature_valid', 'user signature on the mandate verifies', 'intent_mandate.user_sig')
        : fail(
            'mandate_signature_valid',
            'user signature on the mandate does not verify',
            'intent_mandate.user_sig',
          ),
    );
  }

  if (!tx?.seller_transaction_id)
    out.push(fail('transaction_matches_capture', 'dispute names no seller transaction'));
  else if (bundle.paypal_capture_id === tx.seller_transaction_id) {
    out.push(
      pass(
        'transaction_matches_capture',
        `disputed transaction ${tx.seller_transaction_id} is the bundle's capture`,
        'paypal_capture_id',
      ),
    );
  } else {
    out.push(
      fail(
        'transaction_matches_capture',
        `disputed ${tx.seller_transaction_id} ≠ bundle capture ${bundle.paypal_capture_id ?? '(none)'}`,
        'paypal_capture_id',
      ),
    );
  }
  if (tx?.custom === undefined)
    out.push(skip('custom_id_matches', 'PayPal did not report custom_id on the transaction'));
  else if (tx.custom === bundle.bundle_id)
    out.push(pass('custom_id_matches', 'transaction custom_id is this bundle', 'bundle_id'));
  else
    out.push(
      fail('custom_id_matches', `transaction custom_id ${tx.custom} ≠ ${bundle.bundle_id}`, 'bundle_id'),
    );

  const captured = bundle.captured_amount;
  const disputed = { value: dispute.dispute_amount.value, currency: dispute.dispute_amount.currency_code };
  if (captured && captured.currency === disputed.currency && toMinor(disputed) <= toMinor(captured)) {
    out.push(
      pass(
        'dispute_amount_within_capture',
        `disputed ${$(disputed)} ≤ captured ${$(captured)}`,
        'captured_amount',
      ),
    );
  } else {
    out.push(
      fail(
        'dispute_amount_within_capture',
        `disputed ${$(disputed)} vs captured ${$(captured)}`,
        'captured_amount',
      ),
    );
  }
  return out;
}

function chargedAmount(b: EvidenceBundle): Money {
  return b.captured_amount ?? cartTotal(b.cart);
}

/** Step 2 — did the agent stay inside what the user signed? */
export function mandateRules(bundle: EvidenceBundle, confirmationSigValid: boolean | null): RuleResult[] {
  const m = bundle.intent_mandate;
  const charged = chargedAmount(bundle);
  const out: RuleResult[] = [];

  if (charged.currency !== m.max_amount.currency)
    out.push(
      fail(
        'within_max_amount',
        `charged in ${charged.currency}, mandate in ${m.max_amount.currency}`,
        'intent_mandate.max_amount',
      ),
    );
  else if (toMinor(charged) <= toMinor(m.max_amount))
    out.push(
      pass(
        'within_max_amount',
        `charged ${$(charged)} ≤ cap ${$(m.max_amount)}`,
        'intent_mandate.max_amount',
      ),
    );
  else
    out.push(
      fail(
        'within_max_amount',
        `charged ${$(charged)} > cap ${$(m.max_amount)}`,
        'intent_mandate.max_amount',
      ),
    );

  const badCats = bundle.cart.filter((i) => !m.allowed_categories.includes(i.category));
  out.push(
    badCats.length === 0
      ? pass(
          'category_allowed',
          `cart categories ⊆ {${m.allowed_categories.join(', ')}}`,
          'intent_mandate.allowed_categories',
        )
      : fail(
          'category_allowed',
          `${badCats.map((i) => `${i.sku} is ${i.category}`).join(', ')}; allowed {${m.allowed_categories.join(', ')}}`,
          'intent_mandate.allowed_categories',
        ),
  );

  const merchant = bundle.offer_snapshot?.merchant_id ?? null;
  if (m.allowed_merchants.length === 0)
    out.push(skip('merchant_allowed', 'mandate allows any merchant', 'intent_mandate.allowed_merchants'));
  else if (merchant && m.allowed_merchants.includes(merchant))
    out.push(pass('merchant_allowed', `${merchant} is allowed`, 'intent_mandate.allowed_merchants'));
  else
    out.push(
      fail(
        'merchant_allowed',
        `${merchant ?? 'unknown merchant'} not in {${m.allowed_merchants.join(', ')}}`,
        'intent_mandate.allowed_merchants',
      ),
    );

  if (!m.confirm_above || toMinor(charged) <= toMinor(m.confirm_above)) {
    out.push(
      skip(
        'confirmation_present',
        `no confirmation needed (charged ${$(charged)} ≤ ask-me ${$(m.confirm_above)})`,
        'intent_mandate.confirm_above',
      ),
    );
  } else if (!bundle.user_confirmation) {
    out.push(
      fail(
        'confirmation_present',
        `charged ${$(charged)} > ask-me ${$(m.confirm_above)} and the user never confirmed`,
        'user_confirmation',
      ),
    );
  } else if (confirmationSigValid === false) {
    out.push(fail('confirmation_present', 'confirmation signature does not verify', 'user_confirmation.sig'));
  } else if (toMinor(bundle.user_confirmation.amount) < toMinor(charged)) {
    out.push(
      fail(
        'confirmation_present',
        `user confirmed ${$(bundle.user_confirmation.amount)} but was charged ${$(charged)}`,
        'user_confirmation.amount',
      ),
    );
  } else {
    out.push(
      pass(
        'confirmation_present',
        `user confirmed ${$(bundle.user_confirmation.amount)} at ${bundle.user_confirmation.given_at}`,
        'user_confirmation',
      ),
    );
  }

  const orderedAt = bundle.sealed_at ?? bundle.created_at;
  out.push(
    Date.parse(orderedAt) <= Date.parse(m.expires_at)
      ? pass(
          'mandate_not_expired',
          `ordered ${orderedAt}, mandate valid until ${m.expires_at}`,
          'intent_mandate.expires_at',
        )
      : fail(
          'mandate_not_expired',
          `ordered ${orderedAt}, after the mandate expired ${m.expires_at}`,
          'intent_mandate.expires_at',
        ),
  );

  const total = cartTotal(bundle.cart);
  if (!bundle.captured_amount)
    out.push(skip('captured_equals_cart', 'no capture recorded', 'captured_amount'));
  else if (toMinor(bundle.captured_amount) === toMinor(total))
    out.push(
      pass(
        'captured_equals_cart',
        `captured ${$(bundle.captured_amount)} = approved cart ${$(total)}`,
        'cart',
      ),
    );
  else
    out.push(
      fail(
        'captured_equals_cart',
        `captured ${$(bundle.captured_amount)} ≠ approved cart ${$(total)}`,
        'cart',
      ),
    );
  return out;
}

/** Step 3 — was it shipped, delivered, on time, and was it the item in the cart? */
export function deliveryRules(bundle: EvidenceBundle): RuleResult[] {
  const f = bundle.fulfilment;
  const out: RuleResult[] = [];
  if (!f || f.status === 'NOT_SHIPPED') {
    out.push(fail('shipped', 'merchant never recorded a shipment', 'fulfilment'));
    out.push(fail('tracking_present', 'no tracking number', 'fulfilment.tracking_number'));
    return out;
  }
  out.push(pass('shipped', `${f.carrier} shipment, status ${f.status}`, 'fulfilment.status'));
  out.push(pass('tracking_present', `${f.carrier} ${f.tracking_number}`, 'fulfilment.tracking_number'));
  if (f.status === 'DELIVERED' && f.delivered_at)
    out.push(pass('delivered', `delivered ${f.delivered_at}`, 'fulfilment.delivered_at'));
  else out.push(fail('delivered', `status ${f.status}, not delivered`, 'fulfilment.status'));

  const promise = bundle.offer_snapshot?.delivery_promise;
  const orderedAt = Date.parse(bundle.sealed_at ?? bundle.created_at);
  if (promise && f.delivered_at) {
    const days = (Date.parse(f.delivered_at) - orderedAt) / DAY;
    out.push(
      days <= promise.max_days + 1
        ? pass(
            'delivered_within_window',
            `delivered after ${days.toFixed(1)} days; promised ${promise.min_days}–${promise.max_days}`,
            'offer_snapshot.delivery_promise',
          )
        : fail(
            'delivered_within_window',
            `delivered after ${days.toFixed(1)} days; promised ≤ ${promise.max_days}`,
            'offer_snapshot.delivery_promise',
          ),
    );
  } else if (promise) {
    const overdue = (Date.now() - orderedAt) / DAY > promise.max_days + 1;
    out.push(
      overdue
        ? fail(
            'delivered_within_window',
            `not delivered and past the ${promise.max_days}-day promise`,
            'offer_snapshot.delivery_promise',
          )
        : skip(
            'delivered_within_window',
            'still inside the promised window',
            'offer_snapshot.delivery_promise',
          ),
    );
  }

  if (!f.shipped_items)
    out.push(
      skip('shipped_items_match_cart', 'merchant did not record what was packed', 'fulfilment.shipped_items'),
    );
  else {
    const cartSkus = bundle.cart.map((i) => i.sku).sort();
    const shipped = f.shipped_items.map((i) => i.sku).sort();
    const same = cartSkus.length === shipped.length && cartSkus.every((s, i) => s === shipped[i]);
    out.push(
      same
        ? pass('shipped_items_match_cart', `shipped ${shipped.join(', ')} = cart`, 'fulfilment.shipped_items')
        : fail(
            'shipped_items_match_cart',
            `cart ${cartSkus.join(', ')} but shipped ${shipped.join(', ')} (${f.shipped_items
              .map((i) =>
                Object.entries(i.attributes)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(' '),
              )
              .join('; ')})`,
            'fulfilment.shipped_items',
          ),
    );
  }
  return out;
}
