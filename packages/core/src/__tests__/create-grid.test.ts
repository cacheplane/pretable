import { describe, expect, test } from "vitest";

import { createColumnHelper, createGrid, createLocalRowModel } from "../index";

interface Person {
  readonly id: number;
  readonly name: string;
  readonly score: number;
}

const helper = createColumnHelper<Person>();
const columns = [
  helper.accessor("name", { type: "text" }),
  helper.accessor("score", { type: "number" }),
] as const;

describe("createGrid", () => {
  test("creates a UI-only grid over an explicit indexed row model", () => {
    const rowModel = createLocalRowModel({
      rows: [
        { id: 1, name: "Ada", score: 36 },
        { id: 2, name: "Grace", score: 42 },
      ],
      columns,
    });
    const grid = createGrid({
      rowModel,
      columns: [
        { id: "name", widthPx: 240 },
        { id: "score", pinned: "right" },
      ],
    });

    expect(grid.rowModel).toBe(rowModel);
    expect(grid.getState()).toMatchObject({
      observedRowModelRevision: null,
      columnLayout: [
        { id: "name", widthPx: 240 },
        // The undeclared-width default, now one shared constant with the
        // renderer's drawing fallback (140, was 160 here) — so a column the
        // grid draws at its default is STORED at that same number, and
        // freezing it with `setColumnAutoWidth(id, false)` moves no pixel.
        { id: "score", widthPx: 140, pinned: "right" },
      ],
    });

    grid.observeRowModelRevision(rowModel.getState().snapshot.revision);
    grid.setFocus({
      ref: { kind: "data", rowId: 2 },
      columnId: "score",
    });

    expect(grid.getState().focus).toEqual({
      ref: { kind: "data", rowId: 2 },
      columnId: "score",
    });
    expect("applyTransaction" in grid).toBe(false);
    expect("setRows" in grid).toBe(false);
    expect("setSort" in grid).toBe(false);

    grid.dispose();
    rowModel.dispose();
  });
});
