import { Pretable } from "@pretable/react";
import type { ScenarioDataset } from "@pretable-internal/scenario-data";

export interface PretableAdapterProps {
  dataset: ScenarioDataset;
  runKey: number;
}

export function PretableAdapter({ dataset, runKey }: PretableAdapterProps) {
  return (
    <div className="adapter-surface">
      <Pretable
        key={runKey}
        columns={[...dataset.columns]}
        rows={[...dataset.rows]}
      />
    </div>
  );
}
