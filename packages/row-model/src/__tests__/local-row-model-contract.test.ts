import { describe, expect, test, vi } from "vitest";

import {
  PretableDisposedModelError,
  PretableRowModelError,
  createColumnHelper,
  createLocalRowModel,
  type PretableGroupId,
  type PretableVisibleRowRef,
} from "../index";

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
const query = {
  filters: [],
  sort: [{ columnId: "score", direction: "desc" }],
  rowGroups: [],
} as const;

function rows(count = 100): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index,
    label: `row-${index}`,
    score: index,
  }));
}

describe("createLocalRowModel flat snapshot contract", () => {
  test("publishes an indexed revision-zero snapshot without construction notifications", () => {
    const inputRows = rows();
    const model = createLocalRowModel({
      rows: inputRows,
      columns,
      getRowId: (row) => row.id,
      query,
    });
    const listener = vi.fn();
    model.subscribe(listener);

    const state = model.getState();
    const snapshot = state.snapshot;
    expect(model.getState()).toBe(state);
    expect(snapshot.revision).toBe(0);
    expect(snapshot.sourceRowCount).toBe(100);
    expect(snapshot.visibleRowCount).toBe(100);
    expect(snapshot.visibleDataRowCount).toBe(100);
    expect(state.status).toEqual({ kind: "ready" });
    expect(listener).not.toHaveBeenCalled();
    expect(model.getColumns()).toBe(model.getColumns());
    expect(model.getColumns()).toEqual(columns);
    expect(model.getColumns()).not.toBe(columns);
    expect(Object.isFrozen(model.getColumns())).toBe(true);
    expect(model.getColumns()[0]).toBe(columns[0]);
    expect(inputRows.map((row) => row.id)).toEqual(
      Array.from({ length: 100 }, (_, index) => index),
    );

    expect(snapshot.rowAt(0)).toMatchObject({
      kind: "data",
      rowId: 99,
      sourceIndex: 99,
      depth: 0,
    });
    expect(snapshot.dataRowAt(99)?.rowId).toBe(0);
    expect(snapshot.firstDataRow()?.rowId).toBe(99);
    expect(snapshot.lastDataRow()?.rowId).toBe(0);
    expect(snapshot.nextDataRow({ kind: "data", rowId: 99 })?.rowId).toBe(98);
    expect(snapshot.previousDataRow({ kind: "data", rowId: 0 })?.rowId).toBe(1);
    expect(snapshot.indexOf({ kind: "data", rowId: 50 })).toBe(49);
    expect(
      snapshot.range(-20, 3).map((row) => row.kind === "data" && row.rowId),
    ).toEqual([99, 98, 97]);
    expect(
      snapshot.range(98, 400).map((row) => row.kind === "data" && row.rowId),
    ).toEqual([1, 0]);
    expect(snapshot.range(8, 2)).toEqual([]);
    expect(snapshot.rowAt(-1)).toBeUndefined();
    expect(snapshot.rowAt(100)).toBeUndefined();
    expect(snapshot.dataRowAt(-1)).toBeUndefined();
    expect(snapshot.dataRowAt(100)).toBeUndefined();
    expect(snapshot.indexOf({ kind: "data", rowId: 404 })).toBe(-1);
    expect(snapshot.nextDataRow({ kind: "data", rowId: 404 })).toBeUndefined();
    expect(
      snapshot.previousDataRow({ kind: "data", rowId: 404 }),
    ).toBeUndefined();
    expect(snapshot.parentGroupOf({ kind: "data", rowId: 50 })).toBeUndefined();
    expect(snapshot.nearestVisibleRef({ kind: "data", rowId: 50 })).toEqual({
      kind: "data",
      rowId: 50,
    });
  });

  test("keeps data and synthetic group refs discriminated when their text collides", () => {
    interface StringRow {
      id: string;
      label: string;
    }
    const helper = createColumnHelper<StringRow>();
    const stringColumns = [helper.accessor("label", { type: "text" })] as const;
    const collision = "group:path";
    const model = createLocalRowModel({
      rows: [{ id: collision, label: "data" }],
      columns: stringColumns,
      getRowId: (row) => row.id,
    });
    const synthetic: PretableVisibleRowRef<string> = {
      kind: "group",
      groupId: collision as PretableGroupId,
    };

    expect(
      model.getState().snapshot.indexOf({ kind: "data", rowId: collision }),
    ).toBe(0);
    expect(model.getState().snapshot.indexOf(synthetic)).toBe(-1);
    expect(
      model.getState().snapshot.nearestVisibleRef(synthetic),
    ).toBeUndefined();
    expect(model.getState().snapshot.isGroupExpanded(synthetic.groupId)).toBe(
      false,
    );
  });

  test("rejects duplicate IDs atomically with structured context", () => {
    expect(() =>
      createLocalRowModel({
        rows: [
          { id: 1, label: "one", score: 1 },
          { id: 1, label: "duplicate", score: 2 },
        ],
        columns,
        getRowId: (row) => row.id,
      }),
    ).toThrowError(
      expect.objectContaining({
        name: "PretableRowModelError",
        code: "duplicate-row-id",
        operation: "set-rows",
        rowId: 1,
      }),
    );
  });

  test("keeps captured roots readable and reuses unchanged public rows", () => {
    const initial = rows(3);
    const model = createLocalRowModel({
      rows: initial,
      columns,
      getRowId: (row) => row.id,
    });
    const listener = vi.fn();
    model.subscribe(listener);
    const oldState = model.getState();
    const unchangedPublicRow = oldState.snapshot.rowAt(2);
    const replacement = [
      { ...initial[0]!, label: "changed" },
      initial[1]!,
      initial[2]!,
    ];

    expect(model.setRows(replacement)).toMatchObject({
      previousRevision: 0,
      revision: 1,
      updated: 1,
      unchanged: 2,
    });
    const nextState = model.getState();
    expect(nextState).not.toBe(oldState);
    expect(nextState.snapshot.revision).toBe(1);
    expect(nextState.snapshot.rowAt(2)).toBe(unchangedPublicRow);
    expect(oldState.snapshot.revision).toBe(0);
    expect(oldState.snapshot.rowAt(0)).toMatchObject({
      row: expect.objectContaining({ label: "row-0" }),
    });
    expect(nextState.snapshot.rowAt(0)).toMatchObject({
      row: expect.objectContaining({ label: "changed" }),
    });
    expect(listener).toHaveBeenCalledTimes(1);

    const noOpState = model.getState();
    expect(model.setRows(replacement)).toMatchObject({
      previousRevision: 1,
      revision: 1,
      unchanged: 3,
    });
    expect(model.getState()).toBe(noOpState);
    expect(listener).toHaveBeenCalledTimes(1);

    const duplicate = [
      { id: 4, label: "first", score: 1 },
      { id: 4, label: "second", score: 2 },
    ];
    expect(() => model.setRows(duplicate)).toThrowError(
      expect.objectContaining({ code: "duplicate-row-id", rowId: 4 }),
    );
    expect(duplicate.every((row) => Object.isExtensible(row))).toBe(true);
    expect(model.getState()).toBe(noOpState);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("disposes once, detaches listeners, preserves snapshots, and guards every command", () => {
    const model = createLocalRowModel({
      rows: rows(3),
      columns,
      getRowId: (row) => row.id,
    });
    const captured = model.getState().snapshot;
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = model.subscribe(first);
    model.subscribe(second);

    model.dispose();

    const disposedState = model.getState();
    expect(disposedState.status).toEqual({ kind: "disposed" });
    expect(model.getState()).toBe(disposedState);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(captured.rowAt(0)?.kind).toBe("data");
    expect(disposedState.snapshot).toBe(captured);
    unsubscribeFirst();
    unsubscribeFirst();
    const late = vi.fn();
    const unsubscribeLate = model.subscribe(late);
    unsubscribeLate();
    unsubscribeLate();
    model.dispose();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(late).not.toHaveBeenCalled();

    const groupId = "g" as PretableGroupId;
    const commands: readonly [string, () => unknown][] = [
      ["set-rows", () => model.setRows([])],
      ["apply-transaction", () => model.applyTransaction({})],
      [
        "set-query",
        () => model.setQuery({ filters: [], sort: [], rowGroups: [] }),
      ],
      ["set-derivations", () => model.setDerivations(columns)],
      ["set-group-expanded", () => model.setGroupExpanded(groupId, true)],
      [
        "set-expansion-default",
        () => model.setExpansionDefault({ kind: "expanded" }),
      ],
      ["expand-all", () => model.expandAll()],
      ["collapse-all", () => model.collapseAll()],
      ["changes-since", () => model.changesSince(0)],
      ["distinct-values", () => model.distinctValues("label")],
    ];
    for (const [operation, command] of commands) {
      expect(command).toThrowError(PretableDisposedModelError);
      try {
        command();
      } catch (error) {
        expect(error).toBeInstanceOf(PretableRowModelError);
        expect(error).toMatchObject({ code: "disposed-model", operation });
      }
    }
  });
});
