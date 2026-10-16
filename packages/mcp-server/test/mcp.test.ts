import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { purchase } from '../../../apps/server/test/fixtures';
import { bearer, createHarness, type Harness } from '../../../apps/server/test/harness';
import { createProvenantMcp } from '../src/server';

let h: Harness;
let client: Client;

function injectFetch(app: Harness['app']): typeof fetch {
  return (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const res = await app.inject({
      method: (init.method ?? 'GET') as 'GET',
      url: url.pathname + url.search,
      headers: init.headers as Record<string, string>,
      payload: init.body as string | undefined,
    });
    return new Response(res.body, { status: res.statusCode, headers: res.headers as Record<string, string> });
  }) as typeof fetch;
}

beforeAll(async () => {
  h = await createHarness();
  const server = createProvenantMcp({
    baseUrl: 'http://provenant.test',
    platformKey: h.keys.platform,
    reviewKey: h.keys.admin,
    dataDir: mkdtempSync(join(tmpdir(), 'pv-mcp-')),
    fetch: injectFetch(h.app),
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test', version: '1' });
  await Promise.all([server.connect(a), client.connect(b)]);
});
afterAll(async () => {
  await client.close();
  await h.close();
});

const text = (r: Awaited<ReturnType<Client['callTool']>>) => (r.content as Array<{ text: string }>)[0]!.text;

describe('Provenant MCP server', () => {
  it('lists the eight tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'adjudicate_dispute',
      'create_bundle',
      'explain_verdict',
      'get_evidence_bundle',
      'list_disputes',
      'record_offer',
      'seal_order',
      'verify_bundle',
    ]);
  });

  it('creates, records, seals and verifies a bundle', async () => {
    const created = await client.callTool({
      name: 'create_bundle',
      arguments: {
        user_ref: 'usr_mcp',
        text: 'Buy black running shoes under $90',
        max_amount: { value: '90.00', currency: 'USD' },
        allowed_categories: ['footwear'],
        allowed_merchants: ['demo-store'],
        sign_as_demo_user: true,
      },
    });
    expect(created.isError).toBeFalsy();
    const bundleId = (created.structuredContent as { bundle_id: string }).bundle_id;
    expect(bundleId).toMatch(/^apb_/);

    const offer = await client.callTool({
      name: 'record_offer',
      arguments: {
        bundle_id: bundleId,
        merchant_id: 'demo-store',
        url: 'http://localhost:4100/p/RUN-BLK-10',
        title: 'Trail runner, black',
        attributes: { color: 'black' },
        price: { value: '84.00', currency: 'USD' },
        delivery_min_days: 3,
        delivery_max_days: 5,
        decision: { step: 'compared_offers', detail: 'via MCP' },
      },
    });
    expect(offer.isError).toBeFalsy();

    const sealed = await client.callTool({
      name: 'seal_order',
      arguments: {
        bundle_id: bundleId,
        paypal_order_id: 'MCPORDER00000001',
        cart: [
          {
            sku: 'RUN-BLK-10',
            name: 'Trail runner',
            qty: 1,
            unit_price: { value: '84.00', currency: 'USD' },
            category: 'footwear',
          },
        ],
      },
    });
    expect(text(sealed)).toMatch(/custom_id must be apb_/);

    const verified = await client.callTool({ name: 'verify_bundle', arguments: { bundle_id: bundleId } });
    expect(text(verified)).toMatch(/^Seal intact/);
    const byOrder = await client.callTool({
      name: 'get_evidence_bundle',
      arguments: { paypal_order_id: 'MCPORDER00000001' },
    });
    expect((byOrder.structuredContent as { bundle_id: string }).bundle_id).toBe(bundleId);
  });

  it('refuses an unsigned mandate', async () => {
    const r = await client.callTool({
      name: 'create_bundle',
      arguments: {
        user_ref: 'usr_mcp2',
        text: 'x',
        max_amount: { value: '1.00', currency: 'USD' },
        allowed_categories: ['footwear'],
      },
    });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/user_sig is required/);
  });

  it('lists, adjudicates and explains a dispute', async () => {
    const p = await purchase(h);
    await h.app.inject({
      method: 'POST',
      url: `/v1/bundles/${p.bundleId}/capture`,
      headers: bearer(h.keys.platform),
      payload: {},
    });
    const d = await h.mock.buyerOpenDispute({
      capture_id: p.captureId,
      reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
      message: 'never came',
    });
    await h.app.inject({ method: 'POST', url: '/v1/disputes/sync', headers: bearer(h.keys.admin) });

    const list = await client.callTool({ name: 'list_disputes', arguments: {} });
    expect(text(list)).toContain(d.dispute_id);
    const adj = await client.callTool({
      name: 'adjudicate_dispute',
      arguments: { dispute_id: d.dispute_id },
    });
    expect(text(adj)).toMatch(/MERCHANT_MISREPRESENTED .* accept_claim/);
    const why = await client.callTool({ name: 'explain_verdict', arguments: { dispute_id: d.dispute_id } });
    expect(text(why)).toMatch(/Failed checks: shipped/);
    expect(text(why)).toMatch(/nothing is sent to PayPal until a merchant approves/);
  });
});
