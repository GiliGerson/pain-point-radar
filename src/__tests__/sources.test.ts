import { describe, expect, it, vi } from "vitest";
import { createAppStoreAdapter, entryToItem, findApp } from "../sources/appstore";
import { createBlueskyAdapter, postToItem } from "../sources/bluesky";
import { createGitHubAdapter, issueToItem } from "../sources/github";
import { createStackOverflowAdapter, questionToItem } from "../sources/stackoverflow";
import { searchSources, type SourceAdapter } from "../sources";
import type { Item } from "../types";

const DAY = 86400 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();
const LONG = "This keeps crashing whenever I open a big workspace on my phone, very frustrating.";

/** Answers each request with the first responder whose key appears in the URL. */
function fakeFetch(routes: Record<string, unknown | ((url: URL) => unknown)>, status = 200) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const key = Object.keys(routes).find((k) => url.href.includes(k));
    if (!key) return new Response("not found", { status: 404 });
    const body = routes[key];
    return new Response(JSON.stringify(typeof body === "function" ? body(url) : body), { status });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

const app = { trackId: 42, trackName: "Notion: Notes, Tasks, AI", trackViewUrl: "https://apps.apple.com/us/app/notion/id42" };
const review = (id: string, updated: string, rating = "2") => ({
  id: { label: id },
  author: { name: { label: `user${id}` } },
  updated: { label: updated },
  title: { label: "Sync is broken" },
  content: { label: LONG },
  "im:rating": { label: rating },
});

describe("App Store", () => {
  it("only accepts an app whose name contains the topic", async () => {
    const other = { trackId: 1, trackName: "Evernote", trackViewUrl: "https://apps.apple.com/x" };
    expect(await findApp(fakeFetch({ "/search": { results: [other] } }), "notion")).toBeNull();
    expect(await findApp(fakeFetch({ "/search": { results: [other, app] } }), "notion")).toEqual(app);
  });

  it("puts the rating in the text and links to the app page", () => {
    const item = entryToItem(review("7", daysAgo(1)), app)!;
    expect(item.id).toBe("appstore:7");
    expect(item.text.startsWith("Rated 2 of 5 stars.")).toBe(true);
    expect(item.url).toBe(app.trackViewUrl);
  });

  it("stops at the first review older than the range, and handles a single-review feed", async () => {
    const fetchFn = fakeFetch({
      "/search": { results: [app] },
      "page=1/": { feed: { entry: [review("1", daysAgo(1)), review("2", daysAgo(5)), review("3", daysAgo(40))] } },
      "page=2/": { feed: { entry: review("4", daysAgo(2)) } },
    });
    const items = await createAppStoreAdapter(fetchFn).search({ topic: "notion", days: 30, maxItems: 100 });
    expect(items.map((i) => i.id)).toEqual(["appstore:1", "appstore:2"]);
    expect(fetchFn.mock.calls.some(([u]) => String(u).includes("page=2/"))).toBe(false);
  });

  it("returns nothing when no app matches", async () => {
    const items = await createAppStoreAdapter(fakeFetch({ "/search": { results: [] } })).search({ topic: "figma", days: 30, maxItems: 10 });
    expect(items).toEqual([]);
  });
});

describe("Bluesky", () => {
  const post = (rkey: string, text = LONG) => ({
    uri: `at://did:plc:abc/app.bsky.feed.post/${rkey}`,
    author: { handle: "dana.bsky.social" },
    record: { text, createdAt: daysAgo(1) },
  });

  it("builds a public post link and drops short posts", () => {
    expect(postToItem(post("3k2"))?.url).toBe("https://bsky.app/profile/dana.bsky.social/post/3k2");
    expect(postToItem(post("x", "too short"))).toBeNull();
  });

  it("asks for at most 100 posts in the time range", async () => {
    const fetchFn = fakeFetch({ searchPosts: { posts: [post("a"), post("b")] } });
    const items = await createBlueskyAdapter(fetchFn).search({ topic: "notion", days: 7, maxItems: 500 });
    expect(items).toHaveLength(2);
    const url = new URL(String(fetchFn.mock.calls[0][0]));
    expect(url.searchParams.get("limit")).toBe("100");
    expect(url.searchParams.get("since")).toBeTruthy();
  });
});

