import type { Report } from "../types";

function mdEscape(s: string): string {
  return s.replace(/([\\`*_[\]<>|])/g, "\\$1").replace(/\n+/g, " ");
}

export function reportToMarkdown(r: Report): string {
  const lines = [
    `# Pain points: ${mdEscape(r.topic)}`,
    "",
    `${r.itemsAnalyzed} posts and comments from ${r.sources.join(", ")}, last ${r.days} days. Generated ${new Date(r.generatedAt).toLocaleDateString("en-GB")}.`,
    "",
  ];
  r.themes.forEach((t, i) => {
    lines.push(`## ${i + 1}. ${mdEscape(t.title)}`, "");
    lines.push(`Severity ${t.severity}/5 · mentioned in ${t.mentions} ${t.mentions === 1 ? "post" : "posts"}`, "");
    lines.push(mdEscape(t.summary), "");
    for (const q of t.quotes) lines.push(`> ${mdEscape(q.text)} ([${mdEscape(q.author)}](${q.url}))`, "");
  });
  return lines.join("\n");
}

export function downloadFile(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "report";
}

/**
 * Opens the browser's print dialog, where "Save as PDF" produces the PDF.
 * No PDF library needed; the print stylesheet in styles.css lays out the report.
 * The title is swapped while printing because browsers use it as the default file name.
 */
export function printReport(filename: string, win: Window = window): void {
  const previous = win.document.title;
  win.document.title = filename;
  win.addEventListener("afterprint", () => (win.document.title = previous), { once: true });
  win.print();
}
