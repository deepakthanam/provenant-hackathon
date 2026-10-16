import type { LlmProvider } from '@provenant/llm';
import { z } from 'zod';

/** What the agent understood from the user's words. Becomes the signed intent mandate. */
export const ParsedRequest = z.object({
  max_amount: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .nullable(),
  confirm_above: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .nullable(),
  categories: z.array(z.enum(['footwear', 'apparel'])),
  color: z.string().nullable(),
  size: z.string().nullable(),
  style: z.enum(['trail', 'road', 'hybrid', 'hiking']).nullable(),
  search_query: z.string(),
});
export type ParsedRequest = z.infer<typeof ParsedRequest>;

const COLORS = ['black', 'blue', 'brown', 'white', 'grey', 'red', 'green'];

/** Deterministic parser: the mock LLM's answer, and the fallback when no model is configured. */
export function parseDeterministic(text: string): ParsedRequest {
  const t = text.toLowerCase();
  const money = (re: RegExp) => {
    const m = t.match(re)?.[1];
    return m ? Number(m).toFixed(2) : null;
  };
  const max = money(
    /(?:under|below|less than|max(?:imum)?|up to|budget(?: of)?|no more than)\s*\$?\s*(\d+(?:\.\d{1,2})?)/,
  );
  const confirm = money(
    /ask me (?:above|over|before (?:spending )?(?:more than|over)|if (?:it'?s )?(?:more than|over|above))\s*\$?\s*(\d+(?:\.\d{1,2})?)/,
  );
  const categories: ParsedRequest['categories'] = [];
  if (/\b(shoes?|sneakers?|runners?|boots?|trainers?|footwear)\b/.test(t)) categories.push('footwear');
  if (/\b(socks?|shirts?|shorts|apparel|jacket)\b/.test(t)) categories.push('apparel');
  const style = /\bhybrid\b/.test(t)
    ? 'hybrid'
    : /\btrail\b/.test(t)
      ? 'trail'
      : /\broad\b/.test(t)
        ? 'road'
        : /\bhik(e|ing)\b/.test(t)
          ? 'hiking'
          : null;
  const query = t
    .replace(/\$\s*\d+(\.\d+)?/g, ' ')
    .replace(
      /\b(buy|me|a|an|the|pair|of|some|under|below|less|than|up|to|ask|above|over|if|it'?s|more|no|max|budget|please|and|for|size|\d+(\.\d+)?)\b/g,
      ' ',
    )
    .replace(/[^a-z\s/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    max_amount: max,
    confirm_above: confirm,
    categories: categories.length ? categories : ['footwear'],
    color: COLORS.find((c) => new RegExp(`\\b${c}\\b`).test(t)) ?? null,
    size: t.match(/\bsize\s*(\d+(?:\.5)?)/)?.[1] ?? null,
    style,
    search_query: query || t,
  };
}

const SYSTEM = `You turn a shopper's request into purchase constraints for a shopping agent.
Extract only what the shopper said. Do not invent a budget, size or colour they did not state (use null).
max_amount is the spending cap in USD; confirm_above is the amount above which the shopper wants to be asked.
categories: footwear for any shoes/boots, apparel for clothing and socks.
search_query: a short keyword query for a store search box.`;

export async function parseRequest(
  text: string,
  llm: LlmProvider,
): Promise<{ parsed: ParsedRequest; modelId: string }> {
  const r = await llm.generateJson({
    task: 'parse_shopping_request',
    system: SYSTEM,
    content: [{ type: 'text', text: `Shopper request:\n<request>\n${text}\n</request>` }],
    schema: ParsedRequest,
    effort: 'low',
    maxTokens: 2000,
  });
  return { parsed: r.data, modelId: r.modelId };
}
