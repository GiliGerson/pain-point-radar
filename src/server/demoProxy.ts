import { z } from "zod";
import { CLUSTER_MODEL, DEMO_MAX_TOKENS, DEMO_MAX_PROMPT_CHARS, EXTRACT_MODEL } from "../pipeline/config";
import { CLUSTER_SYSTEM, EXTRACT_SYSTEM } from "../pipeline/prompts";

/**
 * The demo proxy lets visitors without a key run a small analysis on the owner's key.
 * It only forwards this app's own two requests (exact system prompt and model),
 * so it cannot be used as a general-purpose Claude endpoint.
 */
const ALLOWED: { model: string; system: string }[] = [
  { model: EXTRACT_MODEL, system: EXTRACT_SYSTEM },
  { model: CLUSTER_MODEL, system: CLUSTER_SYSTEM },
];

const BodySchema = z.object({
  model: z.string(),
  system: z.string(),
  prompt: z.string().min(1).max(DEMO_MAX_PROMPT_CHARS),
  maxTokens: z.number().int().min(1).max(DEMO_MAX_TOKENS),
});

const AnthropicSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
});

/** Fixed-window counter kept in memory. Best effort: each server instance has its own. */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  constructor(
    private limit: number,
    private windowMs: number,
  ) {}

  allow(key: string, now = Date.now()): boolean {
    const entry = this.hits.get(key);
    if (!entry || now >= entry.resetAt) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (entry.count >= this.limit) return false;
    entry.count++;
    return true;
  }
}

export interface ProxyDeps {
  apiKey: string | undefined;
  fetchFn: typeof fetch;
  perVisitor: RateLimiter;
  overall: RateLimiter;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function handleDemoRequest(req: Request, deps: ProxyDeps): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "Use POST." });
  if (!deps.apiKey) return json(503, { error: "The demo key is not configured." });

  // Browsers always send Origin on POST; refuse calls from other sites.
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host) return json(403, { error: "Cross-site requests are not allowed." });

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return json(400, { error: "Invalid request." });
  }
  if (!ALLOWED.some((a) => a.model === body.model && a.system === body.system)) {
    return json(400, { error: "Only Pain Point Radar requests are allowed." });
  }

  const visitor = req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  if (!deps.overall.allow("all") || !deps.perVisitor.allow(visitor)) {
    return json(429, { error: "Demo limit reached." });
  }

  const upstream = await deps.fetchFn("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": deps.apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: body.model,
      max_tokens: body.maxTokens,
      system: body.system,
      messages: [{ role: "user", content: body.prompt }],
    }),
  });
  // Pass the status through, but never Anthropic's error body, which could describe the key or account.
  if (!upstream.ok) {
    // 400/401/403 here mean the owner's key or credit, not the visitor: report the demo as unavailable.
    const status = [400, 401, 403].includes(upstream.status) ? 503 : upstream.status;
    return json(status, { error: `Upstream error (HTTP ${upstream.status}).` });
  }

  const data = AnthropicSchema.parse(await upstream.json());
  return json(200, {
    text: data.content.map((b) => (b.type === "text" ? (b.text ?? "") : "")).join(""),
    inputTokens: data.usage.input_tokens,
    outputTokens: data.usage.output_tokens,
  });
}
