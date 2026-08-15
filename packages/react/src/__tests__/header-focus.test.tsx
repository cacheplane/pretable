// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, test } from "vitest";

import { PretableSurface } from "../pretable-surface";
import type { PretableSurfaceFocusState } from "../surface-types";

// ---------------------------------------------------------------------------
// What jsdom can and cannot prove about this
//
// CAN: the `tabIndex` values the surface WRITES, and the focus addresses the
// engine publishes as keys are delivered. Both are our own output.
//
// CANNOT: that the browser's sequential focus order then matches. jsdom has no
// tab order at all — `Tab` is an ordinary keydown there and nothing moves
// unless a handler moves it — so an assertion phrased as "Tab enters the grid"
// would pass against a component no keyboard user could reach. The tab-stop
// COUNT, in both engines, is asserted in
// apps/website/e2e/grid-header-keyboard.spec.ts and only there.
// ---------------------------------------------------------------------------

type Row = { id: string; name: string; qty: string };

const rows: Row[] = [
  { id: "r0", name: "alpha", qty: "1" },
  { id: "r1", name: "beta", qty: "2" },
  { id: "r2", name: "gamma", qty: "3" },
];

const columns = [
  { id: "name", header: "Name", widthPx: 120 },
  { id: "qty", header: "Qty", widthPx: 120 },
];

function mount(
  onFocusChange?: (next: PretableSurfaceFocusState<string>) => void,
) {
  return render(
    <PretableSurface<Row>
      ariaLabel="header focus"
      columns={columns}
      getRowId={(row) => row.id}
      rows={rows}
      viewportHeight={300}
      onFocusChange={onFocusChange}
    />,
  );
}

const headers = (view: ReturnType<typeof render>) => [
  ...view.container.querySelectorAll<HTMLElement>(
    "[data-pretable-header-cell][data-pretable-column-id]",
  ),
];

const funnels = (view: ReturnType<typeof render>) => [
  ...view.container.querySelectorAll<HTMLElement>(
    "[data-pretable-filter-funnel]",
  ),
];

const cell = (
  view: ReturnType<typeof render>,
  rowId: string,
  columnId: string,
) =>
  view.container.querySelector<HTMLElement>(
    `[data-pretable-row-id="${rowId}"] [data-pretable-column-id="${columnId}"][data-pretable-cell]`,
  )!;

afterEach(cleanup);

