import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDatabase, type TestDatabase } from '@provenant/db/testing';
import type { IntentMandate, UnsignedIntentMandate } from '@provenant/schemas';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { LocalBlobStore } from '../src/blobs';
import { GENESIS_HASH } from '../src/chain';
import { generateKeyPairB64, Signer, signConfirmation, signMandate } from '../src/crypto';
import { BundleStore } from '../src/store';

let tdb: TestDatabase;
let store: BundleStore;
let dataDir: string;
const user = generateKeyPairB64();

function mandate(userRef: string, over: Partial<UnsignedIntentMandate> = {}): IntentMandate {
  const unsigned: UnsignedIntentMandate = {
    text: 'Buy black running shoes, size 10, under $90. Ask me above $50.',
    max_amount: { value: '90.00', currency: 'USD' },
    confirm_above: { value: '50.00', currency: 'USD' },
    allowed_categories: ['footwear'],
    allowed_merchants: ['demo-store'],
    expires_at: '2026-11-30T00:00:00Z',
    ...over,
  };
  return { ...unsigned, user_sig: signMandate(user.privateKey, userRef, unsigned) };
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPj/HwADAgH/eL9GtQAAAABJRU5ErkJggg==',
  'base64',
);

async function fullBundle(userRef = 'usr_alice', orderId = `ORD-${Math.random().toString(36).slice(2, 10)}`) {
  const { bundle } = await store.create({
    platformId: 'demo-agent',
    agentVersion: '0.1.0',
    userRef,
    userPublicKey: user.publicKey,
    mandate: mandate(userRef),
  });
  const id = bundle.bundle_id;
  await store.recordOffer(
    id,
    {
      merchant_id: 'demo-store',
      url: 'http://localhost:4100/p/RUN-BLK-10',
      title: 'Trail runner, black',
      attributes: { color: 'black', size: '10' },
      price: { value: '84.00', currency: 'USD' },
      delivery_promise: { min_days: 3, max_days: 5 },
    },
    { bytes: PNG, contentType: 'image/png' },
  );
  await store.recordDecision(id, { step: 'compared_offers', detail: '3 candidates' });
  await store.setCart(id, [
    {
      sku: 'RUN-BLK-10',
      name: 'Trail runner',
      qty: 1,
      unit_price: { value: '84.00', currency: 'USD' },
      category: 'footwear',
    },
  ]);
  const amount = { value: '84.00', currency: 'USD' };
  const givenAt = new Date().toISOString();
  await store.recordConfirmation(id, {
    amount,
    given_at: givenAt,
    sig: signConfirmation(user.privateKey, id, amount, givenAt),
  });
  await store.seal(id, orderId);
  return id;
}

beforeAll(async () => {
  tdb = await createTestDatabase(inject('databaseUrl'));
  dataDir = mkdtempSync(join(tmpdir(), 'pv-blobs-'));
  store = new BundleStore(
    tdb.db,
    Signer.fromB64(generateKeyPairB64().privateKey),
    new LocalBlobStore(dataDir),
  );
});
afterAll(async () => {
  await tdb.drop();
});

