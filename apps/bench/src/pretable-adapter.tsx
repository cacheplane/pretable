import { Pretable } from "@pretable/react";
import type { ScenarioDataset } from "@pretable-internal/scenario-data";

export interface PretableAdapterProps {
  dataset: ScenarioDataset;
  runKey: number;
}

function getScenarioRowId(row: ScenarioDataset["rows"][number]) {
  return String(row.id ?? "");
}

export function PretableAdapter({ dataset, runKey }: PretableAdapterProps) {
  return (
    <div className="adapter-surface" data-benchmark-adapter="pretable">
      <Pretable
        key={runKey}
        columns={[...dataset.columns]}
        getRowId={getScenarioRowId}
        rows={[...dataset.rows]}
      />
    </div>
  );
}
