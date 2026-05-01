import type { BenchQueryState } from "./bench-types";

const DEFAULT_QUERY_STATE: BenchQueryState = {
  adapterId: "pretable",
  scenarioId: "S1",
  profile: "default",
  scale: "dev",
  scriptName: "initial",
  autorun: false,
  updateRatePerSec: 1000,
};

/** Allowed update-rate values for the rate sweep. */
const UPDATE_RATE_VALUES = new Set([100, 500, 1_000, 5_000, 10_000, 25_000]);

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
      adapter === "ag-grid"
        ? "ag-grid"
        : adapter === "tanstack"
          ? "tanstack"
          : adapter === "mui"
            ? "mui"
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
            : scenario === "S5"
              ? "S5"
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
      script === "filter-text" ||
      script === "updates"
        ? script
        : DEFAULT_QUERY_STATE.scriptName,
    autorun: searchParams.get("autorun") === "1",
    updateRatePerSec: (() => {
      const raw = searchParams.get("updateRatePerSec");
      if (raw === null) return DEFAULT_QUERY_STATE.updateRatePerSec;
      const parsed = Number(raw);
      return UPDATE_RATE_VALUES.has(parsed)
        ? parsed
        : DEFAULT_QUERY_STATE.updateRatePerSec;
    })(),
  };
}
