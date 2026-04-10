export interface BenchQueryState {
  adapterId: "pretable" | "ag-grid";
  scenarioId: "S1" | "S2";
  profile: "default";
  scale: "smoke" | "dev" | "hypothesis" | "target";
  scriptName: "initial" | "scroll";
  autorun: boolean;
}
