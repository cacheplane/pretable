import { useEffect, useMemo, useRef, useState } from "react";
import {
  DataGrid,
  gridFilteredTopLevelRowCountSelector,
  useGridApiRef,
  type GridColDef,
} from "@mui/x-data-grid";

import type {
  ScenarioColumn,
  ScenarioDataset,
  ScenarioRow,
} from "@pretable-internal/scenario-data";

import type { ApplyBenchUpdates } from "./bench-runtime";
import { assertComparatorWrappedScaleIsSmoke } from "./comparator-wrapped-scale-rule";
import type { BenchInteractionPlan } from "./interaction-plan";

const VIEWPORT_HEIGHT = 320;
const ROW_HEIGHT = 48;

/**
 * Props that switch the grid into variable / wrapped row layout.
 *
 * Hoisted and frozen so the identity is stable across renders — MUI memoises
 * its row-height pipeline on the `getRowHeight` reference, and a fresh arrow
 * per render would re-hydrate `rowsMeta` on every commit and pollute the
 * measurement the bench is taking.
 *
 * `getRowHeight: () => "auto"` is sufficient on its own; no `sx` whiteSpace
 * override is needed. `GridRow` stamps `row--dynamicHeight` whenever the
 * resolved height is `"auto"` (components/GridRow.mjs:101), and GridRootStyles
 * carries `& .row--dynamicHeight > .cell { whiteSpace: "initial" }`
 * (components/containers/GridRootStyles.mjs:527) — two class selectors, so it
 * outranks the single-class `.cell { whiteSpace: "nowrap" }` default
 * regardless of source order. Verified by computed style on a real rendered
 * cell, not by reading the rule: see the wrap test in
 * `__tests__/mui-adapter.test.tsx`.
 *
 * `getEstimatedRowHeight` is deliberately NOT set. It only supplies the
 * pre-measurement height for an auto row, and the fallback when it is absent
 * is `dimensions.rowHeight` — i.e. `rowHeight` prop x density factor
 * (@mui/x-virtualizer features/dimensions.mjs:373, and
 * hooks/core/useGridVirtualizer.mjs:77). This adapter pins `rowHeight` to 48
 * at the default `standard` density (factor 1), so MUI already estimates
 * unmeasured rows at exactly the 48px floor the other adapters use. Passing
 * `getEstimatedRowHeight: () => ROW_HEIGHT` would be a literal no-op. Any
 * other value would be an unmeasured guess that moves MUI's virtualisation
 * relative to the other grids, so it needs its own measurement before it is
 * worth adding.
 */
const WRAPPED_ROW_HEIGHT_PROPS = Object.freeze({
  getRowHeight: () => "auto" as const,
});

export interface MuiAdapterProps {
  dataset: ScenarioDataset;
  onUpdateApiReady?: (apply: ApplyBenchUpdates) => void;
  /**
   * Called once the adapter has a usable autosize entry point. The
   * supplied callback wraps `apiRef.current.autosizeColumns(...)`,
   * which returns a Promise on MUI X DataGrid v7+.
   */
  onAutosizeReady?: (autosize: () => Promise<void> | void) => void;
  /**
   * Accepted for harness uniformity but never invoked: the row-grouping
   * scripts are gated off this adapter (paid tier) by
   * `validateSupportedP0aRequest` before the adapter ever mounts (#478).
   */
  onGroupToggleReady?: (collapse: (groupKey: string) => void) => void;
  runKey: number;
  scriptName?: string;
  interactionPlan?: BenchInteractionPlan | null;
}

/**
 * `column.pinned` is deliberately NOT read here, and this adapter is the one
 * exception to #413.
 *
 * S2, S3 and S7 set `pinned_left`, and ag-grid and tanstack both honour it now.
 * MUI cannot: column pinning is an **MUI X Pro** feature, and the matrix runs
 * the Community package. Verified against the installed
 * `@mui/x-data-grid@9.11.0` rather than taken from the docs — there is no
 * `pinnedColumns` prop on `DataGridProps`, no `pinned` field on `GridColDef`,
 * and no `columnPinning` directory under `hooks/features/`. The one pinning
 * symbol Community does ship, `pinnedColumnsSectionSeparator`, is a styling
 * prop for a section this build never renders.
 *
 * So on any scenario with `pinned_left`, MUI is measured WITHOUT a pinned zone
 * while the other three have one. That asymmetry is real and is reported with
 * the numbers rather than papered over: hand-rolling sticky cells here would
 * measure this file's CSS instead of MUI, which is the opposite of what a
 * comparative benchmark is for. The capability gap is itself a finding.
 */
function toColDef(
  column: ScenarioColumn,
  scriptName: string | undefined,
): GridColDef {
  const def: GridColDef = {
    field: column.id,
    headerName: column.header ?? column.id,
    width: column.widthPx ?? 140,
    sortable: true,
    filterable: true,
    resizable: true,
  };

  if (scriptName === "scroll-with-format") {
    def.valueFormatter = (value: unknown) =>
      Array.isArray(value) ? value.join(", ") : String(value ?? "");
  } else if (scriptName === "scroll-with-render") {
    def.renderCell = (params) => (
      <span data-bench-render="cheap">{String(params.value ?? "")}</span>
    );
  } else if (scriptName === "scroll-with-heavy-render") {
    def.renderCell = (params) => (
      <span data-bench-render="heavy" className="bench-status-badge">
        <span className="bench-badge-dot" aria-hidden />
        <span>{String(params.value ?? "")}</span>
      </span>
    );
  }

  return def;
}

