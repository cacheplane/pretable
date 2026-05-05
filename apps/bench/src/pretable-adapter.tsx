import { useCallback, useEffect, useMemo, useRef } from "react";

import type {
  PretableColumn,
  PretableGrid,
  PretableSurfaceState,
  PretableTelemetry,
} from "@pretable/react";
import { PretableSurface } from "@pretable/react";
import { createBatcher } from "@pretable/stream-adapter";
import type {
  ScenarioDataset,
  ScenarioRow,
} from "@pretable-internal/scenario-data";

import type { ApplyBenchUpdates } from "./bench-runtime";
import type { BenchInteractionPlan } from "./interaction-plan";

export interface PretableAdapterProps {
  dataset: ScenarioDataset;
  interactionPlan?: BenchInteractionPlan | null;
  onGridReady?: (grid: PretableGrid<ScenarioRow>) => void;
  onTelemetryChange?: (telemetry: PretableTelemetry) => void;
  /**
   * Called once the adapter has wired up its update mechanism. Pretable
   * routes batches through @pretable/stream-adapter's RAF-based
   * batcher → grid.applyTransaction. This is the wedge's idiomatic
   * streaming pattern.
   */
  onUpdateApiReady?: (apply: ApplyBenchUpdates) => void;
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
  onGridReady,
  onTelemetryChange,
  onUpdateApiReady,
  runKey,
}: PretableAdapterProps) {
  const adapterRef = useRef<HTMLElement>(null);
  const surfaceColumns = useMemo(() => [...dataset.columns], [dataset.columns]);
  const surfaceRows = useMemo(() => [...dataset.rows], [dataset.rows]);
  const autosize = dataset.scenario.autosize_all_columns === true;

  const gridRef = useRef<PretableGrid<ScenarioRow> | null>(null);
  const onGridReadyRef = useRef(onGridReady);
  // eslint-disable-next-line react-hooks/refs -- sync ref to latest prop for use in callbacks
  onGridReadyRef.current = onGridReady;
  const onUpdateApiReadyRef = useRef(onUpdateApiReady);
  // eslint-disable-next-line react-hooks/refs -- sync ref to latest prop for use in callbacks
  onUpdateApiReadyRef.current = onUpdateApiReady;

  const handleGridReady = useCallback((grid: PretableGrid<ScenarioRow>) => {
    gridRef.current = grid;
    onGridReadyRef.current?.(grid);
  }, []);

  // Wire updates through the stream-adapter batcher (RAF-aligned), the
  // same path real consumers use for LLM-rate streaming. The batcher is
  // recreated on each runKey change so a re-run starts with empty buffers.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const batcher = createBatcher<ScenarioRow>(grid);
    const apply: ApplyBenchUpdates = (patches) => {
      batcher.update(patches as Partial<ScenarioRow>[]);
    };
    onUpdateApiReadyRef.current?.(apply);
    return () => {
      batcher.dispose();
    };
  }, [runKey]);

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
        autosize={autosize}
        columns={surfaceColumns}
        getRowId={getScenarioRowId}
        state={planToState(interactionPlan, surfaceColumns)}
        onGridReady={handleGridReady}
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

function planToState(
  plan: BenchInteractionPlan | null | undefined,
  columns: readonly PretableColumn<ScenarioRow>[],
): PretableSurfaceState | null {
  if (!plan) {
    return null;
  }

  const firstColumn = columns[0];
  const lastColumn = columns[columns.length - 1];
  const firstColumnId = firstColumn?.id ?? null;

  const selection: PretableSurfaceState["selection"] =
    plan.selectedRowId && firstColumn && lastColumn
      ? {
          ranges: [
            {
              startRowId: plan.selectedRowId,
              endRowId: plan.selectedRowId,
              startColumnId: firstColumn.id,
              endColumnId: lastColumn.id,
            },
          ],
          anchor: { rowId: plan.selectedRowId, columnId: firstColumn.id },
        }
      : { ranges: [], anchor: null };

  const focus: PretableSurfaceState["focus"] = plan.focusedRowId
    ? { rowId: plan.focusedRowId, columnId: firstColumnId }
    : { rowId: null, columnId: null };

  return {
    filters: plan.filters,
    focus,
    selection,
    sort: plan.sort,
  };
}
