import { z } from "zod";
import type { LLM, LLMRequest, LLMResponse } from "./types";

const ENDPOINT = "https://api.anthropic.com/v1/messages";

const ResponseSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
});

/**
 * Calls the Anthropic API straight from the browser.
 * The key is held in this closure only. It is never logged, stored or put in a URL.
 */
export function createAnthropicClient(
  apiKey: string,
  fetchFn: typeof fetch = (...a) => fetch(...a),
): LLM {
  return {
    async complete({ model, system, prompt, maxTokens, signal }: LLMRequest): Promise<LLMResponse> {
      const res = await fetchFn(ENDPOINT, {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          system,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!res.ok) throw new Error(describeError(res.status));

      const data = ResponseSchema.parse(await res.json());
      return {
        text: data.content.map((b) => (b.type === "text" ? (b.text ?? "") : "")).join(""),
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
      };
    },
  };
}

function describeError(status: number): string {
  switch (status) {
    case 401:
      return "The API key was rejected. Check that you copied the whole key.";
    case 403:
      return "This API key is not allowed to use these models.";
    case 429:
      return "Rate limit reached. Wait a minute and run again, or analyze fewer items.";
    case 529:
    case 503:
      return "The Anthropic API is overloaded right now. Try again in a few minutes.";
    default:
      return `The Anthropic API returned an error (HTTP ${status}).`;
  }
}
