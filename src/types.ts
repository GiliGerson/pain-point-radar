import { z } from "zod";

/** One piece of public discussion, normalized across sources. */
export const ItemSchema = z.object({
  id: z.string(),
  source: z.string(),
  url: z.string(),
  title: z.string(),
  text: z.string(),
  author: z.string(),
  createdAt: z.string(),
});
export type Item = z.infer<typeof ItemSchema>;

/** A single pain point extracted from one item, with a verbatim quote. */
export const PainPointSchema = z.object({
  id: z.string(),
  itemId: z.string(),
  pain: z.string(),
  quote: z.string(),
});
export type PainPoint = z.infer<typeof PainPointSchema>;

export const QuoteSchema = z.object({
  text: z.string(),
  url: z.string(),
  author: z.string(),
});
export type Quote = z.infer<typeof QuoteSchema>;

export const ThemeSchema = z.object({
  title: z.string(),
  summary: z.string(),
  severity: z.number().int().min(1).max(5),
  mentions: z.number().int().min(0),
  quotes: z.array(QuoteSchema),
});
export type Theme = z.infer<typeof ThemeSchema>;

export const ReportSchema = z.object({
  version: z.literal(1),
  topic: z.string(),
  sources: z.array(z.string()),
  generatedAt: z.string(),
  days: z.number(),
  itemsAnalyzed: z.number(),
  painPointsFound: z.number(),
  themes: z.array(ThemeSchema),
});
export type Report = z.infer<typeof ReportSchema>;

export interface SearchOptions {
  topic: string;
  days: number;
  maxItems: number;
  signal?: AbortSignal;
}