describe("GitHub Issues", () => {
  const issue = (id: number, body: string | null = LONG) => ({
    id,
    html_url: `https://github.com/acme/app/issues/${id}`,
    title: "Export fails",
    body,
    user: { login: "erin" },
    created_at: daysAgo(3),
  });

  it("strips issue-template comments", () => {
    const item = issueToItem(issue(1, "<!-- Please fill in the template -->\n" + LONG))!;
    expect(item.text).not.toContain("<!--");
    expect(item.text).toContain("crashing");
  });

  it("stops paging when a page is not full", async () => {
    const fetchFn = fakeFetch({ "search/issues": { total_count: 500, items: [issue(1), issue(2)] } });
    const items = await createGitHubAdapter(fetchFn).search({ topic: "notion", days: 30, maxItems: 500 });
    expect(items).toHaveLength(2);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(new URL(String(fetchFn.mock.calls[0][0])).searchParams.get("q")).toMatch(/^notion is:issue created:>=\d{4}-\d{2}-\d{2}$/);
  });

  it("reports a rate limit clearly", async () => {
    const adapter = createGitHubAdapter(fakeFetch({ "search/issues": {} }, 403));
    await expect(adapter.search({ topic: "notion", days: 30, maxItems: 10 })).rejects.toThrow(/GitHub rate limit/);
  });
});

describe("Stack Overflow", () => {
  it("decodes HTML in titles, bodies and names", () => {
    const item = questionToItem({
      question_id: 9,
      link: "https://stackoverflow.com/questions/9",
      title: "Notion API &quot;rate limited&quot; on bulk insert",
      body: `<p>${LONG}</p>`,
      owner: { display_name: "Jos&#233;" },
      creation_date: 1_780_000_000,
    })!;
    expect(item.title).toBe('Notion API "rate limited" on bulk insert');
    expect(item.text).not.toContain("<p>");
    expect(item.author).toBe("José");
  });

  it("follows has_more", async () => {
    const q = (id: number) => ({ question_id: id, link: `https://stackoverflow.com/q/${id}`, title: "t", body: LONG, creation_date: 1 });
    const fetchFn = fakeFetch({
      "search/advanced": (url: URL) =>
        url.searchParams.get("page") === "1" ? { items: [q(1)], has_more: true } : { items: [q(2)], has_more: false },
    });
    const items = await createStackOverflowAdapter(fetchFn).search({ topic: "notion", days: 30, maxItems: 10 });
    expect(items.map((i) => i.id)).toEqual(["so:1", "so:2"]);
  });
});

describe("searchSources", () => {
  const mk = (source: string, n: number): Item[] =>
    Array.from({ length: n }, (_, i) => ({ id: `${source}:${i}`, source, url: "https://x", title: "", text: LONG, author: "a", createdAt: "" }));
  const adapter = (id: string, result: Item[] | Error): SourceAdapter => ({
    id,
    label: id.toUpperCase(),
    enabled: true,
    search: async () => {
      if (result instanceof Error) throw result;
      return result;
    },
  });

  it("interleaves sources so a quiet one leaves room for the others", async () => {
    const { items } = await searchSources([adapter("a", mk("a", 10)), adapter("b", mk("b", 1))], { topic: "t", days: 30, maxItems: 5 });
    expect(items.map((i) => i.id)).toEqual(["a:0", "b:0", "a:1", "a:2", "a:3"]);
  });

  it("keeps going when one source fails", async () => {
    const res = await searchSources([adapter("a", mk("a", 2)), adapter("b", new Error("B is down"))], { topic: "t", days: 30, maxItems: 10 });
    expect(res.items).toHaveLength(2);
    expect(res.failures).toEqual([{ label: "B", message: "B is down" }]);
  });

  it("throws when every source fails", async () => {
    await expect(searchSources([adapter("a", new Error("A is down"))], { topic: "t", days: 30, maxItems: 10 })).rejects.toThrow("A is down");
  });
});
