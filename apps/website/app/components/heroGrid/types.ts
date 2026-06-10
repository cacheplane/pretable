// apps/website/app/components/heroGrid/types.ts
/** Severity tag the AI analyst assigns a holding. */
export type PositionFlag = "trim" | "hold" | "watch" | "risk";

/**
 * One holding in the demo portfolio.
 *
 * `last`/`mktValue`/`dayPnl`/`dayPnlPct`/`weight` are mutated by Phase-2 `tick`
 * events. `analyst` grows via `commentary` events (wrapped, variable height).
 * `flag` changes via `flag` events. `lastDir`/`tickSeq` are render-only fields
 * the HeroGrid reducer sets when applying a tick — they drive the price flash
 * and are never present in the recording.
 */
export interface PositionRow extends Record<string, unknown> {
  /** Stable row id; equals `symbol`. */
  id: string;
  symbol: string;
  name: string;
  sector: string;
  qty: number;
  last: number;
  mktValue: number;
  dayPnl: number;
  dayPnlPct: number;
  weight: number;
  analyst: string;
  flag: PositionFlag;
  /** Render-only: direction of the most recent price change. */
  lastDir?: "up" | "down";
  /** Render-only: increments on every tick so the flash animation restarts. */
  tickSeq?: number;
}
