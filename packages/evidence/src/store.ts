import type { Db } from '@provenant/db';
import { blobs as blobsTable, bundles, users } from '@provenant/db';
import {
  type BundleEventPayload,
  type BundleEventType,
  type BundleState,
  type CartItem,
  cartTotal,
  type DecisionStep,
  type EvidenceBundle,
  type Fulfilment,
  type IntentMandate,
  type Money,
  type OfferSnapshot,
  toMinor,
  type VerifyResult,
} from '@provenant/schemas';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import type { BlobStore } from './blobs';
import { canonicalize } from './canonical';
import { GENESIS_HASH, ledgerEntryHash } from './chain';
import {
  confirmationSigningMessage,
  mandateSigningMessage,
  publicKeyFromB64,
  type Signer,
  verifyMessage,
} from './crypto';
import { EvidenceError } from './errors';
import { applyEvent, type BundleEventInput, BundleStateError, replay } from './reducer';

/** Serialises appends so the global hash chain never forks. Arbitrary constant. */
const LEDGER_LOCK_KEY = 72_017_001;

export interface BundleRecord {
  bundle: EvidenceBundle;
  platformId: string;
  merchantId: string | null;
}

interface LedgerRow {
  seq: string | number;
  bundle_id: string;
  type: BundleEventType;
  payload: unknown;
  prev_hash: string;
  hash: string;
  sig: string;
  created_at: Date;
  pred_hash?: string | null;
  succ_prev_hash?: string | null;
}

export class BundleStore {
  constructor(
    private readonly db: Db,
    private readonly signer: Signer,
    private readonly blobStore: BlobStore,
  ) {}

  // ---------------------------------------------------------------- writes

  async create(input: {
    platformId: string;
    agentVersion: string;
    userRef: string;
    userPublicKey?: string;
    mandate: IntentMandate;
  }): Promise<BundleRecord> {
    const userKey = await this.resolveUserKey(input.userRef, input.userPublicKey);
    const { user_sig, ...unsigned } = input.mandate;
    if (!verifyMessage(publicKeyFromB64(userKey), mandateSigningMessage(input.userRef, unsigned), user_sig)) {
      throw new EvidenceError(
        'INVALID_SIGNATURE',
        'intent_mandate.user_sig does not verify against the user key',
      );
    }
    const bundleId = `apb_${ulid()}`;
    return this.append(
      bundleId,
      {
        type: 'created',
        payload: {
          agent: { platform_id: input.platformId, agent_version: input.agentVersion },
          user_ref: input.userRef,
          intent_mandate: input.mandate,
        },
      },
      input.platformId,
    );
  }

  async recordOffer(
    bundleId: string,
    offer: Omit<OfferSnapshot, 'image_sha256' | 'image_path' | 'captured_at'> & { captured_at?: string },
    image?: { bytes: Uint8Array; contentType: string },
  ): Promise<BundleRecord> {
    let image_sha256: string | null = null;
    let image_path: string | null = null;
    if (image) {
      const stored = await this.blobStore.put(image.bytes);
      await this.db
        .insert(blobsTable)
        .values({
          sha256: stored.sha256,
          path: stored.path,
          contentType: image.contentType,
          size: stored.size,
        })
        .onConflictDoNothing();
      image_sha256 = stored.sha256;
      image_path = stored.path;
    }
    const offer_snapshot: OfferSnapshot = {
      ...offer,
      image_sha256,
      image_path,
      captured_at: offer.captured_at ?? new Date().toISOString(),
    };
    return this.append(bundleId, { type: 'offer_recorded', payload: { offer_snapshot } });
  }

  recordDecision(bundleId: string, step: Omit<DecisionStep, 'at'> & { at?: string }): Promise<BundleRecord> {
    return this.append(bundleId, {
      type: 'decision_recorded',
      payload: { step: { ...step, at: step.at ?? new Date().toISOString() } },
    });
  }

  async recordConfirmation(
    bundleId: string,
    input: { amount: Money; given_at: string; sig: string },
  ): Promise<BundleRecord> {
    const current = await this.require(bundleId);
    const userKey = await this.userKey(current.bundle.user_ref);
    if (
      !userKey ||
      !verifyMessage(
        publicKeyFromB64(userKey),
        confirmationSigningMessage(bundleId, input.amount, input.given_at),
        input.sig,
      )
    ) {
      throw new EvidenceError('INVALID_SIGNATURE', 'confirmation sig does not verify against the user key');
    }
    const threshold = current.bundle.intent_mandate.confirm_above;
    const required = threshold !== null && toMinor(input.amount) > toMinor(threshold);
    return this.append(bundleId, {
      type: 'confirmation_recorded',
      payload: { user_confirmation: { required, ...input } },
    });
  }

