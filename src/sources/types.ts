import type { Item, SearchOptions } from "../types";

/**
 * Every data source implements this interface.
 * Adding a new source means writing one adapter, nothing else changes.
 */
export interface SourceAdapter {
  id: string;
  label: string;
  enabled: boolean;
  /** Shown in the UI when a source is disabled. */
  disabledReason?: string;
  search(options: SearchOptions): Promise<Item[]>;
}
