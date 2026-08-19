import { describe, expect, test, vi } from "vitest";

import { createColumnHelper, createLocalRowModel } from "../index";

interface Row {
  id: number;
  team: string;
  score: number;
  label: string;
}

const helper = createColumnHelper<Row>();

describe("incremental flat queries", () => {
  test("guards comparator reentrancy throughout cooperative setQuery publication", async () => {
    let nestedError: unknown;
    let armed = false;
    const columns = [
      helper.accessor("score", (row) => row.score, {
        type: "number",
        compare: (left, right) => {
          if (armed) {
            try {
              model.applyTransaction({
                add: [{ id: 99, team: "x", score: 99, label: "nested" }],
              });
            } catch (error) {
              nestedError = error;
            }
          }
          return left - right;
        },
      }),
    ] as const;
    const model = createLocalRowModel({
      rows: [
        { id: 1, team: "a", score: 2, label: "one" },
        { id: 2, team: "a", score: 1, label: "two" },
      ],
      columns,
    });
    armed = true;

    const transition = model.setQuery({
      filters: [],
      sort: [{ columnId: "score", direction: "asc" }],
      rowGroups: [],
    });
    await transition.finished;

    expect(transition.requestedQuery.sort).toHaveLength(1);
    expect(nestedError).toMatchObject({
      code: "reentrant-mutation",
      operation: "apply-transaction",
      activeOperation: "set-query",
    });
    expect(model.getState().snapshot.revision).toBe(1);
    expect(model.getState().snapshot.sourceRowCount).toBe(2);
  });
  test("updates filter membership, multi-sort keys, and stable source ties", async () => {
    const columns = [
      helper.accessor("team", { type: "text" }),
      helper.accessor("score", { type: "number" }),
      helper.accessor("label", { type: "text" }),
    ] as const;
    const model = createLocalRowModel({
      rows: [
        { id: 1, team: "a", score: 2, label: "first" },
        { id: 2, team: "a", score: 2, label: "second" },
        { id: 3, team: "b", score: 3, label: "third" },
      ],
      columns,
    });
    const transition = model.setQuery({
      filters: [{ columnId: "score", operator: "gte", value: 2 }],
      sort: [
        { columnId: "team", direction: "asc" },
        { columnId: "score", direction: "desc" },
      ],
      rowGroups: [],
    });
    await transition.finished;

    expect(transition.requestedQuery).toEqual(model.getState().snapshot.query);
    expect(
      model
        .getState()
        .snapshot.range(0, 10)
        .map((row) => row.kind === "data" && row.rowId),
    ).toEqual([1, 2, 3]);

    model.applyTransaction({ update: [{ id: 3, changes: { team: "a" } }] });
    expect(
      model
        .getState()
        .snapshot.range(0, 10)
        .map((row) => row.kind === "data" && row.rowId),
    ).toEqual([3, 1, 2]);
    model.applyTransaction({ update: [{ id: 1, changes: { score: 1 } }] });
    expect(
      model
        .getState()
        .snapshot.range(0, 10)
        .map((row) => row.kind === "data" && row.rowId),
    ).toEqual([3, 2]);
    model.applyTransaction({ update: [{ id: 1, changes: { score: 4 } }] });
    expect(
      model
        .getState()
        .snapshot.range(0, 10)
        .map((row) => row.kind === "data" && row.rowId),
    ).toEqual([1, 3, 2]);
  });

  test("filters and orders calendar dates without admitting invalid cell values", async () => {
    interface DatedRow {
      id: number;
      asOf: string | null;
    }
    const dated = createColumnHelper<DatedRow>();
    const datedColumns = [dated.accessor("asOf", { type: "date" })] as const;
    const model = createLocalRowModel({
      rows: [
        { id: 1, asOf: "2026-08-06" },
        { id: 2, asOf: "2025-12-31" },
        { id: 3, asOf: "2026-02-30" },
        { id: 4, asOf: null },
      ],
      columns: datedColumns,
    });

    await model.setQuery({
      filters: [{ columnId: "asOf", operator: "after", value: "2026-01-01" }],
      sort: [{ columnId: "asOf", direction: "desc", nulls: "first" }],
      rowGroups: [],
    }).finished;

    expect(
      model
        .getState()
        .snapshot.range(0, 10)
        .flatMap((row) => (row.kind === "data" ? [row.rowId] : [])),
    ).toEqual([1]);
  });

  test("display-only changes evaluate active dependencies once without moving rank", () => {
    const score = vi.fn((row: Row) => row.score);
    const compare = vi.fn((left: number, right: number) => left - right);
    const columns = [
      helper.accessor("score", score, { type: "number", compare }),
      helper.accessor("label", { type: "text" }),
    ] as const;
    const model = createLocalRowModel({
      rows: [
        { id: 1, team: "a", score: 1, label: "one" },
        { id: 2, team: "a", score: 2, label: "two" },
      ],
      columns,
      query: {
        filters: [],
        sort: [{ columnId: "score", direction: "asc" }],
        rowGroups: [],
      },
    });
    score.mockClear();
    compare.mockClear();

    model.applyTransaction({ update: [{ id: 1, changes: { label: "ONE" } }] });

    expect(score).toHaveBeenCalledTimes(1);
    expect(compare).not.toHaveBeenCalled();
    expect(model.getState().snapshot.indexOf({ kind: "data", rowId: 1 })).toBe(
      0,
    );
    expect(model.getState().snapshot.rowAt(0)).toMatchObject({
      row: { label: "ONE" },
    });
  });
});
