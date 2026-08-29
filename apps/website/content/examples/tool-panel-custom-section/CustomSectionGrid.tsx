"use client";

import { useMemo, useRef } from "react";

import { PretableSurface } from "@pretable/react";
import type {
  PretableColumn,
  PretableSurfaceGrid,
  PretableToolPanelConfig,
} from "@pretable/react";

import { columns } from "./columns";
import { trades, type Trade } from "./data";

const VIEWPORT_HEIGHT = 320;

function ActionsIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height="16"
      stroke="currentColor"
      strokeWidth="1.5"
      viewBox="0 0 16 16"
      width="16"
    >
      <path d="M8 2v8M4.5 6.5 8 10l3.5-3.5" />
      <path d="M3 13h10" />
    </svg>
  );
}

export function CustomSectionGrid() {
  // The one route to the grid from inside a custom section: `onGridReady`
  // hands the surface's grid handle to a ref, and the section's `render`
  // closes over that ref. No context argument needed — or offered.
  const grid = useRef<PretableSurfaceGrid<
    Trade,
    string,
    readonly PretableColumn<Trade>[]
  > | null>(null);

  // The COMPLETE rail, in order: grouping is dropped, and the custom section
  // sits between the two built-ins it is interleaved with. Held stable in a
  // memo — a roster built inline would only rebuild the descriptor array each
  // render, but stable is the habit worth copying.
  const toolPanel = useMemo<PretableToolPanelConfig>(
    () => ({
      sections: [
        "columns",
        {
          id: "actions",
          icon: ActionsIcon,
          label: "Actions",
          render: () => (
            <div style={{ display: "grid", gap: 8, padding: 4 }}>
              <h3 style={{ fontSize: 13, margin: 0 }}>Actions</h3>
              <button
                onClick={() => grid.current?.scrollToRow("t1")}
                type="button"
              >
                Jump to first trade
              </button>
              <button
                onClick={() => grid.current?.scrollToRow("t28")}
                type="button"
              >
                Jump to last trade
              </button>
              <button onClick={() => grid.current?.exportCsv()} type="button">
                Download CSV
              </button>
            </div>
          ),
        },
        "filters",
      ],
      defaultActiveSection: "actions",
    }),
    [],
  );

  return (
    <div>
      <p style={{ margin: "0 0 8px", fontSize: 13 }}>
        The rail carries <strong>Columns</strong>, a custom{" "}
        <strong>Actions</strong> section, and <strong>Filters</strong> — in that
        order, with the grouping built-in left off the roster. The Actions pane
        is open on load via{" "}
        <code>defaultActiveSection: &quot;actions&quot;</code>; its buttons
        reach the grid through the handle <code>onGridReady</code> delivers —
        jump the viewport to either end, or download the grid as CSV.
      </p>
      <PretableSurface<Trade>
        ariaLabel="Trades"
        columns={columns}
        getRowId={(row) => row.id}
        onGridReady={(ready) => {
          grid.current = ready;
        }}
        rows={trades}
        toolPanel={toolPanel}
        viewportHeight={VIEWPORT_HEIGHT}
      />
    </div>
  );
}
