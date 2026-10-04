import { describe, expect, it } from "vitest";

/**
 * Vercel runs api/ as plain Node ESM, which needs a file extension on every
 * relative import. Vite does not, so a missing ".js" only shows up as a 500 in production.
 */
const sources = import.meta.glob(["/api/**/*.ts", "/src/**/*.ts"], { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;

function join(fromFile: string, spec: string): string {
  const parts = fromFile.split("/").slice(0, -1);
  for (const seg of spec.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

describe("api function imports", () => {
  it("use explicit .js extensions all the way down", () => {
    const queue = ["/api/claude.ts"];
    const seen = new Set<string>();
    const missing: string[] = [];
    while (queue.length) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const src = sources[file];
      expect(src, `${file} exists`).toBeTypeOf("string");
      for (const [, spec] of src.matchAll(/^import\s+(?!type\b)[^'"]*from\s+["'](\.[^"']+)["']/gm)) {
        if (!spec.endsWith(".js")) missing.push(`${file} imports "${spec}"`);
        queue.push(join(file, spec.replace(/\.js$/, "") + ".ts"));
      }
    }
    expect(missing).toEqual([]);
    expect(seen.size).toBeGreaterThan(3);
  });
});
