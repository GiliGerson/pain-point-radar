import { useEffect, useRef, useState } from "react";
import { SOURCES } from "./sources";
import type { Item, Report } from "./types";
import { ReportSchema } from "./types";
import { analyze, type Progress } from "./pipeline/analyze";
import { estimateCost, type CostEstimate } from "./pipeline/cost";
import { createAnthropicClient } from "./llm/anthropic";
import { ReportView } from "./components/ReportView";

type Phase =
  | { kind: "idle" }
  | { kind: "fetching" }
  | { kind: "ready"; items: Item[]; estimate: CostEstimate }
  | { kind: "analyzing"; progress: Progress | null }
  | { kind: "error"; message: string };

const DAY_OPTIONS = [7, 30, 90, 365];
const ITEM_OPTIONS = [50, 100, 200];

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

  const source = SOURCES.find((s) => s.enabled)!;
  const busy = phase.kind === "fetching" || phase.kind === "analyzing";

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
      const items = await source.search({ topic: t, days, maxItems, signal: abortRef.current.signal });
      if (items.length === 0) {
        setPhase({ kind: "error", message: `Nothing on ${source.label} mentions "${t}" in the last ${days} days. Try a broader topic or a longer range.` });
        return;
      }
      setPhase({ kind: "ready", items, estimate: estimateCost(items) });
    } catch (e) {
      if (!abortRef.current.signal.aborted) setPhase({ kind: "error", message: errorText(e) });
    }
  }

  async function runAnalysis(items: Item[]) {
    if (!apiKey.trim()) return;
    abortRef.current = new AbortController();
    setPhase({ kind: "analyzing", progress: null });
    try {
      const result = await analyze({
        topic: topic.trim(),
        days,
        sources: [source.label],
        items,
        llm: createAnthropicClient(apiKey.trim()),
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
            Reads recent public discussion on {source.label}, pulls out real complaints with an AI model, and groups
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
                  <input type="checkbox" checked={s.enabled} disabled readOnly />
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
              Sent only to api.anthropic.com. Kept in memory, gone when you close the tab. Get one at
              console.anthropic.com.
            </p>
          </div>

          {phase.kind !== "ready" && (
            <button type="submit" className="btn-primary" disabled={busy || !topic.trim()}>
              {phase.kind === "fetching" ? "Finding posts…" : "Find posts"}
            </button>
          )}
        </form>

        <Status phase={phase} hasKey={!!apiKey.trim()} onRun={runAnalysis} onCancel={cancel} sourceLabel={source.label} />

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
    const { items, estimate } = phase;
    return (
      <section className="status" aria-live="polite">
        <p>
          Found {items.length} posts and comments on {props.sourceLabel}. Analyzing them takes {estimate.calls} AI
          calls and should cost about <strong>${Math.max(estimate.usd, 0.01).toFixed(2)}</strong> on your API key.
        </p>
        <div className="status-actions">
          <button type="button" className="btn-primary" disabled={!props.hasKey} onClick={() => props.onRun(items)}>
            Analyze {items.length} posts
          </button>
          <button type="button" className="btn-quiet" onClick={props.onCancel}>
            Start over
          </button>
        </div>
        {!props.hasKey && <p className="hint">Add your API key above to analyze.</p>}
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
