import type { ScenarioDataset } from "@pretable-internal/scenario-data";

import type { ApplyBenchUpdates } from "./bench-runtime";

export interface MuiAdapterProps {
  dataset: ScenarioDataset;
  onUpdateApiReady?: (apply: ApplyBenchUpdates) => void;
  runKey: number;
  scriptName?: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- placeholder; props consumed in Phase 3
export function MuiAdapter(_props: MuiAdapterProps) {
  return (
    <section
      aria-label="MUI X DataGrid adapter"
      data-benchmark-adapter="mui"
      style={{ padding: 16 }}
    >
      <p style={{ margin: 0, fontWeight: 700 }}>MUI X DataGrid Community</p>
      <p style={{ margin: "4px 0 0", opacity: 0.8 }}>
        Real adapter ships in Phase 3 of B2. Currently a placeholder.
      </p>
    </section>
  );
}
