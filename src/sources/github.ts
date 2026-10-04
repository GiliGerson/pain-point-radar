import { z } from "zod";
import type { Item, SearchOptions } from "../types";
import type { SourceAdapter } from "./types";
import { getJson, sinceDate } from "./http";

const API = "https://api.github.com/search/issues";
const PAGE_SIZE = 100;
/** Unauthenticated search allows 10 requests a minute; 3 per run leaves room to run again. */
const MAX_PAGES = 3;
const MIN_TEXT_LENGTH = 40;

const IssueSchema = z.object({
  id: z.number(),
  html_url: z.string(),
  title: z.string(),
  body: z.string().nullish(),
  user: z.object({ login: z.string() }).nullish(),
  created_at: z.string(),
});
const ResponseSchema = z.object({ total_count: z.number(), items: z.array(z.unknown()) });

type FetchFn = typeof fetch;

/** Issue templates are full of HTML comments that are noise for the model. */
function cleanBody(body: string): string {
  return body.replace(/<!--[\s\S]*?-->/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

export function issueToItem(raw: unknown): Item | null {
  const parsed = IssueSchema.safeParse(raw);
  if (!parsed.success) return null;
  const i = parsed.data;
  const text = [i.title, cleanBody(i.body ?? "")].filter(Boolean).join("\n\n");
  if (text.length < MIN_TEXT_LENGTH) return null;
  return {
    id: `gh:${i.id}`,
    source: "github",
    url: i.html_url,
    title: i.title,
    text,
    author: i.user?.login ?? "unknown",
    createdAt: i.created_at,
  };
}

export function createGitHubAdapter(fetchFn: FetchFn = (...a) => fetch(...a)): SourceAdapter {
  return {
    id: "github",
    label: "GitHub Issues",
    enabled: true,
    async search({ topic, days, maxItems, signal }: SearchOptions): Promise<Item[]> {
      const since = sinceDate(days).toISOString().slice(0, 10);
      const items: Item[] = [];
      for (let page = 1; page <= MAX_PAGES && items.length < maxItems; page++) {
        const params = new URLSearchParams({
          q: `${topic} is:issue created:>=${since}`,
          per_page: String(PAGE_SIZE),
          page: String(page),
        });
        const data = ResponseSchema.parse(await getJson(fetchFn, `${API}?${params}`, "GitHub", signal));
        for (const raw of data.items) {
          const item = issueToItem(raw);
          if (item) items.push(item);
          if (items.length >= maxItems) break;
        }
        if (data.items.length < PAGE_SIZE || page * PAGE_SIZE >= data.total_count) break;
      }
      return items;
    },
  };
}
