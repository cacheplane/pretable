import type { BenchScriptName } from "@pretable-internal/bench-runner";

export interface BenchQueryState {
  adapterId: "pretable" | "gridalpha" | "gridbeta" | "gridgamma";
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
  >;
  autorun: boolean;
}
