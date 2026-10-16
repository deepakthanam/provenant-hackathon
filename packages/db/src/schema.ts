import {
  bigserial,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/** Pseudonymous buyers: no names or emails, just a ref and the key they sign mandates with. */
export const users = pgTable('users', {
  ref: text('ref').primaryKey(),
  publicKey: text('public_key').notNull(),
  createdAt: createdAt(),
});

export const agentPlatforms = pgTable('agent_platforms', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: createdAt(),
});

export const merchants = pgTable('merchants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  paypalMerchantId: text('paypal_merchant_id'),
  /** REFUND or REFUND_WITH_RETURN, used when the verdict is MERCHANT_MISREPRESENTED. */
  misrepresentationClaimType: text('misrepresentation_claim_type').notNull().default('REFUND'),
  createdAt: createdAt(),
});

/** Bearer keys. Only the SHA-256 of the key is stored. */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    keyHash: text('key_hash').notNull(),
    kind: text('kind').notNull(), // 'platform' | 'merchant' | 'admin'
    platformId: text('platform_id').references(() => agentPlatforms.id),
    merchantId: text('merchant_id').references(() => merchants.id),
    label: text('label'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('api_keys_hash_idx').on(t.keyHash)],
);

/** Current materialised state of each bundle. The source of truth is bundle_events. */
export const bundles = pgTable(
  'bundles',
  {
    id: text('id').primaryKey(),
    platformId: text('platform_id').notNull(),
    merchantId: text('merchant_id'),
    userRef: text('user_ref').notNull(),
    paypalOrderId: text('paypal_order_id'),
    paypalCaptureId: text('paypal_capture_id'),
    status: text('status').notNull(),
    state: jsonb('state').notNull(),
    headHash: text('head_hash').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('bundles_order_idx').on(t.paypalOrderId),
    index('bundles_capture_idx').on(t.paypalCaptureId),
  ],
);

/** Append-only global hash chain. Every row links to the previous row of the whole ledger. */
export const bundleEvents = pgTable(
  'bundle_events',
  {
    seq: bigserial('seq', { mode: 'number' }).primaryKey(),
    bundleId: text('bundle_id').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    prevHash: text('prev_hash').notNull(),
    hash: text('hash').notNull(),
    sig: text('sig').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('bundle_events_bundle_idx').on(t.bundleId), uniqueIndex('bundle_events_hash_idx').on(t.hash)],
);

export const blobs = pgTable('blobs', {
  sha256: text('sha256').primaryKey(),
  path: text('path').notNull(),
  contentType: text('content_type').notNull(),
  size: integer('size').notNull(),
  createdAt: createdAt(),
});

/** Mirror of PayPal disputes (raw JSON kept, including HATEOAS links). */
export const disputes = pgTable(
  'disputes',
  {
    id: text('id').primaryKey(),
    reason: text('reason').notNull(),
    status: text('status').notNull(),
    stage: text('stage'),
    amountValue: numeric('amount_value', { precision: 14, scale: 2 }),
    amountCurrency: text('amount_currency'),
    transactionId: text('transaction_id'),
    bundleId: text('bundle_id'),
    raw: jsonb('raw').notNull(),
    links: jsonb('links').notNull().default([]),
    paypalCreateTime: timestamp('paypal_create_time', { withTimezone: true }),
    paypalUpdateTime: timestamp('paypal_update_time', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('disputes_tx_idx').on(t.transactionId)],
);

/** Webhook deliveries and poll observations. The idempotency key is the PayPal event id. */
export const disputeEvents = pgTable(
  'dispute_events',
  {
    id: text('id').primaryKey(),
    source: text('source').notNull(), // 'webhook' | 'poll' | 'action'
    eventType: text('event_type').notNull(),
    disputeId: text('dispute_id'),
    payload: jsonb('payload').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [index('dispute_events_dispute_idx').on(t.disputeId)],
);

export const verdicts = pgTable(
  'verdicts',
  {
    id: text('id').primaryKey(),
    disputeId: text('dispute_id').notNull(),
    bundleId: text('bundle_id'),
    verdict: text('verdict').notNull(),
    confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull(),
    reasons: jsonb('reasons').notNull(),
    ruleResults: jsonb('rule_results').notNull(),
    modelFindings: jsonb('model_findings').notNull(),
    modelId: text('model_id'),
    promptHash: text('prompt_hash'),
    inputsHash: text('inputs_hash').notNull(),
    rawModelOutput: text('raw_model_output'),
    /** Model notes, consistency flag, dropped (uncited) differences and any error. */
    modelMeta: jsonb('model_meta'),
    inputs: jsonb('inputs').notNull(),
    recommendedAction: jsonb('recommended_action').notNull(),
    // PENDING | APPROVED | REJECTED | EXECUTED | FAILED | SUPERSEDED
    status: text('status').notNull().default('PENDING'),
    approvedBy: text('approved_by'),
    executedAction: jsonb('executed_action'),
    paypalResponse: jsonb('paypal_response'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('verdicts_dispute_idx').on(t.disputeId)],
);

/** Planned and executed PayPal API calls with request and response. */
export const actions = pgTable(
  'actions',
  {
    id: text('id').primaryKey(),
    disputeId: text('dispute_id').notNull(),
    verdictId: text('verdict_id'),
    kind: text('kind').notNull(),
    // PLANNED | EXECUTED | FAILED | ACTION_NOT_AVAILABLE | REJECTED
    status: text('status').notNull(),
    request: jsonb('request'),
    response: jsonb('response'),
    debugId: text('debug_id'),
    requestId: text('request_id'),
    createdAt: createdAt(),
    executedAt: timestamp('executed_at', { withTimezone: true }),
  },
  (t) => [index('actions_dispute_idx').on(t.disputeId)],
);

export const liabilityLedger = pgTable(
  'liability_ledger',
  {
    id: text('id').primaryKey(),
    platformId: text('platform_id').notNull(),
    disputeId: text('dispute_id').notNull(),
    verdictId: text('verdict_id').notNull(),
    amountValue: numeric('amount_value', { precision: 14, scale: 2 }).notNull(),
    currency: text('currency').notNull(),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('liability_verdict_idx').on(t.verdictId)],
);

/** Small bits of server state, e.g. the dispute poller's update_time watermark. */
export const kv = pgTable('kv', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------------------------
// MockPayPal state (PAYPAL_MODE=mock). Bodies are stored in PayPal's own JSON shapes.

export const mockOrders = pgTable('mock_orders', {
  id: text('id').primaryKey(),
  status: text('status').notNull(),
  body: jsonb('body').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const mockCaptures = pgTable(
  'mock_captures',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id').notNull(),
    body: jsonb('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('mock_captures_order_idx').on(t.orderId)],
);

export const mockDisputes = pgTable(
  'mock_disputes',
  {
    id: text('id').primaryKey(),
    captureId: text('capture_id').notNull(),
    body: jsonb('body').notNull(),
    updateTime: timestamp('update_time', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('mock_disputes_update_idx').on(t.updateTime)],
);

export const mockDocuments = pgTable('mock_documents', {
  id: text('id').primaryKey(),
  disputeId: text('dispute_id').notNull(),
  name: text('name').notNull(),
  contentType: text('content_type').notNull(),
  bytes: text('bytes_b64').notNull(),
  createdAt: createdAt(),
});

export const mockWebhookEvents = pgTable('mock_webhook_events', {
  id: text('id').primaryKey(),
  eventType: text('event_type').notNull(),
  body: jsonb('body').notNull(),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  error: text('error'),
  createdAt: createdAt(),
});
