import { randomBytes, randomUUID } from 'node:crypto';
import type { Db } from '@provenant/db';
import { mockCaptures, mockDisputes, mockDocuments, mockOrders, mockWebhookEvents } from '@provenant/db';
import { and, asc, eq, gt } from 'drizzle-orm';
import { assertFilesAcceptable, type PayPalClient } from './client';
import { PayPalError } from './errors';
import { DisputeRel, findLink } from './links';
import type {
  AcceptClaimInput,
  AcceptClaimType,
  ActionResult,
  Capture,
  CreateOrderInput,
  Dispute,
  DisputeDocument,
  DisputeReason,
  DisputeStage,
  DisputeStatus,
  EvidenceFile,
  Link,
  ListDisputesFilter,
  ListDisputesResult,
  MakeOfferInput,
  OfferType,
  Order,
  PayPalMoney,
  ProvideEvidenceInput,
  SandboxCreateDisputeInput,
  SupportingInfoInput,
  TrackingInput,
  WebhookEvent,
  WebhookHeaders,
} from './types';

/** Receives each emitted webhook exactly as PayPal would send it (raw JSON text). */
export type WebhookSink = (rawBody: string, event: WebhookEvent) => Promise<void>;

export interface MockPayPalOptions {
  db: Db;
  /** Base URL the mock's HATEOAS links point at (e.g. http://localhost:4000/mock-paypal). */
  baseUrl: string;
  /** Where webhooks go. Omit to record them without delivering (polling-only mode). */
  webhookSink?: WebhookSink;
  merchantId?: string;
  merchantName?: string;
}

export interface BuyerOpenDisputeInput {
  /** The capture (seller transaction) being disputed. */
  capture_id: string;
  reason: DisputeReason;
  amount?: PayPalMoney;
  message: string;
  stage?: DisputeStage;
  /** Buyer evidence, e.g. a photo of what arrived. */
  documents?: EvidenceFile[];
}

const ID_CHARS = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const paypalId = (n = 17) => Array.from(randomBytes(n), (b) => ID_CHARS[b % ID_CHARS.length]).join('');
const debugId = () => randomBytes(7).toString('hex');

/**
 * Offline, deterministic stand-in for PayPal. State lives in Postgres `mock_*` tables, bodies use
 * PayPal's JSON shapes, HATEOAS links appear only when PayPal would allow the action, and every
 * change emits the matching webhook (CUSTOMER.DISPUTE.CREATED/UPDATED/RESOLVED,
 * PAYMENT.CAPTURE.COMPLETED).
 *
 * Lifecycle: open → INQUIRY/WAITING_FOR_SELLER_RESPONSE → (evidence) UNDER_REVIEW → (adjudicate) RESOLVED,
 * with offers, escalation to CHARGEBACK and accept-claim along the way.
 */
export class MockPayPal implements PayPalClient {
  readonly mode = 'mock' as const;
  private readonly pending = new Set<Promise<void>>();
  private lastUpdateMs = 0;

  constructor(private readonly o: MockPayPalOptions) {}

  // ================================================================== Orders v2

  async createOrder(input: CreateOrderInput): Promise<Order> {
    const id = paypalId();
    const now = new Date().toISOString();
    const card = input.payment_source && 'card' in input.payment_source;
    const order: Order = {
      id,
      intent: 'CAPTURE',
      status: card ? 'APPROVED' : 'PAYER_ACTION_REQUIRED',
      create_time: now,
      update_time: now,
      purchase_units: [
        {
          reference_id: 'default',
          custom_id: input.custom_id,
          invoice_id: input.invoice_id,
          description: input.description,
          amount: input.items?.length
            ? { ...input.amount, breakdown: { item_total: input.amount } }
            : input.amount,
          items: input.items,
          payee: { merchant_id: this.merchantId },
        },
      ],
      payment_source: input.payment_source ?? { paypal: {} },
    };
    order.links = this.orderLinks(order);
    await this.o.db.insert(mockOrders).values({ id, status: order.status, body: order });
    return order;
  }

