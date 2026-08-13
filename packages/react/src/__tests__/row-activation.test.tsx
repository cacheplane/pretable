import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PretableSurface } from "../pretable-surface";

/**
 * "Open the thing this row stands for" is the most common interaction a grid
 * is asked for, and it is not the same event as selection — selecting a cell
 * range and opening a record are different intents.
 */

type DemoRow = {
  id: string;
  name: string;
};

const columns = [
  { id: "name", header: "Name", value: (row: DemoRow) => row.name },
  { id: "id", header: "Id", value: (row: DemoRow) => row.id },
];

const rows: DemoRow[] = [
  { id: "a", name: "Alpha" },
  { id: "b", name: "Bravo" },
];

function cellFor(container: HTMLElement, rowId: string, columnId: string) {
  const cell = container.querySelector(
    `[data-pretable-row-id="${rowId}"] [data-pretable-column-id="${columnId}"]`,
  );
  if (!cell) throw new Error(`no ${columnId} cell for ${rowId}`);
  return cell as HTMLElement;
}

function renderGrid(onRowActivate: (input: unknown) => void) {
  return render(
    <PretableSurface<DemoRow>
      ariaLabel="Demo"
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      viewportHeight={400}
      onRowActivate={onRowActivate}
    />,
  );
}

afterEach(cleanup);

describe("onRowActivate", () => {
  it("fires when a row is clicked, with the row and its id", () => {
    const onRowActivate = vi.fn();
    const { container } = renderGrid(onRowActivate);

    fireEvent.click(cellFor(container, "b", "name"));

    expect(onRowActivate).toHaveBeenCalledTimes(1);
    expect(onRowActivate.mock.calls[0]![0]).toMatchObject({
      rowId: "b",
      row: { id: "b", name: "Bravo" },
      rowIndex: 1,
    });
  });

  /** Seed engine focus from the grid root, then let the focused cell own the
   *  subsequent keyboard event. Header controls retain native key ownership. */
  function focusFirstCell(container: HTMLElement) {
    const grid = container.querySelector('[role="grid"]') as HTMLElement;
    fireEvent.keyDown(grid, { key: "ArrowDown" });
  }

  it("fires on Enter on the focused cell", () => {
    const onRowActivate = vi.fn();
    const { container } = renderGrid(onRowActivate);

    focusFirstCell(container);
    fireEvent.keyDown(document.activeElement ?? container, { key: "Enter" });

    expect(onRowActivate).toHaveBeenCalledTimes(1);
    expect(onRowActivate.mock.calls[0]![0]).toMatchObject({ rowId: "a" });
  });

  it("fires on Space on the focused cell", () => {
    const onRowActivate = vi.fn();
    const { container } = renderGrid(onRowActivate);

    focusFirstCell(container);
    fireEvent.keyDown(document.activeElement ?? container, {
      key: "ArrowDown",
    });
    fireEvent.keyDown(document.activeElement ?? container, { key: " " });

    expect(onRowActivate).toHaveBeenCalledTimes(1);
    expect(onRowActivate.mock.calls[0]![0]).toMatchObject({ rowId: "b" });
  });

  it("stays quiet for a modifier-click, which is range selection", () => {
    const onRowActivate = vi.fn();
    const { container } = renderGrid(onRowActivate);

    fireEvent.click(cellFor(container, "b", "name"), { shiftKey: true });
    fireEvent.click(cellFor(container, "b", "name"), { metaKey: true });
    fireEvent.click(cellFor(container, "b", "name"), { ctrlKey: true });

    expect(onRowActivate).not.toHaveBeenCalled();
  });

  /**
   * A real browser never delivers `pointerEnter` to any cell but the drag's
   * anchor: the anchor calls `setPointerCapture` on `pointerdown`, and per
   * the Pointer Events spec that retargets every later pointer event to it —
   * confirmed by instrumenting a real drag (see the module doc in
   * `../marquee-drag.ts`). `PretableSurface` resolves the hovered cell off
   * `pointermove` + `document.elementFromPoint` instead, throttled to one
   * resolution per animation frame.
   *
   * jsdom does not implement capture retargeting, so `fireEvent.pointerEnter`
   * on a non-anchor cell used to exercise a path a real drag can never take —
   * false confidence that shipped a marquee drag which only ever selected its
   * start cell. jsdom does not implement `elementFromPoint` at all (no such
   * method exists on its `document`), so that one call is stubbed here, and
   * only that one:
   * `pointermove` still dispatches from the anchor node the way capture
   * forces a real browser to, and the rAF throttle, the dedupe, and the
   * `dragExtendedRef` flag under test all run for real.
   *
   * This proves the click-suppression wiring, not that the range itself grew
   * across real screen coordinates under real capture — jsdom has no layout
   * engine to make that claim either way. That full gesture, driven with
   * real `page.mouse` events under actual pointer capture in both Chromium
   * and WebKit, is `apps/website/e2e/range-selection.spec.ts`.
   */
  it("stays quiet when the click ends a drag across cells", async () => {
    const onRowActivate = vi.fn();
    const { container } = renderGrid(onRowActivate);

    const from = cellFor(container, "a", "name");
    const to = cellFor(container, "b", "id");
    // jsdom's `document` has no `elementFromPoint` at all (not even a
    // stub), so it is assigned directly rather than spied on.
    const elementFromPoint = vi.fn().mockReturnValue(to);
    (
      document as Document & { elementFromPoint: typeof elementFromPoint }
    ).elementFromPoint = elementFromPoint;

    try {
      fireEvent.pointerDown(from);
      // Fired on `from`, the capturing anchor — exactly what a real browser
      // retargets every subsequent pointermove to, regardless of where the
      // cursor physically is.
      fireEvent.pointerMove(from, { clientX: 40, clientY: 80 });
      await waitFor(() => expect(elementFromPoint).toHaveBeenCalled());
      fireEvent.pointerUp(to);
      fireEvent.click(to);

      expect(onRowActivate).not.toHaveBeenCalled();
    } finally {
      delete (document as { elementFromPoint?: unknown }).elementFromPoint;
    }
  });

  it("is optional — a grid without it still handles clicks", () => {
    const { container } = render(
      <PretableSurface<DemoRow>
        ariaLabel="Demo"
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        viewportHeight={400}
      />,
    );

    expect(() =>
      fireEvent.click(cellFor(container, "a", "name")),
    ).not.toThrow();
  });
});
