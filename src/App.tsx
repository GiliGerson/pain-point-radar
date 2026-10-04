import { useEffect, useRef, useState } from "react";
import { SOURCES, searchSources, sourceLabel } from "./sources";
import type { Item, Report } from "./types";
import { ReportSchema } from "./types";
import { analyze, type Progress } from "./pipeline/analyze";
import { estimateCost, type CostEstimate } from "./pipeline/cost";
import { createAnthropicClient } from "./llm/anthropic";
import { createDemoClient } from "./llm/demo";
import { DEMO_MAX_ITEMS } from "./pipeline/config";
import { ReportView } from "./components/ReportView";

type Phase =
  | { kind: "idle" }
  | { kind: "fetching" }
  | { kind: "ready"; items: Item[]; estimate: CostEstimate; failures: { label: string; message: string }[] }
  | { kind: "analyzing"; progress: Progress | null }
  | { kind: "error"; message: string };

const DAY_OPTIONS = [7, 30, 90, 365];
const ITEM_OPTIONS = [50, 100, 200, 500];

export default function App() {
  const [topic, setTopic] = useState("");
  const [days, setDays] = useState(30);
  const [maxItems, setMaxItems] = useState(100);
  // The key lives in React state only: never localStorage, never a URL, never a log.
  const [apiKey, setApiKey] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [report, setReport] = useState<Report | null>(null);
  const [isSample, setIsSample] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const [selected, setSelected] = useState<string[]>(() => SOURCES.filter((s) => s.enabled).map((s) => s.id));
  const chosen = SOURCES.filter((s) => s.enabled && selected.includes(s.id));
  const chosenLabel = chosen.map((s) => s.label).join(", ");
  const busy = phase.kind === "fetching" || phase.kind === "analyzing";
  // Without a key, runs go through the free demo on the owner's key, capped at DEMO_MAX_ITEMS.
  const demo = !apiKey.trim();

  useEffect(() => {
    fetch("/demo-report.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const parsed = ReportSchema.safeParse(data);
        if (parsed.success) {
          setReport(parsed.data);
          setIsSample(true);
        }
      })
      .catch(() => {});
  }, []);

  async function findPosts() {
    const t = topic.trim();
    if (!t) return;
    abortRef.current = new AbortController();
    setPhase({ kind: "fetching" });
    try {
      const { items, failures } = await searchSources(chosen, {
        topic: t,
        days,
        maxItems: demo ? Math.min(maxItems, DEMO_MAX_ITEMS) : maxItems,
        signal: abortRef.current.signal,
      });
      if (items.length === 0) {
        setPhase({ kind: "error", message: `Nothing on ${chosenLabel} mentions "${t}" in the last ${days} days. Try a broader topic, more sources or a longer range.` });
        return;
      }
      setPhase({ kind: "ready", items, estimate: estimateCost(items), failures });
    } catch (e) {
      if (!abortRef.current.signal.aborted) setPhase({ kind: "error", message: errorText(e) });
    }
  }

  async function runAnalysis(found: Item[]) {
    // A search made with a key can be larger than the demo allows.
    const items = demo ? found.slice(0, DEMO_MAX_ITEMS) : found;
    abortRef.current = new AbortController();
    setPhase({ kind: "analyzing", progress: null });
    try {
      const result = await analyze({
        topic: topic.trim(),
        days,
        sources: [...new Set(items.map((it) => it.source))].map(sourceLabel),
        items,
        llm: demo ? createDemoClient() : createAnthropicClient(apiKey.trim()),
        signal: abortRef.current.signal,
        onProgress: (progress) => setPhase({ kind: "analyzing", progress }),
      });
      setReport(result);
      setIsSample(false);
      setPhase({ kind: "idle" });
    } catch (e) {
      if (!abortRef.current.signal.aborted) setPhase({ kind: "error", message: errorText(e) });
    }
  }

  function cancel() {
    abortRef.current?.abort();
    setPhase({ kind: "idle" });
  }

  return (
    <div className="page">
      <header className="masthead">
        <span className="brand">Pain Point Radar</span>
        <a className="repo-link" href="https://github.com/GiliGerson/pain-point-radar" target="_blank" rel="noopener noreferrer">
          Source on GitHub
        </a>
      </header>

      <main>
        <form
          className="ask"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) findPosts();
          }}
        >
          <label className="ask-line" htmlFor="topic">
            <span>What do people struggle with</span>
            <span className="ask-tail">
              in{" "}
              <input
                id="topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Figma"
                maxLength={80}
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
              />
              <span aria-hidden="true">?</span>
            </span>
          </label>

          <p className="ask-intro">
            Reads recent public discussion and app reviews, pulls out real complaints with an AI model, and groups
            them into themes with the original quotes. Runs in your browser with your own Anthropic API key.
          </p>

          <div className="controls">
            <label>
              Time range
              <select value={days} onChange={(e) => setDays(Number(e.target.value))} disabled={busy}>
                {DAY_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    Last {d} days
                  </option>
                ))}
              </select>
            </label>
            <label>
              Posts to read
              <select value={maxItems} onChange={(e) => setMaxItems(Number(e.target.value))} disabled={busy}>
                {ITEM_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    Up to {n}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="sources">
              <legend>Sources</legend>
              {SOURCES.map((s) => (
                <label key={s.id} className={s.enabled ? "" : "is-disabled"}>
                  <input
                    type="checkbox"
                    checked={s.enabled && selected.includes(s.id)}
                    disabled={!s.enabled || busy}
                    onChange={(e) =>
                      setSelected((cur) => (e.target.checked ? [...cur, s.id] : cur.filter((id) => id !== s.id)))
                    }
                  />
                  {s.label}
                  {!s.enabled && <span className="hint"> ({s.disabledReason})</span>}
                </label>
              ))}
            </fieldset>
          </div>

          <div className="key-row">
            <label htmlFor="api-key">Anthropic API key</label>
            <div className="key-input">
              <input
                id="api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-ant-..."
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
              />
              {apiKey && (
                <button type="button" className="btn-quiet" onClick={() => setApiKey("")}>
                  Forget key
                </button>
              )}
            </div>
            <p className="hint">
              Optional. Without a key you get a free demo run of up to {DEMO_MAX_ITEMS} posts. With your own key you
              can read up to 500; it is sent only to api.anthropic.com, kept in memory, and gone when you close the tab.
            </p>
          </div>

          {phase.kind !== "ready" && (
            <button type="submit" className="btn-primary" disabled={busy || !topic.trim() || chosen.length === 0}>
              {phase.kind === "fetching" ? "Finding posts…" : "Find posts"}
            </button>
          )}
        </form>

        <Status phase={phase} hasKey={!!apiKey.trim()} onRun={runAnalysis} onCancel={cancel} sourceLabel={chosenLabel} />

        {report && phase.kind !== "analyzing" && <ReportView report={report} isSample={isSample} />}
      </main>

      <footer className="foot">
        No server, no tracking. Your key and results never leave your browser except to call the APIs above.
      </footer>
    </div>
  );
}

