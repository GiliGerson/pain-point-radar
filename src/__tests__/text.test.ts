import { describe, expect, it } from "vitest";
import { htmlToText, normalizeForMatch, safeHttpsUrl } from "../lib/text";
import { reportToMarkdown } from "../lib/export";

describe("htmlToText", () => {
  it("decodes entities and removes tags", () => {
    expect(htmlToText("a &amp; b<p>c &#x27;d&#x27; <a href=\"x\">link</a>")).toBe("a & b\n\nc 'd' link");
  });
  it("never leaves a script tag behind", () => {
    expect(htmlToText("<script>alert(1)</script>hi")).not.toContain("<script>");
  });
});

describe("safeHttpsUrl", () => {
  it("allows https only", () => {
    expect(safeHttpsUrl("https://news.ycombinator.com/item?id=1")).toBe("https://news.ycombinator.com/item?id=1");
    expect(safeHttpsUrl("http://example.com")).toBeNull();
    expect(safeHttpsUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpsUrl("not a url")).toBeNull();
  });
});

describe("normalizeForMatch", () => {
  it("ignores case, curly quotes and spacing", () => {
    expect(normalizeForMatch("It\u2019s   SLOW")).toBe(normalizeForMatch("it's slow"));
  });
});

describe("reportToMarkdown", () => {
  it("escapes markdown in untrusted text", () => {
    const md = reportToMarkdown({
      version: 1, topic: "x", sources: ["Hacker News"], generatedAt: "2026-10-01T00:00:00Z", days: 30, itemsAnalyzed: 1, painPointsFound: 1,
      themes: [{ title: "T", summary: "s", severity: 3, mentions: 1, quotes: [{ text: "[click](javascript:x)", url: "https://a.b", author: "z" }] }],
    });
    expect(md).toContain("\\[click\\](javascript:x)");
  });
});
