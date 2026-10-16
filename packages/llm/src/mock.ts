import {
  type LlmJsonRequest,
  type LlmJsonResult,
  LlmOutputError,
  type LlmProvider,
  promptHash,
} from './types';

export type MockHandler = (req: LlmJsonRequest<unknown>) => unknown;

/**
 * Deterministic provider for offline runs and tests. Each task registers a pure function that
 * computes the answer from the request; the result still goes through the task's Zod schema,
 * so the mock exercises the same validation path as a real model.
 */
export class MockLlm implements LlmProvider {
  readonly id = 'mock' as const;
  readonly modelId = 'mock-deterministic-v1';
  private readonly handlers = new Map<string, MockHandler>();

  constructor(handlers: Record<string, MockHandler> = {}) {
    for (const [task, h] of Object.entries(handlers)) this.handlers.set(task, h);
  }

  register(task: string, handler: MockHandler): this {
    this.handlers.set(task, handler);
    return this;
  }

  async generateJson<T>(req: LlmJsonRequest<T>): Promise<LlmJsonResult<T>> {
    const handler = this.handlers.get(req.task);
    if (!handler) throw new Error(`MockLlm has no handler for task "${req.task}"`);
    const out = handler(req as LlmJsonRequest<unknown>);
    const raw = JSON.stringify(out);
    const parsed = req.schema.safeParse(out);
    if (!parsed.success)
      throw new LlmOutputError(`mock output failed the schema: ${parsed.error.message}`, raw);
    return { data: parsed.data, raw, modelId: this.modelId, promptHash: promptHash(req) };
  }
}
