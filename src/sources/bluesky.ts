import { z } from "zod";
import type { Item, SearchOptions } from "../types";
import type { SourceAdapter } from "./types";
import { getJson, sinceDate } from "./http";

const API = "https://api.bsky.app/xrpc/app.bsky.feed.searchPosts";
/** The public API serves one page of up to 100 posts; paging requires signing in. */
const MAX_PAGE = 100;
const MIN_TEXT_LENGTH = 40;

const PostSchema = z.object({
  uri: z.string(),
  author: z.object({ handle: z.string() }),
  record: z.object({ text: z.string(), createdAt: z.string() }),
});
const ResponseSchema = z.object({ posts: z.array(z.unknown()) });

type FetchFn = typeof fetch;

export function postToItem(raw: unknown): Item | null {
  const parsed = PostSchema.safeParse(raw);
  if (!parsed.success) return null;
  const p = parsed.data;
  const rkey = p.uri.split("/").pop();
  const text = p.record.text.trim();
  if (!rkey || text.length < MIN_TEXT_LENGTH) return null;
  return {
    id: `bsky:${rkey}`,
    source: "bluesky",
    url: `https://bsky.app/profile/${encodeURIComponent(p.author.handle)}/post/${encodeURIComponent(rkey)}`,
    title: "",
    text,
    author: p.author.handle,
    createdAt: p.record.createdAt,
  };
}

export function createBlueskyAdapter(fetchFn: FetchFn = (...a) => fetch(...a)): SourceAdapter {
  return {
    id: "bluesky",
    label: "Bluesky",
    enabled: true,
    async search({ topic, days, maxItems, signal }: SearchOptions): Promise<Item[]> {
      const params = new URLSearchParams({
        q: topic,
        sort: "top",
        lang: "en",
        since: sinceDate(days).toISOString(),
        limit: String(Math.min(MAX_PAGE, maxItems)),
      });
      const data = ResponseSchema.parse(await getJson(fetchFn, `${API}?${params}`, "Bluesky", signal));
      const items: Item[] = [];
      for (const raw of data.posts) {
        const item = postToItem(raw);
        if (item) items.push(item);
      }
      return items.slice(0, maxItems);
    },
  };
}
