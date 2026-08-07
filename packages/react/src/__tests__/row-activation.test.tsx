import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
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

  /** Reach the body the way a keyboard user does: Tab lands on a column
   *  header, Down moves into the first row. */
  function focusFirstCell(container: HTMLElement) {
    const header = container.querySelector(
      "[data-pretable-header-cell]",
    ) as HTMLElement;
    header.focus();
    fireEvent.keyDown(header, { key: "ArrowDown" });
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

  it("stays quiet when the click ends a drag across cells", () => {
    const onRowActivate = vi.fn();
    const { container } = renderGrid(onRowActivate);

    const from = cellFor(container, "a", "name");
    const to = cellFor(container, "b", "id");
    fireEvent.pointerDown(from);
    fireEvent.pointerEnter(to);
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
