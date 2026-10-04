/** Stage 1 runs on many small batches, so it uses the fast, cheap model. */
export const EXTRACT_MODEL = "claude-haiku-4-5-20251001";
/** Stage 2 runs once over everything, so it gets the stronger model. */
export const CLUSTER_MODEL = "claude-sonnet-5-5";

export const BATCH_SIZE = 15;
export const CONCURRENCY = 3;
export const MAX_ITEM_CHARS = 1500;

/**
 * USD per million tokens, used only for the pre-run estimate.
 * Check https://www.anthropic.com/pricing and update if these change.
 */
export const PRICING: Record<string, { input: number; output: number }> = {
  [EXTRACT_MODEL]: { input: 1, output: 5 },
  [CLUSTER_MODEL]: { input: 3, output: 15 },
};

/**
 * Demo mode: visitors without a key run on the owner's key through /api/claude.
 * A 50-post run is 4 extract calls plus 1 cluster call, and each call may retry once.
 */
export const DEMO_MAX_ITEMS = 50;
export const DEMO_CALLS_PER_VISITOR_PER_HOUR = 20;
export const DEMO_CALLS_PER_DAY = 300;
export const DEMO_MAX_TOKENS = 4000;
export const DEMO_MAX_PROMPT_CHARS = 40_000;
