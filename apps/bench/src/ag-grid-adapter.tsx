import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type FilterChangedEvent,
  type GridApi,
  type GridReadyEvent,
} from "ag-grid-community";

import type {
  ScenarioColumn,
  ScenarioDataset,
} from "@pretable-internal/scenario-data";

import type { ApplyBenchUpdates } from "./bench-runtime";
import { assertComparatorWrappedScaleIsSmoke } from "./comparator-wrapped-scale-rule";
import type { BenchInteractionPlan } from "./interaction-plan";

// AllCommunityModule already `dependsOn` RowAutoHeightModule, so the
// `autoHeight` colDef flag set in `toColDef` needs no extra registration.
ModuleRegistry.registerModules([AllCommunityModule]);

export interface AgGridAdapterProps {
  dataset: ScenarioDataset;
  onUpdateApiReady?: (apply: ApplyBenchUpdates) => void;
  /**
   * Called once the adapter has a usable autosize entry point. The
   * supplied callback wraps `gridApi.autoSizeAllColumns(false)`.
   */
  onAutosizeReady?: (autosize: () => Promise<void> | void) => void;
  runKey: number;
  scriptName?: string;
  interactionPlan?: BenchInteractionPlan | null;
}

const VIEWPORT_HEIGHT = 320;
/**
 * Fixed row height for scenarios with no wrapped columns, and a *floor* for
 * those that have them: RowAutoHeightService computes each row as
 * `Math.max(measuredCellHeight, rowHeightFromOptions)`, so leaving this at 48
 * keeps unwrapped scenarios byte-identical while letting S2's rows grow.
 *
 * It is also the height every wrapped row is PAINTED at before it is measured,
 * and that is not something this adapter can configure away. AG Grid's auto
 * height is a post-paint correction, not a layout mode: the row element keeps
 * an explicit `style.height` from the row model, a cell reports its size on
 * mount (`RowAutoHeightService.setupCellAutoHeight`), the apply pass is behind
 * a 1ms debounce (`_debounce(this, this.calculateRowHeights, 1)`), and the
 * measurement is *deleted* again when the cell is destroyed — so a row that
 * scrolls out and back pays the whole two-pass cost again. Every other grid in
 * the matrix leaves the row box unsized and lets the browser lay it out, which
 * is why they are correct on the first frame and AG Grid is not. Expect
 * `row_height_error_p95_px` and `rendered_rows_peak` to keep reporting the
 * unmeasured state on any scenario with wrapped columns; that IS the finding.
 */
const ROW_HEIGHT = 48;

function toColDef(
  column: ScenarioColumn,
  scriptName: string | undefined,
): ColDef {
  const def: ColDef = {
    field: column.id,
    headerName: column.header ?? column.id,
    width: column.widthPx ?? 140,
    sortable: true,
    filter: true,
    resizable: true,
  };

  // S2, S3 and S7 set `pinned_left`, and every dataset column carries the
  // resulting `pinned` alongside `wrap`. pretable has always honoured it; this
  // adapter read neither until #415 took the first one, so S2 was comparing a
  // grid maintaining a sticky zone on every scroll frame against three that
  // were not (#413).
  //
  // Column pinning is in AG Grid COMMUNITY — `pinned` is a plain ColDef field,
  // not an enterprise module — so this needs no registration. Assigned only
  // when the scenario asks, so the `pinned_left: 0` scenarios (S1, S4, S5, S6)
  // keep the colDef they have always had.
  if (column.pinned === "left") {
    def.pinned = "left";
  }

  // S2 ("wrap-auto-height") marks its wide columns `wrap: true`; that is the
  // scenario's entire subject. AG Grid needs both flags and they are
  // independent: `wrapText` relaxes the base `.ag-cell { white-space: nowrap }`
  // to `normal` (text wraps, but a fixed row height then clips it), while
  // `autoHeight` enrolls the cell in RowAutoHeightService measurement (the row
  // grows, but nowrap text never needs more than one line). Only the pair
  // produces wrapped, variable-height rows.
  //
  // Left off entirely when `wrap` is false, so `wrapped_columns: 0` scenarios
  // (S1 and friends) keep the colDef they have always had.
  if (column.wrap) {
    def.wrapText = true;
    def.autoHeight = true;
    // ...and the leading has to be taken back off the row height, or the two
    // flags above lay the same sentence out into a box nearly twice as tall as
    // every other grid in the matrix draws it.
    //
    // AG Grid's core CSS derives the cell's line-height from the ROW height:
    //
    //   .ag-row { --ag-internal-content-line-height:
    //       calc(min(var(--ag-row-height), var(--ag-line-height, 1000px))
    //            - var(--ag-internal-row-border-width, 1px) - 2px) }
    //   .ag-cell { line-height: var(--ag-internal-content-line-height) }
    //
    // For a single-line cell that is exactly right — one line box, vertically
    // centred, no flexbox needed. For a WRAPPED cell it is a category error:
    // every line of the paragraph gets the row's height as its leading. In S2
    // that measured 39px of leading on a 14px font (ratio 2.79) against
    // pretable 22.5/15 = 1.5, TanStack 24/16 = 1.5, MUI 20/14 = 1.43. The same
    // 89-character string wrapped into a 236px row in AG Grid and a 136px row
    // in pretable — so S2 was not comparing two grids doing the same layout,
    // and `row_height_error_p95_px` was reading ~2x high for that reason alone
    // (S2/scroll/hypothesis: 264 -> 120 with this line, nothing else changed).
    //
    // The theme cannot fix it: `--ag-line-height` is combined with `min()`, so
    // a theme param can only make the leading SMALLER than the row height,
    // never release it. An inline cell style is the only lever, and 1.5 is the
    // ratio the rest of the matrix already wraps at.
    def.cellStyle = { lineHeight: "1.5" };
  }

  if (scriptName === "scroll-with-format") {
    def.valueFormatter = (params) =>
      Array.isArray(params.value)
        ? params.value.join(", ")
        : String(params.value ?? "");
  } else if (scriptName === "scroll-with-render") {
    def.cellRenderer = (params: { value: unknown }) =>
      `<span data-bench-render="cheap">${String(params.value ?? "")}</span>`;
  } else if (scriptName === "scroll-with-heavy-render") {
    def.cellRenderer = (params: { value: unknown }) =>
      `<span data-bench-render="heavy" class="bench-status-badge">` +
      `<span class="bench-badge-dot" aria-hidden></span>` +
      `<span>${String(params.value ?? "")}</span>` +
      `</span>`;
  }

  return def;
}

