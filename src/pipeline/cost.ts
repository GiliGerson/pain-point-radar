import type { Item } from "../types";
import { truncate } from "../lib/text";
import { BATCH_SIZE, CLUSTER_MODEL, EXTRACT_MODEL, MAX_ITEM_CHARS, PRICING } from "./config";
import { EXTRACT_SYSTEM, CLUSTER_SYSTEM } from "./prompts";
import { chunk } from "./analyze";

const CHARS_PER_TOKEN = 4;

export interface CostEstimate {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
}

/** Rough, deliberately conservative estimate shown before any money is spent. */
export function estimateCost(items: Item[]): CostEstimate {
  const batches = chunk(items, BATCH_SIZE);
  const itemChars = items.reduce((n, it) => n + truncate(it.text, MAX_ITEM_CHARS).length + 40, 0);
  const extractIn = (itemChars + batches.length * (EXTRACT_SYSTEM.length + 400)) / CHARS_PER_TOKEN;
  const extractOut = batches.length * 900;
  // Assume roughly one pain point per item, ~25 tokens each, going into stage 2.
  const clusterIn = (CLUSTER_SYSTEM.length + 400) / CHARS_PER_TOKEN + items.length * 25;
  const clusterOut = 1500;

  const usd =
    (extractIn * PRICING[EXTRACT_MODEL].input + extractOut * PRICING[EXTRACT_MODEL].output) / 1e6 +
    (clusterIn * PRICING[CLUSTER_MODEL].input + clusterOut * PRICING[CLUSTER_MODEL].output) / 1e6;

  return {
    calls: batches.length + 1,
    inputTokens: Math.round(extractIn + clusterIn),
    outputTokens: Math.round(extractOut + clusterOut),
    usd,
  };
}
