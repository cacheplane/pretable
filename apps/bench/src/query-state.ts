import type { BenchQueryState } from "./bench-types";

const DEFAULT_QUERY_STATE: BenchQueryState = {
  adapterId: "pretable",
  scenarioId: "S1",
  profile: "default",
  scale: "dev",
  scriptName: "initial",
  autorun: false,
};

export function parseBenchQuery(
  input: string | URLSearchParams,
): BenchQueryState {
  const searchParams =
    typeof input === "string" ? new URLSearchParams(input) : input;
  const adapter = searchParams.get("adapter");
  const scenario = searchParams.get("scenario");
  const scale = searchParams.get("scale");
  const script = searchParams.get("script");

  return {
    adapterId:
      adapter === "gridalpha"
        ? "gridalpha"
        : adapter === "gridbeta"
          ? "gridbeta"
          : adapter === "gridgamma"
            ? "gridgamma"
            : adapter === "pretable"
              ? "pretable"
              : DEFAULT_QUERY_STATE.adapterId,
    scenarioId:
      scenario === "S2"
        ? "S2"
        : scenario === "S3"
          ? "S3"
          : scenario === "S4"
            ? "S4"
            : scenario === "S7"
              ? "S7"
              : DEFAULT_QUERY_STATE.scenarioId,
    profile: DEFAULT_QUERY_STATE.profile,
    scale:
      scale === "smoke" ||
      scale === "dev" ||
      scale === "hypothesis" ||
      scale === "target"
        ? scale
        : DEFAULT_QUERY_STATE.scale,
    scriptName:
      script === "scroll" ||
      script === "sort" ||
      script === "filter-metadata" ||
      script === "filter-text"
        ? script
        : DEFAULT_QUERY_STATE.scriptName,
    autorun: searchParams.get("autorun") === "1",
  };
}
