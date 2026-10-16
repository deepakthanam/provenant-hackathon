import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AnthropicProvider } from '../src/anthropic';
import { MockLlm } from '../src/mock';
import { LlmOutputError, LlmRefusalError, promptHash } from '../src/types';

const Schema = z.object({ color: z.string(), size: z.string() });
const req = {
  task: 'extract',
  system: 'Extract attributes.',
  content: [
    { type: 'text' as const, text: 'black shoes size 10' },
    {
      type: 'image' as const,
      mediaType: 'image/png' as const,
      base64: Buffer.from('img').toString('base64'),
    },
  ],
  schema: Schema,
};

/** A stand-in for the SDK client capturing the request and returning a canned parse result. */
function fakeClient(result: Record<string, unknown>) {
  const calls: unknown[] = [];
  const client = {
    beta: {
      messages: {
        parse: async (params: unknown) => {
          calls.push(params);
          return {
            model: 'claude-sonnet-5-5',
            content: [{ type: 'text', text: '{"color":"black","size":"10"}' }],
            ...result,
          };
        },
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

describe('MockLlm', () => {
  it('runs the task handler through the schema', async () => {
    const llm = new MockLlm({ extract: () => ({ color: 'black', size: '10' }) });
    const r = await llm.generateJson(req);
    expect(r.data).toEqual({ color: 'black', size: '10' });
    expect(r.modelId).toBe('mock-deterministic-v1');
    expect(r.promptHash).toMatch(/^sha256:/);
  });

  it('rejects handler output that breaks the schema', async () => {
    const llm = new MockLlm({ extract: () => ({ color: 1 }) });
    await expect(llm.generateJson(req)).rejects.toBeInstanceOf(LlmOutputError);
  });
});

describe('promptHash', () => {
  it('changes with the image bytes and is stable otherwise', () => {
    expect(promptHash(req)).toBe(promptHash({ ...req }));
    const other = {
      ...req,
      content: [req.content[0]!, { ...req.content[1]!, base64: Buffer.from('other').toString('base64') }],
    };
    expect(promptHash(other)).not.toBe(promptHash(req));
  });
});

describe('AnthropicProvider', () => {
  it('sends structured-output format, images and server-side fallback', async () => {
    const { client, calls } = fakeClient({
      stop_reason: 'end_turn',
      parsed_output: { color: 'black', size: '10' },
    });
    const r = await new AnthropicProvider('claude-sonnet-5-5', { client }).generateJson(req);
    expect(r.data.color).toBe('black');
    const p = calls[0] as Record<string, any>;
    expect(p.model).toBe('claude-sonnet-5-5');
    expect(p.fallbacks).toBe('default');
    expect(p.betas).toContain('server-side-fallback-2026-07-01');
    expect(p.output_config.format).toBeDefined();
    expect(p.messages[0].content[1]).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png' },
    });
  });

  it('surfaces refusals and unparseable output as typed errors', async () => {
    const refused = fakeClient({
      stop_reason: 'refusal',
      stop_details: { category: 'cyber' },
      parsed_output: null,
    });
    await expect(
      new AnthropicProvider('m', { client: refused.client }).generateJson(req),
    ).rejects.toBeInstanceOf(LlmRefusalError);
    const bad = fakeClient({ stop_reason: 'end_turn', parsed_output: null });
    await expect(new AnthropicProvider('m', { client: bad.client }).generateJson(req)).rejects.toBeInstanceOf(
      LlmOutputError,
    );
  });
});
