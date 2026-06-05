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
import type { BenchInteractionPlan } from "./interaction-plan";

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

    if (interactionPlan.mode === "sort" && interactionPlan.sort) {
      api.applyColumnState({
        state: [
          {
            colId: interactionPlan.sort.columnId,
            sort: interactionPlan.sort.direction,
          },
        ],
        defaultState: { sort: null },
      });
      return;
    }

    if (
      interactionPlan.mode === "filter-metadata" ||
      interactionPlan.mode === "filter-text"
    ) {
      const model: Record<string, unknown> = {};
      for (const [colId, value] of Object.entries(interactionPlan.filters)) {
        model[colId] = {
          filterType: "text",
          type:
            interactionPlan.mode === "filter-metadata" ? "equals" : "contains",
          filter: value,
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
