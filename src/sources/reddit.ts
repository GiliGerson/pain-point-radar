import type { SourceAdapter } from "./types";

/**
 * Reddit adapter, intentionally disabled.
 *
 * Reddit closed self-serve API access for new developers in late 2025 and
 * shut the unauthenticated .json endpoints in 2026. Once OAuth credentials
 * are approved, this adapter can be implemented against the official API
 * and switched on without touching the rest of the app.
 */
export const redditAdapter: SourceAdapter = {
  id: "reddit",
  label: "Reddit",
  enabled: false,
  disabledReason: "Waiting on official API access",
  async search() {
    throw new Error("The Reddit source is not enabled yet.");
  },
};
