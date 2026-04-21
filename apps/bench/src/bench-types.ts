import type { BenchScriptName } from "@pretable-internal/bench-runner";

export interface BenchQueryState {
  adapterId: "pretable" | "ag-grid" | "tanstack" | "mui";
  scenarioId: "S1" | "S2" | "S3" | "S7";
  profile: "default";
  scale: "smoke" | "dev" | "hypothesis" | "target";
  scriptName: Extract<
    BenchScriptName,
    "initial" | "scroll" | "sort" | "filter-metadata" | "filter-text"
  >;
  autorun: boolean;
}
