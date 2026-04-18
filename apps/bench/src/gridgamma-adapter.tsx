import { useMemo } from "react";

import type { ScenarioDataset } from "@pretable-internal/scenario-data";
import { DataGrid, type GridColDef } from "@gridgamma/x-data-grid";

export interface GridGammaAdapterProps {
  dataset: ScenarioDataset;
  runKey: number;
}

export function GridGammaAdapter({ dataset, runKey }: GridGammaAdapterProps) {
  const rows = useMemo(
    () =>
      dataset.rows.map((row) => ({
        ...row,
        id: row.id ?? String(dataset.rows.indexOf(row)),
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
        <p style={{ margin: "4px 0 0", opacity: 0.8 }}>
          Rows: {rows.length}
        </p>
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
