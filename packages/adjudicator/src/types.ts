import type { Dispute } from '@provenant/paypal';
import type {
  EvidenceBundle,
  ModelDifference,
  PlannedAction,
  RuleResult,
  VerdictCode,
  VerifyResult,
} from '@provenant/schemas';

export interface BuyerImage {
  name: string;
  contentType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  sha256: string;
  base64: string;
}

export interface AdjudicationSettings {
  confidenceThreshold: number;
  sharedFaultRefundPct: number;
  /** What the merchant accepts when it misrepresented the item. */
  misrepresentationClaimType: 'REFUND' | 'REFUND_WITH_RETURN';
}

export interface AdjudicationInput {
  dispute: Dispute;
  /** How the dispute was linked to a bundle (see DisputeIntake.linkBundle). */
  link: { bundleId: string | null; basis: string };
  bundle: EvidenceBundle | null;
  verify: VerifyResult | null;
  /** Offer snapshot image (as the agent saw it), for the model. */
  snapshotImage: BuyerImage | null;
  buyer: { messages: string[]; images: BuyerImage[] };
  settings: AdjudicationSettings;
}

export interface ModelRun {
  findings: ModelDifference[];
  /** Differences the model returned that cited no real snapshot field (dropped, kept for audit). */
  dropped: Array<{ difference: unknown; why: string }>;
  claimConsistentWithSnapshot: boolean;
  notes: string;
  modelId: string;
  promptHash: string;
  raw: string;
  error: string | null;
}

export interface Decision {
  verdict: VerdictCode;
  confidence: number;
  reasons: Array<{ text: string; ref: string }>;
}

export interface AdjudicationResult extends Decision {
  ruleResults: RuleResult[];
  model: ModelRun | null;
  plannedAction: PlannedAction;
  /** Hash of the inputs (with images by hash), so a replay can prove it ran on the same facts. */
  inputsHash: string;
}
