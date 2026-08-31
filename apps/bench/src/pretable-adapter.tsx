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
import {
  createBenchModelColumns,
  createBenchRowModelOwner,
  type RowModelDiagnosticsController,
} from "./row-model-diagnostics";
import { createDeterministicUpdatePlan } from "./update-plan";

type CellRendererFlavor =
  "scroll-with-format" | "scroll-with-render" | "scroll-with-heavy-render";

function isCellRendererScript(s: string): s is CellRendererFlavor {
  return (
    s === "scroll-with-format" ||
    s === "scroll-with-render" ||
    s === "scroll-with-heavy-render"
  );
}

function isGroupingScript(s: string) {
  return (
    s === "group" ||
    s === "group-expand" ||
    s === "group-updates" ||
    s === "group-updates-stable-keys"
  );
}

/**
 * Attach a built-in aggregator to every numeric column for the row-grouping
 * scripts.
 *
 * Without at least one aggregated column `buildGroupedRows` skips `accumulate`
 * entirely, so the grouping pipeline the bench claims to measure would be
 * missing a stage — and `group-expand`'s whole point is costing the stages
 * that re-run when only `flatten`'s input changed.
 *
 * The spec is the string `"avg"`, never a closure: `mergeColumnsFromProps`
 * treats a fresh function identity on an aggregated column as a semantic
 * change while grouping is active, which would emit once per parent render.
 */
