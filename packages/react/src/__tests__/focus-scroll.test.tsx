import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ROW_SELECT_COLUMN_ID, PretableSurface } from "../pretable-surface";
import type { PretableColumn } from "../types";
import type { PretableGrid } from "@pretable/core";

// ---------------------------------------------------------------------------
// What jsdom can and cannot prove here
//
// CAN: that the surface *wrote* a particular `scrollTop` / `scrollLeft` onto
// the scroll viewport, and — just as importantly — that it wrote nothing at
// all. Every offset in this file is an exact number derived from the same
// arithmetic layout-core does, so a drifted implementation fails loudly rather
// than landing "somewhere near".
//
// CANNOT: that the browser then moved any pixels, that the target cell ended
// up visually clear of the sticky header and the pinned column groups, or that
// a sticky element sticks. jsdom runs no layout: every box is 0x0, `scrollTop`
// is inert, and nothing is ever occluded. Real-browser proof of the visual
// outcome lives in apps/website/e2e/smoke.spec.ts.
//
// Two stubs make the surface's inputs meaningful:
//   - `clientWidth` on HTMLElement.prototype, which is how the surface
//     measures the scrollport (`viewportWidth` state) — unstubbed jsdom
//     reports 0, which the surface correctly treats as "not measured yet".
//   - writable, *recording* `scrollTop` / `scrollLeft` on the viewport
//     instance. jsdom's own accessors are pinned at 0 and swallow writes, so
//     without this both the assertions and the surface's own re-read of the
//     current offset would be meaningless.
//
// Note there is deliberately no `clientHeight` stub: the surface's vertical
// band is prop-driven (`viewportHeight` minus the resolved header height),
// never measured off the DOM. See `bodyViewportHeight` in pretable-surface.tsx.
// ---------------------------------------------------------------------------

const VIEWPORT_WIDTH = 600;
// jsdom resolves no CSS custom properties, so `useResolvedHeights` falls back
// to @pretable/ui's defaults; 36 is the header half of that.
const HEADER_HEIGHT = 36;
// renderer-dom's DEFAULT_ROW_HEIGHT. No column in these fixtures wraps, and
// jsdom measures every rendered row at 0 (below the 44px floor, so nothing is
// ever cached into `measuredHeights`), which keeps every row exactly 44 and
// the arithmetic below exact.
const ROW_HEIGHT = 44;
// Chosen so the unoccluded body band is exactly three rows tall.
const BODY_HEIGHT = ROW_HEIGHT * 3; // 132
const VIEWPORT_HEIGHT = HEADER_HEIGHT + BODY_HEIGHT; // 168
const ROW_COUNT = 40;
const TOTAL_HEIGHT = ROW_COUNT * ROW_HEIGHT; // 1760

let clientWidth = VIEWPORT_WIDTH;
let originalClientWidth: PropertyDescriptor | undefined;

beforeEach(() => {
  clientWidth = VIEWPORT_WIDTH;
  originalClientWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientWidth",
  );
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => clientWidth,
  });
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  cleanup();
  if (originalClientWidth) {
    Object.defineProperty(
      HTMLElement.prototype,
      "clientWidth",
      originalClientWidth,
    );
  }
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
});

type Row = Record<string, string> & { id: string };

const rows: Row[] = Array.from({ length: ROW_COUNT }, (_, i) => {
  const row: Row = { id: `r${i}` };
  for (const key of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
    row[key] = `${key}${i}`;
  }
  return row;
});

// Eight 100px columns, none pinned. totalWidth 800 against a 600px scrollport,
// so maxScrollLeft is 200 and the last column needs a horizontal scroll.
const PLAIN_COLUMNS = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => ({
  id,
  header: id.toUpperCase(),
  widthPx: 100,
}));

