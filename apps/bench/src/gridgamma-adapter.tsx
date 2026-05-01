import { useEffect, useMemo, useRef } from "react";

import type { ScenarioDataset } from "@pretable-internal/scenario-data";
import { DataGrid, useGridApiRef, type GridColDef } from "@gridgamma/x-data-grid";

import type { ApplyBenchUpdates } from "./bench-runtime";

export interface GridGammaAdapterProps {
  dataset: ScenarioDataset;
  runKey: number;
  /**
   * GridGamma X DataGrid's idiomatic streaming pattern:
   * apiRef.current.updateRows([{ id, ...patch }]). Native batching.
   */
  onUpdateApiReady?: (apply: ApplyBenchUpdates) => void;
}

export function GridGammaAdapter({
  dataset,
  runKey,
  onUpdateApiReady,
}: GridGammaAdapterProps) {
  const apiRef = useGridApiRef();
  const onUpdateApiReadyRef = useRef(onUpdateApiReady);
  // eslint-disable-next-line react-hooks/refs -- sync ref to latest prop for use in callbacks
  onUpdateApiReadyRef.current = onUpdateApiReady;

  // Wire updates after mount, when apiRef.current is populated.
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const apply: ApplyBenchUpdates = (patches) => {
      // GridGamma X Community caps updateRows to a single row per call (batched
      // updates are a Pro/Premium feature). To exercise the idiomatic
      // Community API faithfully, loop per patch.
      for (const patch of patches) {
        api.updateRows([patch]);
      }
    };
    onUpdateApiReadyRef.current?.(apply);
  }, [apiRef, runKey]);
  const rows = useMemo(
    () =>
      dataset.rows.map((row, index) => ({
        ...row,
        id: row.id ?? String(index),
      })),
    [dataset.rows],
  );
  const columns = useMemo<GridColDef[]>(
    () =>
      dataset.columns.map((column) => ({
        field: column.id,
        headerName: column.header,
        width: column.widthPx,
        sortable: false,
        renderCell: column.wrap
          ? (params) => (
              <div
                style={{
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  lineHeight: 1.43,
                }}
              >
                {String(params.value ?? "")}
              </div>
            )
          : undefined,
      })),
    [dataset.columns],
  );

  return (
    <section
      aria-label="GridGamma Data Grid Community adapter"
      data-benchmark-adapter="gridgamma"
      data-bench-result-row-count={String(rows.length)}
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
          GridGamma Data Grid Community adapter
        </p>
        <p style={{ margin: "4px 0 0", opacity: 0.8 }}>Rows: {rows.length}</p>
        <p style={{ margin: "4px 0 0", opacity: 0.8 }}>
          Columns: {columns.length}
        </p>
      </header>

      <div
        className="adapter-surface"
        style={{
          height: 320,
          minWidth: 720,
          overflow: "hidden",
        }}
      >
        <DataGrid
          key={runKey}
          apiRef={apiRef}
          rows={rows}
          columns={columns}
          getRowHeight={() => "auto" as const}
          disableColumnMenu
          disableRowSelectionOnClick
          hideFooter
        />
      </div>
    </section>
  );
}