function Status(props: {
  phase: Phase;
  hasKey: boolean;
  sourceLabel: string;
  onRun: (items: Item[]) => void;
  onCancel: () => void;
}) {
  const { phase } = props;

  if (phase.kind === "ready") {
    const { items, estimate, failures } = phase;
    const counts = new Map<string, number>();
    for (const it of items) counts.set(it.source, (counts.get(it.source) ?? 0) + 1);
    const breakdown = [...counts].map(([id, n]) => `${n} from ${sourceLabel(id)}`).join(", ");
    return (
      <section className="status" aria-live="polite">
        <p>
          Found {items.length} posts, comments and reviews ({breakdown}). Analyzing them takes {estimate.calls} AI
          calls
          {props.hasKey ? (
            <>
              {" "}and should cost about <strong>${Math.max(estimate.usd, 0.01).toFixed(2)}</strong> on your API key.
            </>
          ) : (
            <>, free for you: this runs on the demo key.</>
          )}
        </p>
        <div className="status-actions">
          <button type="button" className="btn-primary" onClick={() => props.onRun(items)}>
            Analyze {items.length} posts
          </button>
          <button type="button" className="btn-quiet" onClick={props.onCancel}>
            Start over
          </button>
        </div>
        {failures.map((f) => (
          <p key={f.label} className="hint">
            Skipped {f.label}: {f.message}
          </p>
        ))}
      </section>
    );
  }

  if (phase.kind === "analyzing") {
    const p = phase.progress;
    const label =
      !p ? "Starting…" : p.stage === "extract" ? `Reading posts, batch ${p.done} of ${p.total}` : "Grouping complaints into themes";
    const pct = !p ? 2 : p.stage === "extract" ? 5 + (p.done / p.total) * 75 : 90;
    return (
      <section className="status" aria-live="polite">
        <p>{label}</p>
        <div className="bar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <button type="button" className="btn-quiet" onClick={props.onCancel}>
          Cancel
        </button>
      </section>
    );
  }

  if (phase.kind === "error") {
    return (
      <section className="status status-error" role="alert">
        <p>{phase.message}</p>
        <button type="button" className="btn-quiet" onClick={props.onCancel}>
          Dismiss
        </button>
      </section>
    );
  }

  return null;
}

function errorText(e: unknown): string {
  if (e instanceof TypeError) return "Network request failed. Check your connection and try again.";
  return e instanceof Error ? e.message : "Something went wrong.";
}
