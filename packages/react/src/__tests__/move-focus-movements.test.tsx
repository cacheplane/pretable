// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { createColumnHelper, createLocalRowModel } from "@pretable/core";
import type { PretableIndexedFocusMovement } from "@pretable/core";

import { usePretableModelInternal } from "../pretable-model";

/**
 * `PretableReactGrid.moveFocus` used to declare a HAND-COPIED movement union
 * that had fallen two members behind the engine's
 * `PretableIndexedFocusMovement`; the copy is now the imported type
 * (`type-tests/react/focus-movement-union.types.tsx` pins that).
 *
 * That change is type-only, and a type-only change is exactly the kind that
 * passes every type test while breaking the program: `moveFocus` is reached
 * through a prototype facade over the grid core (`Object.create(stores.gridCore)`
 * in `pretable-model.ts`), so a movement that stopped being forwarded — or was
 * forwarded with its options dropped — would still typecheck perfectly.
 *
 * So this asserts the OLD behavior survives, per movement, against the focus
 * the engine actually publishes. Each case names the focus it expects rather
 * than merely checking that something changed: a `moveFocus` that always went
 * home would pass a "focus moved" assertion for nine of these.
 */
interface Row {
  id: number;
  label: string;
  score: number;
}

const column = createColumnHelper<Row>();
const columns = [
  column.accessor("label", { type: "text" }),
  column.accessor("score", { type: "number" }),
] as const;
const rows: readonly Row[] = [
  { id: 1, label: "one", score: 1 },
  { id: 2, label: "two", score: 2 },
  { id: 3, label: "three", score: 3 },
  { id: 4, label: "four", score: 4 },
  { id: 5, label: "five", score: 5 },
];

const drawn = [
  { id: "label", widthPx: 120 },
  { id: "score", widthPx: 120 },
] as const;

function renderGrid() {
  const rowModel = createLocalRowModel({ rows, columns });
  const view = renderHook(() =>
    usePretableModelInternal({
      rowModel,
      columns: drawn,
      viewportHeight: 200,
    }),
  );
  return { view, rowModel };
}

/** `{rowId, columnId}` of the engine's current focus, or `null` markers. */
function focusOf(grid: {
  getState: () => {
    focus: {
      ref: { kind: string; rowId?: number } | null;
      columnId: string | null;
    };
  };
}) {
  const { ref, columnId } = grid.getState().focus;
  return {
    kind: ref?.kind ?? null,
    rowId: ref?.kind === "data" ? (ref.rowId ?? null) : null,
    columnId,
  };
}

afterEach(cleanup);

describe("moveFocus forwards every movement to the engine", () => {
  /**
   * Start on row 3 / `label` — the interior of both axes, so "moved to the
   * first row" and "did not move" are distinguishable from every direction.
   */
  const cases: readonly {
    readonly movement: PretableIndexedFocusMovement;
    readonly expect: { rowId: number | null; columnId: string | null };
    readonly kind?: string;
  }[] = [
    { movement: "up", expect: { rowId: 2, columnId: "label" } },
    { movement: "down", expect: { rowId: 4, columnId: "label" } },
    { movement: "right", expect: { rowId: 3, columnId: "score" } },
    { movement: "home", expect: { rowId: 1, columnId: "label" } },
    { movement: "end", expect: { rowId: 5, columnId: "label" } },
    { movement: "last-column", expect: { rowId: 3, columnId: "score" } },
    { movement: "first-column", expect: { rowId: 3, columnId: "label" } },
    { movement: "tab", expect: { rowId: 3, columnId: "score" } },
    { movement: "page-down", expect: { rowId: 5, columnId: "label" } },
  ];

  for (const { movement, expect: expected } of cases) {
    test(`"${movement}"`, () => {
      const { view, rowModel } = renderGrid();
      const grid = view.result.current.grid;

      act(() => {
        grid.setFocus({
          ref: { kind: "data", rowId: 3 },
          columnId: "label",
        });
      });
      expect(focusOf(grid)).toEqual({
        kind: "data",
        rowId: 3,
        columnId: "label",
      });

      act(() => grid.moveFocus(movement));

      expect(focusOf(grid)).toEqual({
        kind: "data",
        rowId: expected.rowId,
        columnId: expected.columnId,
      });

      view.unmount();
      rowModel.dispose();
    });
  }

  /**
   * `"left"` off the first column and `"up"` off the first row leave the data
   * rows entirely — the second lands on the header, which is the case a
   * consumer switching on `ref.kind` has to answer.
   */
  test('"up" from the first row lands on the header', () => {
    const { view, rowModel } = renderGrid();
    const grid = view.result.current.grid;

    act(() => {
      grid.setFocus({ ref: { kind: "data", rowId: 1 }, columnId: "label" });
      grid.moveFocus("up");
    });

    expect(focusOf(grid).kind).toBe("header");

    view.unmount();
    rowModel.dispose();
  });

  /**
   * The second parameter, which was a duplicated `{ pageRows?: number }` and is
   * now the imported `PretableIndexedMoveFocusOptions`. Asserted because the
   * call site that broke was repaired with a cast that dropped this argument
   * entirely — a signature can be correct while the value never arrives.
   */
  test('"page-up" honours pageRows', () => {
    const { view, rowModel } = renderGrid();
    const grid = view.result.current.grid;

    act(() => {
      grid.setFocus({ ref: { kind: "data", rowId: 5 }, columnId: "label" });
      grid.moveFocus("page-up", { pageRows: 2 });
    });

    expect(focusOf(grid).rowId).toBe(3);

    act(() => {
      grid.setFocus({ ref: { kind: "data", rowId: 5 }, columnId: "label" });
      grid.moveFocus("page-up", { pageRows: 4 });
    });

    expect(focusOf(grid).rowId).toBe(1);

    view.unmount();
    rowModel.dispose();
  });
});
