import type { ScenarioDataset } from "@pretable-internal/scenario-data";

import { BaselineAdapter } from "./baseline-adapter";
import type { ApplyBenchUpdates } from "./bench-runtime";

export interface GridGammaAdapterProps {
  dataset: ScenarioDataset;
  onUpdateApiReady?: (apply: ApplyBenchUpdates) => void;
  runKey: number;
}

export function GridGammaAdapter(props: GridGammaAdapterProps) {
  return (
    <BaselineAdapter
      {...props}
      adapterId="gridgamma"
      label="GridGamma Data Grid Community"
    />
  );
}
