import { describe, expect, it } from "vitest";
import { createMockLLM } from "../llm/mock";
import { analyze, clusterPainPoints, extractPainPoints } from "../pipeline/analyze";
import { completeJson } from "../pipeline/json";
import { buildExtractPrompt, EXTRACT_SYSTEM } from "../pipeline/prompts";
import { estimateCost } from "../pipeline/cost";
import { z } from "zod";
import type { Item, PainPoint } from "../types";

const items: Item[] = [
  { id: "hn:1", source: "hackernews", url: "https://news.ycombinator.com/item?id=1", title: "", author: "alice", createdAt: "", text: "The new pricing is brutal. We pay per editor now and it tripled our bill." },
  { id: "hn:2", source: "hackernews", url: "https://news.ycombinator.com/item?id=2", title: "", author: "bob", createdAt: "", text: "Large files freeze my browser tab for ten seconds every time I switch pages." },
  { id: "hn:3", source: "hackernews", url: "javascript:alert(1)", title: "", author: "eve", createdAt: "", text: "Per editor pricing tripled what we pay, considering leaving." },
];

const extractReply = JSON.stringify({
  painPoints: [
    { itemId: "hn:1", pain: "Per-editor pricing raised costs", quote: "We pay per editor now and it tripled our bill." },
    { itemId: "hn:2", pain: "Large files freeze", quote: "Large files freeze my browser tab" },
    { itemId: "hn:2", pain: "Invented complaint", quote: "This sentence is not in the post at all" },
    { itemId: "hn:999", pain: "Unknown item", quote: "whatever" },
    { itemId: "hn:3", pain: "Pricing", quote: "Per editor pricing tripled what we pay" },
  ],
});

describe("extractPainPoints", () => {
  it("keeps only quotes that really appear in the source item", async () => {
    const llm = createMockLLM([extractReply]);
    const pps = await extractPainPoints("figma", items, llm);
    expect(pps.map((p) => p.itemId)).toEqual(["hn:1", "hn:2", "hn:3"]);
    expect(pps.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
    expect(pps.some((p) => p.pain === "Invented complaint")).toBe(false);
  });

  it("wraps item text as untrusted data", () => {
    const prompt = buildExtractPrompt("figma", items.slice(0, 1));
    expect(prompt).toContain('<untrusted id="hn:1">');
    expect(prompt).toContain("</untrusted>");
  });

  it("asks only for pain points about the topic itself, not other senses of the word", () => {
    const prompt = buildExtractPrompt("Notion", items.slice(0, 1));
    expect(prompt).toContain("about Notion itself");
    expect(EXTRACT_SYSTEM).toMatch(/another sense/);
    expect(EXTRACT_SYSTEM).toMatch(/other products/);
  });
});

describe("clusterPainPoints", () => {
  const pps: PainPoint[] = [
    { id: "p1", itemId: "hn:1", pain: "Pricing", quote: "We pay per editor now" },
    { id: "p2", itemId: "hn:2", pain: "Freeze", quote: "Large files freeze" },
    { id: "p3", itemId: "hn:3", pain: "Pricing", quote: "Per editor pricing tripled" },
  ];

  it("computes mentions and quotes from real data, not from the model", async () => {
    const llm = createMockLLM([
      JSON.stringify({
        themes: [
          { title: "Slow with large files", summary: "s", severity: 3, painPointIds: ["p2"] },
          { title: "Per-editor pricing", summary: "s", severity: 4, painPointIds: ["p1", "p3", "p1", "ghost"] },
          { title: "Empty theme", summary: "s", severity: 5, painPointIds: ["ghost"] },
        ],
      }),
    ]);
    const themes = await clusterPainPoints("figma", pps, items, llm);
    expect(themes.map((t) => t.title)).toEqual(["Per-editor pricing", "Slow with large files"]);
    expect(themes[0].mentions).toBe(2);
    // hn:3 has a javascript: URL, so its quote must not be rendered as a link.
    expect(themes[0].quotes.map((q) => q.url)).toEqual(["https://news.ycombinator.com/item?id=1"]);
  });

  it("counts each pain point in one theme only", async () => {
    const llm = createMockLLM([
      JSON.stringify({
        themes: [
          { title: "Everything", summary: "s", severity: 2, painPointIds: ["p1", "p2"] },
          { title: "Pricing again", summary: "s", severity: 3, painPointIds: ["p1"] },
          { title: "Freeze again", summary: "s", severity: 3, painPointIds: ["p2", "p3"] },
        ],
      }),
    ]);
    const themes = await clusterPainPoints("figma", pps, items, llm);
    expect(themes.map((t) => t.title).sort()).toEqual(["Everything", "Freeze again"]);
    expect(themes.reduce((n, t) => n + t.mentions, 0)).toBe(3);
    const quoted = themes.flatMap((t) => t.quotes.map((q) => q.text));
    expect(new Set(quoted).size).toBe(quoted.length);
  });

  it("skips the model call when there is nothing to cluster", async () => {
    const llm = createMockLLM(["{}"]);
    expect(await clusterPainPoints("x", [], items, llm)).toEqual([]);
    expect(llm.calls).toHaveLength(0);
  });
});

describe("completeJson", () => {
  const schema = z.object({ ok: z.boolean() });

  it("strips code fences", async () => {
    const llm = createMockLLM(['```json\n{"ok": true}\n```']);
    expect(await completeJson(llm, { model: "m", system: "", prompt: "p", maxTokens: 10 }, schema)).toEqual({ ok: true });
  });

  it("retries once with the validation error", async () => {
    const llm = createMockLLM(['{"ok": "yes"}', '{"ok": true}']);
    await completeJson(llm, { model: "m", system: "", prompt: "p", maxTokens: 10 }, schema);
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1].prompt).toContain("not valid");
  });

  it("gives up after two bad replies", async () => {
    const llm = createMockLLM(["not json"]);
    await expect(completeJson(llm, { model: "m", system: "", prompt: "p", maxTokens: 10 }, schema)).rejects.toThrow(/twice/);
  });
});

describe("analyze", () => {
  it("runs both stages and reports progress", async () => {
    const llm = createMockLLM([
      extractReply,
      JSON.stringify({ themes: [{ title: "Pricing", summary: "s", severity: 4, painPointIds: ["p1", "p3"] }] }),
    ]);
    const stages: string[] = [];
    const report = await analyze({ topic: "figma", days: 30, sources: ["Hacker News"], items, llm, onProgress: (p) => stages.push(p.stage) });
    expect(report.itemsAnalyzed).toBe(3);
    expect(report.painPointsFound).toBe(3);
    expect(report.themes[0].title).toBe("Pricing");
    expect(stages[0]).toBe("extract");
    expect(stages.at(-1)).toBe("cluster");
    expect(llm.calls[0].model).toContain("haiku");
    expect(llm.calls[1].model).toContain("sonnet");
  });
});

describe("estimateCost", () => {
  it("grows with the number of items", () => {
    const small = estimateCost(items);
    const big = estimateCost(Array.from({ length: 100 }, (_, i) => ({ ...items[0], id: `hn:${i}` })));
    expect(big.calls).toBeGreaterThan(small.calls);
    expect(big.usd).toBeGreaterThan(small.usd);
  });
});
