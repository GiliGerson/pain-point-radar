import { describe, expect, it, vi } from "vitest";
import { createHackerNewsAdapter, hitToItem } from "../sources/hackernews";
import page0 from "./fixtures/hn-page0.json";
import page1 from "./fixtures/hn-page1.json";

function fakeFetch(pages: unknown[]) {
  return vi.fn(async (url: string | URL | Request) => {
    const page = Number(new URL(String(url)).searchParams.get("page"));
    return new Response(JSON.stringify(pages[page]), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("hitToItem", () => {
  it("normalizes a comment and strips HTML", () => {
    const item = hitToItem(page0.hits[0])!;
    expect(item.id).toBe("hn:1001");
    expect(item.url).toBe("https://news.ycombinator.com/item?id=1001");
    expect(item.text).toContain("team & contractors");
    expect(item.text).not.toContain("<p>");
    expect(item.author).toBe("alice");
  });

  it("drops items with too little text", () => {
    expect(hitToItem(page0.hits[1])).toBeNull();
  });

  it("drops malformed hits", () => {
    expect(hitToItem({ nope: true })).toBeNull();
  });
});

describe("Hacker News adapter", () => {
  it("paginates, dedups and respects maxItems", async () => {
    const fetchFn = fakeFetch([page0, page1]);
    const adapter = createHackerNewsAdapter(fetchFn);
    const items = await adapter.search({ topic: "figma", days: 30, maxItems: 10 });
    expect(items.map((i) => i.id)).toEqual(["hn:1001", "hn:1003", "hn:1004"]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("stops early when maxItems is reached", async () => {
    const fetchFn = fakeFetch([page0, page1]);
    const items = await createHackerNewsAdapter(fetchFn).search({ topic: "figma", days: 30, maxItems: 2 });
    expect(items).toHaveLength(2);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("sends the time filter and topic", async () => {
    const fetchFn = fakeFetch([page0, page1]);
    await createHackerNewsAdapter(fetchFn).search({ topic: "figma pricing", days: 7, maxItems: 1 });
    const url = new URL(String((fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]));
    expect(url.hostname).toBe("hn.algolia.com");
    expect(url.searchParams.get("query")).toBe("figma pricing");
    expect(url.searchParams.get("numericFilters")).toMatch(/^created_at_i>\d+$/);
  });

  it("throws a readable error on HTTP failure", async () => {
    const fetchFn = vi.fn(async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    await expect(createHackerNewsAdapter(fetchFn).search({ topic: "x", days: 7, maxItems: 5 })).rejects.toThrow(
      /HTTP 500/,
    );
  });
});
