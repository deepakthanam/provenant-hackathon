import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  type LlmJsonRequest,
  type LlmJsonResult,
  LlmOutputError,
  type LlmPart,
  type LlmProvider,
  LlmRefusalError,
  promptHash,
} from './types';

function toBlocks(parts: LlmPart[]): Anthropic.ContentBlockParam[] {
  return parts.map((p) =>
    p.type === 'text'
      ? { type: 'text', text: p.text }
      : { type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.base64 } },
  );
}

function textOf(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('');
}

/**
 * Claude via the first-party API. Structured outputs (`output_config.format` from a Zod schema)
 * make the response schema-valid; server-side fallback (`fallbacks: "default"`) re-runs a
 * declined request on the fallback model inside the same call.
 */
export class AnthropicProvider implements LlmProvider {
  readonly id = 'anthropic' as const;
  private readonly client: Anthropic;

  constructor(
    readonly modelId: string,
    opts: { apiKey?: string; client?: Anthropic } = {},
  ) {
    this.client = opts.client ?? new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
  }

  async generateJson<T>(req: LlmJsonRequest<T>): Promise<LlmJsonResult<T>> {
    const res = await this.client.beta.messages.parse({
      model: this.modelId,
      max_tokens: req.maxTokens ?? 16000,
      system: req.system,
      messages: [{ role: 'user', content: toBlocks(req.content) as Anthropic.Beta.BetaContentBlockParam[] }],
      output_config: { format: betaZodOutputFormat(req.schema), effort: req.effort ?? 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    const raw = textOf(res.content);
    if (res.stop_reason === 'refusal') throw new LlmRefusalError(res.stop_details?.category ?? null);
    if (res.stop_reason === 'max_tokens') throw new LlmOutputError('response hit max_tokens', raw);
    if (res.parsed_output == null) throw new LlmOutputError('response did not match the schema', raw);
    return { data: res.parsed_output as T, raw, modelId: res.model, promptHash: promptHash(req) };
  }
}

/** Claude on Amazon Bedrock through the Mantle (Messages API) client. Model ids carry `anthropic.`. */
export class BedrockProvider implements LlmProvider {
  readonly id = 'bedrock' as const;
  private readonly client: AnthropicBedrockMantle;

  constructor(
    readonly modelId: string,
    awsRegion: string,
  ) {
    this.client = new AnthropicBedrockMantle({ awsRegion });
  }

  async generateJson<T>(req: LlmJsonRequest<T>): Promise<LlmJsonResult<T>> {
    const res = await this.client.messages.parse({
      model: this.modelId,
      max_tokens: req.maxTokens ?? 16000,
      system: req.system,
      messages: [{ role: 'user', content: toBlocks(req.content) }],
      output_config: { format: zodOutputFormat(req.schema), effort: req.effort ?? 'medium' },
    });
    const raw = textOf(res.content);
    if (res.stop_reason === 'refusal') throw new LlmRefusalError(res.stop_details?.category ?? null);
    if (res.stop_reason === 'max_tokens') throw new LlmOutputError('response hit max_tokens', raw);
    if (res.parsed_output == null) throw new LlmOutputError('response did not match the schema', raw);
    return { data: res.parsed_output as T, raw, modelId: res.model, promptHash: promptHash(req) };
  }
}
