import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createColumnHelper } from "@pretable/core";
import { PretableSurface } from "../pretable-surface";
import type { PretableSelectionFor } from "../surface-types";

/**
 * The surface keeps TWO selection slices, and this file is where the boundary
 * between them is written down.
 *
 * `PretableSelectionFor` — the type behind `state.selection` and
 * `onSelectionChange` — is cell ranges plus an anchor. The
 * `rowSelectionColumn` checkboxes are a different slice: a sparse row-selection
 * program that can hold "all rows" symbolically, without materializing a row id
 * per row. A list of (start, end) cell addresses cannot express that, so the
 * checkbox gesture has its own callback, `onRowSelectionChange`.
 *
 * Nothing pinned that split, and the docs had drifted to the opposite claim —
 * that the checkbox "toggles the row's full-row range" and shows up in the same
 * controlled `PretableSelectionFor`. Following the docs produced a grid whose
 * checkboxes appeared dead to the application: they tick, but the controlled
 * state they were supposed to feed never moves.
 *
 * Every test here therefore states one half of the boundary AND its positive
 * twin, so a future change cannot satisfy the silence assertions by breaking
 * selection outright.
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

const EMPTY_SELECTION: PretableSelectionFor<typeof columns> = {
  ranges: [],
  anchor: null,
};

type Handlers = {
  onSelectionChange?: (next: PretableSelectionFor<typeof columns>) => void;
  onRowSelectionChange?: (rowIds: string[]) => void;
};

/**
 * The shape `content/docs/grid/selection.mdx` teaches: a hand-declared
 * `useState<PretableSelectionFor<typeof columns>>` threaded through
 * `state.selection` and `onSelectionChange`, alongside the checkbox column.
 */
function ControlledGrid({
  onSelectionChange,
  onRowSelectionChange,
  rowSelectionColumn = true,
}: Handlers & { rowSelectionColumn?: boolean }) {
  const [selection, setSelection] =
    React.useState<PretableSelectionFor<typeof columns>>(EMPTY_SELECTION);
  const gridRef = React.useRef<{ clearSelection: () => void } | null>(null);
  // Forces a consumer re-render on demand — the moment the controlled
  // `state.selection` is written back into the engine.
  const [, bump] = React.useState(0);
  return (
    <>
      {/* The three "Clear" buttons an application might plausibly wire up. */}
      <button
        data-testid="clear-ranges"
        onClick={() => setSelection(EMPTY_SELECTION)}
        type="button"
      >
        clear ranges
      </button>
      <button
        data-testid="clear-engine"
        onClick={() => {
          gridRef.current?.clearSelection();
          bump((n) => n + 1);
        }}
        type="button"
      >
        clear engine
      </button>
      <button
        data-testid="clear-both"
        onClick={() => {
          gridRef.current?.clearSelection();
          setSelection(EMPTY_SELECTION);
        }}
        type="button"
      >
        clear both
      </button>
      <PretableSurface
        ariaLabel="Demo"
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        viewportHeight={400}
        {...(rowSelectionColumn
          ? { rowSelectionColumn: { enabled: true } }
          : {})}
        state={{ selection }}
        onSelectionChange={(next) => {
          setSelection(next);
          onSelectionChange?.(next);
        }}
        {...(onRowSelectionChange ? { onRowSelectionChange } : {})}
        onGridReady={(grid) => {
          gridRef.current = grid;
        }}
      />
    </>
  );
}

function UncontrolledGrid({
  onSelectionChange,
  onRowSelectionChange,
}: Handlers) {
  return (
    <PretableSurface
      ariaLabel="Demo"
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      viewportHeight={400}
      rowSelectionColumn={{ enabled: true }}
      {...(onSelectionChange ? { onSelectionChange } : {})}
      {...(onRowSelectionChange ? { onRowSelectionChange } : {})}
    />
  );
}

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

function selectedCells(container: HTMLElement): number {
  return container.querySelectorAll('[data-pretable-selected="true"]').length;
}

