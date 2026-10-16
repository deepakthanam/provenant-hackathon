import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  generateKeyPairB64,
  mandateSigningMessage,
  privateKeyFromB64,
  signMessage,
} from '@provenant/evidence/crypto';
import { z } from 'zod';

export interface ProvenantMcpOptions {
  baseUrl: string;
  /** Agent-platform key: create/record/seal bundles. */
  platformKey?: string;
  /** Merchant or admin key: disputes and verdicts. */
  reviewKey?: string;
  /** Where demo user keys live (shared with the demo agent). */
  dataDir: string;
  fetch?: typeof fetch;
}

const VERDICT_MEANING: Record<string, string> = {
  WITHIN_MANDATE:
    'The agent did what the user signed for and the item arrived as shown. The seller defends with the evidence.',
  AGENT_OUT_OF_BOUNDS:
    'The agent broke the signed mandate. Refund the buyer; the agent platform carries the cost.',
  MERCHANT_MISREPRESENTED:
    'What arrived (or did not) differs from the offer the agent saw. Accept the claim.',
  SHARED_FAULT:
    'Inside the mandate, but the listing and the mandate left room for doubt. Offer a partial refund.',
  INSUFFICIENT_EVIDENCE:
    'The evidence cannot be trusted or the facts conflict. A person decides; no PayPal call is made.',
};

const MoneyIn = z.object({
  value: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .describe('e.g. "90.00"'),
  currency: z.string().length(3).default('USD'),
});

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

const ok = (text: string, data?: unknown): ToolResult => ({
  content: [{ type: 'text', text }],
  ...(data !== undefined ? { structuredContent: data as Record<string, unknown> } : {}),
});
const fail = (text: string): ToolResult => ({ content: [{ type: 'text', text }], isError: true });

