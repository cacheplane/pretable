"use client";

import { useState } from "react";

import { PretableSurface } from "@pretable/react";

import { columns } from "./columns";
import { trades, type Trade } from "./data";

const VIEWPORT_HEIGHT = 320;
const IDLE_FOCUS =
  "No cell focused yet — click a cell, then try the keys below.";

export function KeyboardNavGrid() {
  // The reveal math this demo illustrates lives inside <PretableSurface> and
  // is not something the demo drives — focus is left uncontrolled here.
  // onFocusChange only reads the address back out so keystrokes can be
  // correlated with what moved, the same "echo the state a gesture changed"
  // pattern as column-layout and async-cell-editing.
  const [focusAddress, setFocusAddress] = useState(IDLE_FOCUS);

  return (
    <div>
      <p style={{ margin: "0 0 8px", fontSize: 13 }}>
        Click a cell, then press <kbd>Cmd/Ctrl</kbd>+<kbd>End</kbd> to jump to
        the last cell in the grid — 140 trades, well past the fold. Watch how
        little the viewport moves: the revealed row lands at the bottom edge,
        not centered, and clears both the sticky header and the right-pinned{" "}
        <strong>Status</strong> column. <strong>ID</strong> is pinned left and{" "}
        <strong>Status</strong> is pinned right, so <kbd>Home</kbd> /{" "}
        <kbd>End</kbd> inside a row never scrolls a pinned cell out of view.
        From the first row, <kbd>↑</kbd> moves onto that column&rsquo;s header —
        the whole grid is one <kbd>Tab</kbd> stop, so the header is reached with
        the arrows rather than with <kbd>Tab</kbd>.
      </p>
      <PretableSurface<Trade>
        ariaLabel="Trade blotter"
        columns={columns}
        getRowId={(row) => row.id}
        rows={trades}
        viewportHeight={VIEWPORT_HEIGHT}
        onFocusChange={({ ref, columnId }) => {
          if (ref === null || columnId === null) {
            setFocusAddress(IDLE_FOCUS);
            return;
          }
          // Three kinds, not two. `{kind: "header"}` is where the cursor sits
          // after ArrowUp off the first row — the header joined the grid's
          // roving-tabindex model, so it is an address like any other and has
          // no row id to print.
          if (ref.kind === "header") {
            setFocusAddress(`header, column ${columnId}`);
            return;
          }
          const rowId = ref.kind === "data" ? ref.rowId : ref.groupId;
          setFocusAddress(`row ${rowId}, column ${columnId}`);
        }}
      />
      <p style={{ margin: "8px 0 0", fontSize: 13 }}>
        Focus: <code>{focusAddress}</code>
      </p>
    </div>
  );
}