function cellSelected(
  container: HTMLElement,
  rowId: string,
  columnId: string,
): string | null {
  return bodyCell(container, rowId, columnId).getAttribute(
    "data-pretable-selected",
  );
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

afterEach(cleanup);

describe("the row-checkbox slice and the cell-range slice", () => {
  it("routes a checkbox tick to onRowSelectionChange, not onSelectionChange", () => {
    const onSelectionChange = vi.fn();
    const onRowSelectionChange = vi.fn();
    const { container } = render(
      <ControlledGrid
        onSelectionChange={onSelectionChange}
        onRowSelectionChange={onRowSelectionChange}
      />,
    );

    fireEvent.click(rowCheckbox(container, "b"));

    // The positive half. Without it, deleting the checkbox handler outright
    // would satisfy the assertion below.
    expect(onRowSelectionChange.mock.calls.at(-1)?.[0]).toEqual(["b"]);
    // The boundary. `toggleRowSelection` moves the `rows` slice and nothing
    // else, so the only cell-range selection this could report is the one the
    // consumer already holds — an unchanged value announced as a change.
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it("still ticks the checkbox while the selection slice is controlled", () => {
    const { container } = render(<ControlledGrid />);

    expect(checkedState(container, "b")).toBe("false");
    fireEvent.click(rowCheckbox(container, "b"));

    // The controlled `state.selection` write-back runs on every render and
    // must carry the engine's `rows` slice through untouched; if it reset it,
    // the checkbox would untick itself on the very next render.
    expect(checkedState(container, "b")).toBe("true");
    expect(checkedState(container, "a")).toBe("false");
  });

  it("keeps a checkbox ticked across a later cell selection", () => {
    const { container } = render(<ControlledGrid />);

    fireEvent.click(rowCheckbox(container, "b"));
    fireEvent.click(bodyCell(container, "a", "name"));

    expect(checkedState(container, "b")).toBe("true");
  });

  it("still reports cell clicks through onSelectionChange when controlled", () => {
    const onSelectionChange = vi.fn();
    const { container } = render(
      <ControlledGrid onSelectionChange={onSelectionChange} />,
    );

    fireEvent.click(bodyCell(container, "b", "name"));

    expect(onSelectionChange.mock.calls.at(-1)?.[0].ranges).toEqual([
      {
        startRowId: "b",
        endRowId: "b",
        startColumnId: "name",
        endColumnId: "name",
      },
    ]);
  });

  it("still reports cell clicks when the selection slice is uncontrolled", () => {
    const onSelectionChange = vi.fn();
    const { container } = render(
      <UncontrolledGrid onSelectionChange={onSelectionChange} />,
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
  });

  it("still reports cell clicks with no rowSelectionColumn at all", () => {
    const onSelectionChange = vi.fn();
    const { container } = render(
      <ControlledGrid
        onSelectionChange={onSelectionChange}
        rowSelectionColumn={false}
      />,
    );

    expect(
      container.querySelector("button[data-pretable-row-select]"),
    ).toBeNull();
    fireEvent.click(bodyCell(container, "a", "city"));

    expect(onSelectionChange.mock.calls.at(-1)?.[0].ranges).toEqual([
      {
        startRowId: "a",
        endRowId: "a",
        startColumnId: "city",
        endColumnId: "city",
      },
    ]);
  });

  it("selects a cell range spanning every column, which ticks the checkbox", () => {
    const { container } = render(<ControlledGrid />);

    fireEvent.click(bodyCell(container, "b", "name"));
    fireEvent.click(bodyCell(container, "b", "city"), { shiftKey: true });

    // The one direction the two slices do meet: the tri-state derivation reads
    // full-row coverage out of the cell ranges as well as out of `rows`.
    expect(checkedState(container, "b")).toBe("true");
    expect(checkedState(container, "a")).toBe("false");
  });

  it("does not untick checkboxes when the controlled selection is reset", () => {
    const { container, getByTestId } = render(<ControlledGrid />);

    fireEvent.click(rowCheckbox(container, "b"));
    fireEvent.click(bodyCell(container, "a", "name"));
    fireEvent.click(getByTestId("clear-ranges"));

    // Writing the empty selection clears the CELL ranges and nothing else —
    // `state.selection` has no way to say anything about the checked set.
    // `content/docs/grid/selection.mdx` says so, and this is the test behind
    // that sentence. If the row slice ever becomes controllable, this
    // expectation is the one to rewrite, not to work around.
    expect(cellSelected(container, "a", "name")).toBe("false");
    expect(checkedState(container, "b")).toBe("true");
  });

  it("empties both slices via the documented clearSelection() + reset pair", () => {
    // `content/docs/grid/selection.mdx` sends readers to the grid handle's
    // `clearSelection()` as the one way to empty both slices, and tells a
    // CONTROLLED consumer to clear its own state in the same handler. This is
    // that snippet, asserted rather than asserted about.
    const { container, getByTestId } = render(<ControlledGrid />);

    fireEvent.click(rowCheckbox(container, "b"));
    fireEvent.click(bodyCell(container, "a", "name"));
    expect(checkedState(container, "b")).toBe("true");
    expect(cellSelected(container, "a", "name")).toBe("true");

    fireEvent.click(getByTestId("clear-both"));

    expect(checkedState(container, "b")).toBe("false");
    expect(selectedCells(container)).toBe(0);
  });

  it("restores the controlled ranges if only clearSelection() is called", () => {
    // The negative twin of the test above, and the reason its docs paragraph
    // does not stop at "call clearSelection()". `clearSelection()` reaches the
    // ENGINE; the controlled `state.selection` is force-written back on the
    // consumer's next render, so the cell ranges return. The row ticks, which
    // `state.selection` cannot describe, stay gone.
    const { container, getByTestId } = render(<ControlledGrid />);

    fireEvent.click(rowCheckbox(container, "b"));
    fireEvent.click(bodyCell(container, "a", "name"));
    // Calls `clearSelection()` and then re-renders the consumer for an
    // unrelated reason, which is all it takes.
    fireEvent.click(getByTestId("clear-engine"));

    expect(checkedState(container, "b")).toBe("false");
    expect(cellSelected(container, "a", "name")).toBe("true");
  });
});