/** Demo stand-in for a user's wallet key, stored where the demo agent keeps its users. */
function demoUser(dataDir: string, userRef: string): { publicKey: string; privateKey: string } {
  const file = join(dataDir, 'agent-users', `${userRef}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  mkdirSync(join(dataDir, 'agent-users'), { recursive: true });
  const k = generateKeyPairB64();
  const user = { userRef, publicKey: k.publicKey, privateKey: k.privateKey };
  writeFileSync(file, JSON.stringify(user, null, 2), { mode: 0o600 });
  return user;
}

/**
 * Provenant as MCP tools: an agent records and seals its evidence; a reviewer lists disputes,
 * runs adjudication and asks why a verdict came out the way it did.
 */
export function createProvenantMcp(o: ProvenantMcpOptions): McpServer {
  const fetchImpl = o.fetch ?? fetch;
  const server = new McpServer({ name: 'provenant', version: '0.1.0' });

  async function call<T>(
    key: 'platform' | 'review',
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const token = key === 'platform' ? o.platformKey : o.reviewKey;
    if (!token)
      throw new Error(
        `no ${key === 'platform' ? 'PROVENANT_PLATFORM_API_KEY' : 'PROVENANT_ADMIN_API_KEY'} configured`,
      );
    const res = await fetchImpl(`${o.baseUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
    if (!res.ok) throw new Error(`${json.error ?? res.status}: ${json.message ?? res.statusText}`);
    return json;
  }
  const safely =
    <A>(fn: (args: A) => Promise<ToolResult>) =>
    async (args: A): Promise<ToolResult> => {
      try {
        return await fn(args);
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    };

  server.registerTool(
    'create_bundle',
    {
      title: 'Create evidence bundle',
      description:
        "Open a Provenant evidence bundle from the user's signed intent mandate, before shopping. Returns the bundle id. Pass user_sig (and user_public_key the first time a user is seen), or sign_as_demo_user=true in demos.",
      inputSchema: {
        user_ref: z.string().regex(/^usr_[A-Za-z0-9_-]{3,64}$/),
        text: z.string().min(1).describe("The user's request in their own words"),
        max_amount: MoneyIn,
        confirm_above: MoneyIn.nullable().optional(),
        allowed_categories: z.array(z.string()).min(1),
        allowed_merchants: z.array(z.string()).default([]),
        expires_at: z.string().optional().describe('ISO time; defaults to 7 days from now'),
        user_sig: z.string().optional(),
        user_public_key: z.string().optional(),
        sign_as_demo_user: z.boolean().default(false),
        agent_version: z.string().default('mcp'),
      },
    },
    safely(async (a) => {
      const unsigned = {
        text: a.text,
        max_amount: a.max_amount,
        confirm_above: a.confirm_above ?? null,
        allowed_categories: a.allowed_categories,
        allowed_merchants: a.allowed_merchants,
        expires_at: a.expires_at ?? new Date(Date.now() + 7 * 86_400_000).toISOString(),
      };
      let sig = a.user_sig;
      let pub = a.user_public_key;
      if (!sig) {
        if (!a.sign_as_demo_user)
          return fail('user_sig is required (or set sign_as_demo_user=true in a demo)');
        const u = demoUser(o.dataDir, a.user_ref);
        sig = signMessage(privateKeyFromB64(u.privateKey), mandateSigningMessage(a.user_ref, unsigned));
        pub = u.publicKey;
      }
      const b = await call<{ bundle_id: string; hash: string }>('platform', 'POST', '/v1/bundles', {
        user_ref: a.user_ref,
        user_public_key: pub,
        agent_version: a.agent_version,
        intent_mandate: { ...unsigned, user_sig: sig },
      });
      return ok(
        `Bundle ${b.bundle_id} opened (ledger head ${b.hash}). Record offers and decisions, then seal it to the PayPal order.`,
        b,
      );
    }),
  );

  server.registerTool(
    'record_offer',
    {
      title: 'Record offer snapshot',
      description:
        'Record exactly what the agent saw on the product page (title, attributes, price, delivery promise, image). Optionally record a decision step too.',
      inputSchema: {
        bundle_id: z.string(),
        merchant_id: z.string(),
        url: z.url(),
        title: z.string(),
        attributes: z.record(z.string(), z.string()),
        price: MoneyIn,
        delivery_min_days: z.number().int().min(0),
        delivery_max_days: z.number().int().min(0),
        image_url: z.url().optional().describe('Fetched and stored by content hash'),
        decision: z.object({ step: z.string(), detail: z.string() }).optional(),
      },
    },
    safely(async (a) => {
      let image: { image_base64: string; image_content_type: string } | object = {};
      if (a.image_url) {
        const res = await fetchImpl(a.image_url);
        const type = res.headers.get('content-type')?.split(';')[0] ?? 'image/png';
        image = {
          image_base64: Buffer.from(await res.arrayBuffer()).toString('base64'),
          image_content_type: type,
        };
      }
      const b = await call<{ bundle_id: string; offer_snapshot: { image_sha256: string | null } }>(
        'platform',
        'POST',
        `/v1/bundles/${a.bundle_id}/offer`,
        {
          merchant_id: a.merchant_id,
          url: a.url,
          title: a.title,
          attributes: a.attributes,
          price: a.price,
          delivery_promise: { min_days: a.delivery_min_days, max_days: a.delivery_max_days },
          ...image,
        },
      );
      if (a.decision) await call('platform', 'POST', `/v1/bundles/${a.bundle_id}/decision`, a.decision);
      return ok(
        `Offer recorded on ${a.bundle_id}${b.offer_snapshot.image_sha256 ? ` with image sha256 ${b.offer_snapshot.image_sha256}` : ''}.`,
        b,
      );
    }),
  );

  server.registerTool(
    'seal_order',
    {
      title: 'Seal bundle to PayPal order',
      description:
        "Set the approved cart (if given), check the bundle is ready, and seal it to the PayPal order. The PayPal order's purchase_units[0].custom_id must be the bundle id.",
      inputSchema: {
        bundle_id: z.string(),
        paypal_order_id: z.string(),
        cart: z
          .array(
            z.object({
              sku: z.string(),
              name: z.string(),
              qty: z.number().int().min(1),
              unit_price: MoneyIn,
              category: z.string(),
            }),
          )
          .optional(),
      },
    },
    safely(async (a) => {
      if (a.cart) await call('platform', 'PUT', `/v1/bundles/${a.bundle_id}/cart`, { cart: a.cart });
      const prep = await call<{ custom_id: string; amount: { value: string; currency: string } }>(
        'platform',
        'POST',
        `/v1/bundles/${a.bundle_id}/prepare-order`,
      );
      const b = await call<{ status: string; hash: string }>(
        'platform',
        'POST',
        `/v1/bundles/${a.bundle_id}/seal`,
        { paypal_order_id: a.paypal_order_id },
      );
      return ok(
        `Sealed ${a.bundle_id} to PayPal order ${a.paypal_order_id} (${b.status}). Order amount must be ${prep.amount.currency} ${prep.amount.value}; custom_id must be ${prep.custom_id}.`,
        { ...b, ...prep },
      );
    }),
  );

  server.registerTool(
    'get_evidence_bundle',
    {
      title: 'Get evidence bundle',
      description: 'Fetch a bundle by bundle id or by the PayPal order id it is sealed to.',
      inputSchema: { bundle_id: z.string().optional(), paypal_order_id: z.string().optional() },
    },
    safely(async (a) => {
      if (!a.bundle_id && !a.paypal_order_id) return fail('give bundle_id or paypal_order_id');
      const path = a.bundle_id ? `/v1/bundles/${a.bundle_id}` : `/v1/bundles/by-order/${a.paypal_order_id}`;
      const b = await call<Record<string, unknown>>('review', 'GET', path);
      return ok(JSON.stringify(b, null, 2), b);
    }),
  );

  server.registerTool(
    'verify_bundle',
    {
      title: 'Verify bundle integrity',
      description:
        'Replay the ledger for a bundle: hashes, Provenant signatures, chain links, and the user’s signatures.',
      inputSchema: { bundle_id: z.string() },
    },
    safely(async (a) => {
      const v = await call<{ ok: boolean; events: number; chain_position: number; failures: string[] }>(
        'review',
        'GET',
        `/v1/bundles/${a.bundle_id}/verify`,
      );
      return ok(
        v.ok
          ? `Seal intact: ${v.events} signed entries verify (chain position ${v.chain_position}).`
          : `Seal broken: ${v.failures.join('; ')}`,
        v,
      );
    }),
  );

  server.registerTool(
    'list_disputes',
    {
      title: 'List disputes',
      description: 'List PayPal disputes on agent orders with their verdict and planned PayPal call.',
      inputSchema: { verdict: z.string().optional(), status: z.string().optional() },
    },
    safely(async (a) => {
      const { items } = await call<{
        items: Array<{
          id: string;
          reason: string;
          status: string;
          amount: { value: string; currency: string } | null;
          verdict: string | null;
          verdict_status: string | null;
          planned_action: { kind: string } | null;
        }>;
      }>('review', 'GET', '/v1/disputes');
      const rows = items.filter(
        (d) => (!a.verdict || d.verdict === a.verdict) && (!a.status || d.status === a.status),
      );
      const text = rows.length
        ? rows
            .map(
              (d) =>
                `${d.id}  ${d.verdict ?? 'unjudged'}  ${d.planned_action?.kind ?? '-'} (${d.verdict_status ?? '-'})  ${d.reason}  ${d.status}  ${d.amount ? `${d.amount.currency} ${d.amount.value}` : ''}`,
            )
            .join('\n')
        : 'No disputes match.';
      return ok(text, { items: rows });
    }),
  );

  server.registerTool(
    'adjudicate_dispute',
    {
      title: 'Adjudicate dispute',
      description:
        'Run (or re-run with force) adjudication for a dispute. Returns the verdict and the planned PayPal call. Nothing is sent to PayPal.',
      inputSchema: { dispute_id: z.string(), force: z.boolean().default(false) },
    },
    safely(async (a) => {
      const r = await call<{
        created: boolean;
        verdict: {
          verdict: string;
          confidence: number;
          recommended_action: { kind: string; explanation: string };
        };
      }>('review', 'POST', `/v1/disputes/${a.dispute_id}/adjudicate${a.force ? '?force=true' : ''}`);
      const v = r.verdict;
      return ok(
        `${a.dispute_id}: ${v.verdict} (confidence ${v.confidence.toFixed(2)}) → ${v.recommended_action.kind}: ${v.recommended_action.explanation}${r.created ? '' : ' (unchanged)'}`,
        r,
      );
    }),
  );

  server.registerTool(
    'explain_verdict',
    {
      title: 'Explain verdict',
      description:
        'Explain why a dispute got its verdict: reasons with the evidence fields they cite, failed checks, model findings, and the exact PayPal call planned.',
      inputSchema: { dispute_id: z.string() },
    },
    safely(async (a) => {
      const d = await call<{
        id: string;
        reason: string;
        status: string;
        latest_verdict: null | {
          verdict: string;
          confidence: number;
          status: string;
          reasons: Array<{ text: string; ref: string }>;
          rule_results: Array<{ rule: string; passed: boolean; skipped: boolean; detail: string }>;
          model_findings: Array<{
            attribute: string;
            snapshot_value: string;
            claimed_value: string;
            snapshot_field_ref: string;
            severity: string;
          }>;
          model_id: string | null;
          recommended_action: { kind: string; available: boolean; explanation: string; request: unknown };
        };
      }>('review', 'GET', `/v1/disputes/${a.dispute_id}`);
      const v = d.latest_verdict;
      if (!v) return ok(`${d.id} has not been adjudicated yet.`);
      const failed = v.rule_results.filter((r) => !r.passed && !r.skipped);
      const lines = [
        `${d.id} (${d.reason}, ${d.status}): ${v.verdict}, confidence ${v.confidence.toFixed(2)}.`,
        VERDICT_MEANING[v.verdict] ?? '',
        '',
        'Because:',
        ...v.reasons.map((r) => `- ${r.text} [${r.ref}]`),
        '',
        failed.length
          ? `Failed checks: ${failed.map((r) => `${r.rule} (${r.detail})`).join('; ')}`
          : `All ${v.rule_results.filter((r) => !r.skipped).length} applicable checks passed.`,
        v.model_findings.length
          ? `Model (${v.model_id}) reported: ${v.model_findings.map((f) => `${f.attribute} listing "${f.snapshot_value}" vs buyer "${f.claimed_value}" (${f.severity}, ${f.snapshot_field_ref})`).join('; ')}`
          : '',
        '',
        `Planned PayPal call: ${v.recommended_action.kind}${v.recommended_action.available ? '' : ' (not available now)'} (${v.status}). ${v.recommended_action.explanation}`,
        v.recommended_action.request ? `Request body: ${JSON.stringify(v.recommended_action.request)}` : '',
        'The model only reports differences; deterministic rules chose this verdict, and nothing is sent to PayPal until a merchant approves.',
      ].filter((x) => x !== '');
      return ok(lines.join('\n'), d);
    }),
  );

  return server;
}
