import fc from "fast-check";
import { describe, expect, test } from "vitest";

import {
  createColumnHelper,
  createLocalRowModel,
  type PretableGroupId,
} from "@pretable-internal/row-model";

import {
  createEmptyIndexedSelection,
  getIndexedSelectionSummary,
  indexedRangeContainsCell,
  isIndexedRowSelected,
  reconcileIndexedSelection,
  selectAllVisibleRows,
  toggleIndexedRowSelection,
} from "../indexed-selection";

interface Row {
  readonly id: string | number;
  readonly team: string;
  readonly score: number;
}

const helper = createColumnHelper<Row>();
const columns = [
  helper.accessor("team", { type: "text" }),
  helper.accessor("score", { type: "number" }),
] as const;

function createModel() {
  return createLocalRowModel({
    rows: [
      { id: 0, team: "a", score: 1 },
      { id: "0", team: "a", score: 2 },
      { id: "hidden", team: "b", score: 3 },
    ],
    columns,
    getRowId: (row) => row.id,
  });
}

describe("indexed row selection", () => {
  test("stores only data IDs and preserves SameValueZero numeric/string identity", () => {
    const snapshot = createModel().getState().snapshot;
    let selection = createEmptyIndexedSelection<Row["id"], "team" | "score">();

    selection = toggleIndexedRowSelection(selection, 0, snapshot);

    expect(
      isIndexedRowSelected(selection, { kind: "data", rowId: 0 }, snapshot),
    ).toBe(true);
    expect(
      isIndexedRowSelected(selection, { kind: "data", rowId: "0" }, snapshot),
    ).toBe(false);
    expect(
      isIndexedRowSelected(
        selection,
        { kind: "group", groupId: "0" as PretableGroupId },
        snapshot,
      ),
    ).toBe(false);
  });

  test("represents select-all as all-plus-exclusions without reading or allocating N rows", () => {
    const source = createModel().getState().snapshot;
    let indexedReads = 0;
    const snapshot = {
      ...source,
      visibleDataRowCount: 100_000,
      dataRowAt(index: number) {
        indexedReads += 1;
        return source.dataRowAt(index);
      },
      rowAt(index: number) {
        indexedReads += 1;
        return source.rowAt(index);
      },
      range(start: number, end: number) {
        indexedReads += Math.max(0, end - start);
        return source.range(start, end);
      },
    };

    const selection = selectAllVisibleRows(
      createEmptyIndexedSelection<Row["id"], "team" | "score">(),
      snapshot,
    );

    expect(selection.rows.kind).toBe("all");
    if (selection.rows.kind === "all") {
      expect(selection.rows.excludedRowIds.size).toBe(0);
    }
    expect(indexedReads).toBe(0);

    const excluded = toggleIndexedRowSelection(selection, 0, snapshot);
    expect(
      isIndexedRowSelected(excluded, { kind: "data", rowId: 0 }, snapshot),
    ).toBe(false);
    expect(indexedReads).toBeLessThanOrEqual(2);
  });

  test("counts only currently visible data rows and reports header tri-state sublinearly", async () => {
    const model = createModel();
    let selection = createEmptyIndexedSelection<Row["id"], "team" | "score">();
    selection = toggleIndexedRowSelection(
      selection,
      0,
      model.getState().snapshot,
    );
    selection = toggleIndexedRowSelection(
      selection,
      "hidden",
      model.getState().snapshot,
    );

    await model.setQuery({
      filters: [{ columnId: "team", operator: "equals", value: "a" }],
      sort: [],
      rowGroups: [],
    }).finished;

    expect(
      getIndexedSelectionSummary(selection, model.getState().snapshot),
    ).toEqual({
      state: "some",
      selectedCount: 1,
      visibleCount: 2,
    });

    selection = selectAllVisibleRows(selection, model.getState().snapshot);
    expect(
      getIndexedSelectionSummary(selection, model.getState().snapshot),
    ).toEqual({
      state: "all",
      selectedCount: 2,
      visibleCount: 2,
    });
  });

  test("checks cell-range membership from immutable ranks and never selects group headers", () => {
    const model = createLocalRowModel({
      rows: [
        { id: "0", team: "a", score: 1 },
        { id: "next", team: "a", score: 2 },
      ],
      columns,
      getRowId: (row) => row.id,
      initialExpansion: { kind: "expanded" },
      query: {
        filters: [],
        sort: [],
        rowGroups: [{ columnId: "team" }],
      },
    });
    const snapshot = model.getState().snapshot;
    const group = snapshot.rowAt(0);
    expect(group?.kind).toBe("group");
    if (group?.kind !== "group") throw new Error("expected group");
    const range = {
      start: { rowId: "0" as const, columnId: "team" as const },
      end: { rowId: "next" as const, columnId: "score" as const },
    };

    expect(
      indexedRangeContainsCell(
        range,
        { kind: "data", rowId: "0" },
        "score",
        snapshot,
        ["team", "score"],
      ),
    ).toBe(true);
    expect(
      indexedRangeContainsCell(
        range,
        { kind: "group", groupId: group.groupId },
        "team",
        snapshot,
        ["team", "score"],
      ),
    ).toBe(false);
  });

  test("reconciles disappearing range endpoints to a surviving data endpoint", () => {
    const model = createModel();
    const snapshot = model.getState().snapshot;
    const selection = {
      rows: { kind: "explicit" as const, rowIds: new Set<Row["id"]>() },
      ranges: [
        {
          start: { rowId: "missing" as Row["id"], columnId: "team" as const },
          end: { rowId: 0 as Row["id"], columnId: "score" as const },
        },
      ],
      anchor: { rowId: "missing" as Row["id"], columnId: "team" as const },
    };

    const reconciled = reconcileIndexedSelection(selection, snapshot);

    expect(reconciled.ranges).toEqual([
      {
        start: { rowId: 0, columnId: "score" },
        end: { rowId: 0, columnId: "score" },
      },
    ]);
    expect(reconciled.anchor).toEqual({ rowId: 0, columnId: "score" });
  });

  test("select-all is a stable no-op when filters or collapse leave no visible data", () => {
    const filtered = createLocalRowModel({
      rows: [{ id: "row", team: "a", score: 1 }],
      columns,
      getRowId: (row) => row.id,
      query: {
        filters: [{ columnId: "score", operator: "gt", value: 10 }],
        sort: [],
        rowGroups: [],
      },
    });
    const grouped = createLocalRowModel({
      rows: [{ id: "row", team: "a", score: 1 }],
      columns,
      getRowId: (row) => row.id,
      initialExpansion: { kind: "collapsed" },
      query: { filters: [], sort: [], rowGroups: [{ columnId: "team" }] },
    });
    const empty = createEmptyIndexedSelection<Row["id"], "team" | "score">();

    expect(filtered.getState().snapshot.visibleDataRowCount).toBe(0);
    expect(selectAllVisibleRows(empty, filtered.getState().snapshot)).toBe(
      empty,
    );
    expect(grouped.getState().snapshot.visibleRowCount).toBe(1);
    expect(grouped.getState().snapshot.visibleDataRowCount).toBe(0);
    expect(selectAllVisibleRows(empty, grouped.getState().snapshot)).toBe(
      empty,
    );
  });

  test("matches a materialized selection oracle across randomized sparse operations", () => {
    const model = createLocalRowModel({
      rows: Array.from({ length: 32 }, (_, id) => ({
        id,
        team: id % 2 === 0 ? "a" : "b",
        score: id,
      })),
      columns,
      getRowId: (row) => row.id,
    });
    const snapshot = model.getState().snapshot;
    const operation = fc.oneof(
      fc.constant({ kind: "all" as const }),
      fc.record({
        kind: fc.constant("toggle" as const),
        rowId: fc.integer({ min: 0, max: 31 }),
      }),
    );

    fc.assert(
      fc.property(fc.array(operation, { maxLength: 200 }), (operations) => {
        let selection = createEmptyIndexedSelection<
          Row["id"],
          "team" | "score"
        >();
        let oracle = new Set<number>();
        for (const current of operations) {
          if (current.kind === "all") {
            selection = selectAllVisibleRows(selection, snapshot);
            oracle = new Set(Array.from({ length: 32 }, (_, id) => id));
          } else {
            selection = toggleIndexedRowSelection(
              selection,
              current.rowId,
              snapshot,
            );
            if (oracle.has(current.rowId)) oracle.delete(current.rowId);
            else oracle.add(current.rowId);
          }
          for (let rowId = 0; rowId < 32; rowId += 1) {
            expect(
              isIndexedRowSelected(
                selection,
                { kind: "data", rowId },
                snapshot,
              ),
            ).toBe(oracle.has(rowId));
          }
          expect(
            getIndexedSelectionSummary(selection, snapshot).selectedCount,
          ).toBe(oracle.size);
        }
      }),
      { seed: 18_081, numRuns: 100 },
    );
  });
});
