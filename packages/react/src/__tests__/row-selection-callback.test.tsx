import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PretableSurface } from "../pretable-surface";

/**
 * `rowSelectionColumn` draws the checkboxes, but the checked set was only ever
 * available as raw cell ranges — spans of (startRowId, endRowId) that a
 * consumer cannot expand without knowing the rendered row order, which the grid
 * owns once sorting is applied. Bulk actions ("approve the 12 rows I ticked")
 * need the set itself.
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
  { id: "a", name: "Zulu" },
  { id: "b", name: "Alpha" },
  { id: "c", name: "Bravo" },
];

function renderGrid(onRowSelectionChange: (ids: string[]) => void) {
  return render(
    <PretableSurface<DemoRow>
      ariaLabel="Demo"
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      viewportHeight={400}
      rowSelectionColumn={{ enabled: true, headerCheckbox: true }}
      onRowSelectionChange={onRowSelectionChange}
    />,
  );
}

function rowCheckbox(container: HTMLElement, rowId: string): HTMLElement {
  const box = container.querySelector(
    `[data-pretable-row-id="${rowId}"] button[data-pretable-row-select]`,
  );
  if (!box) throw new Error(`no checkbox for row ${rowId}`);
  return box as HTMLElement;
}

function lastCall(fn: ReturnType<typeof vi.fn>): string[] {
  return fn.mock.calls.at(-1)?.[0] as string[];
}

afterEach(cleanup);

describe("onRowSelectionChange", () => {
  it("reports the checked row when a checkbox is ticked", () => {
    const onRowSelectionChange = vi.fn();
    const { container } = renderGrid(onRowSelectionChange);

    fireEvent.click(rowCheckbox(container, "b"));

    expect(lastCall(onRowSelectionChange)).toEqual(["b"]);
  });

  it("accumulates as more rows are ticked, in rendered order", () => {
    const onRowSelectionChange = vi.fn();
    const { container } = renderGrid(onRowSelectionChange);

    fireEvent.click(rowCheckbox(container, "c"));
    fireEvent.click(rowCheckbox(container, "a"));

    // Rendered order, not click order.
    expect(lastCall(onRowSelectionChange)).toEqual(["a", "c"]);
  });

  it("reports an emptied set when a row is unticked", () => {
    const onRowSelectionChange = vi.fn();
    const { container } = renderGrid(onRowSelectionChange);

    fireEvent.click(rowCheckbox(container, "b"));
    fireEvent.click(rowCheckbox(container, "b"));

    expect(lastCall(onRowSelectionChange)).toEqual([]);
  });

  it("reports every visible row for the header select-all", () => {
    const onRowSelectionChange = vi.fn();
    const { container } = renderGrid(onRowSelectionChange);

    const selectAll = container.querySelector(
      "button[data-pretable-row-select-all]",
    );
    if (!selectAll) throw new Error("no select-all checkbox");
    fireEvent.click(selectAll);

    expect(lastCall(onRowSelectionChange)).toEqual(["a", "b", "c"]);
  });

  it("follows the sorted order, not the source order", () => {
    const onRowSelectionChange = vi.fn();
    const { container } = renderGrid(onRowSelectionChange);

    const nameHeader = [
      ...container.querySelectorAll("[data-pretable-header-cell]"),
    ].find((el) => el.getAttribute("aria-label") === "Sort Name");
    if (!nameHeader) throw new Error("no Name header");
    fireEvent.click(nameHeader); // desc: Zulu, Bravo, Alpha
    fireEvent.click(nameHeader); // asc:  Alpha, Bravo, Zulu

    const selectAll = container.querySelector(
      "button[data-pretable-row-select-all]",
    );
    fireEvent.click(selectAll as HTMLElement);

    // Alpha=b, Bravo=c, Zulu=a
    expect(lastCall(onRowSelectionChange)).toEqual(["b", "c", "a"]);
  });

  it("stays quiet when a re-render does not change the checked set", () => {
    const onRowSelectionChange = vi.fn();
    const { container, rerender } = renderGrid(onRowSelectionChange);

    fireEvent.click(rowCheckbox(container, "b"));
    const callsAfterTick = onRowSelectionChange.mock.calls.length;

    rerender(
      <PretableSurface<DemoRow>
        ariaLabel="Demo"
        columns={columns}
        rows={rows.map((r) => ({ ...r }))}
        getRowId={(row) => row.id}
        viewportHeight={400}
        rowSelectionColumn={{ enabled: true, headerCheckbox: true }}
        onRowSelectionChange={onRowSelectionChange}
      />,
    );

    expect(onRowSelectionChange.mock.calls.length).toBe(callsAfterTick);
  });

  it("is optional — checkboxes still work without it", () => {
    const { container } = render(
      <PretableSurface<DemoRow>
        ariaLabel="Demo"
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        viewportHeight={400}
        rowSelectionColumn={{ enabled: true, headerCheckbox: true }}
      />,
    );

    expect(() => fireEvent.click(rowCheckbox(container, "a"))).not.toThrow();
  });
});
