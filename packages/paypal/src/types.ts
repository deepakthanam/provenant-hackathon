/**
 * PayPal REST shapes used by Provenant. Field names follow PayPal's Orders v2 and Disputes v1
 * schemas exactly (snake_case); only the fields we read are typed, the rest pass through.
 */

export interface PayPalMoney {
  currency_code: string;
  value: string;
}

export interface Link {
  href: string;
  rel: string;
  method?: string;
}

// ------------------------------------------------------------------ Orders v2

export interface OrderItem {
  name: string;
  quantity: string;
  unit_amount: PayPalMoney;
  sku?: string;
  category?: 'PHYSICAL_GOODS' | 'DIGITAL_GOODS' | 'DONATION';
  description?: string;
  url?: string;
  image_url?: string;
}

export interface CreateOrderInput {
  /** Becomes purchase_units[0].custom_id; Provenant puts the bundle id here. */
  custom_id?: string;
  amount: PayPalMoney;
  items?: OrderItem[];
  description?: string;
  invoice_id?: string;
  return_url?: string;
  cancel_url?: string;
  /** Sandbox card payments skip buyer approval (useful for contract tests). */
  payment_source?: Record<string, unknown>;
}

export interface Capture {
  id: string;
  status: string;
  amount: PayPalMoney;
  custom_id?: string;
  invoice_id?: string;
  final_capture?: boolean;
  create_time?: string;
  update_time?: string;
  supplementary_data?: { related_ids?: { order_id?: string } };
  links?: Link[];
  [k: string]: unknown;
}

export interface PurchaseUnit {
  reference_id?: string;
  amount?: PayPalMoney & { breakdown?: unknown };
  custom_id?: string;
  invoice_id?: string;
  description?: string;
  items?: OrderItem[];
  payments?: { captures?: Capture[] };
  [k: string]: unknown;
}

export interface Order {
  id: string;
  status: 'CREATED' | 'SAVED' | 'APPROVED' | 'VOIDED' | 'COMPLETED' | 'PAYER_ACTION_REQUIRED';
  intent?: string;
  purchase_units?: PurchaseUnit[];
  links?: Link[];
  create_time?: string;
  update_time?: string;
  [k: string]: unknown;
}

export interface TrackingInput {
  capture_id: string;
  tracking_number: string;
  carrier: string;
  carrier_name_other?: string;
  notify_payer?: boolean;
  items?: Array<{ name: string; quantity: string; sku?: string }>;
}

// ------------------------------------------------------------------ Disputes v1

export type DisputeStatus =
  | 'OPEN'
  | 'WAITING_FOR_BUYER_RESPONSE'
  | 'WAITING_FOR_SELLER_RESPONSE'
  | 'UNDER_REVIEW'
  | 'RESOLVED'
  | 'OTHER';

export type DisputeStage = 'INQUIRY' | 'CHARGEBACK' | 'PRE_ARBITRATION' | 'ARBITRATION';

export type DisputeReason =
  | 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED'
  | 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED'
  | 'UNAUTHORISED'
  | 'CREDIT_NOT_PROCESSED'
  | 'DUPLICATE_TRANSACTION'
  | 'INCORRECT_AMOUNT'
  | 'PAYMENT_BY_OTHER_MEANS'
  | 'CANCELED_RECURRING_BILLING'
  | 'PROBLEM_WITH_REMITTANCE'
  | 'OTHER';

export type AcceptClaimType =
  | 'REFUND'
  | 'REFUND_WITH_RETURN'
  | 'PARTIAL_REFUND'
  | 'REFUND_WITH_RETURN_SHIPMENT_LABEL';
export type OfferType =
  | 'REFUND'
  | 'REFUND_WITH_RETURN'
  | 'REFUND_WITH_REPLACEMENT'
  | 'REPLACEMENT_WITHOUT_REFUND';

export interface DisputedTransaction {
  buyer_transaction_id?: string;
  /** The merchant-side transaction: the capture id. */
  seller_transaction_id?: string;
  create_time?: string;
  transaction_status?: string;
  gross_amount?: PayPalMoney;
  invoice_number?: string;
  /** Carries the order's custom_id. */
  custom?: string;
  seller?: { merchant_id?: string; name?: string; email?: string };
  items?: Array<{ item_name?: string; item_quantity?: string; reason?: DisputeReason; [k: string]: unknown }>;
  [k: string]: unknown;
}

export interface DisputeDocument {
  name: string;
  url?: string;
}

