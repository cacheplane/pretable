"use client";

import { useState } from "react";

import { PretableSurface, type PretableColumn } from "@pretable/react";

import { columns } from "./columns";
import { instruments, type Instrument } from "./data";

const VIEWPORT_HEIGHT = 260;

function initialWidths(cols: PretableColumn<Instrument>[]) {
  const widths: Record<string, number> = {};
  for (const column of cols) {
    if (typeof column.widthPx === "number") {
      widths[column.id] = column.widthPx;
    }
  }
  return widths;
}

export function ColumnLayoutGrid() {
  // All three layout slices are controlled here, independently, so their
  // current values can be echoed below the grid — the same "controlled state
  // makes an invisible gesture legible" pattern as the grouping panel and
  // column filter examples.
  const [columnWidths, setColumnWidths] = useState<
    Partial<Record<string, number>>
  >(() => initialWidths(columns));
  const [columnOrder, setColumnOrder] = useState<readonly string[]>(() =>
    columns.map((column) => column.id),
  );
  const [columnPinned, setColumnPinned] = useState<
    Partial<Record<string, "left" | "right" | null>>
  >({ symbol: "left", note: "right" });

  return (
    <div>
      <p style={{ margin: "0 0 8px", fontSize: 13 }}>
        Drag a header to reorder, drag its right-edge handle to resize,
        double-click the handle to hand the width back to the grid.{" "}
        <strong>Symbol</strong> is pinned left and <strong>Note</strong> is
        pinned right — drag a column into either group to pin it there, or out
        to unpin it. Resizing needs a fine pointer: the handle is a 4px strip,
        so it is not drawn on a touch device.
      </p>
      <PretableSurface<Instrument>
        ariaLabel="Instrument positions"
        columns={columns}
        getRowId={(row) => row.id}
        onColumnOrderChange={setColumnOrder}
        onColumnPinnedChange={setColumnPinned}
        onColumnWidthsChange={setColumnWidths}
        rows={instruments}
        state={{ columnOrder, columnPinned, columnWidths }}
        viewportHeight={VIEWPORT_HEIGHT}
      />
      <p style={{ margin: "8px 0 0", fontSize: 13 }}>
        Order:{" "}
        <code>
          {columnOrder
            .map((id) => {
              const pin = columnPinned[id];
              return pin ? `${id} (${pin})` : id;
            })
            .join(" → ")}
        </code>
      </p>
      <p style={{ margin: "4px 0 0", fontSize: 13 }}>
        Widths:{" "}
        <code>
          {columnOrder
            .map((id) => `${id} ${columnWidths[id] ?? "—"}`)
            .join(" · ")}
        </code>
      </p>
    </div>
  );
}
