import { useCallback, useMemo, useRef } from "react";

import type { ScenarioDataset } from "@pretable-internal/scenario-data";
import { GridAlphaReact } from "gridalpha-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  type ColDef,
  type GridApi,
  type GridReadyEvent,
} from "gridalpha-community";

import "gridalpha-community/styles/gridalpha.css";
import "gridalpha-community/styles/ag-theme-quartz.css";

import type { ApplyBenchUpdates } from "./bench-runtime";

ModuleRegistry.registerModules([AllCommunityModule]);

export interface GridAlphaAdapterProps {
  dataset: ScenarioDataset;
  runKey: number;
  /**
   * Grid Alpha's idiomatic streaming pattern: gridApi.applyTransaction({
   * update }). Native batching, no wrapper layer.
   */
  onUpdateApiReady?: (apply: ApplyBenchUpdates) => void;
}

export function GridAlphaAdapter({
  dataset,
  runKey,
  onUpdateApiReady,
}: GridAlphaAdapterProps) {
  const rowData = useMemo(() => [...dataset.rows], [dataset.rows]);

  const onUpdateApiReadyRef = useRef(onUpdateApiReady);
  // eslint-disable-next-line react-hooks/refs -- sync ref to latest prop for use in callbacks
  onUpdateApiReadyRef.current = onUpdateApiReady;

  const handleGridReady = useCallback((event: GridReadyEvent) => {
    const api: GridApi = event.api;
    const apply: ApplyBenchUpdates = (patches) => {
      api.applyTransaction({ update: patches });
    };
    onUpdateApiReadyRef.current?.(apply);
  }, []);
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
  const defaultColDef = useMemo<ColDef>(
    () => ({
      sortable: false,
      resizable: false,
    }),
    [],
  );

  return (
    <section
      aria-label="Grid Alpha Community adapter"
      data-benchmark-adapter="gridalpha"
      data-bench-result-row-count={String(rowData.length)}
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
          Grid Alpha Community adapter
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
        <GridAlphaReact
          key={runKey}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          getRowId={(params) => String(params.data.id)}
          rowData={rowData}
          onGridReady={handleGridReady}
        />
      </div>
    </section>
  );
}
