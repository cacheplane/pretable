import "@testing-library/jest-dom/vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { createColumnHelper } from "@pretable/core";
import { PretableSurface } from "../pretable-surface";
import type { PretableSurfaceState } from "../surface-types";

/**
 * The controlled write-back — the `useLayoutEffect` in `pretable-surface.tsx`
 * that pushes each `state.*` slice into the engine.
 *
 * Every slice here used to be applied through an `as never` cast, which is
 * assignable to ANYTHING: the compiler could not tell whether the value being
 * written still matched what the engine accepts, and no test asserted that a
 * slice reached the engine at all. Deleting a whole `if (state.x !== undefined)`
 * branch would have left the suite green.
 *
 * So this file is deliberately positive: for each slice it asserts the DRAWN
 * result changed because the prop was supplied, not merely that a callback
 * fired or that a type lined up. Each assertion was mutation-checked by
 * deleting its branch from the write-back; see the commit message.
 */

type Row = { id: string; name: string; city: string; score: number };

const column = createColumnHelper<Row>();
const columns = [
  column.accessor("name", { type: "text", header: "Name", widthPx: 100 }),
  column.accessor("city", { type: "text", header: "City", widthPx: 100 }),
  column.accessor("score", { type: "number", header: "Score", widthPx: 100 }),
] as const;

const rows: Row[] = [
  { id: "a", name: "Zulu", city: "Oslo", score: 3 },
  { id: "b", name: "Alpha", city: "Lima", score: 1 },
  { id: "c", name: "Bravo", city: "Kyiv", score: 2 },
];

afterEach(cleanup);

// The row-select header deliberately carries no `data-pretable-column-id` (it
// is a synthetic UI column, not a data column), so it is identified by its own
// marker attribute instead.
function headerIds(container: HTMLElement): string[] {
  return [
    ...container.querySelectorAll<HTMLElement>("[data-pretable-header-cell]"),
  ].map((el) =>
    el.hasAttribute("data-pretable-row-select-header")
      ? "__pretable_row_select__"
      : (el.dataset["pretableColumnId"] ?? "?"),
  );
}

function headerCell(container: HTMLElement, columnId: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(
    `[data-pretable-header-cell][data-pretable-column-id="${columnId}"]`,
  );
  if (el === null) throw new Error(`no header cell for ${columnId}`);
  return el;
}

function focusedCell(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    '[data-pretable-cell][data-pretable-focused="true"]',
  );
}

function selectedCellKeys(container: HTMLElement): string[] {
  return [
    ...container.querySelectorAll<HTMLElement>(
      '[data-pretable-cell][data-pretable-selected="true"]',
    ),
  ].map(
    (el) =>
      `${el.closest<HTMLElement>("[data-pretable-row-id]")?.dataset["pretableRowId"] ?? "?"}:${el.dataset["pretableColumnId"] ?? "?"}`,
  );
}

function renderControlled(state: PretableSurfaceState<string, typeof columns>) {
  return render(
    <PretableSurface
      ariaLabel="controlled"
      columns={columns}
      getRowId={(row: Row) => row.id}
      overscan={0}
      rows={rows}
      state={state}
      viewportHeight={300}
    />,
  );
}