export interface DisputeEvidence {
  evidence_type: string;
  evidence_info?: {
    tracking_info?: Array<{ carrier_name: string; tracking_number: string; tracking_url?: string }>;
    refund_ids?: string[];
  };
  documents?: DisputeDocument[];
  notes?: string;
  source?: string;
  date?: string;
  dispute_life_cycle_stage?: DisputeStage;
}

export interface DisputeMessage {
  posted_by: 'BUYER' | 'SELLER' | string;
  time_posted: string;
  content: string;
  documents?: DisputeDocument[];
}

export interface Dispute {
  dispute_id: string;
  create_time: string;
  update_time: string;
  disputed_transactions?: DisputedTransaction[];
  reason: DisputeReason;
  status: DisputeStatus;
  dispute_amount: PayPalMoney;
  dispute_state?: string;
  dispute_life_cycle_stage?: DisputeStage;
  dispute_channel?: 'INTERNAL' | 'EXTERNAL' | 'ALERT';
  dispute_outcome?: { outcome_code: string; amount_refunded?: PayPalMoney };
  messages?: DisputeMessage[];
  evidences?: DisputeEvidence[];
  supporting_info?: Array<{
    notes?: string;
    documents?: DisputeDocument[];
    source?: string;
    provided_time?: string;
  }>;
  offer?: {
    buyer_requested_amount?: PayPalMoney;
    seller_offered_amount?: PayPalMoney;
    offer_type?: OfferType;
    history?: unknown[];
  };
  seller_response_due_date?: string;
  buyer_response_due_date?: string;
  allowed_response_options?: {
    accept_claim?: { accept_claim_types?: AcceptClaimType[] };
    make_offer?: { offer_types?: OfferType[] };
    acknowledge_return_item?: { acknowledgement_types?: string[] };
  };
  links?: Link[];
  [k: string]: unknown;
}

/** List-disputes items are a summary subset of the dispute. */
export type DisputeSummary = Pick<
  Dispute,
  | 'dispute_id'
  | 'create_time'
  | 'update_time'
  | 'reason'
  | 'status'
  | 'dispute_amount'
  | 'dispute_state'
  | 'dispute_life_cycle_stage'
  | 'dispute_channel'
  | 'seller_response_due_date'
  | 'links'
>;

export interface ListDisputesFilter {
  update_time_after?: string;
  start_time?: string;
  disputed_transaction_id?: string;
  dispute_state?: string;
  page_size?: number;
  next_page_token?: string;
}

export interface ListDisputesResult {
  items: DisputeSummary[];
  next_page_token?: string;
}

/** A file attached to a dispute action. PayPal accepts jpg, jpeg, gif, png and pdf, < 10 MB each, 50 MB total. */
export interface EvidenceFile {
  name: string;
  contentType: 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/gif';
  bytes: Uint8Array;
}

export interface ProvideEvidenceInput {
  evidences: Array<Pick<DisputeEvidence, 'evidence_type' | 'evidence_info' | 'notes'>>;
  files?: EvidenceFile[];
}

export interface MakeOfferInput {
  note: string;
  offer_type: OfferType;
  offer_amount?: PayPalMoney;
  invoice_id?: string;
}

export interface AcceptClaimInput {
  note: string;
  accept_claim_type?: AcceptClaimType;
  refund_amount?: PayPalMoney;
  accept_claim_reason?: string;
  invoice_id?: string;
  return_shipping_address?: Record<string, unknown>;
  files?: EvidenceFile[];
}

export interface SupportingInfoInput {
  notes: string;
  files?: EvidenceFile[];
}

/** What every dispute action returns: PayPal's HATEOAS links plus our idempotency key. */
export interface ActionResult {
  links: Link[];
  request_id: string;
  debug_id?: string;
}

export interface SandboxCreateDisputeInput {
  /** The buyer-side transaction id (sandbox flow per PayPal's testing guide). */
  buyer_transaction_id: string;
  reason: DisputeReason;
  dispute_amount: PayPalMoney;
  message?: string;
  /** Sandbox buyer email for the PayPal-Auth-Assertion header. */
  buyer_email?: string;
}

// ------------------------------------------------------------------ Webhooks

export interface WebhookEvent<R = unknown> {
  id: string;
  event_version: string;
  create_time: string;
  resource_type: string;
  resource_version?: string;
  event_type: string;
  summary: string;
  resource: R;
  links?: Link[];
}

export type WebhookHeaders = Record<string, string | string[] | undefined>;

export const DISPUTE_EVENTS = [
  'CUSTOMER.DISPUTE.CREATED',
  'CUSTOMER.DISPUTE.UPDATED',
  'CUSTOMER.DISPUTE.RESOLVED',
] as const;