  setCart(bundleId: string, cart: CartItem[]): Promise<BundleRecord> {
    return this.append(bundleId, { type: 'cart_set', payload: { cart } });
  }

  /** Checks the bundle is ready to back an order and returns the value for purchase_units[0].custom_id. */
  async prepareOrder(bundleId: string): Promise<{ custom_id: string; amount: Money }> {
    const { bundle } = await this.require(bundleId);
    if (bundle.status !== 'OPEN') throw new EvidenceError('INVALID_STATE', `bundle is ${bundle.status}`);
    if (!bundle.offer_snapshot)
      throw new EvidenceError('INVALID_STATE', 'record an offer before preparing an order');
    if (bundle.cart.length === 0)
      throw new EvidenceError('INVALID_STATE', 'set the cart before preparing an order');
    return { custom_id: bundle.bundle_id, amount: cartTotal(bundle.cart) };
  }

  seal(bundleId: string, paypalOrderId: string): Promise<BundleRecord> {
    return this.append(bundleId, { type: 'sealed', payload: { paypal_order_id: paypalOrderId } });
  }

  /** Idempotent: recording the same capture twice (webhook and agent racing) is a no-op. */
  recordCapture(bundleId: string, paypalCaptureId: string, amount: Money): Promise<BundleRecord> {
    return this.append(
      bundleId,
      { type: 'capture_recorded', payload: { paypal_capture_id: paypalCaptureId, amount } },
      undefined,
      (state) => {
        if (state.paypal_capture_id === paypalCaptureId) return true;
        if (state.paypal_capture_id) {
          throw new EvidenceError('CONFLICT', `bundle already has capture ${state.paypal_capture_id}`);
        }
        return false;
      },
    );
  }

  recordFulfilment(bundleId: string, fulfilment: Fulfilment): Promise<BundleRecord> {
    return this.append(bundleId, { type: 'fulfilment_recorded', payload: { fulfilment } });
  }

  // ---------------------------------------------------------------- reads

  async get(bundleId: string): Promise<BundleRecord | null> {
    const [row] = await this.db.select().from(bundles).where(eq(bundles.id, bundleId));
    return row ? toRecord(row) : null;
  }

  async getByOrderId(paypalOrderId: string): Promise<BundleRecord | null> {
    const [row] = await this.db.select().from(bundles).where(eq(bundles.paypalOrderId, paypalOrderId));
    return row ? toRecord(row) : null;
  }

  async getByCaptureId(paypalCaptureId: string): Promise<BundleRecord | null> {
    const [row] = await this.db.select().from(bundles).where(eq(bundles.paypalCaptureId, paypalCaptureId));
    return row ? toRecord(row) : null;
  }

  async userKey(userRef: string): Promise<string | null> {
    const [u] = await this.db.select().from(users).where(eq(users.ref, userRef));
    return u?.publicKey ?? null;
  }

  /** Stores a blob (e.g. a buyer's dispute photo) content-addressed, for reports and replay. */
  async putBlob(bytes: Uint8Array, contentType: string): Promise<{ sha256: string; path: string }> {
    const stored = await this.blobStore.put(bytes);
    await this.db
      .insert(blobsTable)
      .values({ sha256: stored.sha256, path: stored.path, contentType, size: stored.size })
      .onConflictDoNothing();
    return { sha256: stored.sha256, path: stored.path };
  }

  async getBlob(sha256: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    const [meta] = await this.db.select().from(blobsTable).where(eq(blobsTable.sha256, sha256));
    const bytes = await this.blobStore.get(sha256);
    return meta && bytes ? { bytes, contentType: meta.contentType } : null;
  }

  // ---------------------------------------------------------------- verification