// `first` left-pinned (120) + five 100px scrollable + two right-pinned
// (90 + 80). pinnedLeftWidth 120, pinnedRightWidth 170, totalWidth 790.
// Against a 600px scrollport the unoccluded band is 310px wide, so at
// scrollLeft 0 it spans content [120, 430].
const PINNED_COLUMNS = [
  { id: "first", header: "First", pinned: "left" as const, widthPx: 120 },
  { id: "b", header: "B", widthPx: 100 },
  { id: "c", header: "C", widthPx: 100 },
  { id: "d", header: "D", widthPx: 100 },
  { id: "e", header: "E", widthPx: 100 },
  { id: "f", header: "F", widthPx: 100 },
  { id: "status", header: "Status", pinned: "right" as const, widthPx: 90 },
  { id: "actions", header: "Actions", pinned: "right" as const, widthPx: 80 },
];

const PINNED_LEFT_WIDTH = 120;
const PINNED_RIGHT_WIDTH = 170;
const PINNED_TOTAL_WIDTH = 790;

/**
 * Replace the viewport's inert jsdom scroll accessors with recording ones.
 *
 * The arrays double as setter spies: an empty array means the property was
 * never *assigned*, which is a strictly stronger claim than "its value did not
 * change" and is the only way to prove the surface is not fighting a user's
 * own scrolling.
 */
function recordScrollWrites(el: HTMLElement) {
  const writes = { top: [] as number[], left: [] as number[] };
  let scrollTop = 0;
  let scrollLeft = 0;

  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (next: number) => {
      writes.top.push(next);
      scrollTop = next;
    },
  });
  Object.defineProperty(el, "scrollLeft", {
    configurable: true,
    get: () => scrollLeft,
    set: (next: number) => {
      writes.left.push(next);
      scrollLeft = next;
    },
  });

  return writes;
}

function renderGrid(
  options: {
    columns?: PretableColumn<Row>[];
    rowSelectionColumn?: { enabled: true };
    /** Renders a focusable element that is NOT part of the surface. */
    outsideButton?: boolean;
  } = {},
) {
  let grid!: PretableGrid<Row>;
  const { container } = render(
    <>
      {options.outsideButton ? <button type="button">outside</button> : null}
      <PretableSurface
        ariaLabel="focus-scroll-grid"
        columns={options.columns ?? PLAIN_COLUMNS}
        getRowId={(row: Row) => row.id}
        onGridReady={(g) => {
          grid = g as PretableGrid<Row>;
        }}
        overscan={0}
        rows={rows}
        rowSelectionColumn={options.rowSelectionColumn}
        viewportHeight={VIEWPORT_HEIGHT}
      />
    </>,
  );

  const viewport = container.querySelector<HTMLElement>(
    "[data-pretable-scroll-viewport]",
  )!;

  return { container, grid, viewport, writes: recordScrollWrites(viewport) };
}

/** The `[role=gridcell]` node for an address, or null when it is not rendered. */
function cellNode(
  container: HTMLElement,
  rowId: string,
  columnId: string,
): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    `[data-pretable-row-id="${rowId}"] [data-pretable-cell][data-pretable-column-id="${columnId}"]`,
  );
}

function focusCell(grid: PretableGrid<Row>, rowId: string, columnId: string) {
  act(() => {
    grid.setFocus({ rowId, columnId });
  });
}

