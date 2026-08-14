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
import type { BenchInteractionPlan } from "./interaction-plan";

const VIEWPORT_HEIGHT = 320;
const ROW_HEIGHT = 48;

export interface MuiAdapterProps {
  dataset: ScenarioDataset;
  onUpdateApiReady?: (apply: ApplyBenchUpdates) => void;
  /**
   * Called once the adapter has a usable autosize entry point. The
   * supplied callback wraps `apiRef.current.autosizeColumns(...)`,
   * which returns a Promise on MUI X DataGrid v7+.
   */
  onAutosizeReady?: (autosize: () => Promise<void> | void) => void;
  runKey: number;
  scriptName?: string;
  interactionPlan?: BenchInteractionPlan | null;
}

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

  // S2 marks three columns `wrap: true`. Without this the grid draws one
  // truncated line where pretable draws the wrapped paragraph, and the scroll
  // comparison stops being like-for-like (#400).
  if (column.wrap) {
    def.cellClassName = "bench-wrap-cell";
  }

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
  const wrapsAnyColumn = useMemo(
    () => dataset.columns.some((c) => c.wrap),
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
      interactionPlan.mode === "filter-text"
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
          // Content decides the height when the scenario wraps; the fixed
          // ROW_HEIGHT control only applies to fixed-height scenarios.
          {...(wrapsAnyColumn
            ? { getRowHeight: () => "auto" as const }
            : { rowHeight: ROW_HEIGHT })}
          sx={{
            "& .bench-wrap-cell": {
              whiteSpace: "normal",
              wordBreak: "break-word",
              alignItems: "flex-start",
              paddingTop: "8px",
              paddingBottom: "8px",
            },
          }}
          hideFooter
          disableRowSelectionOnClick
          getRowId={(row) => String(row.id)}
        />
      </div>
    </section>
  );
}
