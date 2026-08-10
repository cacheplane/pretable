import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PretableSurfaceState } from "../use-pretable";
import { PretableSurface } from "../pretable-surface";

/**
 * D1-GRID-04, React half: with none of the server-authority props supplied,
 * the surface's DOM, ARIA and labels must stay for the whole slice exactly as
 * they are at @pretable/react 0.0.11.
 *
 * Only these edits to this file are sanctioned while the slice is in flight:
 *
 *  1. Purely additive new `it(...)` blocks.
 *  2. Tightening a forward guard (see the `data-pretable-*` block below) into
 *     a live assertion once the attribute it names actually exists in the
 *     source — never loosening or deleting one.
 *
 * Anything else — changing an expected value, relaxing an assertion, dropping
 * a case — means local mode moved under a consumer who opted into nothing.
 * That is the regression this file exists to catch: fix the source, not this
 * file.
 */

afterEach(cleanup);

type Row = { id: string; name: string };

const rows: Row[] = [
  { id: "a", name: "Ada" },
  { id: "b", name: "Bob" },
];

const columns = [{ id: "name", header: "Name", widthPx: 120 }];

function renderSurface(state?: PretableSurfaceState) {
  return render(
    <PretableSurface<Row>
      ariaLabel="People"
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      state={state}
      viewportHeight={400}
      rowSelectionColumn={{ enabled: true }}
    />,
  );
}

describe("local mode baseline (surface)", () => {
  it("aria-rowcount is the visible row count plus the header", () => {
    renderSurface();
    expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "3");
  });

  it("aria-rowcount shrinks with an active filter — it is the POST-filter visible count, not the loaded count", () => {
    // The unfiltered case above cannot tell `visibleRows.length + 1` from
    // `loadedRowCount + 1`; this one can, and it is exactly the expression
    // this slice rewrites. A surface that starts counting loaded rows here
    // reads "3".
    renderSurface({
      filters: { name: { operator: "contains", value: "Ada" } },
    });
    expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "2");
  });

  it("data rows start at aria-rowindex 2", () => {
    renderSurface();
    // Index 0 is the header row; read the FIRST data row, so the assertion
    // says what the title says and stays true under a bigger fixture.
    const gridRows = screen.getAllByRole("row");
    expect(gridRows[1]).toHaveAttribute("aria-rowindex", "2");
  });

  it("never sets aria-busy on the grid", () => {
    renderSurface();
    expect(screen.getByRole("grid")).not.toHaveAttribute("aria-busy");
  });

  // FORWARD GUARDS, not live coverage. None of `data-pretable-data-phase`,
  // `data-pretable-body-state` or `data-pretable-data-state-wrapper` exists
  // anywhere in the source yet — Task 14 introduces them — so today these
  // three cannot fail no matter what the surface renders. They are here so
  // that the task adding the attributes trips them the moment it leaks one
  // into a grid that opted into no `dataState`. Read them as "this must stay
  // absent in local mode", never as "the absence is being exercised".
  it("does not set a data-phase attribute", () => {
    renderSurface();
    expect(screen.getByRole("grid")).not.toHaveAttribute(
      "data-pretable-data-phase",
    );
  });

  it("renders no body-state block", () => {
    const view = renderSurface();
    expect(
      view.container.querySelector("[data-pretable-body-state]"),
    ).toBeNull();
  });

  it("does not add a data-state wrapper around the viewport", () => {
    const view = renderSurface();
    expect(
      view.container.querySelector("[data-pretable-data-state-wrapper]"),
    ).toBeNull();
  });

  it('labels the header checkbox "Select all rows"', () => {
    renderSurface();
    expect(
      screen.getByRole("checkbox", { name: "Select all rows" }),
    ).toBeInTheDocument();
  });
});

/**
 * The `rows` prop moving is not an opt-in: every streaming consumer on 0.0.11
 * replaces it, and none of them asked for the data lifecycle. `dataState` is
 * the opt-in, so with it absent a replacement must stay as mute and as
 * hands-off as it was before this slice existed (design §10.1).
 */
describe("local mode baseline (rows replaced under a focused cell)", () => {
  const ANNOUNCE_DEBOUNCE_MS = 500;

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function renderRows(next: Row[]) {
    return render(
      <PretableSurface<Row>
        ariaLabel="People"
        columns={columns}
        rows={next}
        getRowId={(row) => row.id}
        viewportHeight={400}
      />,
    );
  }

  function rerenderRows(view: ReturnType<typeof render>, next: Row[]) {
    view.rerender(
      <PretableSurface<Row>
        ariaLabel="People"
        columns={columns}
        rows={next}
        getRowId={(row) => row.id}
        viewportHeight={400}
      />,
    );
  }

  /** The live region is portaled to the body; `baseElement` still holds it. */
  function liveRegionText(view: ReturnType<typeof render>): string {
    return (
      view.baseElement.querySelector("[data-pretable-live-region]")
        ?.textContent ?? ""
    );
  }

  function focusCell(view: ReturnType<typeof render>, rowId: string): void {
    const cell = view.container.querySelector<HTMLElement>(
      `[data-pretable-row-id="${rowId}"] [data-pretable-column-id="name"]`,
    );
    if (!cell) throw new Error(`no rendered cell for row ${rowId}`);
    act(() => {
      cell.focus();
      fireEvent.click(cell);
    });
  }

  it("says nothing when the replacement drops the focused row", () => {
    const view = renderRows(rows);
    focusCell(view, "b");
    rerenderRows(view, [rows[0]!]);
    act(() => {
      vi.advanceTimersByTime(ANNOUNCE_DEBOUNCE_MS);
    });
    expect(liveRegionText(view)).toBe("");
  });

  it("does not pull DOM focus to the viewport when the replacement empties the grid", () => {
    const view = renderRows(rows);
    focusCell(view, "b");
    rerenderRows(view, []);
    const viewport = view.container.querySelector(
      "[data-pretable-scroll-viewport]",
    );
    expect(viewport).not.toBeNull();
    expect(viewport).not.toHaveFocus();
  });
});
