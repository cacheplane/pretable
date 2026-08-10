import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ColumnFilter,
  PretableResultMeta,
  PretableSelectionState,
  PretableSortEntry,
} from "@pretable/core";

import { PretableSurface } from "../pretable-surface";
import { usePretable } from "../use-pretable";
import type { PretableSurfaceState } from "../use-pretable";

afterEach(cleanup);

type Row = { id: string; name: string };

const columns = [{ id: "name", header: "Name", widthPx: 120 }];
const q1Rows: Row[] = [
  { id: "a", name: "Ada" },
  { id: "b", name: "Bob" },
  { id: "c", name: "Cyd" },
];
/** Overlaps q1 on b and c: a stale selection can still find a row to paint. */
const q2Rows: Row[] = [
  { id: "b", name: "Bob" },
  { id: "c", name: "Cyd" },
  { id: "d", name: "Dee" },
];

function selectionOf(rowId: string): PretableSelectionState {
  return {
    ranges: [
      {
        startRowId: rowId,
        endRowId: rowId,
        startColumnId: "name",
        endColumnId: "name",
      },
    ],
    anchor: { rowId, columnId: "name" },
  };
}

function renderedRowIds(view: ReturnType<typeof render>): string[] {
  return Array.from(
    view.container.querySelectorAll<HTMLElement>("[data-pretable-row-id]"),
  ).map((node) => node.getAttribute("data-pretable-row-id") ?? "");
}

function selectedRowIds(view: ReturnType<typeof render>): string[] {
  return Array.from(
    view.container.querySelectorAll<HTMLElement>(
      '[data-pretable-row-id][data-pretable-selected="true"]',
    ),
  ).map((node) => node.getAttribute("data-pretable-row-id") ?? "");
}

function cellAt(
  view: ReturnType<typeof render>,
  rowId: string,
): HTMLElement | null {
  return view.container.querySelector<HTMLElement>(
    `[data-pretable-row-id="${rowId}"] [data-pretable-column-id="name"]`,
  );
}

/**
 * The row holding the roving tabstop, i.e. where the engine believes focus is.
 * Read from the DOM rather than the snapshot so the assertion is about what a
 * keyboard user would land on next.
 */
function focusedRowId(view: ReturnType<typeof render>): string | null {
  const cell = view.container.querySelector<HTMLElement>(
    '[data-pretable-cell][tabindex="0"]',
  );
  return (
    cell
      ?.closest("[data-pretable-row-id]")
      ?.getAttribute("data-pretable-row-id") ?? null
  );
}

function clickCell(view: ReturnType<typeof render>, rowId: string): void {
  const cell = cellAt(view, rowId);
  if (!cell) throw new Error(`no rendered cell for row ${rowId}`);
  act(() => {
    cell.focus();
    fireEvent.click(cell);
  });
}

function Harness({
  rows,
  resultMeta,
  state,
  onFiltersChange,
  onSortChange,
}: {
  rows: Row[];
  resultMeta: PretableResultMeta;
  state?: PretableSurfaceState;
  onFiltersChange?: (filters: Record<string, ColumnFilter>) => void;
  onSortChange?: (sort: PretableSortEntry[]) => void;
}) {
  return (
    <>
      {/* A focus target the surface does not own, so "the user was outside the
          grid" is a real place rather than `<body>`. */}
      <button data-testid="outside" type="button">
        Outside
      </button>
      <PretableSurface<Row>
        ariaLabel="People"
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        viewportHeight={400}
        processing={{ filter: "external", sort: "external" }}
        resultMeta={resultMeta}
        state={state}
        onFiltersChange={onFiltersChange}
        onSortChange={onSortChange}
      />
    </>
  );
}

