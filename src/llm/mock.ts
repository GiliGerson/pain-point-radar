import type { LLM, LLMRequest, LLMResponse } from "./types";

/** Returns canned answers in order. Used in tests and for UI development without a key. */
export function createMockLLM(responses: Array<string | ((req: LLMRequest) => string)>): LLM & {
  calls: LLMRequest[];
} {
  const calls: LLMRequest[] = [];
  return {
    calls,
    async complete(req: LLMRequest): Promise<LLMResponse> {
      calls.push(req);
      const next = responses[Math.min(calls.length - 1, responses.length - 1)];
      const text = typeof next === "function" ? next(req) : next;
      return { text, inputTokens: Math.ceil(req.prompt.length / 4), outputTokens: Math.ceil(text.length / 4) };
    },
  };
}
