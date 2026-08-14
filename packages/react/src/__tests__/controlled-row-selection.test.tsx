import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createColumnHelper, describeRowSelection } from "@pretable/core";
import type { PretableRowSelectionState } from "@pretable/core";
import { PretableSurface, type PretableSurfaceGrid } from "../pretable-surface";
import type { PretableSelectionFor } from "../surface-types";

/**
 * `state.rowSelection` — the checkbox slice, made settable.
 *
 * Every other UI slice could be driven from outside: `query`, `selection`,
 * `focus`, the column layout. The checked set could only be READ, through
 * `onRowSelectionChange` and the grid handle, so there was no restoring a saved
 * selection, no "tick everything matching this filter", and no undo. The docs
 * said so in as many words: "There is no `state.rowSelection` counterpart in
 * v1. The checked set is engine-owned and read-only from the outside."
 *
 * Two things are easy to lose here and are each pinned below.
 *
 * The first is SPARSENESS. The engine stores select-all symbolically, so a
 * million-row grid pays nothing for it; a controlled shape that could only say
 * "these ids" would have made the feature cost a million ids to use.
 * `packages/grid-core/src/__tests__/set-row-selection.test.ts` carries the
 * asymptotic half of that proof over 500k rows; this file pins that the surface
 * hands the symbol through rather than flattening it on the way.
 *
 * The second is SETTLING. `onRowSelectionChange` fires from an effect, one
 * render after the gesture that caused it — unlike `onSelectionChange`, which
 * fires from the click. A controlled slice re-asserted on every render would
 * therefore keep overwriting the tick the user just made with the value the
 * consumer had not echoed yet, and the callback would report the overwrite, and
 * the consumer would echo THAT. The pair oscillates rather than settles.
 */

type DemoRow = { id: string; name: string; city: string };

const column = createColumnHelper<DemoRow>();
const columns = [
  column.accessor("name", { type: "text", header: "Name" }),
  column.accessor("city", { type: "text", header: "City" }),
] as const;

const rows: DemoRow[] = [
  { id: "a", name: "Zulu", city: "Oslo" },
  { id: "b", name: "Alpha", city: "Lima" },
  { id: "c", name: "Bravo", city: "Kyiv" },
];

function rowCheckbox(container: HTMLElement, rowId: string): HTMLElement {
  const box = container.querySelector(
    `[data-pretable-row-id="${rowId}"] button[data-pretable-row-select]`,
  );
  if (!box) throw new Error(`no checkbox for row ${rowId}`);
  return box as HTMLElement;
}

function checkedState(container: HTMLElement, rowId: string): string | null {
  return rowCheckbox(container, rowId).getAttribute("aria-checked");
}

function bodyCell(
  container: HTMLElement,
  rowId: string,
  columnId: string,
): HTMLElement {
  const cell = container.querySelector(
    `[data-pretable-row-id="${rowId}"] [data-pretable-column-id="${columnId}"]`,
  );
  if (!cell) throw new Error(`no cell ${columnId}@${rowId}`);
  return cell as HTMLElement;
}

/** A grid whose checkbox slice is driven entirely from the outside. */
function ControlledRowSelection({
  initial,
  echo = true,
  onRowSelectionChange,
  onSelectionChange,
  onRender,
  onGridReady,
}: {
  initial: PretableRowSelectionState<string>;
  /** Feed the callback's ids back into the controlled value — the round trip. */
  echo?: boolean;
  onRowSelectionChange?: (rowIds: string[]) => void;
  onSelectionChange?: (next: PretableSelectionFor<typeof columns>) => void;
  onRender?: () => void;
  onGridReady?: (
    grid: PretableSurfaceGrid<DemoRow, string, typeof columns>,
  ) => void;
}) {
  const [rowSelection, setRowSelection] =
    React.useState<PretableRowSelectionState<string>>(initial);
  // Re-renders the consumer with the controlled value untouched — an unrelated
  // piece of application state moving, which happens constantly in real apps.
  const [, bump] = React.useState(0);
  onRender?.();
  return (
    <>
      <button
        data-testid="bump"
        onClick={() => bump((n) => n + 1)}
        type="button"
      >
        bump
      </button>
      <button
        data-testid="select-all"
        onClick={() => setRowSelection({ kind: "all" })}
        type="button"
      >
        select all
      </button>
      <button
        data-testid="clear"
        onClick={() => setRowSelection({ kind: "explicit", rowIds: [] })}
        type="button"
      >
        clear
      </button>
      <PretableSurface
        ariaLabel="Controlled row selection"
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        viewportHeight={400}
        rowSelectionColumn={{ enabled: true }}
        state={{ rowSelection }}
        onRowSelectionChange={(rowIds) => {
          onRowSelectionChange?.(rowIds);
          if (echo) setRowSelection({ kind: "explicit", rowIds });
        }}
        {...(onSelectionChange ? { onSelectionChange } : {})}
        {...(onGridReady ? { onGridReady } : {})}
      />
    </>
  );
}

