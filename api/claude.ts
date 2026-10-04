import { handleDemoRequest, RateLimiter } from "../src/server/demoProxy.js";
import { DEMO_CALLS_PER_DAY, DEMO_CALLS_PER_VISITOR_PER_HOUR } from "../src/pipeline/config.js";

declare const process: { env: Record<string, string | undefined> };

// Module scope, so the counters live as long as the server instance does.
const perVisitor = new RateLimiter(DEMO_CALLS_PER_VISITOR_PER_HOUR, 60 * 60 * 1000);
const overall = new RateLimiter(DEMO_CALLS_PER_DAY, 24 * 60 * 60 * 1000);

/** Vercel Function: POST /api/claude. The owner's key comes from the ANTHROPIC_API_KEY project setting. */
export function POST(request: Request): Promise<Response> {
  return handleDemoRequest(request, {
    apiKey: process.env.ANTHROPIC_API_KEY,
    fetchFn: (...a) => fetch(...a),
    perVisitor,
    overall,
  });
}