describe("the header joins the roving tabindex", () => {
  test("an untouched grid gives the 0 to a body cell and -1 to every header control", () => {
    const view = mount();

    expect(headers(view).length).toBe(2);
    // The funnels are what made this 2N rather than N: a Sort button AND a
    // filter funnel per column.
    expect(funnels(view).length).toBe(2);

    for (const el of [...headers(view), ...funnels(view)]) {
      expect(el.tabIndex).toBe(-1);
    }

    const tabbableCells = [
      ...view.container.querySelectorAll<HTMLElement>("[data-pretable-cell]"),
    ].filter((el) => el.tabIndex === 0);
    // Exactly one, not "at least one": the roving pattern is one stop, and 6
    // tabbable cells is its own failure.
    expect(tabbableCells.length).toBe(1);
  });

  test("ArrowUp off the first row moves the 0 onto the header, and back", () => {
    const changes: PretableSurfaceFocusState<string>[] = [];
    const view = mount((next) => changes.push(next));

    const first = cell(view, "r0", "name");
    fireEvent.focus(first);
    fireEvent.keyDown(first, { key: "ArrowUp" });

    const nameHeader = headers(view)[0]!;
    expect(nameHeader.getAttribute("data-pretable-column-id")).toBe("name");
    expect(nameHeader.tabIndex).toBe(0);
    expect(nameHeader).toHaveAttribute("data-pretable-focused", "true");
    // Still exactly one stop overall — the body's entry fallback must stand
    // down while the header holds the address, or the grid is two stops.
    expect(
      [
        ...view.container.querySelectorAll<HTMLElement>(
          "[data-pretable-cell], [data-pretable-header-cell]",
        ),
      ].filter((el) => el.tabIndex === 0).length,
    ).toBe(1);
    expect(changes.at(-1)).toEqual({
      ref: { kind: "header" },
      columnId: "name",
    });

    fireEvent.keyDown(nameHeader, { key: "ArrowDown" });
    expect(changes.at(-1)).toEqual({
      ref: { kind: "data", rowId: "r0" },
      columnId: "name",
    });
    expect(headers(view)[0]!.tabIndex).toBe(-1);
  });

  test("ArrowUp from a lower row still moves one row", () => {
    // The positive twin. Without it, an implementation that sent every ArrowUp
    // to the header would satisfy the test above.
    const changes: PretableSurfaceFocusState<string>[] = [];
    const view = mount((next) => changes.push(next));

    const second = cell(view, "r1", "name");
    fireEvent.focus(second);
    fireEvent.keyDown(second, { key: "ArrowUp" });

    expect(changes.at(-1)).toEqual({
      ref: { kind: "data", rowId: "r0" },
      columnId: "name",
    });
  });

  test("Left/Right move between header columns", () => {
    const changes: PretableSurfaceFocusState<string>[] = [];
    const view = mount((next) => changes.push(next));

    const first = cell(view, "r0", "name");
    fireEvent.focus(first);
    fireEvent.keyDown(first, { key: "ArrowUp" });
    fireEvent.keyDown(headers(view)[0]!, { key: "ArrowRight" });

    expect(changes.at(-1)).toEqual({
      ref: { kind: "header" },
      columnId: "qty",
    });
    expect(headers(view)[1]!.tabIndex).toBe(0);
    expect(headers(view)[0]!.tabIndex).toBe(-1);
  });

  test('Tab releases from the header even under tabBehavior="wrap-rows"', () => {
    // No configuration may trap. `"wrap-rows"` is spreadsheet-style entry
    // across the BODY; from the header there is no cell to walk to, so Tab
    // falls through to the browser exactly as it does at the two body corners.
    //
    // jsdom cannot show that focus then LEAVES — it has no tab order — but it
    // can show the two things the surface controls: the cursor does not move,
    // and the event is not `preventDefault`ed, which is what hands the press
    // back to the browser. A consumed-but-inert Tab is precisely the shape of
    // the WCAG 2.1.2 trap #423 removed.
    const changes: PretableSurfaceFocusState<string>[] = [];
    const view = render(
      <PretableSurface<Row>
        ariaLabel="header wrap"
        columns={columns}
        getRowId={(row) => row.id}
        rows={rows}
        tabBehavior="wrap-rows"
        viewportHeight={300}
        onFocusChange={(next) => changes.push(next)}
      />,
    );

    const first = cell(view, "r0", "name");
    fireEvent.focus(first);
    fireEvent.keyDown(first, { key: "ArrowUp" });
    expect(changes.at(-1)).toEqual({
      ref: { kind: "header" },
      columnId: "name",
    });

    const notPrevented = fireEvent.keyDown(headers(view)[0]!, { key: "Tab" });
    expect(notPrevented).toBe(true);
    expect(changes.at(-1)).toEqual({
      ref: { kind: "header" },
      columnId: "name",
    });

    // The positive twin: `wrap-rows` still walks in the BODY, so the release
    // above is scoped to the header rather than the mode being broken.
    //
    // The cursor has to come back down first. The release is keyed on the
    // ENGINE's focus, not on the event target — Tab fired at a body cell while
    // the cursor is still on the header is still a Tab from the header.
    fireEvent.keyDown(headers(view)[0]!, { key: "ArrowDown" });
    expect(changes.at(-1)).toEqual({
      ref: { kind: "data", rowId: "r0" },
      columnId: "name",
    });

    fireEvent.keyDown(cell(view, "r0", "name"), { key: "Tab" });
    expect(changes.at(-1)).toEqual({
      ref: { kind: "data", rowId: "r0" },
      columnId: "qty",
    });
  });

  test("Enter on the header is left to the button's own activation", async () => {
    // The surface must NOT also sort on Enter: the header cell is a real
    // <button>, so its native activation already fires the same onClick a
    // mouse user gets. Handling it here as well would sort twice per press.
    //
    // jsdom does not synthesise a click from a keydown, so a bare keyDown is
    // exactly the "did the grid sort it itself?" probe — and the probe is
    // phrased as a KEYDOWN FOLLOWED BY A CLICK, read once at the end, rather
    // than as two timed reads. `setQuery` settles asynchronously (see #321), so
    // "assert `none` immediately after the keydown" would pass whether the
    // grid sorted or not; it would merely be reading before the commit landed.
    //
    // The cycle is none -> desc -> asc, so:
    //   grid does NOT handle Enter  ->  one activation  ->  "descending"
    //   grid DOES handle Enter      ->  two activations ->  "ascending"
    const view = mount();

    const first = cell(view, "r0", "name");
    fireEvent.focus(first);
    fireEvent.keyDown(first, { key: "ArrowUp" });
    expect(headers(view)[0]!).toHaveAttribute("aria-sort", "none");

    fireEvent.keyDown(headers(view)[0]!, { key: "Enter" });
    fireEvent.click(headers(view)[0]!);

    await waitFor(() =>
      expect(headers(view)[0]!).toHaveAttribute("aria-sort", "descending"),
    );
  });
});