  async setOrderCustomId(orderId: string, customId: string): Promise<void> {
    const order = await this.loadOrder(orderId);
    if (order.status === 'COMPLETED')
      throw unprocessable('ORDER_ALREADY_COMPLETED', 'completed orders cannot be patched');
    order.purchase_units![0]!.custom_id = customId;
    await this.saveOrder(order);
  }

  async getOrder(orderId: string): Promise<Order> {
    return this.loadOrder(orderId);
  }

  /** Buyer simulation: the payer approves the order in the PayPal popup. */
  async buyerApproveOrder(orderId: string): Promise<Order> {
    const order = await this.loadOrder(orderId);
    if (order.status === 'COMPLETED') throw unprocessable('ORDER_ALREADY_CAPTURED', 'order already captured');
    order.status = 'APPROVED';
    await this.saveOrder(order);
    return order;
  }

  async captureOrder(orderId: string): Promise<Order> {
    const order = await this.loadOrder(orderId);
    if (order.status === 'COMPLETED') throw unprocessable('ORDER_ALREADY_CAPTURED', 'order already captured');
    if (order.status !== 'APPROVED')
      throw unprocessable('ORDER_NOT_APPROVED', 'payer has not approved the order');
    const pu = order.purchase_units![0]!;
    const now = new Date().toISOString();
    const capture: Capture = {
      id: paypalId(),
      status: 'COMPLETED',
      amount: { currency_code: pu.amount!.currency_code, value: pu.amount!.value },
      custom_id: pu.custom_id,
      invoice_id: pu.invoice_id,
      final_capture: true,
      seller_protection: {
        status: 'ELIGIBLE',
        dispute_categories: ['ITEM_NOT_RECEIVED', 'UNAUTHORIZED_TRANSACTION'],
      },
      create_time: now,
      update_time: now,
      supplementary_data: { related_ids: { order_id: order.id } },
      links: [
        { href: `${this.o.baseUrl}/v2/payments/captures/{id}`, rel: 'self', method: 'GET' },
        { href: `${this.o.baseUrl}/v2/checkout/orders/${order.id}`, rel: 'up', method: 'GET' },
      ],
    };
    capture.links![0]!.href = capture.links![0]!.href.replace('{id}', capture.id);
    pu.payments = { captures: [capture] };
    order.status = 'COMPLETED';
    await this.o.db.insert(mockCaptures).values({ id: capture.id, orderId: order.id, body: capture });
    await this.saveOrder(order);
    await this.emit(
      'PAYMENT.CAPTURE.COMPLETED',
      'capture',
      '2.0',
      `Payment completed for ${capture.amount.value} ${capture.amount.currency_code}`,
      capture,
    );
    return order;
  }

  async addTracking(orderId: string, t: TrackingInput): Promise<Order> {
    const order = await this.loadOrder(orderId);
    const pu = order.purchase_units![0]!;
    if (!pu.payments?.captures?.some((c) => c.id === t.capture_id)) {
      throw unprocessable(
        'CAPTURE_ID_NOT_FOUND',
        `capture ${t.capture_id} does not belong to order ${orderId}`,
      );
    }
    const shipping = (pu.shipping ?? {}) as { trackers?: unknown[] };
    shipping.trackers = [
      ...(shipping.trackers ?? []),
      {
        id: `${t.capture_id}-${t.tracking_number}`,
        status: 'SHIPPED',
        carrier: t.carrier,
        tracking_number: t.tracking_number,
        items: t.items ?? [],
      },
    ];
    pu.shipping = shipping;
    await this.saveOrder(order);
    return order;
  }

  // ================================================================== Disputes v1