afterEach(cleanup);

describe("state.rowSelection", () => {
  it("ticks the rows the consumer names", () => {
    // The failure this feature exists to fix. Before `state.rowSelection`, the
    // prop did not exist and every checkbox rendered unticked no matter what
    // the consumer held.
    const { container } = render(
      <ControlledRowSelection
        initial={{ kind: "explicit", rowIds: ["b"] }}
        echo={false}
      />,
    );

    expect(checkedState(container, "b")).toBe("true");
    expect(checkedState(container, "a")).toBe("false");
    expect(checkedState(container, "c")).toBe("false");
  });

  it("unticks a row the consumer drops", () => {
    // The positive twin's negative half: an implementation that only ever adds
    // ticks would satisfy the test above and none of the restore/undo cases the
    // slice exists for.
    const { container, getByTestId } = render(
      <ControlledRowSelection
        initial={{ kind: "explicit", rowIds: ["b"] }}
        echo={false}
      />,
    );
    expect(checkedState(container, "b")).toBe("true");

    fireEvent.click(getByTestId("clear"));

    expect(checkedState(container, "b")).toBe("false");
  });

  it("ticks every row from a symbolic all, without naming one", () => {
    const grids: PretableSurfaceGrid<DemoRow, string, typeof columns>[] = [];
    const { container, getByTestId } = render(
      <ControlledRowSelection
        initial={{ kind: "explicit", rowIds: [] }}
        echo={false}
        onGridReady={(grid) => grids.push(grid)}
      />,
    );

    fireEvent.click(getByTestId("select-all"));

    expect(checkedState(container, "a")).toBe("true");
    expect(checkedState(container, "b")).toBe("true");
    expect(checkedState(container, "c")).toBe("true");
    // The load-bearing half: the surface passed the SYMBOL through. Had it
    // expanded `{ kind: "all" }` into the three ids on the way in, the
    // checkboxes above would look identical and a million-row grid would pay a
    // million ids for the same click.
    const rowSelection = grids.at(-1)?.getState().selection.rows;
    expect(rowSelection?.kind).toBe("all");
    expect(describeRowSelection(rowSelection!)).toEqual({ kind: "all" });
  });

  it("keeps a shift-checked span symbolic when it is handed back in", () => {
    const grids: PretableSurfaceGrid<DemoRow, string, typeof columns>[] = [];
    const { container } = render(
      <ControlledRowSelection
        initial={{
          kind: "explicit",
          rowIds: [],
          ranges: [{ startRowId: "a", endRowId: "c" }],
        }}
        echo={false}
        onGridReady={(grid) => grids.push(grid)}
      />,
    );

    expect(checkedState(container, "a")).toBe("true");
    expect(checkedState(container, "b")).toBe("true");
    expect(checkedState(container, "c")).toBe("true");
    const rowSelection = grids.at(-1)?.getState().selection.rows;
    expect(describeRowSelection(rowSelection!)).toEqual({
      kind: "explicit",
      rowIds: [],
      ranges: [{ startRowId: "a", endRowId: "c" }],
    });
  });

  it("reaches rows that arrive after it was set", async () => {
    // A request only means something against the rows the grid currently has:
    // ids it cannot see are dropped, and "all" over an empty grid is nothing at
    // all. So the value is re-applied when the row model publishes as well as
    // when the value changes — otherwise a grid that streams its rows in would
    // keep whatever the request happened to mean at mount, forever.
    function StreamingGrid({ visible }: { visible: DemoRow[] }) {
      return (
        <PretableSurface
          ariaLabel="Streaming"
          columns={columns}
          rows={visible}
          getRowId={(row) => row.id}
          viewportHeight={400}
          rowSelectionColumn={{ enabled: true }}
          state={{ rowSelection: { kind: "all" } }}
        />
      );
    }
    const { container, rerender } = render(
      <StreamingGrid visible={[rows[0]!]} />,
    );
    expect(checkedState(container, "a")).toBe("true");

    rerender(<StreamingGrid visible={rows} />);

    await waitFor(() => expect(checkedState(container, "b")).toBe("true"));
    expect(checkedState(container, "c")).toBe("true");
    expect(checkedState(container, "a")).toBe("true");
  });

  it("excludes a named row from a symbolic all", () => {
    const { container } = render(
      <ControlledRowSelection
        initial={{ kind: "all", excludedRowIds: ["b"] }}
        echo={false}
      />,
    );

    expect(checkedState(container, "a")).toBe("true");
    expect(checkedState(container, "b")).toBe("false");
    expect(checkedState(container, "c")).toBe("true");
  });
});

