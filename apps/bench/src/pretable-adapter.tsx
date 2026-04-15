import { useMemo, useState } from "react";

import type { PretableTelemetry } from "@pretable/react/internal";
import { PretableSurface } from "@pretable/react/internal";
import type { ScenarioDataset } from "@pretable-internal/scenario-data";

import type { BenchInteractionPlan } from "./interaction-plan";

export interface PretableAdapterProps {
  dataset: ScenarioDataset;
  interactionPlan?: BenchInteractionPlan | null;
  onTelemetryChange?: (telemetry: PretableTelemetry) => void;
  runKey: number;
}

const VIEWPORT_HEIGHT = 320;
const BENCHMARK_VIEWPORT_STYLE = {
  contain: "none",
  containIntrinsicSize: "none",
  contentVisibility: "visible",
  overflowAnchor: "none",
  overscrollBehavior: "contain",
} as const;

function getScenarioRowId(row: ScenarioDataset["rows"][number]) {
  return String(row.id ?? "");
}

export function PretableAdapter({
  dataset,
  interactionPlan,
  onTelemetryChange,
  runKey,
}: PretableAdapterProps) {
  const [interactionMetrics, setInteractionMetrics] = useState(() => ({
    focusedRowId: null as string | null,
    resultRowCount: dataset.rows.length,
    selectedRowId: null as string | null,
  }));
  const surfaceColumns = useMemo(() => [...dataset.columns], [dataset.columns]);
  const surfaceRows = useMemo(() => [...dataset.rows], [dataset.rows]);

  const handleTelemetryChange = (telemetry: PretableTelemetry) => {
    onTelemetryChange?.(telemetry);
    setInteractionMetrics((current) => {
      const next = {
        focusedRowId: telemetry.focusedRowId,
        resultRowCount: telemetry.rowModelRowCount,
        selectedRowId: telemetry.selectedRowId,
      };

      return current.focusedRowId === next.focusedRowId &&
        current.resultRowCount === next.resultRowCount &&
        current.selectedRowId === next.selectedRowId
        ? current
        : next;
    });
  };

  return (
    <section
      aria-label="Pretable React adapter"
      className="adapter-surface"
      data-benchmark-adapter="pretable"
      data-bench-focused-row-id={interactionMetrics.focusedRowId ?? ""}
      data-bench-focused-row-preserved={
        interactionPlan
          ? String(interactionMetrics.focusedRowId === interactionPlan.focusedRowId)
          : "false"
      }
      data-bench-result-row-count={
        interactionPlan
          ? String(interactionMetrics.resultRowCount)
          : String(dataset.rows.length)
      }
      data-bench-selected-row-id={interactionMetrics.selectedRowId ?? ""}
      data-bench-selected-row-preserved={
        interactionPlan
          ? String(
              interactionMetrics.selectedRowId === interactionPlan.selectedRowId,
            )
          : "false"
      }
      key={runKey}
      style={{
        display: "grid",
        gap: 12,
      }}
    >
      <header>
        <p
          style={{
            margin: 0,
            fontWeight: 700,
          }}
        >
          Pretable React adapter
        </p>
        <p style={{ margin: "4px 0 0", opacity: 0.8 }}>
          Rows: {dataset.rows.length}
        </p>
        <p style={{ margin: "4px 0 0", opacity: 0.8 }}>
          Columns: {dataset.columns.length}
        </p>
      </header>

      <PretableSurface
        ariaLabel="Pretable React adapter"
        columns={surfaceColumns}
        getRowId={getScenarioRowId}
        interactionState={
          interactionPlan
            ? {
                filters: interactionPlan.filters,
                focusedRowId: interactionPlan.focusedRowId,
                selectedRowId: interactionPlan.selectedRowId,
                sort: interactionPlan.sort,
              }
            : null
        }
        onTelemetryChange={handleTelemetryChange}
        overscan={4}
        renderBodyCell={({ value }) => String(value ?? "")}
        renderHeaderCell={({ label }) => label}
        rows={surfaceRows}
        viewportHeight={VIEWPORT_HEIGHT}
        viewportStyle={BENCHMARK_VIEWPORT_STYLE}
      />
    </section>
  );
}
