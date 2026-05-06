import type { ScenarioDataset } from "@pretable-internal/scenario-data";

import { BaselineAdapter } from "./baseline-adapter";
import type { ApplyBenchUpdates } from "./bench-runtime";

export interface GridBetaAdapterProps {
  dataset: ScenarioDataset;
  onUpdateApiReady?: (apply: ApplyBenchUpdates) => void;
  runKey: number;
}

export function GridBetaAdapter(props: GridBetaAdapterProps) {
  return (
    <BaselineAdapter {...props} adapterId="gridbeta" label="GridBeta Virtual" />
  );
}
