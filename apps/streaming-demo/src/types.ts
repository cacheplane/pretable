/**
 * Rows rendered in the grid. `id === symbol` is the row identifier.
 *
 * Extends Record<string, unknown> so the type satisfies the GridLike
 * constraint from @pretable-internal/stream-adapter (which is
 * `TRow extends Record<string, unknown>`).
 */
export interface StockRow extends Record<string, unknown> {
  id: string;
  symbol: string;
  name: string;
  last: number;
  change_pct: number;
  volume: number;
  sector: string;
  last_update: string;
}

/**
 * One line of `recordings/phase1.jsonl`. Corresponds to a single SSE event
 * from the OpenAI Responses stream.
 */
export type Phase1Entry =
  | {
      t: number;
      type: "response.output_text.delta";
      delta: string;
    }
  | {
      t: number;
      type:
        | "response.created"
        | "response.output_text.done"
        | "response.completed";
    };

/**
 * One line of `recordings/phase2.jsonl`. A batch of update patches to
 * apply at virtual time `t`.
 */
export interface Phase2Entry {
  t: number;
  patches: Partial<StockRow>[];
}

export type PlaybackSpeed = 0.5 | 1 | 2 | 4;
export type ReplayPhase = "fill" | "live" | "done";

export interface EngineState {
  clock: number;
  speed: PlaybackSpeed;
  playing: boolean;
  phase: ReplayPhase;
  totalDuration: number;
  /** Recent phase-1 stream events, newest last. Capped at 8. */
  recentStreamEvents: Phase1Entry[];
  /** Most-recent phase-2 batch, if any. */
  lastPatchBatch: { size: number; sample: Partial<StockRow> } | null;
  /** Parser state snapshot for the AST panel. Null during phase 2. */
  parserSnapshot: ParserSnapshot | null;
  /** Cumulative stats. */
  stats: {
    rowsAdded: number;
    patchesApplied: number;
  };
}

export interface ParserSnapshot {
  mode: string;
  rootKind: "array" | "object" | "other" | "empty";
  topLevelCount: number;
  topLevelCompleted: number;
  /** Partial value of the currently-building child of the root array. */
  buildingRow: Partial<StockRow> | null;
}