export function AgGridAdapter({
  dataset,
  onUpdateApiReady,
  onAutosizeReady,
  runKey,
  scriptName,
  interactionPlan,
}: AgGridAdapterProps) {
  // Before any hook, so a jsdom test that breaks the wrapped-scale rule is
  // refused rather than paying `autoHeight`'s unbounded measurement cost.
  assertComparatorWrappedScaleIsSmoke("ag-grid", dataset);

  const apiRef = useRef<GridApi | null>(null);
  const onUpdateApiReadyRef = useRef(onUpdateApiReady);
  const onAutosizeReadyRef = useRef(onAutosizeReady);
  // Post-filter displayed-row count, published as data-bench-result-row-count.
  const [resultRowCount, setResultRowCount] = useState(dataset.rows.length);
  // `onGridReady` fires asynchronously after mount; gating the interaction
  // effect on this flag re-applies a filter/sort plan that is already present
  // at mount once the grid API exists, rather than silently skipping it.
  const [gridReady, setGridReady] = useState(false);

  useEffect(() => {
    onUpdateApiReadyRef.current = onUpdateApiReady;
  }, [onUpdateApiReady]);

  useEffect(() => {
    onAutosizeReadyRef.current = onAutosizeReady;
  }, [onAutosizeReady]);

  const columnDefs = useMemo(
    () => dataset.columns.map((c) => toColDef(c, scriptName)),
    [dataset.columns, scriptName],
  );

  const onGridReady = (event: GridReadyEvent) => {
    apiRef.current = event.api;
    setGridReady(true);
    const apply: ApplyBenchUpdates = (patches) => {
      const updates = patches.map((p) => ({ ...p }));
      event.api.applyTransaction({ update: updates });
    };
    onUpdateApiReadyRef.current?.(apply);

    onAutosizeReadyRef.current?.(() => {
      const colIds = event.api.getColumns()?.map((c) => c.getColId()) ?? [];
      event.api.autoSizeColumns(colIds, false);
    });
  };

  useEffect(() => {
    apiRef.current?.setGridOption("rowData", dataset.rows.slice());
  }, [dataset.rows, runKey]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api || !interactionPlan) return;

    if (interactionPlan.mode === "sort" && interactionPlan.sort.length > 0) {
      // AG Grid's multi-sort priority lives in ColumnState.sortIndex;
      // the entry list's index is the priority, so map it straight across.
      api.applyColumnState({
        state: interactionPlan.sort.map((entry, index) => ({
          colId: entry.columnId,
          sort: entry.direction,
          sortIndex: index,
        })),
        defaultState: { sort: null },
      });
      return;
    }

    if (
      interactionPlan.mode === "filter-metadata" ||
      interactionPlan.mode === "filter-text"
    ) {
      const model: Record<string, unknown> = {};
      for (const [colId, filter] of Object.entries(interactionPlan.filters)) {
        model[colId] = {
          filterType: "text",
          type:
            interactionPlan.mode === "filter-metadata" ? "equals" : "contains",
          filter: filter.value,
        };
      }
      api.setFilterModel(model);
    }
  }, [interactionPlan, runKey, gridReady]);

  return (
    <section
      aria-label="AG Grid Community adapter"
      data-benchmark-adapter="ag-grid"
      data-bench-result-row-count={String(resultRowCount)}
      style={{ display: "grid", gap: 12 }}
    >
      <header>
        <p style={{ margin: 0, fontWeight: 700 }}>AG Grid Community</p>
        <p style={{ margin: "4px 0 0", opacity: 0.8 }}>
          Rows: {dataset.rows.length} · Columns: {dataset.columns.length}
        </p>
      </header>
      <div key={runKey} style={{ height: VIEWPORT_HEIGHT, minWidth: 720 }}>
        <AgGridReact
          theme={themeQuartz}
          rowData={dataset.rows.slice()}
          columnDefs={columnDefs}
          rowHeight={ROW_HEIGHT}
          onGridReady={onGridReady}
          onFilterChanged={(event: FilterChangedEvent) => {
            // AG Grid renders rows imperatively, so the bench's settle loop
            // records result_row_count the moment the filtered rows paint.
            // A normal setState re-render lands a few frames later — after
            // settle — so the bench would capture the stale pre-filter count.
            // flushSync forces the attribute update synchronously with this
            // event, landing it inside the settle window.
            flushSync(() =>
              setResultRowCount(event.api.getDisplayedRowCount()),
            );
          }}
          getRowId={(params) => String((params.data as { id: unknown }).id)}
        />
      </div>
    </section>
  );
}
