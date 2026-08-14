"use client";

import { useRef } from "react";

import { PretableSurface } from "@pretable/react";
import type { PretableColumn, PretableSurfaceGrid } from "@pretable/react";

import { columns } from "./columns";
import { products, type Product } from "./data";

const VIEWPORT_HEIGHT = 280;

export function ExportCsvGrid() {
  const grid = useRef<PretableSurfaceGrid<
    Product,
    string,
    readonly PretableColumn<Product>[]
  > | null>(null);

  return (
    <div>
      <p style={{ margin: "0 0 8px", fontSize: 13 }}>
        Nothing is checked below, so the button exports every row — check a few
        first to see <code>onlySelected</code> narrow the file instead.
      </p>
      <button
        onClick={() => grid.current?.exportCsv({ onlySelected: true })}
        style={{ marginBottom: 8 }}
        type="button"
      >
        Export CSV
      </button>
      <PretableSurface<Product>
        ariaLabel="Products"
        columns={columns}
        getRowId={(row) => row.id}
        onGridReady={(ready) => {
          grid.current = ready;
        }}
        rowSelectionColumn={{ enabled: true }}
        rows={products}
        viewportHeight={VIEWPORT_HEIGHT}
      />
    </div>
  );
}
