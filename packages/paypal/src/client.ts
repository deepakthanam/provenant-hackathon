import type {
  AcceptClaimInput,
  ActionResult,
  CreateOrderInput,
  Dispute,
  EvidenceFile,
  ListDisputesFilter,
  ListDisputesResult,
  MakeOfferInput,
  Order,
  ProvideEvidenceInput,
  SandboxCreateDisputeInput,
  SupportingInfoInput,
  TrackingInput,
  WebhookHeaders,
} from './types';

/** One interface, two implementations: MockPayPal (offline) and HttpPayPal (sandbox, or the mock over HTTP). */
export interface PayPalClient {
  readonly mode: 'mock' | 'sandbox';

  // Orders v2
  /** Creates an intent=CAPTURE order; `custom_id` goes on purchase_units[0]. */
  createOrder(input: CreateOrderInput): Promise<Order>;
  /** PATCH replace/add purchase_units[0].custom_id (used after Agent Toolkit creates an order). */
  setOrderCustomId(orderId: string, customId: string): Promise<void>;
  getOrder(orderId: string): Promise<Order>;
  captureOrder(orderId: string): Promise<Order>;
  addTracking(orderId: string, tracking: TrackingInput): Promise<Order>;

  // Disputes v1
  listDisputes(filter?: ListDisputesFilter): Promise<ListDisputesResult>;
  /** Full details including HATEOAS links and allowed_response_options. */
  getDispute(id: string): Promise<Dispute>;
  provideEvidence(id: string, input: ProvideEvidenceInput): Promise<ActionResult>;
  makeOffer(id: string, input: MakeOfferInput): Promise<ActionResult>;
  sendMessage(id: string, message: string, files?: EvidenceFile[]): Promise<ActionResult>;
  acceptClaim(id: string, input: AcceptClaimInput): Promise<ActionResult>;
  provideSupportingInfo(id: string, input: SupportingInfoInput): Promise<ActionResult>;
  /** Downloads a dispute document (buyer evidence image). May need an extra scope in sandbox. */
  downloadDocument(url: string): Promise<{ bytes: Uint8Array; contentType: string }>;

  // Sandbox-only helpers (the live API rejects them)
  sandboxCreateDispute(input: SandboxCreateDisputeInput): Promise<Dispute>;
  sandboxRequireEvidence(id: string, action: 'SELLER_EVIDENCE' | 'BUYER_EVIDENCE'): Promise<ActionResult>;
  sandboxAdjudicate(id: string, outcome: 'BUYER_FAVOR' | 'SELLER_FAVOR'): Promise<ActionResult>;

  // Webhooks
  /** POST /v1/notifications/verify-webhook-signature with the raw body spliced in verbatim. */
  verifyWebhookSignature(headers: WebhookHeaders, rawBody: string): Promise<boolean>;
}

export const SUPPORTED_EVIDENCE_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/gif'] as const;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

/** PayPal: jpg/jpeg/gif/png/pdf, under 10 MB per file, up to 50 MB per call. */
export function assertFilesAcceptable(files: EvidenceFile[] = []): void {
  let total = 0;
  for (const f of files) {
    if (!SUPPORTED_EVIDENCE_TYPES.includes(f.contentType))
      throw new Error(`unsupported evidence file type ${f.contentType}`);
    if (f.bytes.byteLength >= MAX_FILE_BYTES) throw new Error(`${f.name} is 10 MB or larger`);
    total += f.bytes.byteLength;
  }
  if (total > MAX_TOTAL_BYTES) throw new Error('evidence files exceed 50 MB in total');
}