  async listDisputes(f: ListDisputesFilter = {}): Promise<ListDisputesResult> {
    const conds = [];
    if (f.update_time_after) conds.push(gt(mockDisputes.updateTime, new Date(f.update_time_after)));
    const rows = await this.o.db
      .select()
      .from(mockDisputes)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(mockDisputes.updateTime));
    let items = rows.map((r) => this.present(r.body as Dispute));
    if (f.start_time) items = items.filter((d) => d.create_time >= f.start_time!);
    if (f.disputed_transaction_id) {
      items = items.filter((d) =>
        d.disputed_transactions?.some(
          (t) =>
            t.seller_transaction_id === f.disputed_transaction_id ||
            t.buyer_transaction_id === f.disputed_transaction_id,
        ),
      );
    }
    if (f.dispute_state) items = items.filter((d) => d.dispute_state === f.dispute_state);
    const size = Math.min(Math.max(f.page_size ?? 10, 1), 50);
    const offset = f.next_page_token ? Number(Buffer.from(f.next_page_token, 'base64url').toString()) : 0;
    const page = items.slice(offset, offset + size);
    return {
      items: page.map((d) => ({
        dispute_id: d.dispute_id,
        create_time: d.create_time,
        update_time: d.update_time,
        reason: d.reason,
        status: d.status,
        dispute_amount: d.dispute_amount,
        dispute_state: d.dispute_state,
        dispute_life_cycle_stage: d.dispute_life_cycle_stage,
        dispute_channel: d.dispute_channel,
        seller_response_due_date: d.seller_response_due_date,
        links: [
          { href: `${this.o.baseUrl}/v1/customer/disputes/${d.dispute_id}`, rel: 'self', method: 'GET' },
        ],
      })),
      next_page_token:
        offset + size < items.length ? Buffer.from(String(offset + size)).toString('base64url') : undefined,
    };
  }

  async getDispute(id: string): Promise<Dispute> {
    return this.present(await this.loadDispute(id));
  }

  async provideEvidence(id: string, input: ProvideEvidenceInput): Promise<ActionResult> {
    assertFilesAcceptable(input.files);
    return this.act(id, DisputeRel.provideEvidence, async (d) => {
      const docs = await this.storeDocuments(id, input.files);
      const stage = d.dispute_life_cycle_stage;
      d.evidences = [
        ...(d.evidences ?? []),
        ...input.evidences.map((e, i) => ({
          ...e,
          documents: i === 0 ? docs : undefined,
          source: 'SUBMITTED_BY_SELLER',
          date: new Date().toISOString(),
          dispute_life_cycle_stage: stage,
        })),
      ];
      d.status = 'UNDER_REVIEW';
      return 'CUSTOMER.DISPUTE.UPDATED';
    });
  }

  async makeOffer(id: string, input: MakeOfferInput): Promise<ActionResult> {
    return this.act(id, DisputeRel.makeOffer, async (d) => {
      const allowed = this.allowedOptions(d).make_offer?.offer_types ?? [];
      if (!allowed.includes(input.offer_type))
        throw unprocessable('INVALID_OFFER_TYPE', `offer_type ${input.offer_type} is not allowed`);
      if (input.offer_type === 'REFUND' && !input.offer_amount)
        throw unprocessable('MISSING_OFFER_AMOUNT', 'offer_amount is required');
      d.offer = {
        ...d.offer,
        seller_offered_amount: input.offer_amount,
        offer_type: input.offer_type,
        history: [
          ...((d.offer?.history as unknown[]) ?? []),
          {
            offer_time: new Date().toISOString(),
            actor: 'SELLER',
            event_type: 'PROPOSED',
            offer_type: input.offer_type,
            offer_amount: input.offer_amount,
            notes: input.note,
          },
        ],
      };
      d.status = 'WAITING_FOR_BUYER_RESPONSE';
      return 'CUSTOMER.DISPUTE.UPDATED';
    });
  }

  async sendMessage(id: string, message: string, files?: EvidenceFile[]): Promise<ActionResult> {
    assertFilesAcceptable(files);
    return this.act(id, DisputeRel.sendMessage, async (d) => {
      const docs = await this.storeDocuments(id, files);
      d.messages = [
        ...(d.messages ?? []),
        { posted_by: 'SELLER', time_posted: new Date().toISOString(), content: message, documents: docs },
      ];
      return 'CUSTOMER.DISPUTE.UPDATED';
    });
  }

  async acceptClaim(id: string, input: AcceptClaimInput): Promise<ActionResult> {
    return this.act(id, DisputeRel.acceptClaim, async (d) => {
      const type: AcceptClaimType = input.accept_claim_type ?? 'REFUND';
      const allowed = this.allowedOptions(d).accept_claim?.accept_claim_types ?? [];
      if (!allowed.includes(type))
        throw unprocessable('INVALID_ACCEPT_CLAIM_TYPE', `accept_claim_type ${type} is not allowed`);
      if (type === 'PARTIAL_REFUND' && !input.refund_amount)
        throw unprocessable('MISSING_REFUND_AMOUNT', 'refund_amount is required for PARTIAL_REFUND');
      const refunded = type === 'PARTIAL_REFUND' ? input.refund_amount! : d.dispute_amount;
      d.status = 'RESOLVED';
      d.dispute_outcome = { outcome_code: 'RESOLVED_BUYER_FAVOUR', amount_refunded: refunded };
      d.messages = [
        ...(d.messages ?? []),
        { posted_by: 'SELLER', time_posted: new Date().toISOString(), content: input.note },
      ];
      return 'CUSTOMER.DISPUTE.RESOLVED';
    });
  }

  async provideSupportingInfo(id: string, input: SupportingInfoInput): Promise<ActionResult> {
    assertFilesAcceptable(input.files);
    return this.act(id, DisputeRel.provideSupportingInfo, async (d) => {
      const docs = await this.storeDocuments(id, input.files);
      d.supporting_info = [
        ...(d.supporting_info ?? []),
        {
          notes: input.notes,
          documents: docs,
          source: 'SUBMITTED_BY_SELLER',
          provided_time: new Date().toISOString(),
        },
      ];
      d.status = 'UNDER_REVIEW';
      return 'CUSTOMER.DISPUTE.UPDATED';
    });
  }

  async downloadDocument(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    const docId = url.split('/').pop() ?? '';
    const [doc] = await this.o.db.select().from(mockDocuments).where(eq(mockDocuments.id, docId));
    if (!doc) throw new PayPalError(404, 'RESOURCE_NOT_FOUND', 'document not found', debugId());
    return { bytes: Buffer.from(doc.bytes, 'base64'), contentType: doc.contentType };
  }

  // ================================================================== sandbox-only + buyer simulation

  async sandboxCreateDispute(input: SandboxCreateDisputeInput): Promise<Dispute> {
    const [cap] = await this.o.db
      .select()
      .from(mockCaptures)
      .where(eq(mockCaptures.id, input.buyer_transaction_id));
    if (!cap)
      throw new PayPalError(422, 'UNPROCESSABLE_ENTITY', 'unknown transaction', debugId(), [
        { issue: 'INVALID_TRANSACTION_ID' },
      ]);
    return this.buyerOpenDispute({
      capture_id: cap.id,
      reason: input.reason,
      amount: input.dispute_amount,
      message: input.message ?? 'Opened via sandbox create-dispute',
    });
  }

  async sandboxRequireEvidence(
    id: string,
    action: 'SELLER_EVIDENCE' | 'BUYER_EVIDENCE',
  ): Promise<ActionResult> {
    return this.act(id, DisputeRel.requireEvidence, async (d) => {
      d.status = action === 'SELLER_EVIDENCE' ? 'WAITING_FOR_SELLER_RESPONSE' : 'WAITING_FOR_BUYER_RESPONSE';
      return 'CUSTOMER.DISPUTE.UPDATED';
    });
  }

  async sandboxAdjudicate(id: string, outcome: 'BUYER_FAVOR' | 'SELLER_FAVOR'): Promise<ActionResult> {
    return this.act(id, DisputeRel.adjudicate, async (d) => {
      d.status = 'RESOLVED';
      d.dispute_outcome =
        outcome === 'BUYER_FAVOR'
          ? { outcome_code: 'RESOLVED_BUYER_FAVOUR', amount_refunded: d.dispute_amount }
          : { outcome_code: 'RESOLVED_SELLER_FAVOUR' };
      return 'CUSTOMER.DISPUTE.RESOLVED';
    });
  }

  /** Buyer simulation: open a dispute against a capture, optionally with photo evidence. */
  async buyerOpenDispute(input: BuyerOpenDisputeInput): Promise<Dispute> {
    const [cap] = await this.o.db.select().from(mockCaptures).where(eq(mockCaptures.id, input.capture_id));
    if (!cap)
      throw new PayPalError(404, 'RESOURCE_NOT_FOUND', `capture ${input.capture_id} not found`, debugId());
    const capture = cap.body as Capture;
    const order = await this.loadOrder(cap.orderId);
    const id = `PP-D-${100000 + Math.floor(Math.random() * 899999)}`;
    const now = this.nextUpdateTime();
    const stage = input.stage ?? 'INQUIRY';
    const docs = await this.storeDocuments(id, input.documents);
    const amount = input.amount ?? capture.amount;
    const dispute: Dispute = {
      dispute_id: id,
      create_time: now,
      update_time: now,
      disputed_transactions: [
        {
          buyer_transaction_id: `B${paypalId(16)}`,
          seller_transaction_id: capture.id,
          create_time: capture.create_time,
          transaction_status: 'COMPLETED',
          gross_amount: capture.amount,
          invoice_number: capture.invoice_id,
          custom: capture.custom_id,
          buyer: { name: 'Sandbox Buyer' },
          seller: { merchant_id: this.merchantId, name: this.o.merchantName ?? 'Provenant demo store' },
          items: (order.purchase_units?.[0]?.items ?? []).map((i) => ({
            item_name: i.name,
            item_quantity: i.quantity,
            reason: input.reason,
            item_type: 'PRODUCT',
          })),
        },
      ],
      reason: input.reason,
      status: 'WAITING_FOR_SELLER_RESPONSE',
      dispute_amount: amount,
      dispute_life_cycle_stage: stage,
      dispute_channel: 'INTERNAL',
      messages: stage === 'INQUIRY' ? [{ posted_by: 'BUYER', time_posted: now, content: input.message }] : [],
      evidences: [
        {
          evidence_type: 'CREATE',
          notes: input.message,
          source: 'SUBMITTED_BY_BUYER',
          date: now,
          dispute_life_cycle_stage: stage,
          documents: docs,
        },
      ],
      seller_response_due_date: new Date(Date.parse(now) + 20 * 86_400_000).toISOString(),
      offer: { buyer_requested_amount: amount },
    };
    await this.o.db
      .insert(mockDisputes)
      .values({ id, captureId: capture.id, body: dispute, updateTime: new Date(now) });
    const presented = this.present(dispute);
    await this.emit(
      'CUSTOMER.DISPUTE.CREATED',
      'dispute',
      '1.0',
      `A new dispute opened with Case # ${id}`,
      presented,
    );
    return presented;
  }

  /** Buyer simulation: accept the merchant's offer. */
  async buyerAcceptOffer(id: string): Promise<Dispute> {
    const d = await this.loadDispute(id);
    if (d.status !== 'WAITING_FOR_BUYER_RESPONSE' || !d.offer?.seller_offered_amount) {
      throw unprocessable('NO_OFFER', 'there is no pending offer to accept');
    }
    d.status = 'RESOLVED';
    d.dispute_outcome = { outcome_code: 'ACCEPTED', amount_refunded: d.offer.seller_offered_amount };
    await this.saveDispute(d, 'CUSTOMER.DISPUTE.RESOLVED');
    return this.present(d);
  }

  /** Buyer simulation: escalate an inquiry to a claim (stage CHARGEBACK). */
  async buyerEscalate(id: string): Promise<Dispute> {
    const d = await this.loadDispute(id);
    if (d.dispute_life_cycle_stage !== 'INQUIRY' || d.status === 'RESOLVED')
      throw unprocessable('CANNOT_ESCALATE', 'only open inquiries escalate');
    d.dispute_life_cycle_stage = 'CHARGEBACK';
    d.status = 'WAITING_FOR_SELLER_RESPONSE';
    await this.saveDispute(d, 'CUSTOMER.DISPUTE.UPDATED');
    return this.present(d);
  }

  // ================================================================== webhooks

  async verifyWebhookSignature(_headers: WebhookHeaders, _rawBody: string): Promise<boolean> {
    // Mock events are produced in-process; there is no PayPal certificate to check against.
    return true;
  }

  /** Waits for in-flight webhook deliveries (tests and scripted scenarios). */
  async flushWebhooks(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }

  /** Re-delivers every recorded event (used by `pnpm dev` restarts and tests). */
  async listEmittedEvents(): Promise<WebhookEvent[]> {
    const rows = await this.o.db.select().from(mockWebhookEvents).orderBy(asc(mockWebhookEvents.createdAt));
    return rows.map((r) => r.body as WebhookEvent);
  }

  // ================================================================== internals

  private get merchantId(): string {
    return this.o.merchantId ?? 'MOCKMERCHANT01';
  }

  private orderLinks(order: Order): Link[] {
    const self = `${this.o.baseUrl}/v2/checkout/orders/${order.id}`;
    const links: Link[] = [{ href: self, rel: 'self', method: 'GET' }];
    if (order.status === 'PAYER_ACTION_REQUIRED' || order.status === 'CREATED') {
      links.push({
        href: `${this.o.baseUrl}/_buyer/orders/${order.id}/approve`,
        rel: 'payer-action',
        method: 'GET',
      });
    }
    if (order.status === 'APPROVED') links.push({ href: `${self}/capture`, rel: 'capture', method: 'POST' });
    if (order.status !== 'COMPLETED') links.push({ href: self, rel: 'update', method: 'PATCH' });
    return links;
  }

  private async loadOrder(id: string): Promise<Order> {
    const [row] = await this.o.db.select().from(mockOrders).where(eq(mockOrders.id, id));
    if (!row)
      throw new PayPalError(404, 'RESOURCE_NOT_FOUND', `order ${id} not found`, debugId(), [
        { issue: 'INVALID_RESOURCE_ID' },
      ]);
    return row.body as Order;
  }

  private async saveOrder(order: Order): Promise<void> {
    order.update_time = new Date().toISOString();
    order.links = this.orderLinks(order);
    await this.o.db
      .update(mockOrders)
      .set({ status: order.status, body: order, updatedAt: new Date() })
      .where(eq(mockOrders.id, order.id));
  }

  private async loadDispute(id: string): Promise<Dispute> {
    const [row] = await this.o.db.select().from(mockDisputes).where(eq(mockDisputes.id, id));
    if (!row)
      throw new PayPalError(404, 'RESOURCE_NOT_FOUND', `dispute ${id} not found`, debugId(), [
        { issue: 'INVALID_RESOURCE_ID' },
      ]);
    return row.body as Dispute;
  }

  private async saveDispute(d: Dispute, event: DisputeEventType): Promise<void> {
    d.update_time = this.nextUpdateTime();
    const stored = { ...d };
    delete stored.links;
    delete stored.allowed_response_options;
    delete stored.dispute_state;
    await this.o.db
      .update(mockDisputes)
      .set({ body: stored, updateTime: new Date(d.update_time) })
      .where(eq(mockDisputes.id, d.dispute_id));
    const summary =
      event === 'CUSTOMER.DISPUTE.RESOLVED'
        ? `A dispute was resolved with case # ${d.dispute_id}`
        : `A dispute was updated with case # ${d.dispute_id}`;
    await this.emit(event, 'dispute', '1.0', summary, this.present(d));
  }

  /** Runs a dispute action only if PayPal would show its HATEOAS link, then persists and emits. */
  private async act(
    id: string,
    rel: string,
    apply: (d: Dispute) => Promise<DisputeEventType>,
  ): Promise<ActionResult> {
    const d = this.present(await this.loadDispute(id));
    if (!findLink(d.links, rel)) {
      throw new PayPalError(
        422,
        'UNPROCESSABLE_ENTITY',
        `The requested action (${rel}) is not allowed in the dispute's current state`,
        debugId(),
        [{ issue: 'NOT_ALLOWED', description: `status ${d.status}, stage ${d.dispute_life_cycle_stage}` }],
      );
    }
    const event = await apply(d);
    await this.saveDispute(d, event);
    return {
      links: [{ href: `${this.o.baseUrl}/v1/customer/disputes/${id}`, rel: 'self', method: 'GET' }],
      request_id: randomUUID(),
    };
  }

  /** Adds the derived fields PayPal computes: dispute_state, allowed_response_options and links. */
  private present(stored: Dispute): Dispute {
    const d: Dispute = structuredClone(stored);
    d.dispute_state = disputeState(d.status);
    d.allowed_response_options = this.allowedOptions(d);
    d.links = this.disputeLinks(d);
    return d;
  }

  private allowedOptions(d: Dispute): NonNullable<Dispute['allowed_response_options']> {
    if (d.status === 'RESOLVED') return {};
    const inquiry = d.dispute_life_cycle_stage === 'INQUIRY';
    const claimTypes: AcceptClaimType[] = inquiry
      ? ['REFUND', 'PARTIAL_REFUND', 'REFUND_WITH_RETURN']
      : ['REFUND', 'REFUND_WITH_RETURN'];
    const offerTypes: OfferType[] = ['REFUND', 'REFUND_WITH_RETURN'];
    return {
      accept_claim: { accept_claim_types: claimTypes },
      ...(inquiry && d.status === 'WAITING_FOR_SELLER_RESPONSE'
        ? { make_offer: { offer_types: offerTypes } }
        : {}),
    };
  }

  private disputeLinks(d: Dispute): Link[] {
    const base = `${this.o.baseUrl}/v1/customer/disputes/${d.dispute_id}`;
    const link = (rel: string, path: string, method = 'POST'): Link => ({
      href: `${base}${path}`,
      rel,
      method,
    });
    const links: Link[] = [link('self', '', 'GET')];
    if (d.status === 'RESOLVED') return links;
    const inquiry = d.dispute_life_cycle_stage === 'INQUIRY';
    const status: DisputeStatus = d.status;
    if (status === 'WAITING_FOR_SELLER_RESPONSE') {
      if (inquiry)
        links.push(
          link(DisputeRel.sendMessage, '/send-message'),
          link(DisputeRel.escalate, '/escalate'),
          link(DisputeRel.makeOffer, '/make-offer'),
        );
      links.push(
        link(DisputeRel.acceptClaim, '/accept-claim'),
        link(DisputeRel.provideEvidence, '/provide-evidence'),
      );
      if (!inquiry) links.push(link(DisputeRel.provideSupportingInfo, '/provide-supporting-info'));
    } else if (status === 'WAITING_FOR_BUYER_RESPONSE') {
      if (inquiry) links.push(link(DisputeRel.sendMessage, '/send-message'));
      links.push(link(DisputeRel.acceptClaim, '/accept-claim'));
    } else if (status === 'UNDER_REVIEW') {
      links.push(
        link(DisputeRel.adjudicate, '/adjudicate'),
        link(DisputeRel.requireEvidence, '/require-evidence'),
      );
      if (!inquiry) links.push(link(DisputeRel.provideSupportingInfo, '/provide-supporting-info'));
      links.push(link(DisputeRel.acceptClaim, '/accept-claim'));
    }
    return links;
  }

  private async storeDocuments(
    disputeId: string,
    files?: EvidenceFile[],
  ): Promise<DisputeDocument[] | undefined> {
    if (!files?.length) return undefined;
    const docs: DisputeDocument[] = [];
    for (const f of files) {
      const id = `DOC-${paypalId(12)}`;
      await this.o.db.insert(mockDocuments).values({
        id,
        disputeId,
        name: f.name,
        contentType: f.contentType,
        bytes: Buffer.from(f.bytes).toString('base64'),
      });
      docs.push({ name: f.name, url: `${this.o.baseUrl}/v1/customer/disputes/${disputeId}/documents/${id}` });
    }
    return docs;
  }

  /** Strictly increasing ISO timestamps so `update_time_after` polling never misses a change. */
  private nextUpdateTime(): string {
    const ms = Math.max(Date.now(), this.lastUpdateMs + 1);
    this.lastUpdateMs = ms;
    return new Date(ms).toISOString();
  }

  private async emit(
    eventType: string,
    resourceType: string,
    resourceVersion: string,
    summary: string,
    resource: unknown,
  ): Promise<void> {
    const id = `WH-${paypalId(17)}-${paypalId(17)}`;
    const event: WebhookEvent = {
      id,
      event_version: '1.0',
      create_time: new Date().toISOString(),
      resource_type: resourceType,
      resource_version: resourceVersion,
      event_type: eventType,
      summary,
      resource,
      links: [
        { href: `${this.o.baseUrl}/v1/notifications/webhooks-events/${id}`, rel: 'self', method: 'GET' },
        {
          href: `${this.o.baseUrl}/v1/notifications/webhooks-events/${id}/resend`,
          rel: 'resend',
          method: 'POST',
        },
      ],
    };
    await this.o.db.insert(mockWebhookEvents).values({ id, eventType, body: event });
    const sink = this.o.webhookSink;
    if (!sink) return;
    // Deliver after the API call returns, like PayPal; failures are recorded, never thrown.
    const raw = JSON.stringify(event);
    const p = new Promise<void>((resolve) => setImmediate(resolve))
      .then(() => sink(raw, event))
      .then(() =>
        this.o.db
          .update(mockWebhookEvents)
          .set({ deliveredAt: new Date() })
          .where(eq(mockWebhookEvents.id, id)),
      )
      .catch((e: unknown) =>
        this.o.db
          .update(mockWebhookEvents)
          .set({ error: e instanceof Error ? e.message : String(e) })
          .where(eq(mockWebhookEvents.id, id)),
      )
      .then(() => undefined)
      .finally(() => this.pending.delete(p));
    this.pending.add(p);
  }
}