describe('BundleStore', () => {
  it('builds a sealed bundle that verifies', async () => {
    const id = await fullBundle();
    const rec = await store.get(id);
    expect(rec?.bundle.status).toBe('SEALED');
    expect(rec?.merchantId).toBe('demo-store');
    expect(rec?.bundle.user_confirmation?.required).toBe(true);
    expect(rec?.bundle.offer_snapshot?.image_sha256).toMatch(/^[0-9a-f]{64}$/);
    const result = await store.verify(id);
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.events).toBe(6);
  });

  it('chains every row to the previous row of the whole ledger', async () => {
    const a = await fullBundle('usr_alice');
    const b = await fullBundle('usr_alice');
    const { rows } = await tdb.db.$client.query<{
      seq: string;
      prev_hash: string;
      hash: string;
      bundle_id: string;
    }>('select seq, prev_hash, hash, bundle_id from bundle_events order by seq');
    expect(rows[0]?.prev_hash).toBe(GENESIS_HASH);
    for (let i = 1; i < rows.length; i++) expect(rows[i]?.prev_hash).toBe(rows[i - 1]?.hash);
    expect(new Set(rows.map((r) => r.bundle_id))).toContain(a);
    expect(new Set(rows.map((r) => r.bundle_id))).toContain(b);
  });

  it('keeps the chain linear under concurrent appends', async () => {
    const ids = await Promise.all([fullBundle(), fullBundle(), fullBundle()]);
    const results = await Promise.all(ids.map((id) => store.verify(id)));
    for (const r of results) expect(r.failures).toEqual([]);
    const { rows } = await tdb.db.$client.query<{ n: string }>(
      'select count(*) as n from (select prev_hash from bundle_events group by prev_hash having count(*) > 1) d',
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });

  it('rejects a mandate whose user signature does not verify', async () => {
    const m = mandate('usr_mallory');
    const forged = { ...m, max_amount: { value: '9000.00', currency: 'USD' } };
    await expect(
      store.create({
        platformId: 'demo-agent',
        agentVersion: '0.1.0',
        userRef: 'usr_mallory',
        userPublicKey: user.publicKey,
        mandate: forged,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' });
  });

  it('refuses to seal two bundles to one PayPal order', async () => {
    await fullBundle('usr_alice', 'ORDER-DUP');
    await expect(fullBundle('usr_alice', 'ORDER-DUP')).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('detects an edited ledger row', async () => {
    const id = await fullBundle();
    await tdb.db.$client.query(
      `update bundle_events set payload = jsonb_set(payload, '{cart,0,unit_price,value}', '"8.40"')
        where bundle_id = $1 and type = 'cart_set'`,
      [id],
    );
    const r = await store.verify(id);
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.startsWith('hash') && f.includes('cart_set'))).toBe(true);
  });

  it('detects an edited materialised bundle row', async () => {
    const id = await fullBundle();
    await tdb.db.$client.query(
      `update bundles set state = jsonb_set(state, '{intent_mandate,max_amount,value}', '"500.00"') where id = $1`,
      [id],
    );
    const r = await store.verify(id);
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.startsWith('materialised_state'))).toBe(true);
  });

  it('detects a deleted row through its neighbours', async () => {
    const victim = await fullBundle();
    const after = await fullBundle();
    await tdb.db.$client.query(`delete from bundle_events where bundle_id = $1 and type = 'sealed'`, [
      victim,
    ]);
    const r = await store.verify(victim);
    expect(r.ok).toBe(false);
    const neighbour = await store.verify(after);
    expect(neighbour.failures.some((f) => f.startsWith('chain_link'))).toBe(true);
  });

  it('detects a swapped offer image', async () => {
    const id = await fullBundle();
    const sha = (await store.get(id))?.bundle.offer_snapshot?.image_sha256;
    writeFileSync(join(dataDir, 'blobs', sha!), Buffer.from('a different picture'));
    const r = await store.verify(id);
    expect(r.failures).toContain('offer_image_integrity: image missing or altered');
  });

  it('stores non-Latin-1 text intact (UTF-8 end to end)', async () => {
    const { bundle } = await store.create({
      platformId: 'demo-agent',
      agentVersion: '0.1.0',
      userRef: 'usr_utf8',
      userPublicKey: user.publicKey,
      mandate: mandate('usr_utf8'),
    });
    const detail = 'colour blue ≠ black · größe 10 · 日本 · ✓';
    await store.recordDecision(bundle.bundle_id, { step: 'rule_check', detail });
    expect((await store.get(bundle.bundle_id))?.bundle.decision_trace[0]?.detail).toBe(detail);
    expect((await store.verify(bundle.bundle_id)).ok).toBe(true);
  });

  it('enforces OPEN-only edits after sealing', async () => {
    const id = await fullBundle();
    await expect(store.recordDecision(id, { step: 'late', detail: 'x' })).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
  });
});
