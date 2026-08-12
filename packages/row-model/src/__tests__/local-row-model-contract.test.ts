import { describe, expect, test, vi } from "vitest";

import {
  PretableDisposedModelError,
  PretableRowModelError,
  type RowIdOf,
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

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

function rows(count = 100): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index,
    label: `row-${index}`,
    score: index,
  }));
}

describe("createLocalRowModel flat snapshot contract", () => {
  test("uses a conventional row.id by default and preserves its inferred type", () => {
    const model = createLocalRowModel({ rows: rows(3), columns });
    type _rowId = Expect<Equal<RowIdOf<typeof model>, number>>;
    const keepTypeFixtureUsed: _rowId = true;

    expect(keepTypeFixtureUsed).toBe(true);
    expect(model.getState().snapshot.rowAt(0)).toMatchObject({ rowId: 0 });
    expect(model.getState().snapshot.indexOf({ kind: "data", rowId: 2 })).toBe(
      2,
    );
  });

  test("keeps explicit ID accessors for arbitrary row domains", () => {
    interface DomainRow {
      key: `holding-${number}`;
      label: string;
    }
    const helper = createColumnHelper<DomainRow>();
    const domainColumns = [helper.accessor("label", { type: "text" })] as const;
    const model = createLocalRowModel({
      rows: [{ key: "holding-1", label: "one" }],
      columns: domainColumns,
      getRowId: (row) => row.key,
    });
    type _rowId = Expect<Equal<RowIdOf<typeof model>, `holding-${number}`>>;
    const keepTypeFixtureUsed: _rowId = true;

    expect(keepTypeFixtureUsed).toBe(true);
    expect(model.getState().snapshot.rowAt(0)).toMatchObject({
      rowId: "holding-1",
    });
  });

  test("requires an explicit accessor when the row domain has no valid id", () => {
    interface MissingIdRow {
      key: string;
      label: string;
    }
    const helper = createColumnHelper<MissingIdRow>();
    const missingIdColumns = [
      helper.accessor("label", { type: "text" }),
    ] as const;
    interface InvalidIdRow {
      id: boolean;
      label: string;
    }
    const invalidHelper = createColumnHelper<InvalidIdRow>();
    const invalidIdColumns = [
      invalidHelper.accessor("label", { type: "text" }),
    ] as const;
    if (false) {
      // @ts-expect-error rows without a conventional ID require getRowId
      createLocalRowModel({
        rows: [{ key: "one", label: "one" }],
        columns: missingIdColumns,
      });
      // @ts-expect-error boolean is not a supported conventional row ID
      createLocalRowModel({
        rows: [{ id: true, label: "one" }],
        columns: invalidIdColumns,
      });
      // @ts-expect-error explicit row IDs must still be strings or numbers
      createLocalRowModel({
        rows: [{ id: true, label: "one" }],
        columns: invalidIdColumns,
        getRowId: (row) => row.id,
      });
    }
    expect(true).toBe(true);
  });

  test("reports invalid, missing, and throwing default IDs as structured errors", () => {
    expect(() =>
      createLocalRowModel({
        rows: [{ label: "missing", score: 1 }] as unknown as Row[],
        columns,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "derivation-failed",
        operation: "set-rows",
      }),
    );
    expect(() =>
      createLocalRowModel({
        rows: [{ id: true, label: "invalid", score: 1 }] as unknown as Row[],
        columns,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "derivation-failed",
        operation: "set-rows",
      }),
    );
    const throwingId = Object.defineProperty(
      { label: "getter", score: 1 },
      "id",
      {
        enumerable: true,
        get: () => {
          throw new Error("spoofed id getter");
        },
      },
    ) as Row;
    expect(() =>
      createLocalRowModel({ rows: [throwingId], columns }),
    ).toThrowError(
      expect.objectContaining({
        code: "derivation-failed",
        operation: "set-rows",
      }),
    );
  });

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
    });
    type _rowId = Expect<Equal<RowIdOf<typeof model>, string>>;
    const keepTypeFixtureUsed: _rowId = true;
    const synthetic: PretableVisibleRowRef<string> = {
      kind: "group",
      groupId: collision as PretableGroupId,
    };

    expect(
      model.getState().snapshot.indexOf({ kind: "data", rowId: collision }),
    ).toBe(0);
    expect(keepTypeFixtureUsed).toBe(true);
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

  test("returns the outer committed revision when a listener publishes again", () => {
    const model = createLocalRowModel({ rows: rows(1), columns });
    const revisions: number[] = [];
    let nestedResult: ReturnType<typeof model.setRows> | undefined;
    model.subscribe(() => {
      revisions.push(model.getState().snapshot.revision);
      if (model.getState().snapshot.revision === 1) {
        nestedResult = model.setRows([
          { id: 0, label: "nested", score: 2 },
          { id: 1, label: "added", score: 1 },
        ]);
      }
    });

    const outerResult = model.setRows([{ id: 0, label: "outer", score: 1 }]);

    expect(outerResult).toMatchObject({
      previousRevision: 0,
      revision: 1,
      updated: 1,
      added: 0,
    });
    expect(nestedResult).toMatchObject({
      previousRevision: 1,
      revision: 2,
      updated: 1,
      added: 1,
    });
    expect(model.getState().snapshot.revision).toBe(2);
    expect(revisions).toEqual([1, 2]);
  });

  test("isolates throwing listeners and honors unsubscription during notification", () => {
    const model = createLocalRowModel({ rows: rows(1), columns });
    const selfRemoving = vi.fn();
    const throwing = vi.fn(() => {
      throw new Error("listener failed");
    });
    const survivor = vi.fn();
    let unsubscribe: () => void = () => undefined;
    unsubscribe = model.subscribe(() => {
      selfRemoving();
      unsubscribe();
    });
    model.subscribe(throwing);
    model.subscribe(survivor);

    expect(() =>
      model.setRows([{ id: 0, label: "first", score: 1 }]),
    ).not.toThrow();
    expect(() =>
      model.setRows([{ id: 0, label: "second", score: 2 }]),
    ).not.toThrow();

    expect(selfRemoving).toHaveBeenCalledTimes(1);
    expect(throwing).toHaveBeenCalledTimes(2);
    expect(survivor).toHaveBeenCalledTimes(2);
  });

  test("remaps setRows accessor failures and rolls back state identity", () => {
    let fail = false;
    const accessorFailure = new Error("accessor failed");
    const helper = createColumnHelper<Row>();
    const activeColumns = [
      helper.accessor(
        "label",
        (row: Row): string => {
          if (fail) throw accessorFailure;
          return row.label;
        },
        { type: "text" },
      ),
    ] as const;
    const model = createLocalRowModel({
      rows: rows(1),
      columns: activeColumns,
      query: {
        filters: [{ columnId: "label", operator: "contains", value: "row" }],
        sort: [],
        rowGroups: [],
      },
    });
    const before = model.getState();
    const listener = vi.fn();
    model.subscribe(listener);
    fail = true;

    expect(() =>
      model.setRows([{ id: 0, label: "changed", score: 0 }]),
    ).toThrowError(
      expect.objectContaining({
        code: "accessor-failed",
        operation: "set-rows",
        rowId: 0,
        columnId: "label",
        cause: accessorFailure,
      }),
    );
    expect(model.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  test("remaps setRows comparator failures with both row IDs and rolls back", () => {
    let fail = false;
    const comparatorFailure = new Error("comparison failed");
    const helper = createColumnHelper<Row>();
    const sortedColumns = [
      helper.accessor("score", (row) => row.score, {
        type: "number",
        compare: (left, right) => {
          if (fail) throw comparatorFailure;
          return left - right;
        },
      }),
    ] as const;
    const model = createLocalRowModel({
      rows: [rows(1)[0]!],
      columns: sortedColumns,
      query: {
        filters: [],
        sort: [{ columnId: "score", direction: "asc" }],
        rowGroups: [],
      },
    });
    const before = model.getState();
    const listener = vi.fn();
    model.subscribe(listener);
    fail = true;

    let thrown: unknown;
    try {
      model.setRows([
        { id: 0, label: "zero", score: 0 },
        { id: 1, label: "one", score: 1 },
      ]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      code: "comparator-failed",
      operation: "set-rows",
      columnId: "score",
      rowIds: expect.arrayContaining([0, 1]),
      cause: comparatorFailure,
    });
    expect(model.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
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