type DisputeEventType = 'CUSTOMER.DISPUTE.UPDATED' | 'CUSTOMER.DISPUTE.RESOLVED';

function disputeState(status: DisputeStatus): string {
  switch (status) {
    case 'WAITING_FOR_SELLER_RESPONSE':
      return 'REQUIRED_ACTION';
    case 'WAITING_FOR_BUYER_RESPONSE':
      return 'REQUIRED_OTHER_PARTY_ACTION';
    case 'UNDER_REVIEW':
      return 'UNDER_PAYPAL_REVIEW';
    case 'RESOLVED':
      return 'RESOLVED';
    default:
      return 'OPEN_INQUIRIES';
  }
}

function unprocessable(issue: string, description: string): PayPalError {
  return new PayPalError(
    422,
    'UNPROCESSABLE_ENTITY',
    'The requested action could not be performed, semantically incorrect, or failed business validation.',
    debugId(),
    [{ issue, description }],
  );
}

/** Posts mock webhooks to a URL (normally the Provenant server's /webhooks/paypal) with PayPal-style headers. */
export function httpWebhookSink(url: string, fetchImpl: typeof fetch = fetch): WebhookSink {
  return async (rawBody) => {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'paypal-transmission-id': randomUUID(),
        'paypal-transmission-time': new Date().toISOString(),
        'paypal-transmission-sig': 'mock',
        'paypal-auth-algo': 'SHA256withRSA',
        'paypal-cert-url': 'https://mock.invalid/cert',
      },
      body: rawBody,
    });
    if (!res.ok) throw new Error(`webhook sink returned ${res.status}`);
  };
}
