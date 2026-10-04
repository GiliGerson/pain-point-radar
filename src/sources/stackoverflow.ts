import { z } from "zod";
import type { Item, SearchOptions } from "../types";
import type { SourceAdapter } from "./types";
import { getJson, sinceDate } from "./http";
import { htmlToText } from "../lib/text";

const API = "https://api.stackexchange.com/2.3/search/advanced";
const PAGE_SIZE = 100;
const MAX_PAGES = 5;
const MIN_TEXT_LENGTH = 40;

const QuestionSchema = z.object({
  question_id: z.number(),
  link: z.string(),
  title: z.string(),
  body: z.string().nullish(),
  owner: z.object({ display_name: z.string().nullish() }).nullish(),
  creation_date: z.number(),
});
const ResponseSchema = z.object({ items: z.array(z.unknown()), has_more: z.boolean() });

type FetchFn = typeof fetch;

export function questionToItem(raw: unknown): Item | null {
  const parsed = QuestionSchema.safeParse(raw);
  if (!parsed.success) return null;
  const q = parsed.data;
  const title = htmlToText(q.title);
  const text = [title, htmlToText(q.body ?? "")].filter(Boolean).join("\n\n");
  if (text.length < MIN_TEXT_LENGTH) return null;
  return {
    id: `so:${q.question_id}`,
    source: "stackoverflow",
    url: q.link,
    title,
    text,
    author: htmlToText(q.owner?.display_name ?? "") || "unknown",
    createdAt: new Date(q.creation_date * 1000).toISOString(),
  };
}

export function createStackOverflowAdapter(fetchFn: FetchFn = (...a) => fetch(...a)): SourceAdapter {
  return {
    id: "stackoverflow",
    label: "Stack Overflow",
    enabled: true,
    async search({ topic, days, maxItems, signal }: SearchOptions): Promise<Item[]> {
      const items: Item[] = [];
      for (let page = 1; page <= MAX_PAGES && items.length < maxItems; page++) {
        const params = new URLSearchParams({
          q: topic,
          site: "stackoverflow",
          fromdate: String(Math.floor(sinceDate(days).getTime() / 1000)),
          sort: "relevance",
          order: "desc",
          filter: "withbody",
          pagesize: String(PAGE_SIZE),
          page: String(page),
        });
        const data = ResponseSchema.parse(await getJson(fetchFn, `${API}?${params}`, "Stack Overflow", signal));
        for (const raw of data.items) {
          const item = questionToItem(raw);
          if (item) items.push(item);
          if (items.length >= maxItems) break;
        }
        if (!data.has_more) break;
      }
      return items;
    },
  };
}
