import type { z } from "zod";
import type { LLM, LLMRequest } from "../llm/types";

export function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("No JSON object in model output");
  return JSON.parse(cleaned.slice(start, end + 1));
}

/**
 * Asks the model for JSON and validates it against a schema.
 * On invalid output it retries once, telling the model what was wrong.
 */
export async function completeJson<S extends z.ZodTypeAny>(
  llm: LLM,
  req: LLMRequest,
  schema: S,
  onUsage?: (input: number, output: number) => void,
): Promise<z.infer<S>> {
  let prompt = req.prompt;
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await llm.complete({ ...req, prompt });
    onUsage?.(res.inputTokens, res.outputTokens);
    try {
      const parsed = schema.safeParse(extractJson(res.text));
      if (parsed.success) return parsed.data;
      lastError = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    prompt = `${req.prompt}\n\nYour previous reply was not valid (${lastError}). Reply again with valid JSON only.`;
  }
  throw new Error(`The model returned invalid JSON twice: ${lastError}`);
}