describe("keyboard focus scrolls the viewport into view", () => {
  it("ArrowDown past the bottom of the window scrolls down by exactly one row", () => {
    const { grid, viewport, writes } = renderGrid();

    // r2 occupies [88, 132) — the last row fully inside the band, so landing
    // on it must not move anything.
    focusCell(grid, "r2", "a");
    expect(writes.top).toEqual([]);

    fireEvent.keyDown(viewport, { key: "ArrowDown" });

    // r3 spans [132, 176). Aligning its bottom edge with the band's bottom
    // gives 176 - 132.
    expect(writes.top).toEqual([ROW_HEIGHT]);
    expect(writes.left).toEqual([]);
  });

  it("ArrowUp past the top of the window scrolls up to the target's top edge", () => {
    const { grid, viewport, writes } = renderGrid();

    // r20 spans [880, 924); revealing its bottom edge parks the band at 792,
    // which spans rows 18..20.
    focusCell(grid, "r20", "a");
    expect(writes.top).toEqual([924 - BODY_HEIGHT]);

    // r19 and r18 are both already inside [792, 924) — no write.
    fireEvent.keyDown(viewport, { key: "ArrowUp" });
    fireEvent.keyDown(viewport, { key: "ArrowUp" });
    expect(writes.top).toEqual([792]);

    // r17 starts at 748, above the band, so we align its top edge.
    fireEvent.keyDown(viewport, { key: "ArrowUp" });
    expect(writes.top).toEqual([792, 17 * ROW_HEIGHT]);
  });

  it("scrolls to a focused row far outside the RENDERED window", () => {
    // The actual bug. Nothing about r30 exists in the DOM, so there is no node
    // to call scrollIntoView() on and the old focus-follow effect's map lookup
    // simply missed — the viewport never moved at all.
    const { container, grid, writes } = renderGrid();

    expect(container.querySelector('[data-pretable-row-id="r30"]')).toBeNull();

    focusCell(grid, "r30", "a");

    // r30 spans [1320, 1364).
    expect(writes.top).toEqual([1364 - BODY_HEIGHT]);
  });

  it("Cmd+End jumps to the last cell and scrolls both axes", () => {
    const { grid, viewport, writes } = renderGrid();

    focusCell(grid, "r0", "a");
    expect(writes.top).toEqual([]);
    expect(writes.left).toEqual([]);

    fireEvent.keyDown(viewport, { key: "End", metaKey: true });

    expect(grid.getSnapshot().focus).toEqual({
      rowId: `r${ROW_COUNT - 1}`,
      columnId: "h",
    });
    // Vertical: last row's bottom is totalHeight, and that lands exactly on
    // the maximum scrollTop.
    expect(writes.top).toEqual([TOTAL_HEIGHT - BODY_HEIGHT]);
    // Horizontal: `h` spans [700, 800) with no pinned groups, so the band is
    // the whole 600px scrollport.
    expect(writes.left).toEqual([800 - VIEWPORT_WIDTH]);
  });

  it("ArrowRight onto a column behind the RIGHT-pinned group scrolls horizontally", () => {
    const { grid, viewport, writes } = renderGrid({ columns: PINNED_COLUMNS });

    // `d` spans [320, 420), inside the unoccluded band [120, 430).
    focusCell(grid, "r0", "d");
    expect(writes.left).toEqual([]);

    fireEvent.keyDown(viewport, { key: "ArrowRight" });
    expect(grid.getSnapshot().focus.columnId).toBe("e");

    // `e` spans [420, 520). It is inside the 600px scrollport at scrollLeft 0
    // — a plain scrollIntoView() would consider it visible — but the sticky
    // right-pinned group covers content from 430 onwards, so it must move.
    expect(writes.left).toEqual([
      520 - VIEWPORT_WIDTH + PINNED_RIGHT_WIDTH, // 90
    ]);
    expect(writes.top).toEqual([]);
    // Sanity: the offset stays inside the scroll extent.
    expect(writes.left[0]!).toBeLessThanOrEqual(
      PINNED_TOTAL_WIDTH - VIEWPORT_WIDTH,
    );
  });

  it("focusing an already-visible cell writes NO scroll on either axis", () => {
    const { grid, writes } = renderGrid({ columns: PINNED_COLUMNS });

    // r1 spans [44, 88) inside the band [0, 132); `c` spans [220, 320) inside
    // [120, 430). Nothing to do — and the surface must therefore not touch the
    // properties at all, or it would stomp on a scroll position the user set.
    focusCell(grid, "r1", "c");

    expect(writes.top).toEqual([]);
    expect(writes.left).toEqual([]);
  });

  it("a column exactly on the band's leading edge is treated as visible", () => {
    const { grid, writes } = renderGrid({ columns: PINNED_COLUMNS });

    // `b` starts at exactly PINNED_LEFT_WIDTH — flush against the left-pinned
    // group's trailing edge, i.e. the first fully unoccluded pixel. This is the
    // off-by-one guard: a `<=` in place of `<` would scroll here.
    expect(PINNED_LEFT_WIDTH).toBe(120);
    focusCell(grid, "r0", "b");

    expect(writes.left).toEqual([]);
  });

  it("left-pinned and right-pinned targets never scroll horizontally", () => {
    const { grid, writes } = renderGrid({ columns: PINNED_COLUMNS });

    // Both pinned groups are sticky overlays: they are on screen at every
    // scroll offset, so no horizontal offset could reveal them "better".
    focusCell(grid, "r0", "first");
    expect(writes.left).toEqual([]);

    focusCell(grid, "r0", "status");
    expect(writes.left).toEqual([]);

    focusCell(grid, "r0", "actions");
    expect(writes.left).toEqual([]);

    // …even when the same address does need a vertical scroll.
    focusCell(grid, "r30", "actions");
    expect(writes.left).toEqual([]);
    expect(writes.top).toEqual([1364 - BODY_HEIGHT]);
  });

  it("the synthetic row-select column never scrolls horizontally", () => {
    // ROW_SELECT_COLUMN_ID is synthesized by the surface and left-pinned by
    // default, so it must fall into the pinned short-circuit like any other
    // pin — it has no content offset a scroll could reach.
    const { grid, writes } = renderGrid({
      rowSelectionColumn: { enabled: true },
    });

    focusCell(grid, "r0", ROW_SELECT_COLUMN_ID);
    expect(writes.left).toEqual([]);
    expect(writes.top).toEqual([]);
  });

  it("re-rendering with the focus address already satisfied does not re-scroll", () => {
    // The guard against yanking a user back: once an address is revealed, no
    // later pass (a measurement, a streamed row update, the user's own scroll)
    // may write for it again.
    const { grid, viewport, writes } = renderGrid();

    focusCell(grid, "r10", "a");
    expect(writes.top).toEqual([11 * ROW_HEIGHT - BODY_HEIGHT]); // 352

    // Simulate the user scrolling the focused row clean out of view. The
    // surface sees the resulting scroll event and re-renders; it must not put
    // the offset back.
    viewport.scrollTop = 0;
    writes.top.length = 0;
    act(() => {
      fireEvent.scroll(viewport);
    });

    expect(writes.top).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Measure-then-scroll convergence.
//
// Scrolling to a distant row uses ESTIMATED heights for every row in between,
// because only rendered rows are ever measured. When the target finally
// renders and is measured, every offset after it shifts and the offset we just
// wrote is wrong. jsdom cannot stage a real measurement pass — every row
// measures 0, below the 44px floor, so `measuredHeights` never fills — so
// these tests move the *estimates* instead, which shifts `rowMetrics` in
// exactly the way a measurement would and drives the same effect path.
// ---------------------------------------------------------------------------

const WRAP_COLUMNS = [
  { id: "a", header: "A", widthPx: 100 },
  { id: "note", header: "Note", widthPx: 100, wrap: true },
];

const CONVERGENCE_TARGET_INDEX = 30;

/**
 * Rows whose estimated height depends on `noteLength` — but only ABOVE the
 * target, so the single thing that changes between renders is how far down the
 * target sits.
 */
function wrapRows(noteLength: number): Row[] {
  return Array.from({ length: ROW_COUNT }, (_, i) => ({
    id: `r${i}`,
    a: `a${i}`,
    note: i < CONVERGENCE_TARGET_INDEX ? "x".repeat(noteLength) : "x",
  })) as Row[];
}

function renderConvergenceGrid() {
  let grid!: PretableGrid<Row>;
  const view = render(
    <PretableSurface
      ariaLabel="convergence-grid"
      columns={WRAP_COLUMNS}
      getRowId={(row: Row) => row.id}
      onGridReady={(g) => {
        grid = g as PretableGrid<Row>;
      }}
      overscan={0}
      rows={wrapRows(1)}
      viewportHeight={VIEWPORT_HEIGHT}
    />,
  );

  const viewport = view.container.querySelector<HTMLElement>(
    "[data-pretable-scroll-viewport]",
  )!;

  const setNoteLength = (noteLength: number) => {
    act(() => {
      view.rerender(
        <PretableSurface
          ariaLabel="convergence-grid"
          columns={WRAP_COLUMNS}
          getRowId={(row: Row) => row.id}
          overscan={0}
          rows={wrapRows(noteLength)}
          viewportHeight={VIEWPORT_HEIGHT}
        />,
      );
    });
  };

  return {
    grid,
    setNoteLength,
    viewport,
    writes: recordScrollWrites(viewport),
  };
}

describe("measure-then-scroll convergence", () => {
  it("re-asserts while the target is still not revealed, then stops", () => {
    const { grid, setNoteLength, viewport, writes } = renderConvergenceGrid();

    focusCell(grid, `r${CONVERGENCE_TARGET_INDEX}`, "a");
    expect(writes.top).toHaveLength(1);
    const firstOffset = writes.top[0]!;

    // The rows above the target turn out to be much taller than estimated, so
    // the offset we just wrote no longer reveals it. Same focus address, new
    // geometry: the effect must correct itself rather than leave the target
    // off-screen.
    setNoteLength(400);
    expect(writes.top).toHaveLength(2);
    expect(writes.top[1]!).toBeGreaterThan(firstOffset);

    // …and it terminates. Once the engine catches up with the offset we wrote
    // (which is what the native scroll event does in a browser), the target is
    // revealed, `scrollTopToReveal` returns null, and the address is settled —
    // no further write, no loop.
    act(() => {
      fireEvent.scroll(viewport);
    });
    expect(writes.top).toHaveLength(2);
  });

  it("bounds the re-assert at MAX_SCROLL_REVEAL_WRITES", () => {
    // A pathological case: heights that never settle. This must degrade to
    // "the target is slightly off", never to an unbounded scroll loop.
    const { grid, setNoteLength, writes } = renderConvergenceGrid();

    focusCell(grid, `r${CONVERGENCE_TARGET_INDEX}`, "a");

    for (const noteLength of [200, 400, 600, 800, 1000, 1200]) {
      setNoteLength(noteLength);
    }

    // 4 = MAX_SCROLL_REVEAL_WRITES in pretable-surface.tsx.
    expect(writes.top).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// DOM focus follow.
//
// Scrolling the viewport to the engine's focus address is only half the job: a
// focus ring left behind on the old cell means the wrong cell is announced and
// the wrong element receives the next keystroke. The surface therefore has to
// move DOM focus onto the target *after* it enters the virtualization window,
// which is one or more commits later than the focus address changed.
//
// Doing that safely is the whole problem — the effect must be able to fire on
// arbitrary later renders without ever taking focus away from something the
// user is actually using (a cell editor's input, a portaled popover, or a
// wholly unrelated part of the host page).
// ---------------------------------------------------------------------------

const EDITABLE_COLUMNS: PretableColumn<Row>[] = [
  { id: "a", header: "A", widthPx: 100, editable: true },
  { id: "b", header: "B", widthPx: 100 },
];

describe("DOM focus follows the engine's focus address", () => {
  it("focuses a cell inside the rendered window (regression guard)", () => {
    const { container, grid } = renderGrid();

    // Nothing on the page has focus yet, exactly as on a freshly loaded
    // document. An unowned focus is the grid's to take.
    expect(document.activeElement).toBe(document.body);

    focusCell(grid, "r1", "a");
    expect(cellNode(container, "r1", "a")).toHaveFocus();

    // …and a subsequent in-window move hands focus on to the next cell.
    focusCell(grid, "r2", "b");
    expect(cellNode(container, "r2", "b")).toHaveFocus();
  });

  it("focuses a cell that was NOT rendered when focus moved to it", () => {
    // THE GAP. Task 3 taught the viewport to scroll to an off-window address,
    // but DOM focus stayed parked on the old cell, so the focus ring, the next
    // keystroke, and the screen reader all pointed at the wrong row.
    const { container, grid, viewport } = renderGrid();

    focusCell(grid, "r0", "a");
    expect(cellNode(container, "r0", "a")).toHaveFocus();

    focusCell(grid, "r30", "a");

    // The scroll offset has been written, but the engine has not seen the
    // resulting scroll event yet, so the window has not moved and there is
    // still no node to focus.
    expect(cellNode(container, "r30", "a")).toBeNull();

    act(() => {
      fireEvent.scroll(viewport);
    });

    // r30 is now rendered — and r0's node was unmounted by the same commit,
    // which is why `document.activeElement` is momentarily `document.body`
    // here rather than the old cell. Focus must still land on the target.
    expect(cellNode(container, "r30", "a")).toHaveFocus();
  });

  it("does not steal focus from an open cell editor", () => {
    const { container, grid } = renderGrid({ columns: EDITABLE_COLUMNS });

    focusCell(grid, "r0", "a");
    fireEvent.keyDown(container.querySelector("[data-pretable-cell]")!, {
      key: "Enter",
    });
    const input = screen.getByRole("textbox");
    expect(input).toHaveFocus();

    // An external focus move landing mid-edit: the surface's own keydown
    // handler bails while `snapshot.editing` is set, but `usePretable`'s
    // controlled-state re-assert calls `grid.setFocus` regardless.
    focusCell(grid, "r1", "a");
    expect(input).toHaveFocus();

    // …and neither does a streamed row update, which hands the surface a fresh
    // rendered set on every patch.
    act(() => {
      grid.setRows(rows.map((row) => ({ ...row })));
    });
    expect(input).toHaveFocus();
    expect(grid.getSnapshot().editing).not.toBeNull();

    // Once the edit ends the pending move is applied — the focus address the
    // grid was asked for is honoured, just not at the editor's expense.
    fireEvent.keyDown(input, { key: "Escape" });
    expect(grid.getSnapshot().editing).toBeNull();
    expect(cellNode(container, "r1", "a")).toHaveFocus();
  });

  it("does not steal focus from a portaled overlay", () => {
    // FilterMenu renders through OverlayPortal into document.body, so it is
    // outside the viewport subtree even though it is logically part of the
    // grid — `viewport.contains(activeElement)` is the check that notices.
    const { container, grid, viewport } = renderGrid();

    focusCell(grid, "r0", "a");
    focusCell(grid, "r30", "a");
    expect(cellNode(container, "r30", "a")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Filter A" }));
    const select = screen.getByRole("combobox", { name: "Filter operator" });
    expect(select).toHaveFocus();
    expect(viewport.contains(select)).toBe(false);

    // Move the render window through the engine rather than by dispatching a
    // DOM scroll event: the popover closes itself on any capture-phase scroll
    // (useFilterPopover.ts), which would delete the element under test. The
    // rendered-set change the surface sees is identical either way.
    act(() => {
      const snapshot = grid.getSnapshot();
      grid.setViewport({
        ...snapshot.viewport,
        scrollTop: 31 * ROW_HEIGHT - BODY_HEIGHT,
      });
    });

    // r30 is rendered now, so the node the pending move wanted exists — and
    // must be left alone.
    expect(cellNode(container, "r30", "a")).not.toBeNull();
    expect(select).toHaveFocus();
  });

  it("does not steal focus from outside the grid entirely", () => {
    const { container, grid, viewport } = renderGrid({ outsideButton: true });

    focusCell(grid, "r0", "a");
    focusCell(grid, "r30", "a");

    const outside = screen.getByRole("button", { name: "outside" });
    act(() => {
      outside.focus();
    });

    act(() => {
      fireEvent.scroll(viewport);
    });

    expect(cellNode(container, "r30", "a")).not.toBeNull();
    expect(outside).toHaveFocus();
  });

  it("does not grab focus back once the grid has been blurred", () => {
    // The steady-state hazard of re-running on the rendered set: under
    // streaming the surface re-renders continuously. `<body>` counts as
    // unowned focus, so the ONLY thing standing between a streamed patch and a
    // stolen focus here is that a satisfied address leaves no pending move.
    const { container, grid } = renderGrid();

    focusCell(grid, "r1", "a");
    const cell = cellNode(container, "r1", "a")!;
    expect(cell).toHaveFocus();

    // The user clicks the page background.
    act(() => {
      cell.blur();
    });
    expect(document.activeElement).toBe(document.body);

    act(() => {
      grid.setRows(rows.map((row) => ({ ...row })));
    });

    expect(document.activeElement).toBe(document.body);
  });

  it("does not pull focus back after the user has moved to another control", () => {
    const { container, grid } = renderGrid({ outsideButton: true });

    focusCell(grid, "r1", "a");
    expect(cellNode(container, "r1", "a")).toHaveFocus();

    const outside = screen.getByRole("button", { name: "outside" });
    act(() => {
      outside.focus();
    });

    act(() => {
      grid.setRows(rows.map((row) => ({ ...row })));
    });

    expect(outside).toHaveFocus();
  });
});
