"use client";

import { PretableSurface } from "@pretable/react";

import { columns } from "./columns";
import { holdings, type Holding } from "./data";

const VIEWPORT_HEIGHT = 340;

export function ToolPanelGrid() {
  return (
    <div>
      <p style={{ margin: "0 0 8px", fontSize: 13 }}>
        The rail is on by default; here <code>defaultActiveSection</code> opens
        the Columns pane too. Uncheck a row to hide its column · drag a grip (or
        focus it and press <kbd>Shift</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd>) to
        reorder · the ⋮ menu pins · <strong>Reset columns</strong> restores the
        mount-time layout.
      </p>
      {/*
        The column layout is deliberately uncontrolled: the panel writes
        order, pinning, and visibility straight into the engine, and a
        controlled `state.columnOrder` would re-impose the prop over every
        commit the panel makes.
      */}
      <PretableSurface<Holding>
        ariaLabel="Holdings"
        columns={columns}
        getRowId={(row) => row.id}
        rows={holdings}
        toolPanel={{ defaultActiveSection: "columns" }}
        viewportHeight={VIEWPORT_HEIGHT}
      />
    </div>
  );
}