describe("the round trip", () => {
  it("settles after a user tick, with one report and no drift", () => {
    const onRowSelectionChange = vi.fn();
    const onRender = vi.fn();
    const { container } = render(
      <ControlledRowSelection
        initial={{ kind: "explicit", rowIds: ["b"] }}
        onRowSelectionChange={onRowSelectionChange}
        onRender={onRender}
      />,
    );
    expect(checkedState(container, "b")).toBe("true");
    const rendersBefore = onRender.mock.calls.length;

    fireEvent.click(rowCheckbox(container, "a"));

    // Reported once, with the whole checked set in rendered order — and never
    // with an intermediate value. A slice re-asserted on every render reports
    // `["b"]` back at the consumer first, because the stale controlled value
    // overwrites the tick before the callback runs.
    expect(onRowSelectionChange.mock.calls).toEqual([[["a", "b"]]]);
    expect(checkedState(container, "a")).toBe("true");
    expect(checkedState(container, "b")).toBe("true");
    // Settled: feeding the reported value back changes nothing, so the
    // consumer re-renders a bounded number of times rather than forever.
    expect(onRender.mock.calls.length - rendersBefore).toBeLessThan(6);
  });

  it("settles after an untick too", () => {
    const onRowSelectionChange = vi.fn();
    const { container } = render(
      <ControlledRowSelection
        initial={{ kind: "explicit", rowIds: ["a", "b"] }}
      />,
    );

    fireEvent.click(rowCheckbox(container, "a"));

    expect(checkedState(container, "a")).toBe("false");
    expect(checkedState(container, "b")).toBe("true");
    expect(onRowSelectionChange).not.toHaveBeenCalled();
  });

  it("does not undo a user tick when the consumer re-renders with the same value", () => {
    // The reason this slice is applied on CHANGE rather than on every render.
    //
    // `onRowSelectionChange` fires from an effect, so between the click and the
    // consumer's echo there is a window where the controlled value is one
    // generation stale. Any re-render landing in that window — a parent, a
    // timer, an unrelated piece of state — would re-assert the stale value and
    // untick the row the user just ticked. And it would do it SILENTLY: the
    // callback compares against the value it last reported, which is exactly
    // the one that got written back, so nothing would tell the consumer that
    // the gesture had been eaten.
    //
    // `echo={false}` holds that window open for the length of the test.
    const { container, getByTestId } = render(
      <ControlledRowSelection
        initial={{ kind: "explicit", rowIds: ["b"] }}
        echo={false}
      />,
    );
    fireEvent.click(rowCheckbox(container, "a"));
    expect(checkedState(container, "a")).toBe("true");

    fireEvent.click(getByTestId("bump"));

    expect(checkedState(container, "a")).toBe("true");
    expect(checkedState(container, "b")).toBe("true");
  });

  it("still applies a value the consumer DOES change after a user tick", () => {
    // The negative twin of the test above: applying on change must be a
    // deferral, not a latch. The consumer's next value wins over whatever the
    // user did in between, or the slice would stop being controlled after the
    // first gesture.
    const { container, getByTestId } = render(
      <ControlledRowSelection
        initial={{ kind: "explicit", rowIds: ["b"] }}
        echo={false}
      />,
    );
    fireEvent.click(rowCheckbox(container, "a"));
    expect(checkedState(container, "a")).toBe("true");

    fireEvent.click(getByTestId("clear"));

    expect(checkedState(container, "a")).toBe("false");
    expect(checkedState(container, "b")).toBe("false");
  });

  it("survives a re-render that changes nothing", () => {
    const onRowSelectionChange = vi.fn();
    const { container, rerender } = render(
      <ControlledRowSelection
        initial={{ kind: "explicit", rowIds: ["b"] }}
        onRowSelectionChange={onRowSelectionChange}
      />,
    );
    fireEvent.click(rowCheckbox(container, "a"));
    const callsAfterTick = onRowSelectionChange.mock.calls.length;

    rerender(
      <ControlledRowSelection
        initial={{ kind: "explicit", rowIds: ["b"] }}
        onRowSelectionChange={onRowSelectionChange}
      />,
    );

    expect(onRowSelectionChange.mock.calls.length).toBe(callsAfterTick);
    expect(checkedState(container, "a")).toBe("true");
  });
});

