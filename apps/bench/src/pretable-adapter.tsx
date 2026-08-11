import { useCallback, useEffect, useMemo, useRef } from "react";

import type {
  PretableCellRenderInput,
  PretableColumn,
  PretableSurfaceGrid,
  PretableRow,
  PretableQueryFor,
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

type CellRendererFlavor =
  "scroll-with-format" | "scroll-with-render" | "scroll-with-heavy-render";

function isCellRendererScript(s: string): s is CellRendererFlavor {
  return (
    s === "scroll-with-format" ||
    s === "scroll-with-render" ||
    s === "scroll-with-heavy-render"
  );
}

// Hoisted to module scope so every column shares the same function reference.
// Per-column closures would give V8's call-site IC a different function per
// cell column → polymorphic / megamorphic, no inlining. One shared fn → mono.
const sharedFormat = <TRow extends PretableRow>({
  value,
}: PretableCellRenderInput<TRow>): string =>
  Array.isArray(value) ? value.join(", ") : String(value ?? "");

const sharedCheapRender = <TRow extends PretableRow>({
  formattedValue,
}: PretableCellRenderInput<TRow>) => (
  <span data-bench-render="cheap">{formattedValue}</span>
);

const sharedHeavyRender = <TRow extends PretableRow>({
  formattedValue,
  value,
}: PretableCellRenderInput<TRow>) => (
  <span
    data-bench-render="heavy"
    data-bench-status={String(value)}
    className="bench-status-badge"
  >
    <span className="bench-badge-dot" aria-hidden />
    <span>{formattedValue}</span>
  </span>
);

function applyCellRendererFlavor<TRow extends PretableRow>(
  columns: readonly PretableColumn<TRow>[],
  flavor: CellRendererFlavor | null,
): PretableColumn<TRow>[] {
  if (flavor === null) {
    return [...columns];
  }
  if (flavor === "scroll-with-format") {
    return columns.map((column) => ({
      ...column,
      format: sharedFormat as PretableColumn<TRow>["format"],
    }));
  }
  if (flavor === "scroll-with-render") {
    return columns.map((column) => ({
      ...column,
      render: sharedCheapRender as PretableColumn<TRow>["render"],
    }));
  }
  return columns.map((column) => ({
    ...column,
    render: sharedHeavyRender as PretableColumn<TRow>["render"],
  }));
}

export interface PretableAdapterProps {
  dataset: ScenarioDataset;
  interactionPlan?: BenchInteractionPlan | null;
  onGridReady?: (
    grid: PretableSurfaceGrid<
      ScenarioRow,
      string,
      readonly PretableColumn<ScenarioRow>[]
    >,
  ) => void;
  onTelemetryChange?: (telemetry: PretableTelemetry) => void;
  /**
   * Called once the adapter has wired up its update mechanism. Pretable
   * routes batches through @pretable/stream-adapter's RAF-based
   * batcher → grid.applyTransaction. This is the wedge's idiomatic
   * streaming pattern.
   */
  onUpdateApiReady?: (apply: ApplyBenchUpdates) => void;
  /**
   * Called once the adapter has a usable autosize entry point. The
   * supplied callback wraps `grid.autosizeColumns()` so the bench
   * harness can invoke it on demand for the autosize script.
   */
  onAutosizeReady?: (autosize: () => Promise<void> | void) => void;
  runKey: number;
  /**
   * Active bench script name. When this matches a cell-renderer flavor
   * (scroll-with-format / scroll-with-render / scroll-with-heavy-render),
   * the adapter wraps base columns with format / render configuration to
   * exercise the D3 cell-renderer pipeline.
   */
  scriptName?: string;
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
  onAutosizeReady,
  runKey,
  scriptName,
}: PretableAdapterProps) {
  const adapterRef = useRef<HTMLElement>(null);
  const groupedUpdates = scriptName === "updates-grouped";
  const baseColumns = useMemo<PretableColumn<ScenarioRow>[]>(
    () => dataset.columns.map((column) => ({ ...column })),
    [dataset.columns],
  );
  const surfaceColumns = useMemo<PretableColumn<ScenarioRow>[]>(() => {
    const flavoredColumns = applyCellRendererFlavor<ScenarioRow>(
      baseColumns,
      scriptName !== undefined && isCellRendererScript(scriptName)
        ? scriptName
        : null,
    );

    return groupedUpdates
      ? flavoredColumns.map((column) =>
          column.id === "col_3" ? { ...column, aggregate: "sum" } : column,
        )
      : flavoredColumns;
  }, [baseColumns, groupedUpdates, scriptName]);
  const surfaceState = useMemo<PretableSurfaceState | null>(() => {
    return planToState(interactionPlan, surfaceColumns);
  }, [interactionPlan, surfaceColumns]);
  const surfaceQuery = useMemo<
    PretableQueryFor<
      readonly {
        readonly id: string;
        readonly accessor: (row: ScenarioRow) => string | number;
        readonly type: "text" | "number" | "date" | "boolean" | "enum";
      }[]
    >
  >(
    () => ({
      filters: Object.entries(interactionPlan?.filters ?? {}).map(
        ([columnId, filter]) => ({ columnId, ...filter }),
      ) as PretableQueryFor<
        readonly {
          readonly id: string;
          readonly accessor: (row: ScenarioRow) => string | number;
          readonly type: "text" | "number" | "date" | "boolean" | "enum";
        }[]
      >["filters"],
      sort: interactionPlan?.sort ?? [],
      rowGroups: groupedUpdates ? [{ columnId: "col_1" }] : [],
    }),
    [groupedUpdates, interactionPlan],
  );
  const surfaceRows = useMemo(() => [...dataset.rows], [dataset.rows]);
  const autosize = dataset.scenario.autosize_all_columns === true;
  const ignoreQueryChange = useCallback(() => undefined, []);

  const gridRef = useRef<PretableSurfaceGrid<
    ScenarioRow,
    string,
    readonly PretableColumn<ScenarioRow>[]
  > | null>(null);
  const onGridReadyRef = useRef(onGridReady);
  // eslint-disable-next-line react-hooks/refs -- sync ref to latest prop for use in callbacks
  onGridReadyRef.current = onGridReady;
  const onUpdateApiReadyRef = useRef(onUpdateApiReady);
  // eslint-disable-next-line react-hooks/refs -- sync ref to latest prop for use in callbacks
  onUpdateApiReadyRef.current = onUpdateApiReady;
  const onAutosizeReadyRef = useRef(onAutosizeReady);
  // eslint-disable-next-line react-hooks/refs -- sync ref to latest prop for use in callbacks
  onAutosizeReadyRef.current = onAutosizeReady;

  const handleGridReady = useCallback(
    (grid: NonNullable<typeof gridRef.current>) => {
      gridRef.current = grid;
      onGridReadyRef.current?.(grid);
      onAutosizeReadyRef.current?.(grid.autosizeColumns);
    },
    [],
  );

  // Wire updates through the stream-adapter batcher (RAF-aligned), the
  // same path real consumers use for LLM-rate streaming. The batcher is
  // recreated on each runKey change so a re-run starts with empty buffers.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const batcher = createBatcher<ScenarioRow, string>(grid.rowModel);
    const apply: ApplyBenchUpdates = (patches) => {
      batcher.update(
        patches.flatMap((patch) => {
          const id = patch.id;
          if (typeof id !== "string" && typeof id !== "number") return [];
          const changes: Record<string, string | number> = {};
          for (const [key, value] of Object.entries(patch)) {
            if (
              key !== "id" &&
              (typeof value === "string" || typeof value === "number")
            ) {
              changes[key] = value;
            }
          }
          return [{ id: String(id), changes }];
        }),
      );
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
        state={surfaceState}
        onGridReady={handleGridReady}
        query={surfaceQuery}
        onQueryChange={ignoreQueryChange}
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
    ? {
        ref: { kind: "data", rowId: plan.focusedRowId },
        columnId: firstColumnId,
      }
    : { ref: null, columnId: null };

  return {
    focus,
    selection,
  };
}