describe("controlled selection across a dataset pivot", () => {
  const q1: PretableResultMeta = {
    datasetKey: "q1",
    total: { kind: "exact", count: 3 },
  };
  const q2: PretableResultMeta = {
    datasetKey: "q2",
    total: { kind: "exact", count: 3 },
  };

  it("keeps the pivot clear when the consumer re-asserts the previous query's selection", () => {
    // The selection object is deliberately re-passed unchanged: a consumer that
    // has not yet noticed the pivot is exactly the case `datasetKey` promises
    // to protect the user from.
    const state: PretableSurfaceState = { selection: selectionOf("b") };
    const view = render(
      <Harness rows={q1Rows} resultMeta={q1} state={state} />,
    );
    expect(selectedRowIds(view)).toEqual(["b"]);

    view.rerender(<Harness rows={q2Rows} resultMeta={q2} state={state} />);
    expect(selectedRowIds(view)).toEqual([]);
  });

  it("survives the follow-up renders the pivot's own emit triggers", () => {
    const state: PretableSurfaceState = { selection: selectionOf("b") };
    const view = render(
      <Harness rows={q1Rows} resultMeta={q1} state={state} />,
    );
    view.rerender(<Harness rows={q2Rows} resultMeta={q2} state={state} />);
    // Same props, new element identity — the parent re-rendering for its own
    // reasons must not be read as "here is a selection for the new dataset".
    view.rerender(<Harness rows={q2Rows} resultMeta={q2} state={state} />);
    expect(selectedRowIds(view)).toEqual([]);
  });

  it("accepts a selection the consumer mints for the new dataset", () => {
    const view = render(
      <Harness
        rows={q1Rows}
        resultMeta={q1}
        state={{ selection: selectionOf("b") }}
      />,
    );
    view.rerender(
      <Harness
        rows={q2Rows}
        resultMeta={q2}
        state={{ selection: selectionOf("d") }}
      />,
    );
    expect(selectedRowIds(view)).toEqual(["d"]);
  });

  it("re-arms for the next pivot", () => {
    const q3: PretableResultMeta = {
      datasetKey: "q3",
      total: { kind: "exact", count: 3 },
    };
    const afterPivot: PretableSurfaceState = { selection: selectionOf("d") };
    const view = render(
      <Harness
        rows={q1Rows}
        resultMeta={q1}
        state={{ selection: selectionOf("b") }}
      />,
    );
    view.rerender(<Harness rows={q2Rows} resultMeta={q2} state={afterPivot} />);
    expect(selectedRowIds(view)).toEqual(["d"]);
    view.rerender(<Harness rows={q2Rows} resultMeta={q3} state={afterPivot} />);
    expect(selectedRowIds(view)).toEqual([]);
  });

  it("re-asserts a controlled selection on an ordinary same-key replacement", () => {
    const state: PretableSurfaceState = { selection: selectionOf("b") };
    const view = render(
      <Harness rows={q1Rows} resultMeta={q1} state={state} />,
    );
    view.rerender(<Harness rows={[...q1Rows]} resultMeta={q1} state={state} />);
    expect(selectedRowIds(view)).toEqual(["b"]);
  });

  it("releases the latch when the slice is uncontrolled at the pivot", () => {
    // Uncontrolled means there is no re-assert to suppress, so arming against
    // the value would only mis-suppress the consumer's LATER re-assert of it.
    const held = selectionOf("b");
    const view = render(
      <Harness rows={q1Rows} resultMeta={q1} state={{ selection: held }} />,
    );
    expect(selectedRowIds(view)).toEqual(["b"]);

    // The consumer hands the slice back to the engine on the pivot render.
    view.rerender(<Harness rows={q2Rows} resultMeta={q2} state={{}} />);
    expect(selectedRowIds(view)).toEqual([]);

    // ...and takes it back later. Supplying a selection AFTER a pivot it has
    // already seen is a fresh claim about the new dataset, whatever its value.
    view.rerender(
      <Harness rows={q2Rows} resultMeta={q2} state={{ selection: held }} />,
    );
    expect(selectedRowIds(view)).toEqual(["b"]);
  });

  it("lets the user select while the latch is held", () => {
    // The latch suspends controlled authority outright, not just the re-assert
    // of the pivot-stale value: while it is held the consumer cannot force a
    // user selection back. Re-asserting is the only thing it could force back
    // TO, and that value belongs to the previous query.
    const state: PretableSurfaceState = { selection: selectionOf("b") };
    const view = render(
      <Harness rows={q1Rows} resultMeta={q1} state={state} />,
    );
    view.rerender(<Harness rows={q2Rows} resultMeta={q2} state={state} />);
    expect(selectedRowIds(view)).toEqual([]);

    clickCell(view, "d");
    view.rerender(<Harness rows={q2Rows} resultMeta={q2} state={state} />);
    expect(selectedRowIds(view)).toEqual(["d"]);
  });

  it("forces a user selection back when no latch is held", () => {
    // The contrast that makes the test above a statement about the latch
    // rather than about controlled selection in general.
    const state: PretableSurfaceState = { selection: selectionOf("b") };
    const view = render(
      <Harness rows={q1Rows} resultMeta={q1} state={state} />,
    );
    clickCell(view, "c");
    expect(selectedRowIds(view)).toEqual(["b"]);
  });
});

