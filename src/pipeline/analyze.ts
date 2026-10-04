import { z } from "zod";
import type { LLM } from "../llm/types";
import type { Item, PainPoint, Quote, Report, Theme } from "../types";
import { normalizeForMatch, safeHttpsUrl } from "../lib/text";
import { BATCH_SIZE, CLUSTER_MODEL, CONCURRENCY, EXTRACT_MODEL } from "./config";
import { buildClusterPrompt, buildExtractPrompt, CLUSTER_SYSTEM, EXTRACT_SYSTEM } from "./prompts";
import { completeJson } from "./json";

const ExtractSchema = z.object({
  painPoints: z.array(z.object({ itemId: z.string(), pain: z.string().min(1), quote: z.string().min(1) })),
});

const ClusterSchema = z.object({
  themes: z.array(
    z.object({
      title: z.string().min(1),
      summary: z.string(),
      severity: z.coerce.number().int().min(1).max(5),
      painPointIds: z.array(z.string()),
    }),
  ),
});

export type Progress =
  | { stage: "extract"; done: number; total: number }
  | { stage: "cluster" };

export interface AnalyzeOptions {
  topic: string;
  days: number;
  sources: string[];
  items: Item[];
  llm: LLM;
  signal?: AbortSignal;
  onProgress?: (p: Progress) => void;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Stage 1: extract pain points from every item.
 * A quote is kept only if it really appears in the source item, so the
 * report can never show a quote the model invented.
 */
export async function extractPainPoints(
  topic: string,
  items: Item[],
  llm: LLM,
  opts: { signal?: AbortSignal; onBatchDone?: (done: number, total: number) => void } = {},
): Promise<PainPoint[]> {
  const byId = new Map(items.map((it) => [it.id, it]));
  const batches = chunk(items, BATCH_SIZE);
  let done = 0;

  const perBatch = await mapLimit(batches, CONCURRENCY, async (batch) => {
    const out = await completeJson(
      llm,
      { model: EXTRACT_MODEL, system: EXTRACT_SYSTEM, prompt: buildExtractPrompt(topic, batch), maxTokens: 2000, signal: opts.signal },
      ExtractSchema,
    );
    opts.onBatchDone?.(++done, batches.length);
    return out.painPoints;
  });

  const kept: PainPoint[] = [];
  for (const raw of perBatch.flat()) {
    const item = byId.get(raw.itemId);
    if (!item) continue;
    if (!normalizeForMatch(item.text).includes(normalizeForMatch(raw.quote))) continue;
    kept.push({ id: `p${kept.length + 1}`, itemId: item.id, pain: raw.pain.trim(), quote: raw.quote.trim() });
  }
  return kept;
}

/**
 * Stage 2: group pain points into themes.
 * The model only decides grouping, wording and severity. Mention counts and
 * quotes are computed here from the real data.
 */
export async function clusterPainPoints(
  topic: string,
  painPoints: PainPoint[],
  items: Item[],
  llm: LLM,
  signal?: AbortSignal,
): Promise<Theme[]> {
  if (painPoints.length === 0) return [];
  const out = await completeJson(
    llm,
    { model: CLUSTER_MODEL, system: CLUSTER_SYSTEM, prompt: buildClusterPrompt(topic, painPoints), maxTokens: 4000, signal },
    ClusterSchema,
  );

  const ppById = new Map(painPoints.map((p) => [p.id, p]));
  const itemById = new Map(items.map((it) => [it.id, it]));

  // A pain point counts toward one theme only, the first one the model puts it in,
  // so the same complaint cannot inflate several themes.
  const assigned = new Set<string>();
  const themes: Theme[] = [];
  for (const t of out.themes) {
    const ids = t.painPointIds.filter((id) => ppById.has(id) && !assigned.has(id));
    ids.forEach((id) => assigned.add(id));
    const members = [...new Set(ids)].map((id) => ppById.get(id)!);
    if (members.length === 0) continue;

    const itemIds = new Set(members.map((m) => m.itemId));
    const quotes: Quote[] = [];
    const quotedItems = new Set<string>();
    for (const m of members) {
      if (quotes.length >= 3) break;
      if (quotedItems.has(m.itemId)) continue;
      const item = itemById.get(m.itemId);
      const url = item && safeHttpsUrl(item.url);
      if (!item || !url) continue;
      quotedItems.add(m.itemId);
      quotes.push({ text: m.quote, url, author: item.author, source: item.source });
    }

    themes.push({ title: t.title.trim(), summary: t.summary.trim(), severity: t.severity, mentions: itemIds.size, quotes });
  }

  return themes.sort((a, b) => b.severity * b.mentions - a.severity * a.mentions);
}

export async function analyze(opts: AnalyzeOptions): Promise<Report> {
  const { topic, items, llm, signal, onProgress } = opts;
  onProgress?.({ stage: "extract", done: 0, total: chunk(items, BATCH_SIZE).length });
  const painPoints = await extractPainPoints(topic, items, llm, {
    signal,
    onBatchDone: (done, total) => onProgress?.({ stage: "extract", done, total }),
  });
  onProgress?.({ stage: "cluster" });
  const themes = await clusterPainPoints(topic, painPoints, items, llm, signal);
  return {
    version: 1,
    topic,
    sources: opts.sources,
    generatedAt: new Date().toISOString(),
    days: opts.days,
    itemsAnalyzed: items.length,
    painPointsFound: painPoints.length,
    themes,
  };
}
