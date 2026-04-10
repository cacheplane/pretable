import type { BenchQueryState } from "./bench-types";

const DEFAULT_QUERY_STATE: BenchQueryState = {
  adapterId: "pretable",
  scenarioId: "S1",
  profile: "default",
  scriptName: "initial",
  autorun: false,
};

export function parseBenchQuery(input: string | URLSearchParams): BenchQueryState {
  const searchParams =
    typeof input === "string" ? new URLSearchParams(input) : input;

  return {
    adapterId:
      searchParams.get("adapter") === "pretable"
        ? "pretable"
        : DEFAULT_QUERY_STATE.adapterId,
    scenarioId:
      searchParams.get("scenario") === "S2"
        ? "S2"
        : DEFAULT_QUERY_STATE.scenarioId,
    profile: DEFAULT_QUERY_STATE.profile,
    scriptName:
      searchParams.get("script") === "scroll"
        ? "scroll"
        : DEFAULT_QUERY_STATE.scriptName,
    autorun: searchParams.get("autorun") === "1",
  };
}
