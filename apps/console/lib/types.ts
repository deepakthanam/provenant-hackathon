/** Shapes returned by the Provenant API (see /docs on the API server). */

export type Verdict =
  | 'WITHIN_MANDATE'
  | 'AGENT_OUT_OF_BOUNDS'
  | 'MERCHANT_MISREPRESENTED'
  | 'SHARED_FAULT'
  | 'INSUFFICIENT_EVIDENCE';

export interface Money {
  value: string;
  currency: string;
}

export interface DisputeSummary {
  id: string;
  reason: string;
  status: string;
  stage: string | null;
  amount: Money | null;
  transaction_id: string | null;
  bundle_id: string | null;
  link_basis: string | null;
  paypal_create_time: string | null;
  paypal_update_time: string | null;
  verdict: Verdict | null;
  confidence: number | null;
  verdict_status: string | null;
  planned_action: { kind: string; available: boolean } | null;
  age_hours: number | null;
}

export interface RuleResult {
  rule: string;
  passed: boolean;
  skipped: boolean;
  detail: string;
  field_ref?: string;
}

export interface Finding {
  attribute: string;
  snapshot_value: string;
  claimed_value: string;
  snapshot_field_ref: string;
  severity: 'minor' | 'material' | 'critical';
}

export interface PlannedAction {
  kind: string;
  link_rel: string | null;
  available: boolean;
  request: Record<string, unknown> | null;
  refund_amount: Money | null;
  liability: { platform_id: string; amount: Money } | null;
  explanation: string;
}

export interface VerdictView {
  id: string;
  verdict: Verdict;
  confidence: number;
  status: string;
  reasons: Array<{ text: string; ref: string }>;
  rule_results: RuleResult[];
  model_findings: Finding[];
  model_id: string | null;
  model_meta: {
    notes?: string;
    claim_consistent_with_snapshot?: boolean;
    dropped?: Array<{ why: string }>;
    error?: string | null;
  } | null;
  prompt_hash: string | null;
  inputs_hash: string;
  inputs_summary: {
    buyer_messages: string[];
    buyer_images: Array<{ name: string; sha256: string; content_type: string }>;
    snapshot_image_sha256: string | null;
    link_basis: string | null;
  };
  recommended_action: PlannedAction;
  approved_by: string | null;
  executed_action: Record<string, unknown> | null;
  paypal_response: unknown;
  created_at: string;
}

export interface DisputeDetail extends DisputeSummary {
  paypal: Record<string, unknown> & {
    dispute_outcome?: { outcome_code: string; amount_refunded?: Money & { currency_code?: string } };
    seller_response_due_date?: string;
  };
  latest_verdict: VerdictView | null;
  verdict_history: Array<{ id: string; verdict: string; status: string; created_at: string }>;
  actions: Array<{
    id: string;
    verdict_id: string | null;
    kind: string;
    status: string;
    request: unknown;
    response: unknown;
    debug_id: string | null;
    request_id: string | null;
    created_at: string;
    executed_at: string | null;
  }>;
  events: Array<{
    id: string;
    source: string;
    event_type: string;
    created_at: string;
    processed: boolean;
    error: string | null;
  }>;
}

export interface Bundle {
  bundle_id: string;
  paypal_order_id: string | null;
  paypal_capture_id: string | null;
  captured_amount: Money | null;
  agent: { platform_id: string; agent_version: string };
  user_ref: string;
  intent_mandate: {
    text: string;
    max_amount: Money;
    confirm_above: Money | null;
    allowed_categories: string[];
    allowed_merchants: string[];
    expires_at: string;
    user_sig: string;
  };
  user_confirmation: { required: boolean; amount: Money; given_at: string; sig: string } | null;
  cart: Array<{ sku: string; name: string; qty: number; unit_price: Money; category: string }>;
  offer_snapshot: {
    merchant_id: string;
    url: string;
    title: string;
    attributes: Record<string, string>;
    price: Money;
    delivery_promise: { min_days: number; max_days: number };
    image_sha256: string | null;
    captured_at: string;
  } | null;
  decision_trace: Array<{ step: string; detail: string; at: string }>;
  fulfilment: {
    carrier: string;
    tracking_number: string;
    status: string;
    shipped_at: string | null;
    delivered_at: string | null;
    shipped_items: Array<{ sku: string; attributes: Record<string, string> }> | null;
  } | null;
  status: string;
  created_at: string;
  sealed_at: string | null;
  prev_hash: string;
  hash: string;
  bundle_sig: string;
}

export interface VerifyResult {
  ok: boolean;
  bundle_id: string;
  events: number;
  head_hash: string | null;
  chain_position: number | null;
  signer_fingerprint: string;
  checks: Array<{ check: string; ok: boolean; detail?: string }>;
  failures: string[];
}

export interface Liability {
  platforms: Array<{ platform_id: string; name: string | null; total: Money; disputes: number }>;
  entries: Array<{
    id: string;
    platform_id: string;
    dispute_id: string;
    verdict_id: string;
    amount: Money;
    note: string | null;
    created_at: string;
  }>;
}

export interface BundleListItem {
  bundle_id: string;
  status: string;
  user_ref: string;
  platform_id: string;
  merchant_id: string | null;
  paypal_order_id: string | null;
  paypal_capture_id: string | null;
  title: string | null;
  amount: Money | null;
  created_at: string;
  hash: string;
}
