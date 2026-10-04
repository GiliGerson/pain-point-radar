export interface LLMRequest {
  model: string;
  system: string;
  prompt: string;
  maxTokens: number;
  signal?: AbortSignal;
}

export interface LLMResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

/** Anything that can answer a prompt. The real client and the test mock both implement this. */
export interface LLM {
  complete(req: LLMRequest): Promise<LLMResponse>;
}