describe("the slices stay separate while rowSelection is controlled", () => {
  it("still does not fire onSelectionChange when a checkbox is ticked", () => {
    // Corrected recently and easy to regress from here: the checkbox drives the
    // row slice and only that, so there is no cell-range change to report.
    const onSelectionChange = vi.fn();
    const onRowSelectionChange = vi.fn();
    const { container } = render(
      <ControlledRowSelection
        initial={{ kind: "explicit", rowIds: [] }}
        onRowSelectionChange={onRowSelectionChange}
        onSelectionChange={onSelectionChange}
      />,
    );

    fireEvent.click(rowCheckbox(container, "b"));

    // The positive half, so deleting the checkbox handler cannot satisfy the
    // silence below.
    expect(onRowSelectionChange.mock.calls.at(-1)?.[0]).toEqual(["b"]);
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it("still reports cell clicks through onSelectionChange", () => {
    const onSelectionChange = vi.fn();
    const { container } = render(
      <ControlledRowSelection
        initial={{ kind: "explicit", rowIds: ["b"] }}
        onSelectionChange={onSelectionChange}
      />,
    );

    fireEvent.click(bodyCell(container, "c", "city"));

    expect(onSelectionChange.mock.calls.at(-1)?.[0].ranges).toEqual([
      {
        startRowId: "c",
        endRowId: "c",
        startColumnId: "city",
        endColumnId: "city",
      },
    ]);
    // ...and the controlled checkbox slice is untouched by the cell gesture.
    expect(checkedState(container, "b")).toBe("true");
  });

  it("leaves the checkboxes uncontrolled when the slice is omitted", () => {
    // The old behaviour, still the default: omit `rowSelection` and the engine
    // owns it exactly as before.
    const onRowSelectionChange = vi.fn();
    const { container } = render(
      <PretableSurface
        ariaLabel="Uncontrolled"
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        viewportHeight={400}
        rowSelectionColumn={{ enabled: true }}
        onRowSelectionChange={onRowSelectionChange}
      />,
    );

    fireEvent.click(rowCheckbox(container, "b"));

    expect(checkedState(container, "b")).toBe("true");
    expect(onRowSelectionChange.mock.calls.at(-1)?.[0]).toEqual(["b"]);
  });
});
