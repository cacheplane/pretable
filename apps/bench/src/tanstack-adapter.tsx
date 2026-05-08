import type { ScenarioDataset } from "@pretable-internal/scenario-data";

import type { ApplyBenchUpdates } from "./bench-runtime";

export interface TanstackAdapterProps {
  dataset: ScenarioDataset;
  onUpdateApiReady?: (apply: ApplyBenchUpdates) => void;
  runKey: number;
  scriptName?: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- placeholder; props consumed in Phase 2
export function TanstackAdapter(_props: TanstackAdapterProps) {
  return (
    <section
      aria-label="TanStack Table adapter"
      data-benchmark-adapter="tanstack"
      style={{ padding: 16 }}
    >
      <p style={{ margin: 0, fontWeight: 700 }}>TanStack Table v8</p>
      <p style={{ margin: "4px 0 0", opacity: 0.8 }}>
        Real adapter ships in Phase 2 of B2. Currently a placeholder.
      </p>
    </section>
  );
}
