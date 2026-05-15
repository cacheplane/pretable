import type {
  BenchAdapterId,
  BenchScriptName,
} from "@pretable-internal/bench-runner";

export interface BenchQueryState {
  adapterId: BenchAdapterId;
  scenarioId: "S1" | "S2" | "S3" | "S4" | "S5" | "S7";
  profile: "default";
  scale: "smoke" | "dev" | "hypothesis" | "target";
  scriptName: Extract<
    BenchScriptName,
    | "initial"
    | "scroll"
    | "sort"
    | "filter-metadata"
    | "filter-text"
    | "updates"
    | "autosize"
    | "select-range-extend"
    | "keyboard-nav-row"
    | "select-all"
    | "scroll-with-format"
    | "scroll-with-render"
    | "scroll-with-heavy-render"
  >;
  autorun: boolean;
  /**
   * Patches per second for the `updates` script. Default is 1000/sec
   * (the existing S5 default), held by varying batch size at a fixed
   * 50 ms tick (so RAF/timer behavior stays consistent across rates).
   */
  updateRatePerSec: number;
  waitForTrigger: boolean;
}
