import type {
  BenchAdapterId,
  BenchScriptName,
} from "@pretable-internal/bench-runner";

export interface BenchQueryState {
  adapterId: BenchAdapterId;
  scenarioId: "S1" | "S2" | "S3" | "S4" | "S5" | "S7";
  profile: "default";
  scale: "smoke" | "dev" | "hypothesis" | "target" | "local-max";
  scriptName: Extract<
    BenchScriptName,
    | "initial"
    | "scroll"
    | "sort"
    | "filter-metadata"
    | "filter-text"
    | "updates"
    | "updates-grouped"
    | "autosize"
    | "select-range-extend"
    | "keyboard-nav-row"
    | "select-all"
    | "scroll-with-format"
    | "scroll-with-render"
    | "scroll-with-heavy-render"
    | "group"
    | "group-expand"
    | "group-updates"
    | "group-updates-stable-keys"
    | "replace"
    | "append"
  >;
  autorun: boolean;
  /**
   * Patches per second for the update scripts. Default is 1000/sec
   * (the existing S5 default), held by varying batch size at a fixed
   * 50 ms tick (so RAF/timer behavior stays consistent across rates).
   */
  updateRatePerSec: number;
  waitForTrigger: boolean;
  /** Enables the private instrumented row-model controller for gate runs. */
  diagnostics: boolean;
  /** One explicit seed shared by all four permanent row-model jobs. */
  seed: number;
}

export interface RowModelBenchRebuildSummary {
  readonly completed: boolean;
  readonly responsive: boolean;
  readonly durationMs: number;
  readonly streamCommitsObserved: number;
  readonly interactionSamplesObserved: number;
  readonly sourceRowCountBefore: number;
  readonly sourceRowCountAfter: number;
  readonly groupCountBefore: number;
  readonly groupCountAfter: number;
  readonly expectedGroupCountAfter: number;
}

export interface RowModelBenchSummary {
  readonly diagnostics: true;
  readonly updatePlanChecksum: string;
  readonly acceptedPatchCount: number;
  readonly checksumAcceptedPatchCount: number;
  readonly finalChecksum: string;
  readonly expectedFinalChecksum: string;
  readonly rebuild: RowModelBenchRebuildSummary | null;
}
