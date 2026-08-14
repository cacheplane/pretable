"use client";

import { useState } from "react";

import { PretableSurface } from "@pretable/react";
import type {
  PretableCellRangeFor,
  PretableSelectionFor,
} from "@pretable/react";

import { columns } from "./columns";
import { rows } from "./data";

const VIEWPORT_HEIGHT = 300;

// Echoes `PretableCellRangeFor`'s own fields — the shape the page's
// "Selection model" section just taught — rather than a re-derived summary,
// so the caption stays an honest window onto the controlled state above it.
// Narrowed to `typeof columns`, so a typo'd column id here is a compile error
// rather than a silently-dead comparison.
function describeRange(range: PretableCellRangeFor<typeof columns>): string {
  return range.startRowId === range.endRowId &&
    range.startColumnId === range.endColumnId
    ? `${range.startColumnId}@${range.startRowId}`
    : `${range.startColumnId}@${range.startRowId} → ${range.endColumnId}@${range.endRowId}`;
}

export function RangeSelectionGrid() {
  const [selection, setSelection] = useState<
    PretableSelectionFor<typeof columns>
  >({
    ranges: [],
    anchor: null,
  });

  return (
    <div>
      <p style={{ margin: "0 0 8px", fontSize: 13 }}>
        Click a cell, then <kbd>Shift</kbd>+click another to extend the range.{" "}
        <kbd>Cmd</kbd>/<kbd>Ctrl</kbd>+click adds a discontiguous range. Drag
        from one cell to another for a marquee selection. The checkbox column
        derives its three states from these ranges.
      </p>
      <PretableSurface
        ariaLabel="Selection demo"
        columns={columns}
        getRowId={(row) => row.id}
        rows={rows}
        rowSelectionColumn={{ enabled: true }}
        state={{ selection }}
        onSelectionChange={setSelection}
        viewportHeight={VIEWPORT_HEIGHT}
      />
      <p style={{ margin: "8px 0 0", fontSize: 13 }}>
        Selected:{" "}
        <code>
          {selection.ranges.length > 0
            ? selection.ranges.map(describeRange).join(" · ")
            : "(none)"}
        </code>
      </p>
    </div>
  );
}
