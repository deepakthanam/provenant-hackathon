import type { Env } from '@provenant/config';
import { AnthropicProvider, BedrockProvider } from './anthropic';
import { type MockHandler, MockLlm } from './mock';
import type { LlmProvider } from './types';

export * from './anthropic';
export * from './mock';
export * from './types';

/**
 * Picks the provider from LLM_PROVIDER. `mockHandlers` supplies the deterministic answers used
 * when LLM_PROVIDER=mock (each feature registers its own).
 */
export function createLlm(env: Env, mockHandlers: Record<string, MockHandler> = {}): LlmProvider {
  switch (env.LLM_PROVIDER) {
    case 'anthropic':
      return new AnthropicProvider(env.LLM_MODEL, { apiKey: env.ANTHROPIC_API_KEY });
    case 'bedrock':
      if (!env.AWS_REGION) throw new Error('LLM_PROVIDER=bedrock needs AWS_REGION');
      return new BedrockProvider(env.BEDROCK_MODEL_ID ?? `anthropic.${env.LLM_MODEL}`, env.AWS_REGION);
    default:
      return new MockLlm(mockHandlers);
  }
}