describe("controlled focus across a dataset pivot", () => {
  const q1: PretableResultMeta = {
    datasetKey: "q1",
    total: { kind: "exact", count: 3 },
  };
  const q2: PretableResultMeta = {
    datasetKey: "q2",
    total: { kind: "exact", count: 3 },
  };
  // `c` is in both datasets, so a focus address minted for q1 still finds a
  // row to land on in q2. Without the latch that is exactly what happens.
  const heldFocus = { rowId: "c", columnId: "name" };

  it("keeps the pivot's focus move when the consumer re-asserts the previous query's focus", () => {
    const state: PretableSurfaceState = { focus: heldFocus };
    const view = render(
      <Harness rows={q1Rows} resultMeta={q1} state={state} />,
    );
    expect(focusedRowId(view)).toBe("c");

    // Stated rather than relied on: the pivot's focus move is conditional on
    // the user being in the grid, and asserting the move means putting them
    // there. The cell is the one the controlled focus already names, so this
    // changes no engine state on the way in.
    const held = cellAt(view, "c");
    act(() => held?.focus());

    view.rerender(<Harness rows={q2Rows} resultMeta={q2} state={state} />);
    // First row of the new result, matching the uncontrolled behavior pinned
    // in lifecycle-announcements.test.tsx.
    expect(focusedRowId(view)).toBe("b");
  });

  it("takes nothing when the user was outside the grid at the pivot", () => {
    const state: PretableSurfaceState = { focus: heldFocus };
    const view = render(
      <Harness rows={q1Rows} resultMeta={q1} state={state} />,
    );
    // Asserting a controlled focus moves DOM focus into the grid, so leaving
    // the grid is a deliberate act here rather than the starting state.
    const outside = view.getByTestId("outside");
    act(() => outside.focus());

    view.rerender(<Harness rows={q2Rows} resultMeta={q2} state={state} />);
    expect(focusedRowId(view)).toBeNull();
    expect(document.activeElement).toBe(outside);
  });

  it("accepts a focus address the consumer mints for the new dataset", () => {
    const view = render(
      <Harness rows={q1Rows} resultMeta={q1} state={{ focus: heldFocus }} />,
    );
    view.rerender(
      <Harness
        rows={q2Rows}
        resultMeta={q2}
        state={{ focus: { rowId: "d", columnId: "name" } }}
      />,
    );
    expect(focusedRowId(view)).toBe("d");
  });

  it("releases the latch when the slice is uncontrolled at the pivot", () => {
    const view = render(
      <Harness rows={q1Rows} resultMeta={q1} state={{ focus: heldFocus }} />,
    );
    view.rerender(<Harness rows={q2Rows} resultMeta={q2} state={{}} />);
    view.rerender(
      <Harness rows={q2Rows} resultMeta={q2} state={{ focus: heldFocus }} />,
    );
    expect(focusedRowId(view)).toBe("c");
  });

  it("re-asserts a controlled focus on an ordinary same-key replacement", () => {
    const state: PretableSurfaceState = { focus: heldFocus };
    const view = render(
      <Harness rows={q1Rows} resultMeta={q1} state={state} />,
    );
    view.rerender(<Harness rows={[...q1Rows]} resultMeta={q1} state={state} />);
    expect(focusedRowId(view)).toBe("c");
  });
});

