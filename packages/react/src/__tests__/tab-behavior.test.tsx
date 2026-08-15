import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { createColumnHelper } from "@pretable/core";

import { PretableSurface } from "../pretable-surface";

// ---------------------------------------------------------------------------
// What jsdom can and cannot prove here
//
// CANNOT: that Tab moved focus anywhere. jsdom has no sequential focus order —
// `Tab` is an ordinary keydown, and nothing traverses unless a handler does it
// by hand. A test here that asserted "focus left the grid" would pass against a
// grid nobody can leave.
//
// CAN: whether the surface CONSUMED the press. `preventDefault()` is the whole
// mechanism by which the grid takes Tab away from the browser, so
// `defaultPrevented` is the exact fork: prevented means the grid moved focus
// itself, not prevented means the browser's own traversal runs and focus leaves.
// That second half — "not prevented ⇒ focus really does leave the grid" — is
// proved in a real engine, in both of them, by the `tabBehavior="exit"` default
// in apps/website/e2e/grid-keyboard-a11y.spec.ts.
//
// This file exists for the corner cases of `"wrap-rows"`, which has no live
// example on the docs site to drive with real presses.
// ---------------------------------------------------------------------------

interface Row {
  id: string;
  a: string;
  b: string;
}

const column = createColumnHelper<Row>();
const columns = [
  column.accessor("a", { type: "text", header: "A" }),
  column.accessor("b", { type: "text", header: "B" }),
] as const;

const rows: Row[] = [
  { id: "r1", a: "a1", b: "b1" },
  { id: "r2", a: "a2", b: "b2" },
];

function renderGrid(tabBehavior?: "wrap-rows" | "exit") {
  return render(
    <PretableSurface
      ariaLabel="Tab behavior"
      columns={columns}
      getRowId={(row) => row.id}
      rows={rows}
      viewportHeight={400}
      {...(tabBehavior ? { tabBehavior } : {})}
    />,
  );
}

function cellAt(container: HTMLElement, rowId: string, columnId: string) {
  const cell = container.querySelector<HTMLElement>(
    `[data-pretable-row-id="${rowId}"] [data-pretable-cell][data-pretable-column-id="${columnId}"]`,
  );
  if (cell === null) throw new Error(`no cell ${rowId}/${columnId}`);
  return cell;
}

/** Click a cell to give it the engine's focus address, then press Tab. */
function tabFrom(
  container: HTMLElement,
  rowId: string,
  columnId: string,
  { shift = false } = {},
): boolean {
  const cell = cellAt(container, rowId, columnId);
  fireEvent.pointerDown(cell, { button: 0 });
  return !fireEvent.keyDown(cell, { key: "Tab", shiftKey: shift });
}

afterEach(cleanup);

describe("tabBehavior", () => {
  it('defaults to "exit" — Tab is never consumed', () => {
    const { container } = renderGrid();

    // Every cell, corners included. The default must not consume Tab anywhere:
    // the old `"wrap-rows"` default consumed it at all four of these and was a
    // WCAG 2.1.2 keyboard trap in both Chromium and WebKit (120 presses, never
    // out).
    expect(tabFrom(container, "r1", "a")).toBe(false);
    expect(tabFrom(container, "r1", "b")).toBe(false);
    expect(tabFrom(container, "r2", "a")).toBe(false);
    expect(tabFrom(container, "r2", "b")).toBe(false);
    expect(tabFrom(container, "r1", "a", { shift: true })).toBe(false);
    expect(tabFrom(container, "r2", "b", { shift: true })).toBe(false);
  });

  describe('"wrap-rows"', () => {
    it("consumes Tab in the middle of the grid, and moves focus", () => {
      const { container } = renderGrid("wrap-rows");

      // The positive twin of the release assertions below. Without this, a
      // wrap-rows that released EVERYWHERE — i.e. did nothing at all — would
      // satisfy the two corner tests and look like a pass.
      expect(tabFrom(container, "r1", "a")).toBe(true);
      expect(
        cellAt(container, "r1", "b").getAttribute("data-pretable-focused"),
      ).toBe("true");

      // And it wraps to the next row rather than stopping at the row end.
      expect(tabFrom(container, "r1", "b")).toBe(true);
      expect(
        cellAt(container, "r2", "a").getAttribute("data-pretable-focused"),
      ).toBe("true");

      expect(tabFrom(container, "r2", "b", { shift: true })).toBe(true);
      expect(
        cellAt(container, "r2", "a").getAttribute("data-pretable-focused"),
      ).toBe("true");
    });

    it("RELEASES Tab at the last cell instead of clamping", () => {
      const { container } = renderGrid("wrap-rows");

      // This used to clamp — focus stayed on the bottom-right cell and the key
      // was consumed, so forward Tab could never leave. Releasing hands the
      // press back to the browser's own traversal.
      expect(tabFrom(container, "r2", "b")).toBe(false);
      // Released, so the grid moved nothing.
      expect(
        cellAt(container, "r2", "b").getAttribute("data-pretable-focused"),
      ).toBe("true");
    });

    it("RELEASES Shift+Tab at the first cell instead of clamping", () => {
      const { container } = renderGrid("wrap-rows");

      expect(tabFrom(container, "r1", "a", { shift: true })).toBe(false);
      expect(
        cellAt(container, "r1", "a").getAttribute("data-pretable-focused"),
      ).toBe("true");
    });
  });
});
