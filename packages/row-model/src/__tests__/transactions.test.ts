import { describe, expect, test, vi } from "vitest";

import {
  PretableDisposedModelError,
  createColumnHelper,
  createLocalRowModel,
} from "../index";

interface Row {
  id: number;
  label: string;
  score: number;
}

const helper = createColumnHelper<Row>();
const columns = [
  helper.accessor("label", { type: "text" }),
  helper.accessor("score", { type: "number" }),
] as const;

describe("flat transactions", () => {
  test("adds, coalesces partial updates, removes, and preserves captured snapshots", () => {
    const original = { id: 1, label: "one", score: 1 };
    const model = createLocalRowModel({ rows: [original], columns });
    const captured = model.getState().snapshot;
    const listener = vi.fn();
    model.subscribe(listener);

    const result = model.applyTransaction({
      add: [{ id: 2, label: "two", score: 2 }],
      update: [
        { id: 1, changes: { label: "first" } },
        { id: 1, changes: { score: 10 } },
      ],
    });

    expect(result).toMatchObject({
      previousRevision: 0,
      revision: 1,
      added: 1,
      updated: 1,
      removed: 0,
      unchanged: 0,
      ignored: 0,
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(model.getState().snapshot.rowAt(0)).toMatchObject({
      row: { id: 1, label: "first", score: 10 },
    });
    const committed = model.getState().snapshot.rowAt(0);
    expect(committed?.kind === "data" && Object.isFrozen(committed.row)).toBe(
      true,
    );
    expect(original).toEqual({ id: 1, label: "one", score: 1 });
    expect(captured.rowAt(0)).toMatchObject({ row: original });

    expect(model.applyTransaction({ remove: [2] })).toMatchObject({
      previousRevision: 1,
      revision: 2,
      removed: 1,
    });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test("validates all category conflicts and additions before callbacks or publication", () => {
    const accessor = vi.fn((row: Row) => row.score);
    const activeColumns = [
      helper.accessor("score", accessor, { type: "number" }),
    ] as const;
    const model = createLocalRowModel({
      rows: [{ id: 1, label: "one", score: 1 }],
      columns: activeColumns,
      query: {
        filters: [{ columnId: "score", operator: "gte", value: 0 }],
        sort: [],
        rowGroups: [],
      },
    });
    const before = model.getState();
    const listener = vi.fn();
    model.subscribe(listener);
    accessor.mockClear();

    expect(() =>
      model.applyTransaction({
        add: [{ id: 2, label: "two", score: 2 }],
        update: [{ id: 2, changes: { score: 3 } }],
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "transaction-conflict",
        operation: "apply-transaction",
        rowId: 2,
      }),
    );
    expect(() =>
      model.applyTransaction({
        add: [
          { id: 3, label: "three", score: 3 },
          { id: 3, label: "duplicate", score: 4 },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: "duplicate-row-id" }));
    expect(() =>
      model.applyTransaction({
        add: [{ id: 1, label: "existing", score: 5 }],
      }),
    ).toThrowError(expect.objectContaining({ code: "existing-row-id" }));
    expect(model.getState()).toBe(before);
    expect(accessor).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  test("reports unknown operations once and suppresses semantic no-op publications", () => {
    const row = { id: 1, label: "one", score: 1 };
    const model = createLocalRowModel({ rows: [row], columns });
    const listener = vi.fn();
    model.subscribe(listener);
    const before = model.getState();

    const result = model.applyTransaction({
      update: [
        { id: 1, changes: { score: 1 } },
        { id: 404, changes: { score: 4 } },
        { id: 404, changes: { label: "missing" } },
      ],
      remove: [405, 405],
    });

    expect(result).toEqual({
      previousRevision: 0,
      revision: 0,
      added: 0,
      updated: 0,
      removed: 0,
      unchanged: 1,
      ignored: 2,
      issues: [
        { code: "unknown-update-id", rowId: 404 },
        { code: "unknown-remove-id", rowId: 405 },
      ],
    });
    expect(model.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  test("compares a coalesced update's final data state with the original", () => {
    const score = vi.fn((row: Row) => row.score);
    const activeColumns = [
      helper.accessor("score", score, { type: "number" }),
    ] as const;
    const model = createLocalRowModel({
      rows: [{ id: 1, label: "one", score: 1 }],
      columns: activeColumns,
      query: {
        filters: [],
        sort: [{ columnId: "score", direction: "asc" }],
        rowGroups: [],
      },
    });
    const listener = vi.fn();
    model.subscribe(listener);
    score.mockClear();

    expect(
      model.applyTransaction({
        update: [
          { id: 1, changes: { score: 2 } },
          { id: 1, changes: { score: 1 } },
        ],
      }),
    ).toMatchObject({ revision: 0, updated: 0, unchanged: 1 });
    expect(score).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  test("defines __proto__ as an own data field without changing the prototype", () => {
    const token = Symbol("patch-token");
    const model = createLocalRowModel({
      rows: [{ id: 1, label: "one", score: 1 }],
      columns,
    });
    const payload = Object.create(null) as Partial<Row> & {
      __proto__?: unknown;
    };
    Object.defineProperty(payload, "__proto__", {
      value: { polluted: true },
      enumerable: true,
    });
    Object.defineProperty(payload, token, { value: 42, enumerable: true });
    Object.defineProperty(payload, "label", {
      value: "hidden",
      enumerable: false,
    });

    model.applyTransaction({ update: [{ id: 1, changes: payload }] });

    const visible = model.getState().snapshot.rowAt(0);
    expect(visible?.kind).toBe("data");
    if (visible?.kind === "data") {
      expect(Object.getPrototypeOf(visible.row)).toBe(Object.prototype);
      expect(Object.hasOwn(visible.row, "__proto__")).toBe(true);
      expect((visible.row as Row & { __proto__: unknown }).__proto__).toEqual({
        polluted: true,
      });
      expect((visible.row as Row & { [token]: number })[token]).toBe(42);
      expect(visible.row.label).toBe("one");
    }
  });

  test("rolls back accessor failures with exact operation context", () => {
    const failure = new Error("explode");
    const activeColumns = [
      helper.accessor(
        "score",
        (row) => {
          if (row.score === 2) throw failure;
          return row.score;
        },
        { type: "number" },
      ),
    ] as const;
    const model = createLocalRowModel({
      rows: [{ id: 1, label: "one", score: 1 }],
      columns: activeColumns,
      query: {
        filters: [{ columnId: "score", operator: "gte", value: 0 }],
        sort: [],
        rowGroups: [],
      },
    });
    const before = model.getState();
    const listener = vi.fn();
    model.subscribe(listener);

    expect(() =>
      model.applyTransaction({ update: [{ id: 1, changes: { score: 2 } }] }),
    ).toThrowError(
      expect.objectContaining({
        code: "accessor-failed",
        operation: "apply-transaction",
        rowId: 1,
        columnId: "score",
        cause: failure,
      }),
    );
    expect(model.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  test("captures every partial patch before running any active accessor", () => {
    const accessor = vi.fn((row: Row) => row.score);
    const activeColumns = [
      helper.accessor("score", accessor, { type: "number" }),
    ] as const;
    const model = createLocalRowModel({
      rows: [
        { id: 1, label: "one", score: 1 },
        { id: 2, label: "two", score: 2 },
      ],
      columns: activeColumns,
      query: {
        filters: [],
        sort: [{ columnId: "score", direction: "asc" }],
        rowGroups: [],
      },
    });
    accessor.mockClear();
    const hostile = Object.defineProperty({}, "score", {
      enumerable: true,
      get: () => {
        throw new Error("hostile patch");
      },
    });

    expect(() =>
      model.applyTransaction({
        update: [
          { id: 1, changes: { score: 10 } },
          { id: 2, changes: hostile },
        ],
      }),
    ).toThrowError(expect.objectContaining({ operation: "apply-transaction" }));
    expect(accessor).not.toHaveBeenCalled();
    expect(model.getState().snapshot.revision).toBe(0);
  });

  test("captures hostile later entries before any add ID or active accessor callback", () => {
    const getRowId = vi.fn((row: Row) => row.id);
    const accessor = vi.fn((row: Row) => row.score);
    const activeColumns = [
      helper.accessor("score", accessor, { type: "number" }),
    ] as const;
    const model = createLocalRowModel({
      rows: [{ id: 1, label: "one", score: 1 }],
      columns: activeColumns,
      getRowId,
      query: {
        filters: [],
        sort: [{ columnId: "score", direction: "asc" }],
        rowGroups: [],
      },
    });
    getRowId.mockClear();
    accessor.mockClear();
    const hostile = Object.defineProperties(
      {},
      {
        id: { enumerable: true, value: 1 },
        changes: {
          enumerable: true,
          get: () => {
            throw new Error("late entry");
          },
        },
      },
    );

    expect(() =>
      model.applyTransaction({
        add: [{ id: 2, label: "two", score: 2 }],
        update: [
          { id: 1, changes: { label: "ONE" } },
          hostile as { id: number; changes: Partial<Row> },
        ],
      }),
    ).toThrowError(
      expect.objectContaining({
        operation: "apply-transaction",
        path: "transaction.update[1].changes",
        cause: expect.any(Error),
      }),
    );
    expect(getRowId).not.toHaveBeenCalled();
    expect(accessor).not.toHaveBeenCalled();
  });

  test("rejects sparse lists, invalid IDs, and accessor patch fields structurally", () => {
    const model = createLocalRowModel({
      rows: [{ id: 1, label: "one", score: 1 }],
      columns,
    });
    const sparse = Array(1) as Row[];
    expect(() => model.applyTransaction({ add: sparse })).toThrowError(
      expect.objectContaining({ path: "transaction.add[0]" }),
    );
    expect(() =>
      model.applyTransaction({
        update: [{ id: true as never, changes: { score: 2 } }],
      }),
    ).toThrowError(
      expect.objectContaining({ path: "transaction.update[0].id" }),
    );
    expect(() =>
      model.applyTransaction({ remove: [Symbol("bad") as never] }),
    ).toThrowError(expect.objectContaining({ path: "transaction.remove[0]" }));
    const accessorPatch = Object.defineProperty({}, "score", {
      enumerable: true,
      get: () => 2,
    });
    expect(() =>
      model.applyTransaction({
        update: [{ id: 1, changes: accessorPatch }],
      }),
    ).toThrowError(
      expect.objectContaining({
        path: "transaction.update[0].changes.score",
      }),
    );
  });

  test("accepts the model's full numeric ID domain and uses SameValueZero identity", () => {
    const model = createLocalRowModel({ rows: [], columns });
    expect(
      model.applyTransaction({
        add: [
          { id: Number.NaN, label: "nan", score: 1 },
          { id: Number.POSITIVE_INFINITY, label: "infinity", score: 2 },
          { id: -0, label: "zero", score: 3 },
        ],
      }),
    ).toMatchObject({ added: 3 });
    expect(
      model.applyTransaction({
        update: [{ id: Number.NaN, changes: { label: "updated" } }],
      }),
    ).toMatchObject({ updated: 1 });
    expect(() =>
      model.applyTransaction({
        add: [{ id: 0, label: "same-zero", score: 4 }],
      }),
    ).toThrowError(expect.objectContaining({ code: "existing-row-id" }));
  });

  test("wraps hostile category and dense-index getters with their exact path", () => {
    const getRowId = vi.fn((row: Row) => row.id);
    const model = createLocalRowModel({ rows: [], columns, getRowId });
    const categoryFailure = new Error("category");
    const hostileTransaction = Object.defineProperty({}, "update", {
      get: () => {
        throw categoryFailure;
      },
    });
    expect(() =>
      model.applyTransaction(hostileTransaction as never),
    ).toThrowError(
      expect.objectContaining({
        path: "transaction.update",
        cause: categoryFailure,
      }),
    );

    const indexFailure = new Error("index");
    const updates = [{ id: 1, changes: {} }];
    Object.defineProperty(updates, 0, {
      get: () => {
        throw indexFailure;
      },
    });
    expect(() =>
      model.applyTransaction({
        add: [{ id: 2, label: "two", score: 2 }],
        update: updates,
      }),
    ).toThrowError(
      expect.objectContaining({
        path: "transaction.update[0]",
        cause: indexFailure,
      }),
    );
    expect(getRowId).not.toHaveBeenCalled();
  });

  test("never recycles source order after removal and reinsertion", () => {
    const model = createLocalRowModel({
      rows: [
        { id: 1, label: "one", score: 0 },
        { id: 2, label: "two", score: 0 },
      ],
      columns,
    });
    model.applyTransaction({ remove: [2] });
    model.applyTransaction({ add: [{ id: 3, label: "three", score: 0 }] });
    model.applyTransaction({ remove: [3] });
    model.applyTransaction({ add: [{ id: 2, label: "again", score: 0 }] });

    expect(model.getState().snapshot.range(0, 10)).toMatchObject([
      { rowId: 1, sourceIndex: 0 },
      { rowId: 2, sourceIndex: 3 },
    ]);
  });

  test("disposal guard wins", () => {
    const model = createLocalRowModel({ rows: [], columns });
    model.dispose();
    expect(() => model.applyTransaction({})).toThrowError(
      PretableDisposedModelError,
    );
  });
});
