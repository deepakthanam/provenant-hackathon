import { canonicalize } from '@provenant/evidence/canonical';
import { sha256Hex } from '@provenant/evidence/crypto';
import type { z } from 'zod';

export type LlmPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; base64: string };

export interface LlmJsonRequest<T> {
  /** Stable task name, e.g. `claim_vs_snapshot`; the mock provider dispatches on it. */
  task: string;
  system: string;
  content: LlmPart[];
  schema: z.ZodType<T>;
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high';
}

export interface LlmJsonResult<T> {
  /** Schema-validated output. */
  data: T;
  /** The model's raw text, stored for audit and replay. */
  raw: string;
  /** The model that actually answered (may differ from the configured one after a fallback). */
  modelId: string;
  promptHash: string;
}

/** The model returns structured findings only; callers decide what to do with them. */
export interface LlmProvider {
  readonly id: 'mock' | 'anthropic' | 'bedrock';
  readonly modelId: string;
  generateJson<T>(req: LlmJsonRequest<T>): Promise<LlmJsonResult<T>>;
}

export class LlmRefusalError extends Error {
  constructor(readonly category: string | null) {
    super(`model declined the request${category ? ` (${category})` : ''}`);
    this.name = 'LlmRefusalError';
  }
}

export class LlmOutputError extends Error {
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message);
    this.name = 'LlmOutputError';
  }
}

/**
 * Hash of exactly what the model was asked: task, system prompt and content, with images
 * replaced by their SHA-256 so the hash stays small and stable.
 */
export function promptHash(req: Pick<LlmJsonRequest<unknown>, 'task' | 'system' | 'content'>): string {
  const content = req.content.map((p) =>
    p.type === 'image'
      ? { type: 'image', mediaType: p.mediaType, sha256: sha256Hex(Buffer.from(p.base64, 'base64')) }
      : p,
  );
  return `sha256:${sha256Hex(canonicalize({ task: req.task, system: req.system, content }))}`;
}
