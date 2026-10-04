import { createAppStoreAdapter } from "./appstore";
import { createBlueskyAdapter } from "./bluesky";
import { createGitHubAdapter } from "./github";
import { createHackerNewsAdapter } from "./hackernews";
import { redditAdapter } from "./reddit";
import { createStackOverflowAdapter } from "./stackoverflow";
import type { SourceAdapter } from "./types";
import type { Item, SearchOptions } from "../types";

export const SOURCES: SourceAdapter[] = [
  createHackerNewsAdapter(),
  createAppStoreAdapter(),
  createBlueskyAdapter(),
  createGitHubAdapter(),
  createStackOverflowAdapter(),
  redditAdapter,
];
export type { SourceAdapter };

export function sourceLabel(id: string): string {
  return SOURCES.find((s) => s.id === id)?.label ?? id;
}

export interface SearchResult {
  items: Item[];
  /** Sources that failed, with a message. The others still count. */
  failures: { label: string; message: string }[];
}

/**
 * Searches every selected source in parallel. Each source is asked for the full
 * amount, then results are interleaved so a busy source cannot crowd out the rest,
 * and a quiet one leaves its share to the others.
 */
export async function searchSources(adapters: SourceAdapter[], opts: SearchOptions): Promise<SearchResult> {
  const settled = await Promise.allSettled(adapters.map((a) => a.search(opts)));
  const lists: Item[][] = [];
  const failures: SearchResult["failures"] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") lists.push(r.value);
    else failures.push({ label: adapters[i].label, message: r.reason instanceof Error ? r.reason.message : String(r.reason) });
  });
  if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (lists.length === 0 && failures.length > 0) throw new Error(failures.map((f) => f.message).join(" "));

  const items: Item[] = [];
  const seen = new Set<string>();
  for (let i = 0; items.length < opts.maxItems && lists.some((l) => i < l.length); i++) {
    for (const list of lists) {
      const item = list[i];
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
      if (items.length >= opts.maxItems) break;
    }
  }
  return { items, failures };
}
