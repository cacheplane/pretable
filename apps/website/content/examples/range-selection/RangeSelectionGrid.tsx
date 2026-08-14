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
// "Selection model" section describes below — rather than a re-derived summary,
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
  // The CELL-RANGE slice. Controlled, and narrowed to the column tuple.
  const [selection, setSelection] = useState<
    PretableSelectionFor<typeof columns>
  >({
    ranges: [],
    anchor: null,
  });
  // The CHECKBOX slice, which is a different thing entirely: it lives in the
  // engine, is reported by its own callback, and never appears in `selection`.
  // Wiring only `onSelectionChange` — the mistake this example exists to make
  // hard — leaves the checkboxes ticking with nothing downstream ever hearing.
  const [checkedRowIds, setCheckedRowIds] = useState<readonly string[]>([]);

  return (
    <div>
      <p style={{ margin: "0 0 8px", fontSize: 13 }}>
        Click a cell, then <kbd>Shift</kbd>+click another to extend the range.{" "}
        <kbd>Cmd</kbd>/<kbd>Ctrl</kbd>+click adds a discontiguous range. Drag
        from one cell to another for a marquee selection. Then tick a checkbox,
        and watch the second caption move instead of the first.
      </p>
      <PretableSurface
        ariaLabel="Selection demo"
        columns={columns}
        getRowId={(row) => row.id}
        rows={rows}
        rowSelectionColumn={{ enabled: true }}
        state={{ selection }}
        onSelectionChange={setSelection}
        onRowSelectionChange={setCheckedRowIds}
        viewportHeight={VIEWPORT_HEIGHT}
      />
      <p style={{ margin: "8px 0 0", fontSize: 13 }}>
        Cell ranges (<code>onSelectionChange</code>):{" "}
        <code>
          {selection.ranges.length > 0
            ? selection.ranges.map(describeRange).join(" · ")
            : "(none)"}
        </code>
      </p>
      <p style={{ margin: "4px 0 0", fontSize: 13 }}>
        Ticked rows (<code>onRowSelectionChange</code>):{" "}
        <code>
          {checkedRowIds.length > 0 ? checkedRowIds.join(", ") : "(none)"}
        </code>
      </p>
    </div>
  );
}
