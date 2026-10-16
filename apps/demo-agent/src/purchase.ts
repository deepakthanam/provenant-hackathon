import { join } from 'node:path';
import { type Env, findRepoRoot } from '@provenant/config';
import { createLlm, type LlmProvider } from '@provenant/llm';
import { type CartItem, cartTotal, type Fulfilment, type Money, toMinor } from '@provenant/schemas';
import { mandateForSigning, Provenant, signConfirmation, signMandate } from '@provenant/sdk';
import { fetchBytes, type Offer, searchStore, snapshotPage } from './browse';
import { createCheckout } from './checkout';
import { type Choice, choose, chooseDeterministic, evaluate } from './choose';
import { type ParsedRequest, parseDeterministic, parseRequest } from './parse';
import { loadOrCreateUser } from './users';

export const AGENT_VERSION = '0.1.0';

export interface PurchaseOptions {
  /** The shopper's words, e.g. "black running shoes size 10 under $90". */
  request: string;
  userRef?: string;
  /** Scripted mode: override what the agent understood. */
  mandateOverrides?: Partial<Pick<ParsedRequest, 'max_amount' | 'confirm_above' | 'categories'>> & {
    allowedMerchants?: string[];
    expiresAt?: string;
  };
  /** Scripted mode: buy this SKU regardless of the evaluation (simulates a misbehaving agent). */
  forceSku?: string;
  /** How a required confirmation is obtained: ask on the terminal, sign automatically, or skip it. */
  confirm?: 'prompt' | 'auto' | 'never';
  fulfil?: { ship?: boolean; deliver?: boolean };
  log?: (line: string) => void;
  /** Asked when confirm = 'prompt'. */
  askUser?: (question: string) => Promise<boolean>;
}

export interface PurchaseResult {
  bundleId: string;
  orderId: string;
  captureId: string;
  amount: Money;
  sku: string;
  customIdMatches: boolean;
  verified: boolean;
  receiptUrl: string;
  fulfilment: Fulfilment | null;
  photoUrl: string | null;
}

/** Deterministic answers for LLM_PROVIDER=mock, so the same code path runs offline. */
function agentLlm(env: Env): LlmProvider {
  return createLlm(env, {
    parse_shopping_request: (req) => {
      const text =
        (req.content[0] as { text: string }).text.match(/<request>\n([\s\S]*)\n<\/request>/)?.[1] ?? '';
      return parseDeterministic(text);
    },
    choose_offer: (req) => {
      const text = (req.content[0] as { text: string }).text;
      const offers = JSON.parse(text.match(/<offers>\n([\s\S]*)\n<\/offers>/)?.[1] ?? '[]') as Array<{
        sku: string;
        price: string;
        delivery_days: { maxDays: number };
      }>;
      const sorted = [...offers].sort(
        (a, b) => Number(a.price) - Number(b.price) || a.delivery_days.maxDays - b.delivery_days.maxDays,
      );
      return { sku: sorted[0]?.sku ?? '', rationale: `cheapest of ${offers.length} eligible offer(s)` };
    },
  });
}

/**
 * The demo shopping agent: understands the request, has the user sign a mandate, browses and
 * compares offers, records everything in Provenant, then pays through PayPal and ships.
 */
