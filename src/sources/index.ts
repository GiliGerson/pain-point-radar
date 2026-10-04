import { createHackerNewsAdapter } from "./hackernews";
import { redditAdapter } from "./reddit";
import type { SourceAdapter } from "./types";

export const SOURCES: SourceAdapter[] = [createHackerNewsAdapter(), redditAdapter];
export type { SourceAdapter };