  /**
   * Replays the bundle's ledger rows and checks: every row's hash recomputes, every signature
   * verifies, every row links to its global predecessor (and its successor links back), the
   * replayed state equals the materialised row, the mandate and confirmation carry valid user
   * signatures, and the offer image still matches its hash.
   */
  async verify(bundleId: string): Promise<VerifyResult> {
    const checks: VerifyResult['checks'] = [];
    const add = (check: string, ok: boolean, detail?: string) => checks.push({ check, ok, detail });

    const { rows } = await this.db.$client.query<LedgerRow>(
      `select e.seq, e.bundle_id, e.type, e.payload, e.prev_hash, e.hash, e.sig, e.created_at,
              (select p.hash from bundle_events p where p.seq < e.seq order by p.seq desc limit 1) as pred_hash,
              (select n.prev_hash from bundle_events n where n.seq > e.seq order by n.seq asc limit 1) as succ_prev_hash
         from bundle_events e where e.bundle_id = $1 order by e.seq`,
      [bundleId],
    );
    add('events_present', rows.length > 0, `${rows.length} ledger rows`);

    for (const r of rows) {
      const at = `#${r.seq} ${r.type}`;
      const body = {
        bundle_id: r.bundle_id,
        type: r.type,
        payload: r.payload,
        prev_hash: r.prev_hash,
        created_at: r.created_at.toISOString(),
      };
      const recomputed = ledgerEntryHash(body);
      add(
        `hash ${at}`,
        recomputed === r.hash,
        recomputed === r.hash ? undefined : 'row content changed after signing',
      );
      add(`signature ${at}`, this.signer.verify(r.hash, r.sig));
      const expectedPrev = r.pred_hash ?? GENESIS_HASH;
      add(
        `chain_link ${at}`,
        r.prev_hash === expectedPrev,
        r.prev_hash === expectedPrev ? undefined : 'predecessor mismatch',
      );
      if (r.succ_prev_hash != null) {
        add(
          `chain_successor ${at}`,
          r.succ_prev_hash === r.hash,
          r.succ_prev_hash === r.hash ? undefined : 'next row does not link back',
        );
      }
    }

    let replayed: BundleState | null = null;
    if (rows.length > 0) {
      try {
        replayed = replay(
          rows.map(
            (r) =>
              ({
                type: r.type,
                payload: r.payload,
                bundle_id: r.bundle_id,
                created_at: r.created_at.toISOString(),
              }) as BundleEventInput,
          ),
        );
        add('replay', true);
      } catch (e) {
        add('replay', false, e instanceof Error ? e.message : String(e));
      }
    }

    const stored = await this.get(bundleId);
    const last = rows.at(-1);
    if (replayed && last) {
      const expected: EvidenceBundle = {
        ...replayed,
        prev_hash: last.prev_hash,
        hash: last.hash,
        bundle_sig: last.sig,
      };
      const same = stored !== null && canonicalize(stored.bundle) === canonicalize(expected);
      add('materialised_state', same, same ? undefined : 'bundles row differs from the replayed ledger');
    }

    const subject = replayed ?? stored?.bundle ?? null;
    if (subject) {
      const userKey = await this.userKey(subject.user_ref);
      const { user_sig, ...unsigned } = subject.intent_mandate;
      const mandateOk =
        userKey !== null &&
        verifyMessage(publicKeyFromB64(userKey), mandateSigningMessage(subject.user_ref, unsigned), user_sig);
      add('mandate_user_signature', mandateOk, userKey ? undefined : 'user has no registered key');
      if (subject.user_confirmation) {
        const c = subject.user_confirmation;
        const ok =
          userKey !== null &&
          verifyMessage(
            publicKeyFromB64(userKey),
            confirmationSigningMessage(bundleId, c.amount, c.given_at),
            c.sig,
          );
        add('confirmation_user_signature', ok);
      }
      const img = subject.offer_snapshot?.image_sha256;
      if (img) {
        const bytes = await this.blobStore.get(img);
        add('offer_image_integrity', bytes !== null, bytes ? undefined : 'image missing or altered');
      }
    }

    const failures = checks.filter((c) => !c.ok).map((c) => (c.detail ? `${c.check}: ${c.detail}` : c.check));
    return {
      ok: failures.length === 0,
      bundle_id: bundleId,
      events: rows.length,
      head_hash: last?.hash ?? null,
      chain_position: last ? Number(last.seq) : null,
      signer_fingerprint: this.signer.fingerprint,
      checks,
      failures,
    };
  }

  // ---------------------------------------------------------------- internals

  private async require(bundleId: string): Promise<BundleRecord> {
    const rec = await this.get(bundleId);
    if (!rec) throw new EvidenceError('NOT_FOUND', `bundle ${bundleId} not found`);
    return rec;
  }

