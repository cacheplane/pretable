import { useMemo } from "react";

import type { ScenarioDataset } from "@pretable-internal/scenario-data";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  type ColDef,
} from "ag-grid-community";

import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";

ModuleRegistry.registerModules([AllCommunityModule]);

export interface AGGridAdapterProps {
  dataset: ScenarioDataset;
  runKey: number;
}

export function AGGridAdapter({ dataset, runKey }: AGGridAdapterProps) {
  const columnDefs = useMemo<ColDef[]>(
    () =>
      dataset.columns.map((column) => ({
        field: column.id,
        headerName: column.header,
        width: column.widthPx,
        pinned: column.pinned,
        wrapText: column.wrap,
        autoHeight: column.wrap,
      })),
    [dataset.columns],
  );
  const rowData = useMemo(() => [...dataset.rows], [dataset.rows]);
  const defaultColDef = useMemo<ColDef>(
    () => ({
      sortable: false,
      resizable: false,
    }),
    [],
  );

  return (
    <section
      aria-label="AG Grid Community adapter"
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
          AG Grid Community adapter
        </p>
        <p style={{ margin: "4px 0 0", opacity: 0.8 }}>
          Rows: {rowData.length}
        </p>
        <p style={{ margin: "4px 0 0", opacity: 0.8 }}>
          Columns: {columnDefs.length}
        </p>
      </header>

      <div
        className="adapter-surface ag-theme-quartz"
        style={{
          height: 320,
          minWidth: 720,
          overflow: "hidden",
        }}
      >
        <AgGridReact
          key={runKey}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          getRowId={(params) => String(params.data.id)}
          rowData={rowData}
        />
      </div>
    </section>
  );
}
