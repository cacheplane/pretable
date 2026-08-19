import { describe, expect, test, vi } from "vitest";

import {
  PretableDisposedModelError,
  createColumnHelper,
  createLocalRowModel,
} from "../index";
import { createInstrumentedLocalRowModel } from "../diagnostics";

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
  test("does not churn lowered date extrema for an unrelated row update", () => {
    interface DatedRow {
      readonly id: number;
      readonly group: string;
      readonly occurredOn: string | null;
      readonly label: string;
    }
    const dated = createColumnHelper<DatedRow>();
    const datedColumns = [
      dated.accessor("group", { type: "text" }),
      dated.accessor("occurredOn", {
        type: "date",
        aggregate: "min",
      }),
    ] as const;
    const { model, diagnostics } = createInstrumentedLocalRowModel({
      rows: [
        { id: 1, group: "A", occurredOn: "2026-08-18", label: "one" },
        { id: 2, group: "A", occurredOn: "2025-01-01", label: "two" },
      ],
      columns: datedColumns,
      query: {
        filters: [],
        sort: [],
        rowGroups: [{ columnId: "group" }],
      },
    });
    const before = model.getState().snapshot.rowAt(0);
    if (before?.kind !== "group") throw new Error("missing group");
    const aggregateRoot = before.aggregates;
    diagnostics.resetWork();

    model.applyTransaction({
      update: [{ id: 1, changes: { label: "renamed" } }],
    });

    const after = model.getState().snapshot.rowAt(0);
    expect(after?.kind).toBe("group");
    expect(after?.kind === "group" && after.aggregates).toBe(aggregateRoot);
    expect(diagnostics.read().work.aggregateMerges).toBe(0);
  });

  test("rejects nested commands during proxy capture without losing the outer commit", () => {
    const model = createLocalRowModel({
      rows: [{ id: 1, label: "one", score: 1 }],
      columns,
    });
    let nestedError: unknown;
    const transaction = Object.defineProperty({}, "add", {
      get: () => {
        try {
          model.applyTransaction({
            add: [{ id: 99, label: "nested", score: 99 }],
          });
        } catch (error) {
          nestedError = error;
        }
        return [{ id: 2, label: "outer", score: 2 }];
      },
    });

    expect(model.applyTransaction(transaction as never)).toMatchObject({
      revision: 1,
      added: 1,
    });
    expect(nestedError).toMatchObject({
      code: "reentrant-mutation",
      operation: "apply-transaction",
      activeOperation: "apply-transaction",
    });
    expect(model.getState().snapshot.sourceRowCount).toBe(2);
    expect(model.getState().snapshot.indexOf({ kind: "data", rowId: 99 })).toBe(
      -1,
    );
  });

  test("rolls back when an uncaught nested command escapes a user trap", () => {
    const model = createLocalRowModel({
      rows: [{ id: 1, label: "one", score: 1 }],
      columns,
    });
    const before = model.getState();
    const transaction = Object.defineProperty({}, "add", {
      get: () => {
        model.dispose();
        return [{ id: 2, label: "outer", score: 2 }];
      },
    });

    expect(() => model.applyTransaction(transaction as never)).toThrowError(
      expect.objectContaining({
        code: "reentrant-mutation",
        operation: "dispose",
      }),
    );
    expect(model.getState()).toBe(before);
    expect(model.getState().status).toEqual({ kind: "ready" });
  });
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

  test("guards query and disposal reentrancy from accessors and comparators", () => {
    let accessorNested: unknown;
    let comparatorNested: unknown;
    let runAccessor = false;
    let runComparator = false;
    const activeColumns = [
      helper.accessor(
        "score",
        (row) => {
          if (runAccessor) {
            try {
              model.setQuery({ filters: [], sort: [], rowGroups: [] });
            } catch (error) {
              accessorNested = error;
            }
          }
          return row.score;
        },
        {
          type: "number",
          compare: (left, right) => {
            if (runComparator) {
              try {
                model.dispose();
              } catch (error) {
                comparatorNested = error;
              }
            }
            return left - right;
          },
        },
      ),
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
    runAccessor = true;
    runComparator = true;

    expect(
      model.applyTransaction({
        update: [{ id: 1, changes: { score: 3 } }],
      }),
    ).toMatchObject({ revision: 1, updated: 1 });
    expect(accessorNested).toMatchObject({
      code: "reentrant-mutation",
      operation: "set-query",
    });
    expect(comparatorNested).toMatchObject({
      code: "reentrant-mutation",
      operation: "dispose",
    });
    expect(model.getState().status).toEqual({ kind: "ready" });
    expect(model.getState().snapshot.revision).toBe(1);
  });

  test("rejects row identity changes before derivation work", () => {
    const accessor = vi.fn((row: Row) => row.score);
    const activeColumns = [
      helper.accessor("score", accessor, { type: "number" }),
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
    const before = model.getState();
    accessor.mockClear();

    expect(() =>
      model.applyTransaction({ update: [{ id: 1, changes: { id: 2 } }] }),
    ).toThrowError(
      expect.objectContaining({
        code: "row-identity-change",
        operation: "apply-transaction",
        rowId: 1,
        nextRowId: 2,
      }),
    );
    expect(accessor).not.toHaveBeenCalled();
    expect(model.getState()).toBe(before);
  });

  test("rejects custom identity changes and exotic partial updates", () => {
    interface CustomRow {
      key: string;
      label: string;
    }
    const custom = createColumnHelper<CustomRow>();
    const customColumns = [custom.accessor("label", { type: "text" })] as const;
    const customModel = createLocalRowModel({
      rows: [{ key: "one", label: "one" }],
      columns: customColumns,
      getRowId: (row) => row.key,
    });
    expect(() =>
      customModel.applyTransaction({
        update: [{ id: "one", changes: { key: "two" } }],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "row-identity-change", rowId: "one" }),
    );

    class PrivateRow {
      #secret = 7;
      constructor(
        readonly id: number,
        readonly label: string,
      ) {}
      secret(): number {
        return this.#secret;
      }
    }
    const privateHelper = createColumnHelper<PrivateRow>();
    const privateColumns = [
      privateHelper.accessor("label", { type: "text" }),
    ] as const;
    const original = new PrivateRow(1, "one");
    const privateModel = createLocalRowModel({
      rows: [original],
      columns: privateColumns,
    });
    expect(() =>
      privateModel.applyTransaction({
        update: [{ id: 1, changes: { label: "changed" } }],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "unsupported-row-update", rowId: 1 }),
    );
    expect(original.secret()).toBe(7);
    expect(() =>
      privateModel.setRows([new PrivateRow(1, "replacement")]),
    ).not.toThrow();

    const exoticRows = [
      Object.assign(new Date(0), { id: 1 }),
      Object.assign(new Map(), { id: 1 }),
      Object.assign([], { id: 1 }),
      new Proxy(new PrivateRow(1, "proxy"), {}),
    ];
    for (const exotic of exoticRows) {
      const exoticModel = createLocalRowModel({
        rows: [exotic as unknown as PrivateRow],
        columns: privateColumns,
      });
      expect(() =>
        exoticModel.applyTransaction({
          update: [{ id: 1, changes: { label: "changed" } }],
        }),
      ).toThrowError(
        expect.objectContaining({ code: "unsupported-row-update", rowId: 1 }),
      );
    }

    const revocable = Proxy.revocable(
      { id: 1, label: "revocable", secret: () => 7 },
      {},
    );
    const revocableModel = createLocalRowModel({
      rows: [revocable.proxy as unknown as PrivateRow],
      columns: privateColumns,
    });
    revocable.revoke();
    expect(() =>
      revocableModel.applyTransaction({
        update: [{ id: 1, changes: { label: "changed" } }],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "unsupported-row-update", rowId: 1 }),
    );
  });

  test("rejects fingerprinted proxy and non-extensible rows before partial merge", () => {
    const target = { id: 1, label: "base", score: 1 };
    const proxy = new Proxy(target, {
      get: (source, key, receiver) =>
        key === "label" ? "virtual" : Reflect.get(source, key, receiver),
      preventExtensions: () => {
        throw new Error("proxy refuses freeze");
      },
    });
    const proxyModel = createLocalRowModel({ rows: [proxy], columns });
    const proxyBefore = proxyModel.getState();
    expect(proxyBefore.snapshot.rowAt(0)).toMatchObject({
      row: expect.objectContaining({ label: "virtual", score: 1 }),
    });

    expect(() =>
      proxyModel.applyTransaction({
        update: [{ id: 1, changes: { score: 2 } }],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "unsupported-row-update", rowId: 1 }),
    );
    expect(proxyModel.getState()).toBe(proxyBefore);
    expect(proxyModel.getState().snapshot.rowAt(0)).toMatchObject({
      row: expect.objectContaining({ label: "virtual", score: 1 }),
    });

    const fingerprinted = Object.preventExtensions({
      id: 2,
      label: "fixed",
      score: 2,
    });
    const fixedModel = createLocalRowModel({ rows: [fingerprinted], columns });
    const fixedBefore = fixedModel.getState();
    expect(() =>
      fixedModel.applyTransaction({
        update: [{ id: 2, changes: { score: 3 } }],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "unsupported-row-update", rowId: 2 }),
    );
    expect(fixedModel.getState()).toBe(fixedBefore);
    expect(() =>
      fixedModel.setRows([{ id: 2, label: "replacement", score: 3 }]),
    ).not.toThrow();
    expect(fixedModel.getState().snapshot.rowAt(0)).toMatchObject({
      row: { label: "replacement", score: 3 },
    });

    const nullPrototype = Object.assign(Object.create(null), {
      id: 3,
      label: "null",
      score: 3,
    }) as Row;
    const nullModel = createLocalRowModel({ rows: [nullPrototype], columns });
    expect(
      nullModel.applyTransaction({
        update: [{ id: 3, changes: { score: 4 } }],
      }),
    ).toMatchObject({ updated: 1, revision: 1 });
    const updated = nullModel.getState().snapshot.rowAt(0);
    expect(updated?.kind === "data" && Object.getPrototypeOf(updated.row)).toBe(
      null,
    );
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
