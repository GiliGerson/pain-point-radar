import { z } from "zod";
import type { Item, SearchOptions } from "../types";
import type { SourceAdapter } from "./types";
import { getJson, sinceDate } from "./http";
import { safeHttpsUrl } from "../lib/text";

const SEARCH_API = "https://itunes.apple.com/search";
const REVIEWS_API = "https://itunes.apple.com/us/rss/customerreviews";
/** Apple serves at most 10 pages of 50 reviews per app. */
const MAX_PAGES = 10;
const MIN_TEXT_LENGTH = 40;

const AppSchema = z.object({ trackId: z.number(), trackName: z.string(), trackViewUrl: z.string() });
const SearchSchema = z.object({ results: z.array(z.unknown()) });

const Label = z.object({ label: z.string() });
const EntrySchema = z.object({
  id: Label,
  author: z.object({ name: Label }),
  updated: Label,
  title: Label,
  content: Label,
  "im:rating": Label,
});
// A feed with a single review returns an object instead of an array.
const FeedSchema = z.object({
  feed: z.object({ entry: z.union([z.array(z.unknown()), z.unknown()]).optional() }),
});

type App = z.infer<typeof AppSchema>;
type FetchFn = typeof fetch;

/** Finds the app for a topic. Returns null unless its name actually contains the topic. */
export async function findApp(fetchFn: FetchFn, topic: string, signal?: AbortSignal): Promise<App | null> {
  const params = new URLSearchParams({ term: topic, entity: "software", country: "us", limit: "5" });
  const data = SearchSchema.parse(await getJson(fetchFn, `${SEARCH_API}?${params}`, "App Store", signal));
  const needle = topic.trim().toLowerCase();
  for (const raw of data.results) {
    const app = AppSchema.safeParse(raw);
    if (app.success && app.data.trackName.toLowerCase().includes(needle)) return app.data;
  }
  return null;
}

export function entryToItem(raw: unknown, app: App): Item | null {
  const parsed = EntrySchema.safeParse(raw);
  if (!parsed.success) return null;
  const e = parsed.data;
    const body = [e.title.label, e.content.label].filter(Boolean).join("\n\n").trim();
  // The rating goes into the text so the model can tell a complaint from praise.
  const text = `Rated ${e["im:rating"].label} of 5 stars.\n\n${body}`;
  const url = safeHttpsUrl(app.trackViewUrl);
  if (body.length < MIN_TEXT_LENGTH || !url) return null;
  return {
    id: `appstore:${e.id.label}`,
    source: "appstore",
    url,
    title: `${app.trackName} review, ${e["im:rating"].label} of 5 stars`,
    text,
    author: e.author.name.label || "unknown",
    createdAt: new Date(e.updated.label).toISOString(),
  };
}

export function createAppStoreAdapter(fetchFn: FetchFn = (...a) => fetch(...a)): SourceAdapter {
  return {
    id: "appstore",
    label: "App Store",
    enabled: true,
    async search({ topic, days, maxItems, signal }: SearchOptions): Promise<Item[]> {
      const app = await findApp(fetchFn, topic, signal);
      if (!app) return [];
      const since = sinceDate(days).getTime();
      const items: Item[] = [];

      for (let page = 1; page <= MAX_PAGES && items.length < maxItems; page++) {
        const url = `${REVIEWS_API}/page=${page}/id=${app.trackId}/sortBy=mostRecent/json`;
        const { feed } = FeedSchema.parse(await getJson(fetchFn, url, "App Store", signal));
        const entries = feed.entry === undefined ? [] : Array.isArray(feed.entry) ? feed.entry : [feed.entry];
        if (entries.length === 0) break;

        let reachedOld = false;
        for (const raw of entries) {
          const item = entryToItem(raw, app);
          if (!item) continue;
          // Newest first, so the first review older than the range ends the search.
          if (new Date(item.createdAt).getTime() < since) {
            reachedOld = true;
            break;
          }
          items.push(item);
          if (items.length >= maxItems) break;
        }
        if (reachedOld) break;
      }
      return items;
    },
  };
}
