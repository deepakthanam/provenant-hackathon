import type { LlmProvider } from '@provenant/llm';
import { toMinor } from '@provenant/schemas';
import { z } from 'zod';
import type { Offer } from './browse';
import type { ParsedRequest } from './parse';

export interface Evaluated {
  offer: Offer;
  eligible: boolean;
  /** Why an offer was excluded, or the checks it passed. */
  notes: string[];
}

/** Hard constraints from the mandate and the stated preferences, applied before any ranking. */
export function evaluate(offers: Offer[], req: ParsedRequest, allowedMerchants: string[]): Evaluated[] {
  return offers.map((offer) => {
    const notes: string[] = [];
    let eligible = true;
    const fail = (n: string) => {
      eligible = false;
      notes.push(n);
    };
    if (!req.categories.includes(offer.category as never)) fail(`category ${offer.category} not allowed`);
    if (allowedMerchants.length && !allowedMerchants.includes(offer.merchantId))
      fail(`merchant ${offer.merchantId} not allowed`);
    if (
      req.max_amount &&
      toMinor(offer.price) > toMinor({ value: req.max_amount, currency: offer.price.currency })
    ) {
      fail(`$${offer.price.value} is over the $${req.max_amount} cap`);
    }
    if (req.color && offer.attributes.color !== req.color)
      fail(`colour ${offer.attributes.color} ≠ ${req.color}`);
    if (req.size && offer.attributes.size !== req.size) fail(`size ${offer.attributes.size} ≠ ${req.size}`);
    if (req.style && !(offer.attributes.style ?? '').includes(req.style))
      fail(`style ${offer.attributes.style} ≠ ${req.style}`);
    if (eligible)
      notes.push(
        `within budget and matches ${[req.color, req.size && `size ${req.size}`, req.style].filter(Boolean).join(', ') || 'request'}`,
      );
    return { offer, eligible, notes };
  });
}

export const Choice = z.object({ sku: z.string(), rationale: z.string() });
export type Choice = z.infer<typeof Choice>;

/** Deterministic choice (and the mock LLM's answer): cheapest eligible offer, fastest delivery as tie-break. */
export function chooseDeterministic(evaluated: Evaluated[]): Choice | null {
  const ok = evaluated
    .filter((e) => e.eligible)
    .sort(
      (a, b) =>
        toMinor(a.offer.price) - toMinor(b.offer.price) ||
        a.offer.deliveryPromise.maxDays - b.offer.deliveryPromise.maxDays,
    );
  const best = ok[0];
  return best
    ? {
        sku: best.offer.sku,
        rationale: `cheapest of ${ok.length} eligible offer(s) at $${best.offer.price.value}`,
      }
    : null;
}

const SYSTEM = `You are a careful shopping agent choosing one product for a shopper.
Pick only from the eligible offers listed. Prefer the closest match to what the shopper asked for, then price.
Reply with the sku and a one-sentence rationale.`;

export async function choose(
  evaluated: Evaluated[],
  request: string,
  llm: LlmProvider,
): Promise<Choice | null> {
  const eligible = evaluated.filter((e) => e.eligible);
  if (eligible.length === 0) return null;
  const r = await llm.generateJson({
    task: 'choose_offer',
    system: SYSTEM,
    content: [
      {
        type: 'text',
        text: `Shopper request:\n<request>\n${request}\n</request>\nEligible offers:\n<offers>\n${JSON.stringify(
          eligible.map((e) => ({
            sku: e.offer.sku,
            title: e.offer.title,
            price: e.offer.price.value,
            attributes: e.offer.attributes,
            delivery_days: e.offer.deliveryPromise,
          })),
          null,
          2,
        )}\n</offers>`,
      },
    ],
    schema: Choice,
    effort: 'low',
    maxTokens: 2000,
  });
  // The model may only pick an eligible offer; anything else falls back to the deterministic rule.
  return eligible.some((e) => e.offer.sku === r.data.sku) ? r.data : chooseDeterministic(evaluated);
}