export async function runPurchase(env: Env, o: PurchaseOptions): Promise<PurchaseResult> {
  const log = o.log ?? ((s: string) => console.log(s));
  const step = (s: string) => log(`  ✓ ${s}`);
  if (!env.PROVENANT_PLATFORM_API_KEY)
    throw new Error('PROVENANT_PLATFORM_API_KEY is missing; run `pnpm bootstrap`');
  const pv = new Provenant({
    baseUrl: env.PUBLIC_BASE_URL,
    apiKey: env.PROVENANT_PLATFORM_API_KEY,
    agentVersion: AGENT_VERSION,
  });
  const llm = agentLlm(env);
  const dataDir = env.DATA_DIR ?? join(findRepoRoot(), 'data');

  // 1. Understand the request → mandate the user signs.
  const { parsed: understood } = await parseRequest(o.request, llm).catch(() => ({
    parsed: parseDeterministic(o.request),
  }));
  const parsed: ParsedRequest = { ...understood, ...o.mandateOverrides };
  if (!parsed.max_amount) throw new Error('Tell the agent a budget, e.g. "… under $90".');
  const user = loadOrCreateUser(dataDir, o.userRef ?? 'usr_demo');
  const draft = {
    text: o.request,
    maxAmount: { value: parsed.max_amount, currency: 'USD' },
    confirmAbove: parsed.confirm_above ? { value: parsed.confirm_above, currency: 'USD' } : null,
    allowedCategories: parsed.categories,
    allowedMerchants: o.mandateOverrides?.allowedMerchants ?? ['demo-store'],
    expiresAt: o.mandateOverrides?.expiresAt ?? new Date(Date.now() + 7 * 86_400_000).toISOString(),
  };
  const { bundleId } = await pv.recordMandate({
    ...draft,
    userRef: user.userRef,
    userPublicKey: user.publicKey,
    userSig: signMandate(user.privateKey, user.userRef, mandateForSigning(draft)),
  });
  step(
    `mandate signed by ${user.userRef}: cap $${draft.maxAmount.value}${draft.confirmAbove ? `, ask above $${draft.confirmAbove.value}` : ''} → bundle ${bundleId}`,
  );

  // 2. Browse and compare.
  const urls = await searchStore(env.DEMO_STORE_URL, parsed.search_query);
  const offers: Offer[] = await Promise.all(urls.map((u) => snapshotPage(u)));
  const evaluated = evaluate(offers, parsed, draft.allowedMerchants);
  await pv.recordDecision(bundleId, {
    step: 'compared_offers',
    detail: `${offers.length} candidates: ${evaluated.map((e) => `${e.offer.sku} $${e.offer.price.value} ${e.eligible ? 'eligible' : `excluded (${e.notes.join('; ')})`}`).join(' | ')}`,
  });
  step(`compared ${offers.length} offers, ${evaluated.filter((e) => e.eligible).length} eligible`);

  let choice: Choice | null;
  if (o.forceSku) {
    choice = { sku: o.forceSku, rationale: 'selected by scripted scenario' };
  } else {
    choice = await choose(evaluated, o.request, llm).catch(() => chooseDeterministic(evaluated));
  }
  const picked = choice && offers.find((x) => x.sku === choice.sku);
  if (!choice || !picked) throw new Error('No offer satisfies the mandate.');
  const pickedEval = evaluated.find((e) => e.offer.sku === picked.sku)!;
  await pv.recordDecision(bundleId, { step: 'selected_offer', detail: `${picked.sku}: ${choice.rationale}` });
  await pv.recordDecision(bundleId, {
    step: 'rule_check',
    detail: pickedEval.eligible
      ? pickedEval.notes.join('; ')
      : `proceeding despite: ${pickedEval.notes.join('; ')}`,
  });
  step(`chose ${picked.sku} "${picked.title}" at $${picked.price.value} (${choice.rationale})`);

  // 3. Snapshot exactly what was shown, image included.
  await pv.recordOffer(bundleId, {
    merchantId: picked.merchantId,
    url: picked.url,
    title: picked.title,
    attributes: picked.attributes,
    price: picked.price,
    deliveryPromise: picked.deliveryPromise,
    imageBytes: await fetchBytes(picked.imageUrl),
    imageContentType: 'image/png',
  });
  const cart: CartItem[] = [
    { sku: picked.sku, name: picked.title, qty: 1, unit_price: picked.price, category: picked.category },
  ];
  await pv.setCart(bundleId, cart);
  const total = cartTotal(cart);
  step(`offer snapshot (with image) and cart recorded: $${total.value}`);

  // 4. Confirmation above the threshold.
  if (draft.confirmAbove && toMinor(total) > toMinor(draft.confirmAbove)) {
    const mode = o.confirm ?? 'prompt';
    if (mode === 'never') {
      log(
        `  ! $${total.value} is above the $${draft.confirmAbove.value} ask-me threshold, but the agent did not ask`,
      );
    } else {
      const ok =
        mode === 'auto' ||
        (await (o.askUser ?? (async () => false))(
          `Buy "${picked.title}" for $${total.value}? It is above your $${draft.confirmAbove.value} ask-me limit.`,
        ));
      if (!ok) throw new Error('The user declined the purchase.');
      const givenAt = new Date().toISOString();
      await pv.recordConfirmation(bundleId, {
        amount: total,
        givenAt,
        sig: signConfirmation(user.privateKey, bundleId, total, givenAt),
      });
      step(`user confirmed $${total.value} (signed)`);
    }
  }

  // 5. Pay with PayPal.
  const checkout = await createCheckout(env, pv);
  const order = await checkout.createOrderAndSeal(
    bundleId,
    cart.map((c) => ({ sku: c.sku, name: c.name, quantity: c.qty, unitPrice: c.unit_price.value })),
    total.value,
  );
  step(`PayPal order ${order.id} created via ${checkout.label}; bundle sealed`);
  await checkout.approve(order, (s) => log(`  … ${s}`));
  const captured = await checkout.capture(order.id);
  const capture = captured.purchase_units?.[0]?.payments?.captures?.[0];
  if (!capture) throw new Error(`order ${order.id} has no capture`);
  await pv.syncCapture(bundleId, capture.id);
  step(`captured ${capture.id} for $${capture.amount.value} (verified by Provenant against PayPal)`);

  // 6. Merchant ships; tracking goes to PayPal.
  const ship = await fetch(`${env.DEMO_STORE_URL}/api/fulfil`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      bundle_id: bundleId,
      order_ref: order.id,
      items: [{ sku: picked.sku, qty: 1 }],
      ship: o.fulfil?.ship ?? true,
      deliver: o.fulfil?.deliver ?? true,
    }),
  }).then(
    (r) => r.json() as Promise<{ shipped: boolean; fulfilment: Fulfilment | null; photo_url?: string }>,
  );
  if (ship.fulfilment) {
    await checkout.paypal.addTracking(order.id, {
      capture_id: capture.id,
      tracking_number: ship.fulfilment.tracking_number,
      carrier: ship.fulfilment.carrier,
      notify_payer: false,
    });
    step(
      `shipped ${ship.fulfilment.carrier} ${ship.fulfilment.tracking_number} (${ship.fulfilment.status}); tracking added to PayPal`,
    );
  } else {
    log('  ! merchant did not ship the order');
  }

  // 7. Check the link: the PayPal order must carry this bundle's id.
  const final = await checkout.paypal.getOrder(order.id);
  const customIdMatches = final.purchase_units?.[0]?.custom_id === bundleId;
  const verify = await pv.verify(bundleId);
  step(
    `PayPal custom_id ${customIdMatches ? 'matches' : 'DOES NOT match'} the bundle; integrity ${verify.ok ? 'verified' : 'FAILED'}`,
  );

  return {
    bundleId,
    orderId: order.id,
    captureId: capture.id,
    amount: { value: capture.amount.value, currency: capture.amount.currency_code },
    sku: picked.sku,
    customIdMatches,
    verified: verify.ok,
    receiptUrl: pv.receiptUrl(bundleId),
    fulfilment: ship.fulfilment,
    photoUrl: ship.photo_url ?? null,
  };
}
