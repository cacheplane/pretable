import fc from "fast-check";
import { describe, expect, test } from "vitest";

import {
  createColumnHelper,
  createLocalRowModel,
  type PretableGroupId,
} from "@pretable-internal/row-model";

import {
  createEmptyIndexedSelection,
  getIndexedCellSelectionSummary,
  getIndexedRowSelectionProgramDiagnostics,
  getIndexedSelectionSummary,
  indexedRangeContainsCell,
  isIndexedRowSelected,
  projectIndexedSelection,
  reconcileIndexedSelection,
  selectAllVisibleRows,
  selectIndexedRowRange,
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
  test("compacts superseded rules and releases snapshot bases on canonical resets", () => {
    const snapshot = createModel().getState().snapshot;
    let selection = createEmptyIndexedSelection<Row["id"], "team" | "score">();
    for (let index = 0; index < 1_000; index += 1)
      selection = toggleIndexedRowSelection(selection, 0, snapshot);
    expect(
      getIndexedRowSelectionProgramDiagnostics(selection.rows),
    ).toMatchObject({
      pointRuleCount: 1,
      snapshotBasisCount: 0,
    });

    for (let index = 0; index < 1_000; index += 1)
      selection = selectIndexedRowRange(selection, 0, "0", snapshot);
    expect(
      getIndexedRowSelectionProgramDiagnostics(selection.rows),
    ).toMatchObject({
      pointRuleCount: 1,
      rangeRuleCount: 1,
      snapshotBasisCount: 1,
    });

    selection = selectAllVisibleRows(selection, snapshot);
    expect(getIndexedRowSelectionProgramDiagnostics(selection.rows)).toEqual({
      pointRuleCount: 0,
      rangeRuleCount: 0,
      snapshotBasisCount: 0,
      projectionRunCount: 1,
    });
    expect(
      getIndexedRowSelectionProgramDiagnostics(
        createEmptyIndexedSelection<Row["id"], "team" | "score">().rows,
      ),
    ).toEqual({
      pointRuleCount: 0,
      rangeRuleCount: 0,
      snapshotBasisCount: 0,
      projectionRunCount: 0,
    });
  });

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
      expect(selection.rows.excludedRanges?.size ?? 0).toBe(0);
    }
    expect(indexedReads).toBe(0);

    const excluded = toggleIndexedRowSelection(selection, 0, snapshot);
    expect(
      isIndexedRowSelected(excluded, { kind: "data", rowId: 0 }, snapshot),
    ).toBe(false);
    expect(indexedReads).toBeLessThanOrEqual(2);
  });

  test("represents a 100k row range symbolically with bounded indexed reads", () => {
    const source = createModel().getState().snapshot;
    let dataIndexReads = 0;
    const snapshot = {
      ...source,
      visibleRowCount: 100_000,
      visibleDataRowCount: 100_000,
      indexOf(ref: Parameters<typeof source.indexOf>[0]) {
        if (ref.kind !== "data" || typeof ref.rowId !== "number") return -1;
        return ref.rowId >= 0 && ref.rowId < 100_000 ? ref.rowId : -1;
      },
      dataIndexOf(ref: Parameters<typeof source.dataIndexOf>[0]) {
        dataIndexReads += 1;
        if (ref.kind !== "data" || typeof ref.rowId !== "number") return -1;
        return ref.rowId >= 0 && ref.rowId < 100_000 ? ref.rowId : -1;
      },
      dataRowAt(): never {
        throw new Error("range selection must not materialize rows");
      },
      rowAt(): never {
        throw new Error("range selection must not materialize rows");
      },
      range(): never {
        throw new Error("range selection must not scan rows");
      },
    };

    let selection = selectIndexedRowRange(
      createEmptyIndexedSelection<Row["id"], "team" | "score">(),
      0,
      99_999,
      snapshot,
    );

    expect(selection.rows.kind).toBe("explicit");
    if (selection.rows.kind !== "explicit")
      throw new Error("expected explicit");
    expect(Array.from(selection.rows.ranges ?? [])).toEqual([
      { startRowId: 0, endRowId: 99_999 },
    ]);
    expect(
      isIndexedRowSelected(
        selection,
        { kind: "data", rowId: 50_000 },
        snapshot,
      ),
    ).toBe(true);
    expect(getIndexedSelectionSummary(selection, snapshot)).toEqual({
      state: "all",
      selectedCount: 100_000,
      visibleCount: 100_000,
    });

    selection = toggleIndexedRowSelection(selection, 50_000, snapshot);

    expect(
      isIndexedRowSelected(
        selection,
        { kind: "data", rowId: 50_000 },
        snapshot,
      ),
    ).toBe(false);
    expect(getIndexedSelectionSummary(selection, snapshot).selectedCount).toBe(
      99_999,
    );
    expect(dataIndexReads).toBeLessThan(64);
  });

  test("keeps surviving symbolic identities when range endpoints disappear", () => {
    const model = createLocalRowModel({
      rows: [
        { id: 1, team: "a", score: 1 },
        { id: 2, team: "a", score: 2 },
        { id: 3, team: "a", score: 3 },
      ],
      columns,
      getRowId: (row) => row.id,
    });
    const selected = selectIndexedRowRange(
      createEmptyIndexedSelection<Row["id"], "team" | "score">(),
      1,
      3,
      model.getState().snapshot,
    );

    model.applyTransaction({ remove: [3] });
    const oneEndpoint = reconcileIndexedSelection(
      selected,
      model.getState().snapshot,
    );
    expect(oneEndpoint.rows.kind).toBe("explicit");
    if (oneEndpoint.rows.kind !== "explicit")
      throw new Error("expected explicit");
    expect(
      isIndexedRowSelected(
        oneEndpoint,
        { kind: "data", rowId: 2 },
        model.getState().snapshot,
      ),
    ).toBe(true);
    expect(
      getIndexedSelectionSummary(oneEndpoint, model.getState().snapshot),
    ).toEqual({ state: "all", selectedCount: 2, visibleCount: 2 });

    model.applyTransaction({ remove: [1] });
    const noEndpoints = reconcileIndexedSelection(
      oneEndpoint,
      model.getState().snapshot,
    );
    expect(noEndpoints.rows).toMatchObject({ kind: "explicit" });
    if (noEndpoints.rows.kind !== "explicit")
      throw new Error("expected explicit");
    expect(
      isIndexedRowSelected(
        noEndpoints,
        { kind: "data", rowId: 2 },
        model.getState().snapshot,
      ),
    ).toBe(true);
    expect(
      getIndexedSelectionSummary(noEndpoints, model.getState().snapshot),
    ).toEqual({ state: "all", selectedCount: 1, visibleCount: 1 });
  });

  test("preserves the exact symbolic identity set through setRows reorder and filtering", async () => {
    const rows = [
      { id: 1, team: "a", score: 1 },
      { id: 2, team: "b", score: 4 },
      { id: 3, team: "a", score: 3 },
      { id: 4, team: "a", score: 2 },
    ];
    const model = createLocalRowModel({
      rows,
      columns,
      getRowId: (row) => row.id,
    });
    let selection = selectIndexedRowRange(
      createEmptyIndexedSelection<Row["id"], "team" | "score">(),
      1,
      3,
      model.getState().snapshot,
    );

    model.setRows([rows[0]!, rows[3]!, rows[2]!, rows[1]!]);
    selection = reconcileIndexedSelection(selection, model.getState().snapshot);

    for (const rowId of [1, 2, 3])
      expect(
        isIndexedRowSelected(
          selection,
          { kind: "data", rowId },
          model.getState().snapshot,
        ),
      ).toBe(true);
    expect(
      isIndexedRowSelected(
        selection,
        { kind: "data", rowId: 4 },
        model.getState().snapshot,
      ),
    ).toBe(false);
    expect(
      getIndexedSelectionSummary(selection, model.getState().snapshot),
    ).toEqual({ state: "some", selectedCount: 3, visibleCount: 4 });

    await model.setQuery({
      filters: [{ columnId: "team", operator: "equals", value: "a" }],
      sort: [],
      rowGroups: [],
    }).finished;
    selection = reconcileIndexedSelection(selection, model.getState().snapshot);
    expect(
      getIndexedSelectionSummary(selection, model.getState().snapshot),
    ).toEqual({ state: "some", selectedCount: 2, visibleCount: 3 });

    await model.setQuery({ filters: [], sort: [], rowGroups: [] }).finished;
    selection = reconcileIndexedSelection(selection, model.getState().snapshot);
    expect(
      isIndexedRowSelected(
        selection,
        { kind: "data", rowId: 2 },
        model.getState().snapshot,
      ),
    ).toBe(true);
    expect(
      getIndexedSelectionSummary(selection, model.getState().snapshot),
    ).toEqual({ state: "some", selectedCount: 3, visibleCount: 4 });
  });

  test("counts an additive range exactly after its source identities reorder", () => {
    const rows = [1, 2, 3, 4].map((id) => ({
      id,
      team: "a",
      score: id,
    }));
    const model = createLocalRowModel({
      rows,
      columns,
      getRowId: (row) => row.id,
    });
    const previous = model.getState().snapshot;
    let selection = selectIndexedRowRange(
      createEmptyIndexedSelection<Row["id"], "team" | "score">(),
      1,
      3,
      previous,
    );

    model.setRows([rows[0]!, rows[3]!, rows[2]!, rows[1]!]);
    const snapshot = model.getState().snapshot;
    selection = projectIndexedSelection(
      selection,
      previous,
      snapshot,
      model.changesSince(previous.revision),
    );
    selection = selectIndexedRowRange(selection, 4, 3, snapshot);

    expect(getIndexedSelectionSummary(selection, snapshot)).toEqual({
      state: "all",
      selectedCount: 4,
      visibleCount: 4,
    });
    for (const rowId of [1, 2, 3, 4])
      expect(
        isIndexedRowSelected(selection, { kind: "data", rowId }, snapshot),
      ).toBe(true);
  });

  test("counts externally supplied overlapping row ranges only once", () => {
    const model = createLocalRowModel({
      rows: [
        { id: 1, team: "a", score: 1 },
        { id: 2, team: "a", score: 2 },
        { id: 3, team: "a", score: 3 },
      ],
      columns,
      getRowId: (row) => row.id,
    });
    let selection = selectIndexedRowRange(
      createEmptyIndexedSelection<Row["id"], "team" | "score">(),
      1,
      3,
      model.getState().snapshot,
    );
    selection = selectIndexedRowRange(
      selection,
      2,
      3,
      model.getState().snapshot,
    );

    expect(
      getIndexedSelectionSummary(selection, model.getState().snapshot),
    ).toEqual({ state: "all", selectedCount: 3, visibleCount: 3 });
  });

  test("preserves holes in earlier ranges when adding a disjoint span", () => {
    const model = createLocalRowModel({
      rows: Array.from({ length: 6 }, (_, index) => ({
        id: index + 1,
        team: "a",
        score: index,
      })),
      columns,
      getRowId: (row) => row.id,
    });
    const snapshot = model.getState().snapshot;
    let selection = selectIndexedRowRange(
      createEmptyIndexedSelection<Row["id"], "team" | "score">(),
      1,
      3,
      snapshot,
    );
    selection = toggleIndexedRowSelection(selection, 2, snapshot);
    selection = selectIndexedRowRange(selection, 5, 6, snapshot);

    expect(
      isIndexedRowSelected(selection, { kind: "data", rowId: 2 }, snapshot),
    ).toBe(false);
    expect(
      isIndexedRowSelected(selection, { kind: "data", rowId: 5 }, snapshot),
    ).toBe(true);
    selection = selectIndexedRowRange(selection, 2, 2, snapshot);
    expect(
      isIndexedRowSelected(selection, { kind: "data", rowId: 2 }, snapshot),
    ).toBe(true);
  });

  test("reselects an excluded endpoint even when another exclusion is adjacent", () => {
    const model = createLocalRowModel({
      rows: Array.from({ length: 24 }, (_, id) => ({
        id,
        team: "a",
        score: id,
      })),
      columns,
      getRowId: (row) => row.id,
    });
    const snapshot = model.getState().snapshot;
    let selection = selectAllVisibleRows(
      createEmptyIndexedSelection<Row["id"], "team" | "score">(),
      snapshot,
    );
    selection = toggleIndexedRowSelection(selection, 3, snapshot);
    selection = toggleIndexedRowSelection(selection, 1, snapshot);

    selection = selectIndexedRowRange(selection, 3, 2, snapshot);

    expect(
      isIndexedRowSelected(selection, { kind: "data", rowId: 3 }, snapshot),
    ).toBe(true);
    expect(getIndexedSelectionSummary(selection, snapshot).selectedCount).toBe(
      23,
    );
  });

  test("select-all replaces a prior cell range with the all-rows selection", () => {
    const model = createLocalRowModel({
      rows: [1, 2, 3].map((id) => ({ id, team: "a", score: id })),
      columns,
      getRowId: (row) => row.id,
    });
    const snapshot = model.getState().snapshot;
    const selected = selectAllVisibleRows(
      {
        rows: createEmptyIndexedSelection<Row["id"], "team" | "score">().rows,
        ranges: [
          {
            start: { rowId: 1, columnId: "team" },
            end: { rowId: 1, columnId: "team" },
          },
        ],
        anchor: { rowId: 1, columnId: "team" },
      },
      snapshot,
    );

    expect(selected.rows.kind).toBe("all");
    expect(selected.ranges).toEqual([]);
    expect(selected.anchor).toBeNull();
  });

  test("preserves a surviving exclusion endpoint after its neighbor disappears", () => {
    const model = createLocalRowModel({
      rows: [1, 2, 3].map((id) => ({ id, team: "a", score: id })),
      columns,
      getRowId: (row) => row.id,
    });
    let selection = selectAllVisibleRows(
      createEmptyIndexedSelection<Row["id"], "team" | "score">(),
      model.getState().snapshot,
    );
    selection = toggleIndexedRowSelection(
      selection,
      1,
      model.getState().snapshot,
    );
    selection = toggleIndexedRowSelection(
      selection,
      2,
      model.getState().snapshot,
    );

    model.applyTransaction({ remove: [1] });
    selection = reconcileIndexedSelection(selection, model.getState().snapshot);

    expect(
      isIndexedRowSelected(
        selection,
        { kind: "data", rowId: 2 },
        model.getState().snapshot,
      ),
    ).toBe(false);
    expect(
      getIndexedSelectionSummary(selection, model.getState().snapshot),
    ).toEqual({ state: "some", selectedCount: 1, visibleCount: 2 });
  });

  test("preserves an interior excluded identity when both neighbors disappear", () => {
    const model = createLocalRowModel({
      rows: [1, 2, 3, 4].map((id) => ({ id, team: "a", score: id })),
      columns,
      getRowId: (row) => row.id,
    });
    let selection = selectAllVisibleRows(
      createEmptyIndexedSelection<Row["id"], "team" | "score">(),
      model.getState().snapshot,
    );
    for (const rowId of [1, 2, 3])
      selection = toggleIndexedRowSelection(
        selection,
        rowId,
        model.getState().snapshot,
      );

    model.applyTransaction({ remove: [1, 3] });
    selection = reconcileIndexedSelection(selection, model.getState().snapshot);

    expect(
      isIndexedRowSelected(
        selection,
        { kind: "data", rowId: 2 },
        model.getState().snapshot,
      ),
    ).toBe(false);
    expect(
      getIndexedSelectionSummary(selection, model.getState().snapshot),
    ).toEqual({ state: "some", selectedCount: 1, visibleCount: 2 });
  });

  test("reconciles exclusion identities through reorder and filtering", async () => {
    const model = createLocalRowModel({
      rows: [
        { id: 1, team: "a", score: 1 },
        { id: 2, team: "b", score: 2 },
        { id: 3, team: "b", score: 3 },
        { id: 4, team: "a", score: 4 },
      ],
      columns,
      getRowId: (row) => row.id,
    });
    let selection = selectAllVisibleRows(
      createEmptyIndexedSelection<Row["id"], "team" | "score">(),
      model.getState().snapshot,
    );
    selection = toggleIndexedRowSelection(
      selection,
      1,
      model.getState().snapshot,
    );
    selection = toggleIndexedRowSelection(
      selection,
      3,
      model.getState().snapshot,
    );

    await model.setQuery({
      filters: [],
      sort: [{ columnId: "score", direction: "desc" }],
      rowGroups: [],
    }).finished;
    selection = reconcileIndexedSelection(selection, model.getState().snapshot);
    expect(
      isIndexedRowSelected(
        selection,
        { kind: "data", rowId: 1 },
        model.getState().snapshot,
      ),
    ).toBe(false);
    expect(
      isIndexedRowSelected(
        selection,
        { kind: "data", rowId: 3 },
        model.getState().snapshot,
      ),
    ).toBe(false);

    await model.setQuery({
      filters: [{ columnId: "team", operator: "equals", value: "b" }],
      sort: [{ columnId: "score", direction: "desc" }],
      rowGroups: [],
    }).finished;
    selection = reconcileIndexedSelection(selection, model.getState().snapshot);
    expect(
      isIndexedRowSelected(
        selection,
        { kind: "data", rowId: 3 },
        model.getState().snapshot,
      ),
    ).toBe(false);
    expect(
      getIndexedSelectionSummary(selection, model.getState().snapshot),
    ).toEqual({ state: "some", selectedCount: 1, visibleCount: 2 });
  });

  test("adds to 25k disjoint intervals with only the new endpoint lookups", () => {
    const source = createModel().getState().snapshot;
    let dataIndexReads = 0;
    const snapshot = {
      ...source,
      visibleRowCount: 50_000,
      visibleDataRowCount: 50_000,
      indexOf(ref: Parameters<typeof source.indexOf>[0]) {
        return ref.kind === "data" &&
          typeof ref.rowId === "number" &&
          ref.rowId >= 0 &&
          ref.rowId < 50_000
          ? ref.rowId
          : -1;
      },
      dataIndexOf(ref: Parameters<typeof source.dataIndexOf>[0]) {
        dataIndexReads += 1;
        return ref.kind === "data" &&
          typeof ref.rowId === "number" &&
          ref.rowId >= 0 &&
          ref.rowId < 50_000
          ? ref.rowId
          : -1;
      },
    };
    let selection = createEmptyIndexedSelection<Row["id"], "team" | "score">();
    for (let rowId = 0; rowId < 50_000; rowId += 2) {
      selection = selectIndexedRowRange(selection, rowId, rowId, snapshot);
    }
    dataIndexReads = 0;

    selection = selectIndexedRowRange(selection, 49_999, 49_999, snapshot);

    expect(dataIndexReads).toBe(2);
    expect(selection.rows.kind).toBe("explicit");
    if (selection.rows.kind !== "explicit")
      throw new Error("expected explicit");
    expect(selection.rows.ranges?.size).toBe(25_000);
  }, 30_000);

  test("reconciles 25k source-owned intervals across a routine revision without endpoint reads", () => {
    const source = createModel().getState().snapshot;
    let dataIndexReads = 0;
    let dataRowReads = 0;
    const snapshot = (revision: number) => ({
      ...source,
      revision,
      visibleRowCount: 50_000,
      visibleDataRowCount: 50_000,
      indexOf(ref: Parameters<typeof source.indexOf>[0]) {
        return ref.kind === "data" &&
          typeof ref.rowId === "number" &&
          ref.rowId >= 0 &&
          ref.rowId < 50_000
          ? ref.rowId
          : -1;
      },
      dataIndexOf(ref: Parameters<typeof source.dataIndexOf>[0]) {
        dataIndexReads += 1;
        return ref.kind === "data" &&
          typeof ref.rowId === "number" &&
          ref.rowId >= 0 &&
          ref.rowId < 50_000
          ? ref.rowId
          : -1;
      },
      dataRowAt(): never {
        dataRowReads += 1;
        throw new Error("routine reconciliation must not materialize rows");
      },
    });
    let selection = createEmptyIndexedSelection<Row["id"], "team" | "score">();
    const initial = snapshot(0);
    for (let rowId = 0; rowId < 50_000; rowId += 2)
      selection = selectIndexedRowRange(selection, rowId, rowId, initial);
    dataIndexReads = 0;

    const next = snapshot(1);
    const reconciled = projectIndexedSelection(selection, initial, next, {
      kind: "changes",
      fromRevision: 0,
      toRevision: 1,
      changes: [{ previousRevision: 0, revision: 1, operations: [] }],
    });

    expect(reconciled.rows.kind).toBe("explicit");
    expect(dataIndexReads).toBe(0);
    expect(dataRowReads).toBe(0);
    expect(getIndexedSelectionSummary(reconciled, next).selectedCount).toBe(
      25_000,
    );
  }, 30_000);

  test("streams an exact 100k reset projection once without requesting a row range", () => {
    const source = createModel().getState().snapshot;
    const makeSnapshot = (revision: number, reversed: boolean) => ({
      ...source,
      revision,
      visibleRowCount: 100_000,
      visibleDataRowCount: 100_000,
      indexOf(ref: Parameters<typeof source.indexOf>[0]) {
        if (ref.kind !== "data" || typeof ref.rowId !== "number") return -1;
        return ref.rowId < 0 || ref.rowId >= 100_000
          ? -1
          : reversed
            ? 99_999 - ref.rowId
            : ref.rowId;
      },
      dataIndexOf(ref: Parameters<typeof source.dataIndexOf>[0]) {
        return this.indexOf(ref);
      },
      dataRowAt(index: number) {
        dataRowReads += 1;
        const rowId = reversed ? 99_999 - index : index;
        return {
          kind: "data" as const,
          rowId,
          row: { id: rowId, team: "a", score: rowId },
          sourceIndex: rowId,
          depth: 0,
        };
      },
      range(): never {
        throw new Error("selection reset projection must stream dataRowAt");
      },
    });
    let dataRowReads = 0;
    const previous = makeSnapshot(0, false);
    const snapshot = makeSnapshot(1, true);
    const selected = selectIndexedRowRange(
      createEmptyIndexedSelection<number, "team" | "score">(),
      0,
      99_999,
      previous,
    );
    dataRowReads = 0;

    const projected = projectIndexedSelection(selected, previous, snapshot, {
      kind: "reset",
      toRevision: 1,
      reason: "bulk-replace",
    });

    expect(dataRowReads).toBe(100_000);
    expect(getIndexedSelectionSummary(projected, snapshot)).toEqual({
      state: "all",
      selectedCount: 100_000,
      visibleCount: 100_000,
    });
    expect(dataRowReads).toBe(100_000);
  });

  test("drops a covered subtree of 50k disjoint exclusions without scanning it", () => {
    const source = createModel().getState().snapshot;
    let dataIndexReads = 0;
    const snapshot = {
      ...source,
      visibleRowCount: 100_000,
      visibleDataRowCount: 100_000,
      indexOf(ref: Parameters<typeof source.indexOf>[0]) {
        return ref.kind === "data" &&
          typeof ref.rowId === "number" &&
          ref.rowId >= 0 &&
          ref.rowId < 100_000
          ? ref.rowId
          : -1;
      },
      dataIndexOf(ref: Parameters<typeof source.dataIndexOf>[0]) {
        dataIndexReads += 1;
        return ref.kind === "data" &&
          typeof ref.rowId === "number" &&
          ref.rowId >= 0 &&
          ref.rowId < 100_000
          ? ref.rowId
          : -1;
      },
    };
    let selection = selectAllVisibleRows(
      createEmptyIndexedSelection<Row["id"], "team" | "score">(),
      snapshot,
    );
    for (let rowId = 0; rowId < 100_000; rowId += 2)
      selection = toggleIndexedRowSelection(selection, rowId, snapshot);
    dataIndexReads = 0;

    const next = selectIndexedRowRange(selection, 0, 99_999, snapshot);

    expect(dataIndexReads).toBe(2);
    expect(getIndexedSelectionSummary(next, snapshot)).toEqual({
      state: "all",
      selectedCount: 100_000,
      visibleCount: 100_000,
    });
  }, 30_000);

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

  test("an evicted row's range survives reconciliation unchanged", () => {
    const previousModel = createLocalRowModel({
      rows: [
        { id: "x", team: "a", score: 1 },
        { id: "y", team: "a", score: 2 },
      ],
      columns,
      getRowId: (row) => row.id,
    });
    const previousSnapshot = previousModel.getState().snapshot;
    // "x" and "y" sat at dataset positions 100 and 101 the last time they
    // were loaded.
    const previousWindow = { start: 100, length: 2 };

    const selection = {
      rows: { kind: "explicit" as const, rowIds: new Set<Row["id"]>() },
      ranges: [
        {
          start: { rowId: "x" as Row["id"], columnId: "team" as const },
          end: { rowId: "y" as Row["id"], columnId: "score" as const },
        },
      ],
      anchor: { rowId: "x" as Row["id"], columnId: "team" as const },
    };

    // The window moved on to an entirely different page -- neither "x" nor
    // "y" is anywhere in the new snapshot, exactly what real eviction looks
    // like from the row model's point of view (it cannot tell this apart
    // from a delete on its own).
    const currentModel = createLocalRowModel({
      rows: [{ id: "z", team: "b", score: 3 }],
      columns,
      getRowId: (row) => row.id,
    });
    const snapshot = currentModel.getState().snapshot;
    // Dataset position 500: nowhere near where "x"/"y" used to sit, so
    // "outside the window" isn't a coincidence of small numbers.
    const loadedWindow = { start: 500, length: 1 };

    const reconciled = reconcileIndexedSelection(selection, snapshot, {
      window: loadedWindow,
      previous: { snapshot: previousSnapshot, window: previousWindow },
    });

    expect(reconciled.ranges).toEqual(selection.ranges);
    // Pinned so an anchor reassignment can't slip in silently: the anchor
    // reset at the bottom of reconcileIndexedSelection triggers on
    // visibility alone, not on eviction-vs-deletion, so a retained range
    // still gives `ranges[0]?.start` a non-null target to reassign to. Here
    // that target happens to equal `selection.anchor`'s value already, which
    // is exactly why this assertion is needed -- without it, a real
    // reassignment would be invisible.
    expect(reconciled.anchor).toEqual(selection.anchor);
  });

  test("a deleted row inside the window's span still prunes", () => {
    const model = createLocalRowModel({
      rows: [
        { id: "x", team: "a", score: 1 },
        { id: "y", team: "a", score: 2 },
        { id: "z", team: "a", score: 3 },
      ],
      columns,
      getRowId: (row) => row.id,
    });
    const previousSnapshot = model.getState().snapshot;
    // Dataset positions 100 (x), 101 (y), 102 (z).
    const previousWindow = { start: 100, length: 3 };

    const selection = {
      rows: { kind: "explicit" as const, rowIds: new Set<Row["id"]>() },
      ranges: [
        {
          start: { rowId: "y" as Row["id"], columnId: "team" as const },
          end: { rowId: "y" as Row["id"], columnId: "team" as const },
        },
      ],
      anchor: { rowId: "y" as Row["id"], columnId: "team" as const },
    };

    // "y" is genuinely removed from the middle -- the window does not move,
    // so its old absolute position (101) is still covered by the current
    // window's span.
    model.applyTransaction({ remove: ["y"] });
    const snapshot = model.getState().snapshot;
    const loadedWindow = { start: 100, length: 2 };

    const reconciled = reconcileIndexedSelection(selection, snapshot, {
      window: loadedWindow,
      previous: { snapshot: previousSnapshot, window: previousWindow },
    });

    expect(reconciled.ranges).toEqual([]);
  });

  test("prunes a range when only ONE endpoint is proven deleted -- the other merely evicted", () => {
    // This is the test that tells `startDeleted || endDeleted` (prune if
    // EITHER endpoint is proven deleted) apart from the wrong simplification
    // `startDeleted && endDeleted` (prune only if BOTH are). The other two
    // eviction tests can't: one has neither endpoint provable, the other has
    // both endpoints be the same row. Only a MIXED pair -- one provable, one
    // not -- distinguishes the two combinators.
    const model = createLocalRowModel({
      rows: [
        { id: "x", team: "a", score: 1 },
        { id: "y", team: "a", score: 2 },
        { id: "z", team: "a", score: 3 },
      ],
      columns,
      getRowId: (row) => row.id,
    });
    const previousSnapshot = model.getState().snapshot;
    // Dataset positions 100 (x), 101 (y), 102 (z).
    const previousWindow = { start: 100, length: 3 };

    const selection = {
      rows: { kind: "explicit" as const, rowIds: new Set<Row["id"]>() },
      ranges: [
        {
          start: { rowId: "x" as Row["id"], columnId: "team" as const },
          end: { rowId: "z" as Row["id"], columnId: "team" as const },
        },
      ],
      anchor: { rowId: "x" as Row["id"], columnId: "team" as const },
    };

    // Neither "x" nor "z" is in the new snapshot -- an unrelated row model,
    // as in the pure-eviction test above.
    const currentModel = createLocalRowModel({
      rows: [{ id: "w", team: "b", score: 4 }],
      columns,
      getRowId: (row) => row.id,
    });
    const snapshot = currentModel.getState().snapshot;
    // Covers only "x"'s old absolute position (100), not "z"'s (102): "x" is
    // provably deleted (window still covers where it was); "z" is merely
    // evicted (unprovable, same as the pure-eviction case).
    const loadedWindow = { start: 100, length: 1 };

    const reconciled = reconcileIndexedSelection(selection, snapshot, {
      window: loadedWindow,
      previous: { snapshot: previousSnapshot, window: previousWindow },
    });

    expect(reconciled.ranges).toEqual([]);
  });

  /**
   * A dataset of `count` rows named `row-0 … row-(count - 1)`, whose dataset
   * position is exactly the number in the name. Every eviction test below
   * slices this one array, so a loaded window's `start` and the ids inside it
   * can never drift apart.
   */
  function datasetRows(count: number) {
    return Array.from({ length: count }, (_, index) => ({
      id: `row-${index}`,
      team: "a",
      score: index,
    }));
  }

  /**
   * A stable population identity. Spans are only readable when the window
   * publishes one -- see `spanReadableInWindow`: an absent `datasetKey` is
   * refused, not treated as agreement, because "no evidence about the
   * population" and "a different population" are the same situation from the
   * engine's side. So every test below that expects a span to survive an
   * eviction publishes one, and the fail-closed test publishes none.
   */
  const DATASET_KEY = "population-1";

  function modelFor(rows: readonly Row[]) {
    return createLocalRowModel({
      rows: [...rows],
      columns,
      getRowId: (row) => row.id,
    }).getState().snapshot;
  }

  function cellRangeSelection(startRowId: string, endRowId: string) {
    return {
      rows: { kind: "explicit" as const, rowIds: new Set<Row["id"]>() },
      ranges: [
        {
          start: { rowId: startRowId as Row["id"], columnId: "team" as const },
          end: { rowId: endRowId as Row["id"], columnId: "score" as const },
        },
      ],
      anchor: { rowId: startRowId as Row["id"], columnId: "team" as const },
    };
  }

  test("counts a selected span whose rows are almost entirely evicted", () => {
    // 4,901 rows at dataset positions 0..4900. The literal matters: the
    // mutation for this test shrinks the SPAN, so a count that secretly reads
    // loaded rows cannot keep reporting it.
    const SPAN_LENGTH = 4_901;
    const all = datasetRows(SPAN_LENGTH);
    const loadedSnapshot = modelFor(all);
    const loadedWindow = {
      start: 0,
      length: SPAN_LENGTH,
      datasetKey: DATASET_KEY,
    };

    const selection = cellRangeSelection("row-0", `row-${SPAN_LENGTH - 1}`);

    // Baseline, everything loaded: the count is the plain resolvable one, and
    // it is verified because both endpoints are present to prove it.
    const whileLoaded = reconcileIndexedSelection(selection, loadedSnapshot, {
      window: loadedWindow,
    });
    expect(
      getIndexedCellSelectionSummary(whileLoaded, loadedSnapshot, loadedWindow),
    ).toEqual({ rowCount: SPAN_LENGTH, verified: true });

    // Evict all but 30 rows, from the middle of the span. Both endpoints go
    // with them, so nothing in the new snapshot can resolve either bound.
    const keptStart = 2_000;
    const keptSnapshot = modelFor(all.slice(keptStart, keptStart + 30));
    const keptWindow = {
      start: keptStart,
      length: 30,
      datasetKey: DATASET_KEY,
    };
    expect(keptSnapshot.sourceRowCount).toBe(30);

    const afterEviction = reconcileIndexedSelection(whileLoaded, keptSnapshot, {
      window: keptWindow,
      previous: { snapshot: loadedSnapshot, window: loadedWindow },
    });

    // The whole point: 4,901 reported off 30 loaded rows.
    expect(
      getIndexedCellSelectionSummary(afterEviction, keptSnapshot, keptWindow)
        .rowCount,
    ).toBe(SPAN_LENGTH);
  });

  test("a span it cannot re-verify reports its count as unverified", () => {
    // Pins the deliberate answer to "what does the count say for a span whose
    // rows it cannot see?" -- it says the span's size, and says it is
    // unverified. Reporting only the loaded rows would understate a real
    // selection by 99%; reporting the span silently as fact would let a row
    // deleted server-side WHILE EVICTED inflate the count forever, because
    // once a row has been absent for one revision `provenDeletedRow` can
    // never prove it deleted again. The flag is the downgrade: the number
    // survives, the claim that it is proven does not.
    const all = datasetRows(4_901);
    const loadedSnapshot = modelFor(all);
    const loadedWindow = {
      start: 0,
      length: all.length,
      datasetKey: DATASET_KEY,
    };
    const selection = cellRangeSelection("row-0", `row-${all.length - 1}`);

    const whileLoaded = reconcileIndexedSelection(selection, loadedSnapshot, {
      window: loadedWindow,
    });
    expect(
      getIndexedCellSelectionSummary(whileLoaded, loadedSnapshot, loadedWindow)
        .verified,
    ).toBe(true);

    const keptSnapshot = modelFor(all.slice(2_000, 2_030));
    const keptWindow = { start: 2_000, length: 30, datasetKey: DATASET_KEY };
    const afterEviction = reconcileIndexedSelection(whileLoaded, keptSnapshot, {
      window: keptWindow,
      previous: { snapshot: loadedSnapshot, window: loadedWindow },
    });

    expect(
      getIndexedCellSelectionSummary(afterEviction, keptSnapshot, keptWindow),
    ).toEqual({ rowCount: 4_901, verified: false });
  });

  test("a rendered row inside an evicted span paints; one outside does not", () => {
    const all = datasetRows(4_901);
    const loadedSnapshot = modelFor(all);
    const loadedWindow = {
      start: 0,
      length: all.length,
      datasetKey: DATASET_KEY,
    };

    // Two ranges, deliberately. A contiguous loaded window and a contiguous
    // span whose endpoints are BOTH evicted can never straddle each other --
    // if the window held the far endpoint, that endpoint would be loaded and
    // reconciliation would collapse the range instead of retaining it. So the
    // discriminator is one rendered row against two spans: `spanning` covers
    // the whole loaded window, `earlier` stops well before it. Same row, same
    // snapshot, same window; only the span differs.
    const selection = {
      rows: { kind: "explicit" as const, rowIds: new Set<Row["id"]>() },
      ranges: [
        {
          start: { rowId: "row-0" as Row["id"], columnId: "team" as const },
          end: { rowId: "row-4900" as Row["id"], columnId: "score" as const },
        },
        {
          start: { rowId: "row-0" as Row["id"], columnId: "team" as const },
          end: { rowId: "row-1500" as Row["id"], columnId: "score" as const },
        },
      ],
      anchor: { rowId: "row-0" as Row["id"], columnId: "team" as const },
    };

    const whileLoaded = reconcileIndexedSelection(selection, loadedSnapshot, {
      window: loadedWindow,
    });

    const keptSnapshot = modelFor(all.slice(2_000, 2_030));
    const keptWindow = { start: 2_000, length: 30, datasetKey: DATASET_KEY };
    const afterEviction = reconcileIndexedSelection(whileLoaded, keptSnapshot, {
      window: keptWindow,
      previous: { snapshot: loadedSnapshot, window: loadedWindow },
    });
    // Both ranges must have survived, or the assertions below would be
    // testing an empty list rather than containment.
    expect(afterEviction.ranges).toHaveLength(2);
    const spanning = afterEviction.ranges[0];
    const earlier = afterEviction.ranges[1];
    if (spanning === undefined || earlier === undefined) {
      throw new Error("expected both ranges to survive eviction");
    }

    // row-2005 sits at dataset position 2005 and IS loaded -- it is a rendered
    // row in the middle of a span whose two endpoints are both gone. Today
    // that paints nothing at all.
    for (const rowId of ["row-2005", "row-2025"]) {
      expect(
        indexedRangeContainsCell(
          spanning,
          { kind: "data", rowId },
          "team",
          keptSnapshot,
          ["team", "score"],
          keptWindow,
        ),
      ).toBe(true);
      expect(
        indexedRangeContainsCell(
          earlier,
          { kind: "data", rowId },
          "team",
          keptSnapshot,
          ["team", "score"],
          keptWindow,
        ),
      ).toBe(false);
    }
  });

  test("an incremental window slide that evicts ONE endpoint keeps the range whole", () => {
    // THE ordinary scrolling case, and the one every fixture-level test above
    // misses: a window that SLIDES retires the range's start several
    // revisions before its end, so for that whole stretch the range has
    // exactly one resolvable endpoint. Collapsing to the survivor there
    // silently rewrites an 81-row selection as a 1-row one -- and stamps the
    // 1-row span over the 81-row one, so the truth is gone even after the
    // evicted endpoint comes back. A window JUMP that clears both endpoints
    // at once (what the tests above do) never reaches this branch.
    const all = datasetRows(200);
    const firstSnapshot = modelFor(all.slice(0, 100));
    const firstWindow = { start: 0, length: 100, datasetKey: DATASET_KEY };
    const selection = cellRangeSelection("row-10", "row-90");

    const stamped = reconcileIndexedSelection(selection, firstSnapshot, {
      window: firstWindow,
    });
    expect(
      getIndexedCellSelectionSummary(stamped, firstSnapshot, firstWindow),
    ).toEqual({ rowCount: 81, verified: true });

    // Slide by 50. "row-10" (dataset position 10) falls out of [50, 150);
    // "row-90" is still loaded, at rank 40 of the new window.
    const slidSnapshot = modelFor(all.slice(50, 150));
    const slidWindow = { start: 50, length: 100, datasetKey: DATASET_KEY };

    const slid = reconcileIndexedSelection(stamped, slidSnapshot, {
      window: slidWindow,
      previous: { snapshot: firstSnapshot, window: firstWindow },
    });

    expect(slid.ranges).toHaveLength(1);
    // Whole, not collapsed: both endpoint IDs survive, so the range re-widens
    // by itself when "row-10" is fetched back.
    expect(slid.ranges[0]?.start.rowId).toBe("row-10");
    expect(slid.ranges[0]?.end.rowId).toBe("row-90");
    expect(
      getIndexedCellSelectionSummary(slid, slidSnapshot, slidWindow),
    ).toEqual({ rowCount: 81, verified: false });
  });

  test("a PROVEN-DELETED endpoint still collapses the range to its survivor", () => {
    // The positive twin of the slide test above: the identical shape --
    // one endpoint absent, one loaded -- must still collapse when the absent
    // one is provably deleted. Without this, "keep the range whole" could be
    // implemented as "never collapse", which would resurrect deleted rows.
    const all = datasetRows(200);
    const firstSnapshot = modelFor(all.slice(0, 100));
    const firstWindow = { start: 0, length: 100, datasetKey: DATASET_KEY };
    const selection = cellRangeSelection("row-10", "row-90");

    const stamped = reconcileIndexedSelection(selection, firstSnapshot, {
      window: firstWindow,
    });

    // "row-10" is genuinely removed while the window stays put, so its old
    // absolute position (10) is still covered by the current window -- the
    // proof `provenDeletedRow` requires. Everything after it shifts down one.
    const afterDelete = [...all.slice(0, 10), ...all.slice(11, 100)];
    const deletedSnapshot = modelFor(afterDelete);
    const deletedWindow = {
      start: 0,
      length: afterDelete.length,
      datasetKey: DATASET_KEY,
    };

    const reconciled = reconcileIndexedSelection(stamped, deletedSnapshot, {
      window: deletedWindow,
      previous: { snapshot: firstSnapshot, window: firstWindow },
    });

    expect(reconciled.ranges).toHaveLength(1);
    expect(reconciled.ranges[0]?.start.rowId).toBe("row-90");
    expect(reconciled.ranges[0]?.end.rowId).toBe("row-90");
    expect(
      getIndexedCellSelectionSummary(
        reconciled,
        deletedSnapshot,
        deletedWindow,
      ),
    ).toEqual({ rowCount: 1, verified: true });
  });

  test("a population change resets spans instead of re-reading them", () => {
    // `resultMeta.datasetKey` is the signal that the positions a span
    // remembers now hold DIFFERENT rows. Spec scope: "selection surviving a
    // query change" is out -- a new datasetKey resets everything, as today.
    const all = datasetRows(200);
    const loadedSnapshot = modelFor(all.slice(0, 100));
    const loadedWindow = { start: 0, length: 100, datasetKey: "sort=name" };
    const selection = cellRangeSelection("row-10", "row-90");

    const stamped = reconcileIndexedSelection(selection, loadedSnapshot, {
      window: loadedWindow,
    });
    expect(
      getIndexedCellSelectionSummary(stamped, loadedSnapshot, loadedWindow),
    ).toEqual({ rowCount: 81, verified: true });

    const resortedSnapshot = modelFor(all.slice(120, 160));
    const resortedWindow = { start: 120, length: 40, datasetKey: "sort=score" };
    const after = reconcileIndexedSelection(stamped, resortedSnapshot, {
      window: resortedWindow,
      previous: { snapshot: loadedSnapshot, window: loadedWindow },
    });

    expect(after.ranges).toEqual([]);
    expect(
      getIndexedCellSelectionSummary(after, resortedSnapshot, resortedWindow),
    ).toEqual({ rowCount: 0, verified: true });
  });

  test("a population change that spares one endpoint never calls the remnant proven", () => {
    // The other shape of the same reset: the re-sort leaves ONE endpoint
    // loaded, so the range collapses onto it instead of vanishing. The
    // collapse is right -- the engine genuinely cannot locate the other rows
    // in a population it has never seen -- but the count over what is left
    // must not be presented as proven. An 81-row selection reporting
    // `{rowCount: 1, verified: true}` is the exact "silent under-count
    // wearing a verified flag" this whole design exists to remove; the fact
    // that a reset caused it does not make the claim true.
    const all = datasetRows(200);
    const loadedSnapshot = modelFor(all.slice(0, 100));
    const loadedWindow = { start: 0, length: 100, datasetKey: "sort=name" };
    const selection = cellRangeSelection("row-10", "row-90");

    const stamped = reconcileIndexedSelection(selection, loadedSnapshot, {
      window: loadedWindow,
    });

    // A window that still covers "row-90" but not "row-10", under a new key.
    const resortedSnapshot = modelFor(all.slice(60, 100));
    const resortedWindow = { start: 60, length: 40, datasetKey: "sort=score" };
    const after = reconcileIndexedSelection(stamped, resortedSnapshot, {
      window: resortedWindow,
      previous: { snapshot: loadedSnapshot, window: loadedWindow },
    });

    // The survivor stays selected -- it is a real, loaded row.
    expect(after.ranges).toHaveLength(1);
    expect(after.ranges[0]?.start.rowId).toBe("row-90");
    // ...and it carries no span, which is what records the doubt.
    expect(after.ranges[0]?.datasetRowSpan).toBeUndefined();
    expect(
      getIndexedCellSelectionSummary(after, resortedSnapshot, resortedWindow),
    ).toEqual({ rowCount: 1, verified: false });
  });

  test("a range still wholly loaded across a population change is re-stamped, not left stale", () => {
    // The positive twin of the two resets above, and the one that keeps the
    // reset from being implemented as "drop everything". Both endpoints are
    // present in the NEW population, so the range is fully locatable there:
    // it survives, its span is re-measured in the new coordinates, and the
    // old key does not linger on it to be emitted through
    // `onSelectionChange` and persisted by a consumer.
    const all = datasetRows(200);
    const loadedSnapshot = modelFor(all.slice(0, 100));
    const loadedWindow = { start: 0, length: 100, datasetKey: "sort=name" };
    const selection = cellRangeSelection("row-10", "row-40");

    const stamped = reconcileIndexedSelection(selection, loadedSnapshot, {
      window: loadedWindow,
    });
    expect(stamped.ranges[0]?.datasetRowSpan).toEqual({
      start: 10,
      end: 40,
      datasetKey: "sort=name",
    });

    // Same rows, re-sorted so they now sit 30 positions further along.
    const resortedSnapshot = modelFor(all.slice(0, 100));
    const resortedWindow = { start: 30, length: 100, datasetKey: "sort=score" };
    const after = reconcileIndexedSelection(stamped, resortedSnapshot, {
      window: resortedWindow,
      previous: { snapshot: loadedSnapshot, window: loadedWindow },
    });

    expect(after.ranges).toHaveLength(1);
    expect(after.ranges[0]?.datasetRowSpan).toEqual({
      start: 40,
      end: 70,
      datasetKey: "sort=score",
    });
    expect(
      getIndexedCellSelectionSummary(after, resortedSnapshot, resortedWindow),
    ).toEqual({ rowCount: 31, verified: true });
  });

  test("a windowed grid that publishes no datasetKey refuses its own spans", () => {
    // FAIL-CLOSED, and the assertion is about PAINT, not about a flag.
    //
    // `datasetKey` is optional and nothing in the type says it is
    // load-bearing, so "windowed, no key" is the default configuration a
    // consumer lands in, not an exotic one. Treating an absent key on both
    // sides as agreement gives that consumer full span trust with zero
    // staleness protection -- and `indexedRangeContainsCell` returns a bare
    // boolean with no `verified` channel, so the failure is not a shaky
    // number, it is a row the user never selected painted as selected.
    const all = datasetRows(200);
    const loadedSnapshot = modelFor(all.slice(0, 100));
    const selection = cellRangeSelection("row-10", "row-40");

    // A re-sort the engine is given no way to detect: the window moves to
    // [30, 130), "row-40" survives at position 35, and position 30 -- inside
    // the span the range remembers -- is now held by a row that has never
    // been in any selection.
    const resortedRows = [
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `other-${index}`,
        team: "a",
        score: index,
      })),
      ...all.slice(40, 100),
    ];
    const resortedSnapshot = modelFor(resortedRows);

    const run = (
      datasetKey: string | undefined,
      secondSnapshot: ReturnType<typeof modelFor>,
      secondLength: number,
      probeRowId: string,
    ) => {
      const first = {
        start: 0,
        length: 100,
        ...(datasetKey === undefined ? {} : { datasetKey }),
      };
      const second = {
        start: 30,
        length: secondLength,
        ...(datasetKey === undefined ? {} : { datasetKey }),
      };
      const stamped = reconcileIndexedSelection(selection, loadedSnapshot, {
        window: first,
      });
      const after = reconcileIndexedSelection(stamped, secondSnapshot, {
        window: second,
        previous: { snapshot: loadedSnapshot, window: first },
      });
      const range = after.ranges[0];
      if (range === undefined) throw new Error("expected a surviving range");
      return {
        summary: getIndexedCellSelectionSummary(after, secondSnapshot, second),
        // A keyless window must not STAMP either, not merely refuse to read
        // back. Observed on the FIRST reconciliation, while both endpoints
        // are still loaded -- that is the only moment a keyless stamp is
        // written, and it is written straight into `onSelectionChange`, where
        // a consumer may persist it and restore it later under a key that
        // happens to match, resurrecting positions measured in a population
        // nobody can now identify.
        stampedWhileLoaded: stamped.ranges[0]?.datasetRowSpan,
        stampedSpan: range.datasetRowSpan,
        // Dataset position 30 either way, so the two runs differ only in what
        // the engine is entitled to believe about that position.
        paintsPosition30: indexedRangeContainsCell(
          range,
          { kind: "data", rowId: probeRowId },
          "team",
          secondSnapshot,
          ["team", "score"],
          second,
        ),
      };
    };

    // Without a key the engine cannot tell the re-sort above from an ordinary
    // scroll, so it refuses its own memory: the count degrades to what it can
    // still see, visibly unverified, and "other-0" -- a row that has never
    // been selected -- does not paint.
    expect(
      run(undefined, resortedSnapshot, resortedRows.length, "other-0"),
    ).toEqual({
      summary: { rowCount: 1, verified: false },
      stampedWhileLoaded: undefined,
      stampedSpan: undefined,
      paintsPosition30: false,
    });

    // The positive twin, so the refusal above cannot be passing because the
    // feature was simply switched off: with a key published and unchanged,
    // the SAME window movement is an honest scroll, the span is read back
    // across the evicted endpoint, and "row-30" -- genuinely inside the
    // user's 10..40 selection -- paints.
    expect(
      run("sort=name", modelFor(all.slice(30, 130)), 100, "row-30"),
    ).toEqual({
      summary: { rowCount: 31, verified: false },
      stampedWhileLoaded: { start: 10, end: 40, datasetKey: "sort=name" },
      stampedSpan: { start: 10, end: 40, datasetKey: "sort=name" },
      paintsPosition30: true,
    });
  });

  test("containment refuses a span measured under a different datasetKey", () => {
    // Reconciliation resets on a datasetKey change, but containment is asked
    // on every painted cell and must not depend on having been reconciled
    // first. A stale span that still answers paints the WRONG rows -- and
    // `indexedRangeContainsCell` returns a bare boolean, so there is no
    // `verified` channel to downgrade through. Refusing is the only honest
    // answer available to it.
    const all = datasetRows(200);
    // Endpoints (10, 90) both evicted; "row-50" rendered in the middle.
    const snapshot = modelFor(all.slice(40, 61));
    const range = {
      start: { rowId: "row-10" as Row["id"], columnId: "team" as const },
      end: { rowId: "row-90" as Row["id"], columnId: "score" as const },
      datasetRowSpan: { start: 10, end: 90, datasetKey: "sort=name" },
    };

    const contains = (datasetKey: string) =>
      indexedRangeContainsCell(
        range,
        { kind: "data", rowId: "row-50" },
        "team",
        snapshot,
        ["team", "score"],
        { start: 40, length: 21, datasetKey },
      );

    // Positive twin first, so "false" below cannot be passing vacuously.
    expect(contains("sort=name")).toBe(true);
    expect(contains("sort=score")).toBe(false);
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
      fc.record({
        kind: fc.constant("range" as const),
        start: fc.integer({ min: 0, max: 31 }),
        end: fc.integer({ min: 0, max: 31 }),
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
          } else if (current.kind === "toggle") {
            selection = toggleIndexedRowSelection(
              selection,
              current.rowId,
              snapshot,
            );
            if (oracle.has(current.rowId)) oracle.delete(current.rowId);
            else oracle.add(current.rowId);
          } else {
            selection = selectIndexedRowRange(
              selection,
              current.start,
              current.end,
              snapshot,
            );
            const lo = Math.min(current.start, current.end);
            const hi = Math.max(current.start, current.end);
            for (let rowId = lo; rowId <= hi; rowId += 1) oracle.add(rowId);
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
