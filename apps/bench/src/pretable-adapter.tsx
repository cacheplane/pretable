import { useCallback, useMemo, useRef } from "react";

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
  const adapterRef = useRef<HTMLElement>(null);
  const surfaceColumns = useMemo(() => [...dataset.columns], [dataset.columns]);
  const surfaceRows = useMemo(() => [...dataset.rows], [dataset.rows]);

  const onTelemetryChangeRef = useRef(onTelemetryChange);
  // eslint-disable-next-line react-hooks/refs -- sync ref to latest prop for use in callbacks
  onTelemetryChangeRef.current = onTelemetryChange;
  const interactionPlanRef = useRef(interactionPlan);
  // eslint-disable-next-line react-hooks/refs -- sync ref to latest prop for use in callbacks
  interactionPlanRef.current = interactionPlan;
  const datasetRowCountRef = useRef(dataset.rows.length);
  // eslint-disable-next-line react-hooks/refs -- sync ref to latest prop for use in callbacks
  datasetRowCountRef.current = dataset.rows.length;

  const handleTelemetryChange = useCallback((telemetry: PretableTelemetry) => {
    onTelemetryChangeRef.current?.(telemetry);
    const el = adapterRef.current;
    if (!el) return;
    const plan = interactionPlanRef.current;
    el.dataset.benchFocusedRowId = telemetry.focusedRowId ?? "";
    el.dataset.benchResultRowCount = plan
      ? String(telemetry.rowModelRowCount)
      : String(datasetRowCountRef.current);
    el.dataset.benchSelectedRowId = telemetry.selectedRowId ?? "";
    el.dataset.benchFocusedRowPreserved = plan
      ? String(telemetry.focusedRowId === plan.focusedRowId)
      : "false";
    el.dataset.benchSelectedRowPreserved = plan
      ? String(telemetry.selectedRowId === plan.selectedRowId)
      : "false";
  }, []);

  return (
    <section
      ref={adapterRef}
      aria-label="Pretable React adapter"
      className="adapter-surface"
      data-benchmark-adapter="pretable"
      data-bench-focused-row-id=""
      data-bench-focused-row-preserved="false"
      data-bench-result-row-count={String(dataset.rows.length)}
      data-bench-selected-row-id=""
      data-bench-selected-row-preserved="false"
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