function applyGroupAggregates<TRow extends PretableRow>(
  columns: readonly PretableColumn<TRow>[],
  sampleRow: TRow | undefined,
): PretableColumn<TRow>[] {
  if (!sampleRow) {
    return [...columns];
  }

  const sample = sampleRow as Record<string, unknown>;

  return columns.map((column) =>
    typeof sample[column.id] === "number"
      ? { ...column, aggregate: "avg" as const }
      : column,
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
   * Called once the adapter can accept a new row array. The bench drives replace and
   * append through the SAME path a remote consumer uses — a new `rows` prop, which the
   * engine ingests id-keyed — not through an imperative back door that would measure a
   * code path no product uses.
   */
  onDataApiReady?: (apply: (rows: readonly ScenarioRow[]) => void) => void;
  /** Rows to render instead of `dataset.rows`, for the data-update scripts. */
  initialRows?: readonly ScenarioRow[];
  /**
   * Called once the adapter has a usable autosize entry point. The
   * supplied callback wraps `grid.setAllColumnsAutoWidth(true)` — pretable's
   * "grid-managed width" mode bit, its nearest analog to the other grids'
   * autosize APIs — so the bench harness can invoke it on demand for the
   * autosize script.
   */
  onAutosizeReady?: (autosize: () => Promise<void> | void) => void;
  /**
   * Publishes the group-expand trigger (#478): `collapse(groupKey)` collapses
   * the group whose grouping value equals `groupKey`, through the same
   * `setGroupExpanded` call the twisty click funnels through. Which key to
   * collapse is the PLAN's contract (`collapsedGroupKey`); the adapter only
   * resolves key -> groupId.
   */
  onGroupToggleReady?: (collapse: (groupKey: string) => void) => void;
  runKey: number;
  /**
   * Active bench script name. When this matches a cell-renderer flavor
   * (scroll-with-format / scroll-with-render / scroll-with-heavy-render),
   * the adapter wraps base columns with format / render configuration to
   * exercise the D3 cell-renderer pipeline.
   */
  scriptName?: string;
  /** Explicit opt-in for the private benchmark diagnostics controller. */
  diagnostics?: boolean;
  /** Cooperative slice budget for that private diagnostic model only. */
  transitionBudgetMs?: number;
  /** Seed shared by the permanent row-model workload quartet. */
  seed?: number;
  onDiagnosticsReady?: (
    diagnostics: RowModelDiagnosticsController | null,
  ) => void;
}

const VIEWPORT_HEIGHT = 320;
const BENCHMARK_VIEWPORT_STYLE = {
  contain: "none",
  containIntrinsicSize: "none",
  contentVisibility: "visible",
  overflowAnchor: "none",
  overscrollBehavior: "contain",
} as const;

/**
 * Monotonic across adapter mounts on purpose. A per-mount counter would restart at 1
 * on every remount, so a run that rebuilt the whole adapter would read the same id
 * before and after — the one thing `grid_instance_reconstructed` exists to catch.
 */
let gridInstanceSeq = 0;

export function PretableAdapter({
  dataset,
  initialRows,
  interactionPlan,
  onDataApiReady,
  onGridReady,
  onGroupToggleReady,
  onTelemetryChange,
  onUpdateApiReady,
  onAutosizeReady,
  runKey,
  scriptName,
  diagnostics = false,
  transitionBudgetMs,
  seed = dataset.seed,
  onDiagnosticsReady,
}: PretableAdapterProps) {
  const adapterRef = useRef<HTMLElement>(null);
  const groupedUpdates = scriptName === "updates-grouped";
  const groupingScript =
    scriptName !== undefined && isGroupingScript(scriptName);
  const modelDataset = useMemo<ScenarioDataset>(
    () =>
      initialRows === undefined
        ? dataset
        : { ...dataset, rows: initialRows, rowCount: initialRows.length },
    [dataset, initialRows],
  );
  const baseColumns = useMemo<PretableColumn<ScenarioRow>[]>(
    () => dataset.columns.map((column) => ({ ...column })),
    [dataset.columns],
  );
  const sampleRow = modelDataset.rows[0];
  const surfaceColumns = useMemo<PretableColumn<ScenarioRow>[]>(() => {
    const withRenderers = applyCellRendererFlavor<ScenarioRow>(
      baseColumns,
      scriptName !== undefined && isCellRendererScript(scriptName)
        ? scriptName
        : null,
    );

    return groupedUpdates
      ? withRenderers.map((column) =>
          column.id === "col_3" ? { ...column, aggregate: "sum" } : column,
        )
      : groupingScript
        ? applyGroupAggregates<ScenarioRow>(withRenderers, sampleRow)
        : withRenderers;
  }, [baseColumns, groupedUpdates, groupingScript, sampleRow, scriptName]);
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
      sort:
        interactionPlan !== null && interactionPlan !== undefined
          ? interactionPlan.sort
          : groupedUpdates
            ? [{ columnId: "col_3", direction: "asc" as const }]
            : [],
      rowGroups:
        interactionPlan !== null && interactionPlan !== undefined
          ? interactionPlan.rowGroups.map((columnId) => ({ columnId }))
          : groupedUpdates
            ? [{ columnId: "col_1" }]
            : [],
    }),
    [groupedUpdates, interactionPlan],
  );
  const initialSurfaceQuery = useMemo(
    () => ({
      filters: [],
      sort: groupedUpdates
        ? [{ columnId: "col_3", direction: "asc" as const }]
        : [],
      rowGroups: groupedUpdates ? [{ columnId: "col_1" }] : [],
    }),
    [groupedUpdates],
  );
  const updatePlan = useMemo(
    () =>
      createDeterministicUpdatePlan({
        dataset: modelDataset,
        grouped: groupedUpdates || groupingScript,
        seed,
      }),
    [groupedUpdates, groupingScript, modelDataset, seed],
  );
  const modelColumns = useMemo(() => {
    const columns = createBenchModelColumns(modelDataset, groupedUpdates);
    return groupingScript
      ? columns.map((column) =>
          typeof sampleRow?.[column.id] === "number"
            ? { ...column, type: "number" as const, aggregate: "avg" as const }
            : column,
        )
      : columns;
  }, [groupedUpdates, groupingScript, modelDataset, sampleRow]);
  const rowModelOwner = useMemo(
    () =>
      createBenchRowModelOwner({
        dataset: modelDataset,
        plan: updatePlan,
        columns: modelColumns,
        query: initialSurfaceQuery as never,
        diagnostics,
        transitionBudgetMs,
      }),
    [
      diagnostics,
      initialSurfaceQuery,
      modelColumns,
      modelDataset,
      transitionBudgetMs,
      updatePlan,
    ],
  );
  const diagnosticsController = rowModelOwner.diagnostics;
  const onDataApiReadyRef = useRef(onDataApiReady);
  // eslint-disable-next-line react-hooks/refs -- sync ref to latest prop for use in callbacks
  onDataApiReadyRef.current = onDataApiReady;
  useEffect(() => {
    onDataApiReadyRef.current?.((rows) => {
      rowModelOwner.model.setRows(rows);
    });
  }, [rowModelOwner, runKey]);
  const onGroupToggleReadyRef = useRef(onGroupToggleReady);
  // eslint-disable-next-line react-hooks/refs -- sync ref to latest prop for use in callbacks
  onGroupToggleReadyRef.current = onGroupToggleReady;
  useEffect(() => {
    onGroupToggleReadyRef.current?.((groupKey) => {
      // The model here is the SAME object the surface republishes as
      // `grid.rowModel`, so this is the twisty click's call path exactly.
      const snapshot = rowModelOwner.model.getState().snapshot;
      for (let index = 0; index < snapshot.visibleRowCount; index += 1) {
        const row = snapshot.rowAt(index);
        if (row?.kind === "group" && String(row.value) === groupKey) {
          rowModelOwner.model.setGroupExpanded(row.groupId, false);
          return;
        }
      }
    });
  }, [rowModelOwner, runKey]);
  useEffect(() => {
    rowModelOwner.model.setQuery(surfaceQuery as never);
  }, [rowModelOwner, surfaceQuery]);
  const autosize = dataset.scenario.autosize_all_columns === true;

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
  const onDiagnosticsReadyRef = useRef(onDiagnosticsReady);
  // eslint-disable-next-line react-hooks/refs -- sync ref to latest prop for use in effects
  onDiagnosticsReadyRef.current = onDiagnosticsReady;

  useEffect(() => {
    onDiagnosticsReadyRef.current?.(diagnosticsController);
    if (diagnosticsController !== null) {
      window.__PRETABLE_ROW_MODEL_BENCH__ = diagnosticsController;
    }
    return () => {
      onDiagnosticsReadyRef.current?.(null);
      if (
        diagnosticsController !== null &&
        window.__PRETABLE_ROW_MODEL_BENCH__ === diagnosticsController
      ) {
        delete window.__PRETABLE_ROW_MODEL_BENCH__;
      }
      rowModelOwner.dispose();
    };
  }, [diagnosticsController, rowModelOwner]);

  // null until a grid publishes one. The attribute stays off the element until then,
  // so `readBenchGridInstanceId` sees an absence it can report as unavailable — a
  // placeholder value would be read as a real id and make an unobserved engine look
  // like an engine that survived.
  const gridInstanceIdRef = useRef<string | null>(null);
  const publishGridInstanceId = useCallback(() => {
    const el = adapterRef.current;
    const gridInstanceId = gridInstanceIdRef.current;

    if (
      el &&
      gridInstanceId !== null &&
      el.dataset.benchGridInstanceId !== gridInstanceId
    ) {
      el.dataset.benchGridInstanceId = gridInstanceId;
    }
  }, []);
  const handleGridReady = useCallback(
    (grid: NonNullable<typeof gridRef.current>) => {
      gridRef.current = grid;
      gridInstanceSeq += 1;
      // Read by measureBenchDataUpdateRun. A replacement that rebuilt the engine would
      // bump this, and §11's replace budget forbids exactly that.
      gridInstanceIdRef.current = String(gridInstanceSeq);
      publishGridInstanceId();
      onGridReadyRef.current?.(grid);
      onAutosizeReadyRef.current?.(() => grid.setAllColumnsAutoWidth(true));
    },
    [publishGridInstanceId],
  );

  // PretableSurface publishes its grid from a LAYOUT effect, which React runs
  // before this section's own ref is attached — so the write inside
  // handleGridReady lands on a null ref on the mount pass and only works for a
  // later rebuild. This publishes the id the mount pass could not.
  useEffect(() => {
    publishGridInstanceId();
  }, [publishGridInstanceId, runKey]);

  // Wire updates through the stream-adapter batcher (RAF-aligned), the
  // same path real consumers use for LLM-rate streaming. The batcher is
  // recreated on each runKey change so a re-run starts with empty buffers.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const batcher = createBatcher<ScenarioRow, string>(rowModelOwner.model);
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
      return new Promise<void>((resolve, reject) => {
        let settled = false;
        let unsubscribe: () => void = () => undefined;
        unsubscribe = batcher.subscribeError((error) => {
          if (settled) return;
          settled = true;
          unsubscribe();
          reject(error);
        });
        requestAnimationFrame(() => {
          if (settled) return;
          settled = true;
          unsubscribe();
          resolve();
        });
      });
    };
    onUpdateApiReadyRef.current?.(apply);
    return () => {
      batcher.dispose();
    };
  }, [rowModelOwner, runKey]);

  const onTelemetryChangeRef = useRef(onTelemetryChange);
  // eslint-disable-next-line react-hooks/refs -- sync ref to latest prop for use in callbacks
  onTelemetryChangeRef.current = onTelemetryChange;
  const interactionPlanRef = useRef(interactionPlan);
  // eslint-disable-next-line react-hooks/refs -- sync ref to latest prop for use in callbacks
  interactionPlanRef.current = interactionPlan;
  const datasetRowCountRef = useRef(modelDataset.rows.length);
  // eslint-disable-next-line react-hooks/refs -- sync ref to latest prop for use in callbacks
  datasetRowCountRef.current = modelDataset.rows.length;

  // The surface owns only UI state. Query state is applied directly to the
  // explicit indexed row model above, keeping the ownership boundary exact.
  const surfaceState = useMemo(
    () => planToState(interactionPlan, surfaceColumns),
    [interactionPlan, surfaceColumns],
  );

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
      data-bench-result-row-count={String(modelDataset.rows.length)}
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
          Rows: {modelDataset.rows.length}
        </p>
        <p style={{ margin: "4px 0 0", opacity: 0.8 }}>
          Columns: {dataset.columns.length}
        </p>
      </header>

      <PretableSurface
        ariaLabel="Pretable React adapter"
        allColumnsAutoWidth={autosize}
        columns={surfaceColumns}
        model={rowModelOwner.model}
        state={surfaceState}
        onGridReady={handleGridReady}
        onTelemetryChange={handleTelemetryChange}
        overscan={4}
        renderBodyCell={({ value }) => String(value ?? "")}
        renderHeaderCell={({ label }) => label}
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