describe("controlled write-back", () => {
  it("applies state.focus to the engine", async () => {
    const { container } = renderControlled({
      focus: { ref: { kind: "data", rowId: "b" }, columnId: "city" },
    });
    await waitFor(() => {
      const cell = focusedCell(container);
      expect(cell).not.toBeNull();
      expect(cell!.dataset["pretableColumnId"]).toBe("city");
      expect(
        cell!.closest<HTMLElement>("[data-pretable-row-id]")?.dataset[
          "pretableRowId"
        ],
      ).toBe("b");
    });
  });

  it("re-applies state.focus when the controlled value changes", async () => {
    const { container, rerender } = renderControlled({
      focus: { ref: { kind: "data", rowId: "a" }, columnId: "name" },
    });
    await waitFor(() => {
      expect(focusedCell(container)?.dataset["pretableColumnId"]).toBe("name");
    });
    rerender(
      <PretableSurface
        ariaLabel="controlled"
        columns={columns}
        getRowId={(row: Row) => row.id}
        overscan={0}
        rows={rows}
        state={{
          focus: { ref: { kind: "data", rowId: "c" }, columnId: "score" },
        }}
        viewportHeight={300}
      />,
    );
    await waitFor(() => {
      const cell = focusedCell(container);
      expect(cell?.dataset["pretableColumnId"]).toBe("score");
      expect(
        cell?.closest<HTMLElement>("[data-pretable-row-id]")?.dataset[
          "pretableRowId"
        ],
      ).toBe("c");
    });
  });

  it("applies state.selection ranges to the engine", async () => {
    const { container } = renderControlled({
      selection: {
        anchor: { rowId: "a", columnId: "name" },
        ranges: [
          {
            startRowId: "a",
            endRowId: "b",
            startColumnId: "name",
            endColumnId: "city",
          },
        ],
      },
    });
    await waitFor(() => {
      expect(selectedCellKeys(container).sort()).toEqual([
        "a:city",
        "a:name",
        "b:city",
        "b:name",
      ]);
    });
  });

  it("applies state.rowSelection to the engine", async () => {
    const { container } = render(
      <PretableSurface
        ariaLabel="controlled"
        columns={columns}
        getRowId={(row: Row) => row.id}
        overscan={0}
        rows={rows}
        rowSelectionColumn={{ enabled: true }}
        state={{ rowSelection: { kind: "explicit", rowIds: ["a", "c"] } }}
        viewportHeight={300}
      />,
    );
    await waitFor(() => {
      const checked = [
        ...container.querySelectorAll<HTMLElement>(
          "button[data-pretable-row-select]",
        ),
      ]
        .filter((el) => el.getAttribute("aria-checked") === "true")
        .map(
          (el) =>
            el.closest<HTMLElement>("[data-pretable-row-id]")?.dataset[
              "pretableRowId"
            ] ?? "?",
        );
      expect(checked.sort()).toEqual(["a", "c"]);
    });
  });

  it("applies state.columnOrder to the engine", async () => {
    const { container } = renderControlled({
      columnOrder: ["score", "name", "city"],
    });
    await waitFor(() => {
      expect(headerIds(container)).toEqual(["score", "name", "city"]);
    });
  });

  it("applies state.columnWidths to the engine", async () => {
    const { container } = renderControlled({ columnWidths: { city: 240 } });
    await waitFor(() => {
      expect(headerCell(container, "city").style.width).toBe("240px");
    });
    // The untouched columns keep their declared width, so the assertion above
    // cannot pass by every column happening to be 240.
    expect(headerCell(container, "name").style.width).toBe("100px");
  });

  it("applies state.columnPinned to the engine", async () => {
    const { container } = renderControlled({ columnPinned: { score: "left" } });
    await waitFor(() => {
      expect(headerCell(container, "score").dataset["pretablePinned"]).toBe(
        "left",
      );
    });
    expect(headerCell(container, "name").dataset["pretablePinned"]).toBe(
      undefined,
    );
  });

  it("applies a controlled query to the engine", async () => {
    const { container } = render(
      <PretableSurface
        ariaLabel="controlled"
        columns={columns}
        getRowId={(row: Row) => row.id}
        overscan={0}
        onQueryChange={() => {}}
        query={{
          filters: [],
          rowGroups: [],
          sort: [{ columnId: "name", direction: "asc" }],
        }}
        rows={rows}
        viewportHeight={300}
      />,
    );
    await waitFor(() => {
      const drawn = [
        ...container.querySelectorAll<HTMLElement>("[data-pretable-row-id]"),
      ].map((el) => el.dataset["pretableRowId"]);
      expect(drawn).toEqual(["b", "c", "a"]);
    });
  });
});

describe("controlled write-back — synthetic columns", () => {
  /**
   * `state.columnOrder` is gated on covering the DRAWN layout exactly
   * (`length === layout.length` and every id present). The row-select column is
   * drawn but is NOT one of `TColumns`' ids, so a consumer with checkboxes on
   * has to be able to name it or the gate can never pass and the whole slice is
   * silently inert. `PretableSurfaceColumnId<TColumns>` excludes the synthetic
   * ids; `PretableSurfaceInteractionColumnId<TColumns>` is the type that
   * includes them, and it is what these slices are typed with.
   */
  it("applies state.columnOrder when a row-select column is drawn", async () => {
    const { container } = render(
      <PretableSurface
        ariaLabel="controlled"
        columns={columns}
        getRowId={(row: Row) => row.id}
        overscan={0}
        rows={rows}
        rowSelectionColumn={{ enabled: true, pinned: false }}
        state={{
          columnOrder: ["__pretable_row_select__", "score", "name", "city"],
        }}
        viewportHeight={300}
      />,
    );
    await waitFor(() => {
      expect(headerIds(container)).toEqual([
        "__pretable_row_select__",
        "score",
        "name",
        "city",
      ]);
    });
  });

  it("applies state.columnWidths to the row-select column", async () => {
    const { container } = render(
      <PretableSurface
        ariaLabel="controlled"
        columns={columns}
        getRowId={(row: Row) => row.id}
        overscan={0}
        rows={rows}
        rowSelectionColumn={{ enabled: true, pinned: false }}
        state={{ columnWidths: { __pretable_row_select__: 72 } }}
        viewportHeight={300}
      />,
    );
    await waitFor(() => {
      const el = container.querySelector<HTMLElement>(
        "[data-pretable-row-select-header]",
      );
      expect(el).not.toBeNull();
      expect(el!.style.width).toBe("72px");
    });
  });
});