  private async resolveUserKey(userRef: string, offered?: string): Promise<string> {
    const existing = await this.userKey(userRef);
    if (existing) {
      if (offered && offered !== existing) {
        throw new EvidenceError('CONFLICT', `user ${userRef} is already registered with a different key`);
      }
      return existing;
    }
    if (!offered)
      throw new EvidenceError('UNKNOWN_USER', `user ${userRef} has no registered key; send user_public_key`);
    try {
      publicKeyFromB64(offered);
    } catch {
      throw new EvidenceError('INVALID_SIGNATURE', 'user_public_key is not a base64 Ed25519 SPKI PEM');
    }
    await this.db.insert(users).values({ ref: userRef, publicKey: offered }).onConflictDoNothing();
    return (await this.userKey(userRef)) ?? offered;
  }

  /** Appends one signed row to the global chain and updates the materialised bundle, atomically. */
  private async append(
    bundleId: string,
    event: BundleEventPayload,
    platformIdForCreate?: string,
    /** Checked under the ledger lock; returning true skips the append (idempotent no-op). */
    skipIf?: (state: EvidenceBundle) => boolean,
  ): Promise<BundleRecord> {
    const client = await this.db.$client.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock($1)', [LEDGER_LOCK_KEY]);

      const cur = await client.query<{ state: EvidenceBundle; platform_id: string }>(
        'select state, platform_id from bundles where id = $1 for update',
        [bundleId],
      );
      const current = cur.rows[0];
      if (event.type !== 'created' && !current)
        throw new EvidenceError('NOT_FOUND', `bundle ${bundleId} not found`);
      if (current && skipIf?.(current.state)) {
        await client.query('commit');
        return {
          bundle: current.state,
          platformId: current.platform_id,
          merchantId: current.state.offer_snapshot?.merchant_id ?? null,
        };
      }

      const createdAt = new Date().toISOString();
      let next: BundleState;
      try {
        next = applyEvent(current ? stripChain(current.state) : null, {
          ...event,
          bundle_id: bundleId,
          created_at: createdAt,
        });
      } catch (e) {
        if (e instanceof BundleStateError) throw new EvidenceError('INVALID_STATE', e.message);
        throw e;
      }

      const head = await client.query<{ hash: string }>(
        'select hash from bundle_events order by seq desc limit 1',
      );
      const prevHash = head.rows[0]?.hash ?? GENESIS_HASH;
      const hash = ledgerEntryHash({
        bundle_id: bundleId,
        type: event.type,
        payload: event.payload,
        prev_hash: prevHash,
        created_at: createdAt,
      });
      const sig = this.signer.sign(hash);

      await client.query(
        `insert into bundle_events (bundle_id, type, payload, prev_hash, hash, sig, created_at)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [bundleId, event.type, JSON.stringify(event.payload), prevHash, hash, sig, createdAt],
      );

      const bundle: EvidenceBundle = { ...next, prev_hash: prevHash, hash, bundle_sig: sig };
      const platformId = current?.platform_id ?? platformIdForCreate;
      if (!platformId) throw new Error('platformId is required to create a bundle');
      const merchantId = bundle.offer_snapshot?.merchant_id ?? null;
      await client.query(
        `insert into bundles (id, platform_id, merchant_id, user_ref, paypal_order_id, paypal_capture_id, status, state, head_hash)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (id) do update set merchant_id = excluded.merchant_id, paypal_order_id = excluded.paypal_order_id,
           paypal_capture_id = excluded.paypal_capture_id, status = excluded.status, state = excluded.state,
           head_hash = excluded.head_hash, updated_at = now()`,
        [
          bundleId,
          platformId,
          merchantId,
          bundle.user_ref,
          bundle.paypal_order_id,
          bundle.paypal_capture_id,
          bundle.status,
          JSON.stringify(bundle),
          hash,
        ],
      );
      await client.query('commit');
      return { bundle, platformId, merchantId };
    } catch (e) {
      await client.query('rollback').catch(() => {});
      if (isUniqueViolation(e))
        throw new EvidenceError('CONFLICT', 'that PayPal order is already sealed to another bundle');
      throw e;
    } finally {
      client.release();
    }
  }
}

function stripChain(b: EvidenceBundle): BundleState {
  const { prev_hash: _p, hash: _h, bundle_sig: _s, ...state } = b;
  return state;
}

function toRecord(row: typeof bundles.$inferSelect): BundleRecord {
  return { bundle: row.state as EvidenceBundle, platformId: row.platformId, merchantId: row.merchantId };
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
}