describe("callback loops under external authority (D1-GRID-09)", () => {
  const filters: Record<string, ColumnFilter> = {
    name: { operator: "contains", value: "A" },
  };
  const sort: PretableSortEntry[] = [{ columnId: "name", direction: "asc" }];

  it("stays quiet through a setRows round trip", () => {
    const onFiltersChange = vi.fn();
    const onSortChange = vi.fn();
    const state: PretableSurfaceState = { filters, sort };
    const view = render(
      <Harness
        rows={q1Rows}
        resultMeta={{ datasetKey: "q1", total: { kind: "exact", count: 90 } }}
        state={state}
        onFiltersChange={onFiltersChange}
        onSortChange={onSortChange}
      />,
    );
    // The server answering the query the callbacks already reported. If the
    // engine mirrored its own re-assert back out, the consumer would refetch
    // for a filter nobody touched — one poll tick per poll tick, forever.
    view.rerender(
      <Harness
        rows={q2Rows}
        resultMeta={{ datasetKey: "q1", total: { kind: "exact", count: 90 } }}
        state={state}
        onFiltersChange={onFiltersChange}
        onSortChange={onSortChange}
      />,
    );
    expect(onFiltersChange).not.toHaveBeenCalled();
    expect(onSortChange).not.toHaveBeenCalled();
    // The round trip has to have happened for the silence to mean anything.
    expect(renderedRowIds(view)).toEqual(["b", "c", "d"]);
  });

  it("stays quiet through a meta-only setResultMeta update", () => {
    const onFiltersChange = vi.fn();
    const onSortChange = vi.fn();
    const state: PretableSurfaceState = { filters, sort };
    const view = render(
      <Harness
        rows={q1Rows}
        resultMeta={{ datasetKey: "q1", total: { kind: "unknown" } }}
        state={state}
        onFiltersChange={onFiltersChange}
        onSortChange={onSortChange}
      />,
    );
    view.rerender(
      <Harness
        rows={q1Rows}
        resultMeta={{ datasetKey: "q1", total: { kind: "exact", count: 90 } }}
        state={state}
        onFiltersChange={onFiltersChange}
        onSortChange={onSortChange}
      />,
    );
    expect(onFiltersChange).not.toHaveBeenCalled();
    expect(onSortChange).not.toHaveBeenCalled();
  });

  it("emits nothing when the controlled state re-asserts unchanged values", () => {
    // Counted at the engine's subscribe port rather than through the DOM: the
    // convergence claim in `use-pretable` is that the re-assert is a no-op at
    // the source, and a render count would also move for reasons that are not
    // this one.
    let emits = 0;
    function EmitCounter({ state }: { state: PretableSurfaceState }) {
      const { grid } = usePretable<Row>({
        columns,
        rows: q1Rows,
        getRowId: (row) => row.id,
        processing: { filter: "external", sort: "external" },
        resultMeta: { datasetKey: "q1", total: { kind: "exact", count: 90 } },
        state,
        viewportHeight: 400,
      });
      React.useEffect(
        () =>
          grid.subscribe(() => {
            emits += 1;
          }),
        [grid],
      );
      return null;
    }

    const state: PretableSurfaceState = { filters, sort };
    const view = render(<EmitCounter state={state} />);
    emits = 0;
    view.rerender(<EmitCounter state={state} />);
    view.rerender(<EmitCounter state={{ filters: { ...filters }, sort }} />);
    expect(emits).toBe(0);

    // A subscription that never fires would satisfy the assertion above for
    // the wrong reason.
    view.rerender(
      <EmitCounter
        state={{
          filters: { name: { operator: "contains", value: "B" } },
          sort,
        }}
      />,
    );
    expect(emits).toBeGreaterThan(0);
  });
});
