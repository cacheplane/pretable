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
   * The marquee drag does not call `setPointerCapture` (see the module doc
   * in `../marquee-drag.ts` for why); instead the anchor cell's
   * `onPointerDown` attaches `pointermove`/`pointerup` listeners to
   * `window` for the duration of the drag and reads `event.target` off
   * them directly. That is what makes this exercisable in jsdom at all: a
   * `pointermove` fired on the target cell bubbles to `window` the normal
   * way, with `target` set to that cell, exactly like a real, uncaptured
   * pointer event — no `document.elementFromPoint` stub needed, unlike the
   * capture-based designs this replaced.
   *
   * This proves the click-suppression wiring — the rAF throttle, the
   * dedupe, and the `dragExtendedRef` flag all run for real — not that the
   * range grows correctly under a real browser's actual hit-testing across
   * real screen coordinates; jsdom has no layout engine to make that claim
   * either way. That full gesture, driven with real `page.mouse` events in
   * both Chromium and WebKit, is `apps/website/e2e/range-selection.spec.ts`.
   */
  it("stays quiet when the click ends a drag across cells", async () => {
    const onRowActivate = vi.fn();
    const { container } = renderGrid(onRowActivate);

    const from = cellFor(container, "a", "name");
    const to = cellFor(container, "b", "id");

    fireEvent.pointerDown(from);
    // Fired on `to`, the real cell under the pointer — nothing retargets
    // it, so `event.target` on the window listener is `to` itself.
    fireEvent.pointerMove(to, { clientX: 40, clientY: 80 });
    // The rAF-throttled resolution runs asynchronously; wait for its
    // observable effect (the range extending onto `to`) rather than for
    // an internal call, since there is no DOM lookup left to spy on.
    await waitFor(() =>
      expect(to).toHaveAttribute("data-pretable-selected", "true"),
    );
    fireEvent.pointerUp(to);
    fireEvent.click(to);

    expect(onRowActivate).not.toHaveBeenCalled();
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
