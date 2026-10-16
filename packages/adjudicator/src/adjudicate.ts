import { canonicalize } from '@provenant/evidence/canonical';
import { sha256Hex } from '@provenant/evidence/crypto';
import type { LlmProvider } from '@provenant/llm';
import { cartTotal } from '@provenant/schemas';
import { compareClaim, DESCRIPTION_REASONS } from './claim';
import { decide } from './decide';
import { planAction } from './plan';
import { deliveryRules, integrityRules, mandateRules } from './rules';
import type { AdjudicationInput, AdjudicationResult, BuyerImage } from './types';

/** The inputs with image bytes replaced by their hashes: what gets stored and hashed. */
export function storableInputs(input: AdjudicationInput) {
  const strip = <T extends { base64: string }>(img: T) => {
    const { base64: _b, ...rest } = img;
    return rest;
  };
  return {
    ...input,
    snapshotImage: input.snapshotImage ? strip(input.snapshotImage) : null,
    buyer: { messages: input.buyer.messages, images: input.buyer.images.map(strip) },
  };
}

export function inputsHash(input: AdjudicationInput): string {
  return `sha256:${sha256Hex(canonicalize(storableInputs(input)))}`;
}

/** Runs the full pipeline. Pure apart from the model call; same inputs + same model → same result. */
export async function adjudicate(input: AdjudicationInput, llm: LlmProvider): Promise<AdjudicationResult> {
  const integrity = integrityRules(input);
  const bundle = input.bundle;
  const confirmationSig = input.verify?.checks.find((c) => c.check === 'confirmation_user_signature');
  const mandate = bundle ? mandateRules(bundle, confirmationSig ? confirmationSig.ok : null) : [];
  const mandateAtCart = bundle?.cart.length
    ? mandateRules(
        { ...bundle, captured_amount: cartTotal(bundle.cart) },
        confirmationSig ? confirmationSig.ok : null,
      )
    : undefined;
  const delivery = bundle ? deliveryRules(bundle) : [];
  const integrityOk = integrity.every((r) => r.passed || r.skipped);
  const model =
    integrityOk && bundle?.offer_snapshot && DESCRIPTION_REASONS.has(input.dispute.reason)
      ? await compareClaim(input, llm)
      : null;
  const decision = decide({
    reason: input.dispute.reason,
    integrity,
    mandate,
    mandateAtCart,
    delivery,
    model,
    settings: input.settings,
  });
  return {
    ...decision,
    ruleResults: [...integrity, ...mandate, ...delivery],
    model,
    plannedAction: planAction({ decision, dispute: input.dispute, bundle, settings: input.settings }),
    inputsHash: inputsHash(input),
  };
}

type StoredImage = Omit<BuyerImage, 'base64'>;
export type StoredInputs = Omit<AdjudicationInput, 'snapshotImage' | 'buyer'> & {
  snapshotImage: StoredImage | null;
  buyer: { messages: string[]; images: StoredImage[] };
};

/** Rebuilds full inputs from a stored verdict, fetching images by hash (for `pnpm replay`). */
export async function rehydrateInputs(
  stored: StoredInputs,
  getImage: (sha256: string) => Promise<Uint8Array | null>,
): Promise<AdjudicationInput> {
  const load = async (img: StoredImage): Promise<BuyerImage> => {
    const bytes = await getImage(img.sha256);
    if (!bytes) throw new Error(`image ${img.sha256} is missing from the blob store`);
    return { ...img, base64: Buffer.from(bytes).toString('base64') };
  };
  return {
    ...stored,
    snapshotImage: stored.snapshotImage ? await load(stored.snapshotImage) : null,
    buyer: { messages: stored.buyer.messages, images: await Promise.all(stored.buyer.images.map(load)) },
  };
}
