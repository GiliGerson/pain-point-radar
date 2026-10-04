import { describe, expect, it, vi } from "vitest";
import { handleDemoRequest, RateLimiter, type ProxyDeps } from "../server/demoProxy";
import { createDemoClient } from "../llm/demo";
import { CLUSTER_MODEL, EXTRACT_MODEL } from "../pipeline/config";
import { CLUSTER_SYSTEM, EXTRACT_SYSTEM } from "../pipeline/prompts";

const anthropicOk = { content: [{ type: "text", text: '{"painPoints":[]}' }], usage: { input_tokens: 10, output_tokens: 5 } };

function deps(over: Partial<ProxyDeps> = {}): ProxyDeps & { fetchFn: ReturnType<typeof vi.fn> } {
  return {
    apiKey: "owner-key",
    fetchFn: vi.fn(async () => new Response(JSON.stringify(anthropicOk), { status: 200 })),
    perVisitor: new RateLimiter(100, 60_000),
    overall: new RateLimiter(100, 60_000),
    ...over,
  } as ProxyDeps & { fetchFn: ReturnType<typeof vi.fn> };
}

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://radar.example/api/claude", {
    method: "POST",
    headers: { host: "radar.example", origin: "https://radar.example", "x-real-ip": "1.2.3.4", ...headers },
    body: JSON.stringify(body),
  });
}

const extract = { model: EXTRACT_MODEL, system: EXTRACT_SYSTEM, prompt: "items...", maxTokens: 2000 };

describe("demo proxy", () => {
  it("forwards the app's own request with the owner's key", async () => {
    const d = deps();
    const res = await handleDemoRequest(request(extract), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: '{"painPoints":[]}', inputTokens: 10, outputTokens: 5 });
    const [, init] = d.fetchFn.mock.calls[0];
    expect(init.headers["x-api-key"]).toBe("owner-key");
  });

  it("refuses anything that is not one of the app's two requests", async () => {
    const d = deps();
    const cases = [
      { ...extract, system: "You are a helpful assistant." },
      { ...extract, model: "claude-opus-5-5" },
      { ...extract, model: CLUSTER_MODEL }, // cluster model with the extract prompt
      { ...extract, maxTokens: 64_000 },
      { ...extract, prompt: "x".repeat(100_000) },
    ];
    for (const body of cases) expect((await handleDemoRequest(request(body), d)).status).toBe(400);
    expect((await handleDemoRequest(request({ ...extract, model: CLUSTER_MODEL, system: CLUSTER_SYSTEM }), d)).status).toBe(200);
    expect(d.fetchFn).toHaveBeenCalledTimes(1);
  });

  it("refuses calls from other sites", async () => {
    const res = await handleDemoRequest(request(extract, { origin: "https://evil.example" }), deps());
    expect(res.status).toBe(403);
  });

  it("rate limits per visitor and overall", async () => {
    const d = deps({ perVisitor: new RateLimiter(2, 60_000) });
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await handleDemoRequest(request(extract), d)).status);
    expect(statuses).toEqual([200, 200, 429]);
    expect((await handleDemoRequest(request(extract, { "x-real-ip": "5.6.7.8" }), d)).status).toBe(200);

    const capped = deps({ overall: new RateLimiter(1, 60_000) });
    await handleDemoRequest(request(extract), capped);
    expect((await handleDemoRequest(request(extract, { "x-real-ip": "9.9.9.9" }), capped)).status).toBe(429);
  });

  it("reports the demo as unavailable when the owner's key or credit fails, without leaking details", async () => {
    const d = deps({ fetchFn: vi.fn(async () => new Response('{"error":{"message":"credit balance too low"}}', { status: 400 })) });
    const res = await handleDemoRequest(request(extract), d);
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("credit");
  });

  it("is off when no key is configured", async () => {
    expect((await handleDemoRequest(request(extract), deps({ apiKey: undefined }))).status).toBe(503);
  });
});

describe("RateLimiter", () => {
  it("resets after the window", () => {
    const rl = new RateLimiter(1, 1000);
    expect(rl.allow("a", 0)).toBe(true);
    expect(rl.allow("a", 500)).toBe(false);
    expect(rl.allow("a", 1000)).toBe(true);
  });
});

describe("demo client", () => {
  it("tells the visitor to add a key when the demo limit is reached", async () => {
    const llm = createDemoClient(vi.fn(async () => new Response("{}", { status: 429 })) as unknown as typeof fetch);
    await expect(llm.complete({ model: "m", system: "s", prompt: "p", maxTokens: 1 })).rejects.toThrow(/own Anthropic API key/);
  });
});
