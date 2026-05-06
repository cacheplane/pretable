import type { ScenarioDataset } from "@pretable-internal/scenario-data";

import { BaselineAdapter } from "./baseline-adapter";
import type { ApplyBenchUpdates } from "./bench-runtime";

export interface GridAlphaAdapterProps {
  dataset: ScenarioDataset;
  onUpdateApiReady?: (apply: ApplyBenchUpdates) => void;
  runKey: number;
}

export function GridAlphaAdapter(props: GridAlphaAdapterProps) {
  return (
    <BaselineAdapter
      {...props}
      adapterId="gridalpha"
      label="Grid Alpha Community"
    />
  );
}
