import type { Report } from "../types";
import { RadarGlyph } from "./RadarGlyph";
import { safeHttpsUrl } from "../lib/text";
import { sourceLabel } from "../sources";
import { downloadFile, printReport, reportToMarkdown, slugify } from "../lib/export";

interface Props {
  report: Report;
  isSample: boolean;
}

export function ReportView({ report, isSample }: Props) {
  const date = new Date(report.generatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const base = `pain-points-${slugify(report.topic)}`;

  return (
    <section className="report" aria-labelledby="report-title">
      {isSample && (
        <p className="sample-note">
          This is a sample report. Enter a topic above and add your API key to run your own.
        </p>
      )}

      <header className="report-head">
        <h2 id="report-title">What people struggle with in {report.topic}</h2>
        <p className="report-meta">
          {report.themes.length} {report.themes.length === 1 ? "theme" : "themes"} from {report.itemsAnalyzed} posts, issues and reviews from{" "}
          {report.sources.join(", ")} over the last {report.days} days, generated {date}.
        </p>
        <div className="report-actions">
          <button type="button" className="btn-quiet" onClick={() => downloadFile(`${base}.md`, reportToMarkdown(report), "text/markdown")}>
            Download Markdown
          </button>
          <button
            type="button"
            className="btn-quiet"
            onClick={() => downloadFile(`${base}.json`, JSON.stringify(report, null, 2), "application/json")}
          >
            Download JSON
          </button>
          <button type="button" className="btn-quiet" onClick={() => printReport(base)}>
            Download PDF
          </button>
        </div>
      </header>

      {report.themes.length === 0 ? (
        <p className="empty">
          No clear pain points turned up for this topic. Try a broader topic or a longer time range.
        </p>
      ) : (
        <ol className="themes">
          {report.themes.map((t) => (
            <li key={t.title} className="theme">
              <RadarGlyph severity={t.severity} />
              <div className="theme-body">
                <h3>{t.title}</h3>
                <p className="theme-stats">
                  Severity {t.severity} of 5, mentioned in {t.mentions} {t.mentions === 1 ? "post" : "posts"}
                </p>
                <p className="theme-summary">{t.summary}</p>
                {t.quotes.length > 0 && (
                  <ul className="quotes">
                    {t.quotes.map((q) => {
                      const href = safeHttpsUrl(q.url);
                      return (
                        <li key={q.url + q.text}>
                          <blockquote>{q.text}</blockquote>
                          {href && (
                            <a href={href} target="_blank" rel="noopener noreferrer nofollow">
                              {q.author} on {sourceLabel(q.source ?? "hackernews")}
                            </a>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      <p className="print-only print-credit">Generated with Pain Point Radar, pain-point-radar-delta.vercel.app</p>
    </section>
  );
}