export function MuiAdapter({
  dataset,
  onUpdateApiReady,
  onAutosizeReady,
  runKey,
  scriptName,
  interactionPlan,
}: MuiAdapterProps) {
  // Before any hook, so a jsdom test that breaks the wrapped-scale rule is
  // refused rather than paying `getRowHeight: "auto"`'s measurement cost.
  assertComparatorWrappedScaleIsSmoke("mui", dataset);

  const apiRef = useGridApiRef();
  const onUpdateApiReadyRef = useRef(onUpdateApiReady);
  // eslint-disable-next-line react-hooks/refs -- sync to latest
  onUpdateApiReadyRef.current = onUpdateApiReady;
  const onAutosizeReadyRef = useRef(onAutosizeReady);
  // eslint-disable-next-line react-hooks/refs -- sync to latest
  onAutosizeReadyRef.current = onAutosizeReady;

  const [rows, setRows] = useState<ScenarioRow[]>(() => dataset.rows.slice());
  // Post-interaction visible-row count. `rows` above is always the full
  // dataset (DataGrid filters internally), so the published count is sourced
  // from the grid's filtered-row selector instead — keeping it in sync with
  // what the grid actually shows after a filter.
  const [resultRowCount, setResultRowCount] = useState(dataset.rows.length);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- runKey reset
    setRows(dataset.rows.slice());
  }, [dataset.rows, runKey]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    // Seed immediately (covers a filter already applied before subscribe),
    // then track every filter change. `filteredRowsSet` fires after the grid
    // recomputes its filtered model.
    const sync = () =>
      setResultRowCount(gridFilteredTopLevelRowCountSelector(apiRef));
    sync();
    return api.subscribeEvent("filteredRowsSet", sync);
  }, [apiRef, runKey, dataset.rows.length]);

  const columns = useMemo(
    () => dataset.columns.map((c) => toColDef(c, scriptName)),
    [dataset.columns, scriptName],
  );

  // S2 ("wrap-auto-height") is the primary wedge scenario: `wrapped_columns: 3`,
  // `row_height_mode: "variable"`. Every dataset column carries `wrap`, and this
  // adapter used to ignore it — so S2 compared pretable doing wrapped
  // variable-height layout against a MUI grid doing fixed single-line rows
  // (issue #400). Gated on the dataset rather than applied unconditionally
  // because the fixed-height scenarios (S1 etc., `wrapped_columns: 0`) must not
  // move; without the gate this would silently re-baseline every scenario.
  const hasWrappedColumns = useMemo(
    () => dataset.columns.some((column) => column.wrap),
    [dataset.columns],
  );

  useEffect(() => {
    const apply: ApplyBenchUpdates = (patches) => {
      setRows((prev) => {
        const map = new Map(prev.map((r) => [String(r.id), r] as const));
        for (const patch of patches) {
          const id = String(patch.id);
          const existing = map.get(id);
          if (existing) {
            map.set(id, { ...existing, ...patch } as ScenarioRow);
          }
        }
        return Array.from(map.values());
      });
    };
    onUpdateApiReadyRef.current?.(apply);
    // Re-publish only on runKey change; bench-app keeps onUpdateApiReady
    // stable via useCallback, and the ref above always reads the latest.
  }, [runKey]);

  useEffect(() => {
    onAutosizeReadyRef.current?.(async () => {
      await apiRef.current?.autosizeColumns({ includeOutliers: true });
    });
  }, [apiRef, runKey]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api || !interactionPlan) return;

    if (interactionPlan.mode === "sort" && interactionPlan.sort.length > 0) {
      // MUI's GridSortModel is already an ordered array — entry-list order
      // maps 1:1 onto sort-model priority.
      api.setSortModel(
        interactionPlan.sort.map((entry) => ({
          field: entry.columnId,
          sort: entry.direction,
        })),
      );
      return;
    }

    if (
      interactionPlan.mode === "filter-metadata" ||
      interactionPlan.mode === "filter-text" ||
      interactionPlan.mode === "filter-keystrokes"
    ) {
      const items = Object.entries(interactionPlan.filters).map(
        ([field, filter]) => ({
          field,
          operator:
            interactionPlan.mode === "filter-metadata" ? "equals" : "contains",
          value: filter.value,
        }),
      );
      api.setFilterModel({ items });
    }
  }, [apiRef, interactionPlan, runKey]);

  return (
    <section
      aria-label="MUI X DataGrid adapter"
      data-benchmark-adapter="mui"
      data-bench-result-row-count={String(resultRowCount)}
      style={{ display: "grid", gap: 12 }}
    >
      <header>
        <p style={{ margin: 0, fontWeight: 700 }}>MUI X DataGrid Community</p>
        <p style={{ margin: "4px 0 0", opacity: 0.8 }}>
          Rows: {rows.length} · Columns: {dataset.columns.length}
        </p>
      </header>
      <div key={runKey} style={{ height: VIEWPORT_HEIGHT, minWidth: 720 }}>
        <DataGrid
          apiRef={apiRef}
          rows={rows}
          columns={columns}
          // Kept on both paths. `rowHeight` is NOT inert under auto height: it
          // is the base the virtualizer uses to size unmeasured auto rows (see
          // WRAPPED_ROW_HEIGHT_PROPS), so dropping it for the wrapped path
          // would fall back to MUI's own 52px default.
          rowHeight={ROW_HEIGHT}
          {...(hasWrappedColumns ? WRAPPED_ROW_HEIGHT_PROPS : null)}
          hideFooter
          disableRowSelectionOnClick
          getRowId={(row) => String(row.id)}
        />
      </div>
    </section>
  );
}
