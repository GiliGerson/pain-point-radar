import { z } from "zod";
import type { LLM, LLMRequest, LLMResponse } from "./types";

const ResponseSchema = z.object({ text: z.string(), inputTokens: z.number(), outputTokens: z.number() });

/** Runs requests through the site's own /api/claude proxy, on the owner's key. */
export function createDemoClient(fetchFn: typeof fetch = (...a) => fetch(...a)): LLM {
  return {
    async complete({ model, system, prompt, maxTokens, signal }: LLMRequest): Promise<LLMResponse> {
      const res = await fetchFn("/api/claude", {
        method: "POST",
        signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, system, prompt, maxTokens }),
      });
      if (!res.ok) throw new Error(describeDemoError(res.status));
      return ResponseSchema.parse(await res.json());
    },
  };
}

function describeDemoError(status: number): string {
  switch (status) {
    case 429:
      return "The free demo limit was reached. Add your own Anthropic API key above to keep going.";
    case 404:
    case 503:
      return "The free demo is not available here. Add your own Anthropic API key above.";
    case 529:
      return "The Anthropic API is overloaded right now. Try again in a few minutes.";
    default:
      return `The free demo failed (HTTP ${status}). Try again, or add your own API key.`;
  }
}
