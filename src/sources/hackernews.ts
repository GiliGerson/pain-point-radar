import { z } from "zod";
import type { Item, SearchOptions } from "../types";
import type { SourceAdapter } from "./types";
import { htmlToText } from "../lib/text";

// Relevance-ranked, not newest-first: for a common word like "notion", the newest
// 50 hits were almost all other senses of the word; the most relevant 50 were mostly about the product.
const API = "https://hn.algolia.com/api/v1/search";
const PAGE_SIZE = 100;
const MIN_TEXT_LENGTH = 40;

const HitSchema = z.object({
  objectID: z.string(),
  author: z.string().nullish(),
  created_at: z.string(),
  title: z.string().nullish(),
  story_title: z.string().nullish(),
  story_text: z.string().nullish(),
  comment_text: z.string().nullish(),
});

const ResponseSchema = z.object({
  hits: z.array(z.unknown()),
  nbPages: z.number(),
});

type FetchFn = typeof fetch;

export function hitToItem(raw: unknown): Item | null {
  const parsed = HitSchema.safeParse(raw);
  if (!parsed.success) return null;
  const hit = parsed.data;
  const body = htmlToText(hit.comment_text ?? hit.story_text ?? "");
  const title = hit.title ?? hit.story_title ?? "";
  const text = [hit.title ?? "", body].filter(Boolean).join("\n\n");
  if (text.length < MIN_TEXT_LENGTH) return null;
  return {
    id: `hn:${hit.objectID}`,
    source: "hackernews",
    url: `https://news.ycombinator.com/item?id=${encodeURIComponent(hit.objectID)}`,
    title,
    text,
    author: hit.author ?? "unknown",
    createdAt: hit.created_at,
  };
}

export function createHackerNewsAdapter(fetchFn: FetchFn = (...a) => fetch(...a)): SourceAdapter {
  return {
    id: "hackernews",
    label: "Hacker News",
    enabled: true,
    async search({ topic, days, maxItems, signal }: SearchOptions): Promise<Item[]> {
      const since = Math.floor(Date.now() / 1000) - days * 86400;
      const seen = new Set<string>();
      const items: Item[] = [];

      for (let page = 0; items.length < maxItems; page++) {
        const params = new URLSearchParams({
          query: topic,
          tags: "(story,comment)",
          numericFilters: `created_at_i>${since}`,
          hitsPerPage: String(PAGE_SIZE),
          page: String(page),
        });
        const res = await fetchFn(`${API}?${params}`, { signal });
        if (!res.ok) throw new Error(`Hacker News search failed (HTTP ${res.status}).`);
        const data = ResponseSchema.parse(await res.json());

        for (const raw of data.hits) {
          const item = hitToItem(raw);
          if (!item || seen.has(item.id)) continue;
          seen.add(item.id);
          items.push(item);
          if (items.length >= maxItems) break;
        }
        if (page + 1 >= data.nbPages || data.hits.length === 0) break;
      }
      return items;
    },
  };
}
