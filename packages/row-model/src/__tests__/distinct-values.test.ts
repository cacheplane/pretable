import { describe, expect, test, vi } from "vitest";

import {
  createColumnHelper,
  createLocalRowModel,
  PretableDisposedModelError,
  type PretableDistinctValueResult,
} from "../index";
import type { CooperativeTransitionScheduler } from "../cooperative-transition";
import { getDistinctValueDiagnosticsForTesting } from "../distinct-values";

interface Row {
  id: number;
  label: string | null | undefined;
  score: number;
  opaque: { readonly code: string };
}

const helper = createColumnHelper<Row>();
const columns = [
  helper.accessor("label", { type: "text" }),
  helper.accessor("score", { type: "number" }),
  helper.accessor("opaque", { type: "text" }),
] as const;

interface ScheduledEntry {
  readonly task: () => void;
  cancelled: boolean;
}

class ManualScheduler implements CooperativeTransitionScheduler {
  readonly entries: ScheduledEntry[] = [];

  schedule(task: () => void): () => void {
    const entry = { task, cancelled: false };
    this.entries.push(entry);
    return () => {
      entry.cancelled = true;
    };
  }

  flushOne(options: { readonly includeCancelled?: boolean } = {}): boolean {
    const entry = this.entries.shift();
    if (entry === undefined) return false;
    if (!entry.cancelled || options.includeCancelled === true) entry.task();
    return true;
  }

  flushAll(limit = 100_000): void {
    let count = 0;
    while (this.flushOne()) {
      count += 1;
      if (count > limit) throw new Error("Manual scheduler did not settle.");
    }
  }
}

function tickingClock() {
  let tick = 0;
  return () => tick++;
}

function makeRows(): readonly Row[] {
  return [
    { id: 1, label: "Beta", score: 1, opaque: { code: "b" } },
    { id: 2, label: "alpha", score: 2, opaque: { code: "a" } },
    { id: 3, label: "Beta", score: 3, opaque: { code: "b" } },
    { id: 4, label: null, score: 4, opaque: { code: "blank" } },
  ];
}

function createModel(options: {
  readonly rows?: readonly Row[];
  readonly scheduler?: ManualScheduler;
  readonly query?: {
    readonly filters: readonly {
      readonly columnId: "score";
      readonly operator: "gte";
      readonly value: number;
    }[];
    readonly sort: readonly [];
    readonly rowGroups: readonly [];
  };
  readonly changeJournalCapacity?: number;
}) {
  return createLocalRowModel({
    rows: options.rows ?? makeRows(),
    columns,
    query: options.query,
    changeJournalCapacity: options.changeJournalCapacity,
    transitionScheduler: options.scheduler,
    transitionClock: tickingClock(),
    transitionBudgetMs: 1,
    transitionMaxUnitsPerSlice: 1,
  });
}

describe("bounded distinct-value dictionaries", () => {
  test("returns exact typed values and counts from the all-row population by default", async () => {
    const scheduler = new ManualScheduler();
    const model = createModel({ scheduler });

    const query = model.distinctValues("label", { limit: 10 });

    expect(query.status).toBe("pending");
    scheduler.flushAll();
    await expect(query.finished).resolves.toEqual({
      values: [
        { value: "alpha", count: 1 },
        { value: "Beta", count: 2 },
      ],
      totalDistinct: 2,
      population: "all",
      rowModelRevision: 0,
    });
    expect(query.status).toBe("ready");
  });

  test("keeps all and post-filter populations independent and current", async () => {
    const scheduler = new ManualScheduler();
    const model = createModel({
      scheduler,
      query: {
        filters: [{ columnId: "score", operator: "gte", value: 3 }],
        sort: [],
        rowGroups: [],
      },
    });
    const all = model.distinctValues("label", { limit: 10 });
    const filtered = model.distinctValues("label", {
      population: "filtered",
      limit: 10,
    });
    scheduler.flushAll();

    await expect(all.finished).resolves.toMatchObject({
      values: [
        { value: "alpha", count: 1 },
        { value: "Beta", count: 2 },
      ],
      population: "all",
    });
    await expect(filtered.finished).resolves.toMatchObject({
      values: [{ value: "Beta", count: 1 }],
      population: "filtered",
    });

    model.applyTransaction({
      update: [{ id: 2, changes: { score: 5 } }],
    });
    await expect(
      model.distinctValues("label", {
        population: "filtered",
        limit: 10,
      }).finished,
    ).resolves.toMatchObject({
      values: [
        { value: "alpha", count: 1 },
        { value: "Beta", count: 1 },
      ],
      rowModelRevision: 1,
    });
  });

  test("supports bounded search and ranges with explicit blank inclusion and ordering", async () => {
    const scheduler = new ManualScheduler();
    const rows: readonly Row[] = [
      { id: 1, label: "alpha", score: 1, opaque: { code: "a" } },
      { id: 2, label: "Beta", score: 2, opaque: { code: "b" } },
      { id: 3, label: "gamma", score: 3, opaque: { code: "g" } },
      { id: 4, label: null, score: 4, opaque: { code: "n" } },
      { id: 5, label: undefined, score: 5, opaque: { code: "u" } },
      { id: 6, label: "   ", score: 6, opaque: { code: "s" } },
    ];
    const model = createModel({ scheduler, rows });
    const searched = model.distinctValues("label", {
      search: "a",
      start: 1,
      limit: 2,
    });
    const blanksFirst = model.distinctValues("label", {
      includeBlanks: true,
      blankOrder: "first",
      limit: 10,
    });
    scheduler.flushAll();

    await expect(searched.finished).resolves.toMatchObject({
      values: [
        { value: "Beta", count: 1 },
        { value: "gamma", count: 1 },
      ],
      totalDistinct: 3,
    });
    const blankResult = await blanksFirst.finished;
    expect(blankResult.values.slice(0, 3).map(({ value }) => value)).toEqual([
      null,
      undefined,
      "   ",
    ]);
    expect(blankResult.values.slice(3).map(({ value }) => value)).toEqual([
      "alpha",
      "Beta",
      "gamma",
    ]);
  });

  test("returns detached Date values that cannot mutate a retained dictionary", async () => {
    interface DatedRow {
      id: number;
      when: Date;
    }
    const datedHelper = createColumnHelper<DatedRow>();
    const datedColumns = [
      datedHelper.accessor("when", { type: "date" }),
    ] as const;
    const scheduler = new ManualScheduler();
    const model = createLocalRowModel({
      rows: [
        { id: 1, when: new Date("2026-01-01T00:00:00.000Z") },
        { id: 2, when: new Date("2026-01-02T00:00:00.000Z") },
      ],
      columns: datedColumns,
      transitionScheduler: scheduler,
      transitionClock: tickingClock(),
      transitionBudgetMs: 1,
      transitionMaxUnitsPerSlice: 1,
    });
    const first = model.distinctValues("when", { limit: 10 });
    scheduler.flushAll();
    const firstResult = await first.finished;
    firstResult.values[0]!.value.setTime(0);

    const secondResult = await model.distinctValues("when", { limit: 10 })
      .finished;
    expect(secondResult.values.map(({ value }) => value.toISOString())).toEqual(
      ["2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z"],
    );
    expect(secondResult.values[0]!.value).not.toBe(
      firstResult.values[0]!.value,
    );
  });

  test("shares an in-progress dictionary across independent projections and cancellation", async () => {
    const scheduler = new ManualScheduler();
    let reads = 0;
    const countedColumns = [
      {
        ...columns[0],
        accessor: (row: Row) => {
          reads += 1;
          return row.label;
        },
        value: (row: Row) => row.label,
      },
      columns[1],
      columns[2],
    ] as const;
    const model = createLocalRowModel({
      rows: makeRows(),
      columns,
      derivations: countedColumns,
      transitionScheduler: scheduler,
      transitionClock: tickingClock(),
      transitionBudgetMs: 1,
      transitionMaxUnitsPerSlice: 1,
    });
    reads = 0;
    const cancelled = model.distinctValues("label", {
      search: "alpha",
      limit: 10,
    });
    const survivor = model.distinctValues("label", {
      search: "beta",
      limit: 10,
    });
    const rejection = expect(cancelled.finished).rejects.toMatchObject({
      name: "PretableDistinctValueCancelledError",
      reason: "cancelled",
    });

    cancelled.cancel();
    scheduler.flushAll();

    await rejection;
    await expect(survivor.finished).resolves.toMatchObject({
      values: [{ value: "Beta", count: 2 }],
    });
    expect(reads).toBe(makeRows().length);
    const cached = model.distinctValues("label", { limit: 10 });
    expect(cached.status).toBe("ready");
    await cached.finished;
    expect(reads).toBe(makeRows().length);
  });

  test("captures inactive derivation replacements without rebuilding and uses them later", async () => {
    const scheduler = new ManualScheduler();
    const model = createModel({ scheduler });
    const original = model.distinctValues("label", { limit: 10 });
    scheduler.flushAll();
    await original.finished;
    const upperAccessor = (row: Row) => row.label?.toUpperCase();
    const descending = (
      left: string | null | undefined,
      right: string | null | undefined,
    ) => String(right).localeCompare(String(left));
    const replacement = [
      {
        ...columns[0],
        accessor: upperAccessor,
        value: upperAccessor,
        compare: descending,
      },
      columns[1],
      columns[2],
    ] as const;

    const transition = model.setDerivations(replacement);

    await expect(transition.finished).resolves.toBe(0);
    expect(transition.requestedDerivations[0]?.accessor).toBe(upperAccessor);
    expect(model.getState()).toMatchObject({
      snapshot: { revision: 0 },
      status: { kind: "ready" },
    });
    expect(scheduler.entries).toHaveLength(0);

    const replaced = model.distinctValues("label", { limit: 10 });
    expect(replaced.status).toBe("pending");
    scheduler.flushAll();
    await expect(replaced.finished).resolves.toMatchObject({
      values: [
        { value: "BETA", count: 2 },
        { value: "ALPHA", count: 1 },
      ],
      rowModelRevision: 0,
    });

    const activated = model.setQuery({
      filters: [{ columnId: "label", operator: "startsWith", value: "B" }],
      sort: [],
      rowGroups: [],
    });
    scheduler.flushAll();
    await activated.finished;
    expect(
      model
        .getState()
        .snapshot.range(0, 10)
        .flatMap((row) => (row.kind === "data" ? [row.rowId] : [])),
    ).toEqual([1, 3]);
  });

  test("catches up through private unbounded deltas despite consumer-journal eviction", async () => {
    const scheduler = new ManualScheduler();
    const model = createModel({
      scheduler,
      changeJournalCapacity: 1,
      rows: Array.from({ length: 20 }, (_, id) => ({
        id,
        label: `value-${id % 2}`,
        score: id,
        opaque: { code: String(id) },
      })),
    });
    const pending = model.distinctValues("label", { limit: 10 });

    model.applyTransaction({
      update: [{ id: 0, changes: { label: "updated" } }],
    });
    model.applyTransaction({
      remove: [1],
      add: [{ id: 21, label: "added", score: 21, opaque: { code: "21" } }],
    });
    model.applyTransaction({
      update: [{ id: 2, changes: { label: "updated" } }],
    });
    expect(model.changesSince(0).kind).toBe("reset");

    scheduler.flushAll();

    await expect(pending.finished).resolves.toMatchObject({
      values: [
        { value: "added", count: 1 },
        { value: "updated", count: 2 },
        { value: "value-0", count: 8 },
        { value: "value-1", count: 9 },
      ],
      rowModelRevision: 3,
    });
  });

  test("bounds each cooperative slice and exposes only direct retention diagnostics", async () => {
    const scheduler = new ManualScheduler();
    let reads = 0;
    const derivations = [
      {
        ...columns[0],
        accessor: (row: Row) => {
          reads += 1;
          return row.label;
        },
        value: (row: Row) => row.label,
      },
      columns[1],
      columns[2],
    ] as const;
    const model = createLocalRowModel({
      rows: makeRows(),
      columns,
      derivations,
      transitionScheduler: scheduler,
      transitionClock: tickingClock(),
      transitionBudgetMs: 1,
      transitionMaxUnitsPerSlice: 1,
    });
    expect(getDistinctValueDiagnosticsForTesting(model)).toMatchObject({
      retainedDictionaryCount: 0,
      buildingDictionaryCount: 0,
      capturedRootCount: 0,
    });
    reads = 0;
    const query = model.distinctValues("label", { limit: 10 });
    expect(reads).toBe(1);
    expect(getDistinctValueDiagnosticsForTesting(model)).toMatchObject({
      buildingDictionaryCount: 1,
      capturedRootCount: 1,
      rowsEvaluated: 1,
    });

    model.applyTransaction({
      update: [{ id: 1, changes: { label: "changed" } }],
    });
    expect(
      getDistinctValueDiagnosticsForTesting(model).candidateDeltaCount,
    ).toBe(1);
    let previousReads = reads;
    while (scheduler.flushOne()) {
      expect(reads - previousReads).toBeLessThanOrEqual(1);
      previousReads = reads;
    }
    await query.finished;
    expect(getDistinctValueDiagnosticsForTesting(model)).toMatchObject({
      retainedDictionaryCount: 1,
      buildingDictionaryCount: 0,
      capturedRootCount: 0,
      candidateDeltaCount: 0,
      releasedCandidateCount: 1,
    });
  });

  test("bounds retained dictionaries with LRU eviction and completely releases evicted roots", async () => {
    interface CacheRow {
      id: number;
      first: string;
      second: string;
      third: string;
    }
    const cacheHelper = createColumnHelper<CacheRow>();
    const cacheColumns = [
      cacheHelper.accessor("first", { type: "text" }),
      cacheHelper.accessor("second", { type: "text" }),
      cacheHelper.accessor("third", { type: "text" }),
    ] as const;
    const scheduler = new ManualScheduler();
    const model = createLocalRowModel({
      rows: [
        { id: 1, first: "a", second: "b", third: "c" },
        { id: 2, first: "d", second: "e", third: "f" },
      ],
      columns: cacheColumns,
      distinctValueCacheCapacity: 2,
      transitionScheduler: scheduler,
      transitionClock: tickingClock(),
      transitionBudgetMs: 1,
      transitionMaxUnitsPerSlice: 1,
    });
    for (const columnId of ["first", "second", "third"] as const) {
      const query = model.distinctValues(columnId, { limit: 10 });
      scheduler.flushAll();
      await query.finished;
    }
    expect(getDistinctValueDiagnosticsForTesting(model)).toMatchObject({
      retainedDictionaryCount: 2,
      retainedRowValueCount: 4,
      retainedDistinctValueCount: 4,
    });
    const before = getDistinctValueDiagnosticsForTesting(model).rowsEvaluated;
    const rebuilt = model.distinctValues("first", { limit: 10 });
    expect(rebuilt.status).toBe("pending");
    scheduler.flushAll();
    await rebuilt.finished;
    expect(
      getDistinctValueDiagnosticsForTesting(model).rowsEvaluated - before,
    ).toBe(2);
    expect(
      getDistinctValueDiagnosticsForTesting(model).retainedDictionaryCount,
    ).toBe(2);
  });

  test("preserves all-population caches across filters and invalidates only filtered semantics", async () => {
    const scheduler = new ManualScheduler();
    let reads = 0;
    const derivations = [
      {
        ...columns[0],
        accessor: (row: Row) => {
          reads += 1;
          return row.label;
        },
        value: (row: Row) => row.label,
      },
      columns[1],
      columns[2],
    ] as const;
    const model = createLocalRowModel({
      rows: makeRows(),
      columns,
      derivations,
      query: {
        filters: [{ columnId: "score", operator: "gte", value: 2 }],
        sort: [],
        rowGroups: [],
      },
      transitionScheduler: scheduler,
      transitionClock: tickingClock(),
      transitionBudgetMs: 1,
      transitionMaxUnitsPerSlice: 1,
    });
    const all = model.distinctValues("label", { limit: 10 });
    const filtered = model.distinctValues("label", {
      population: "filtered",
      limit: 10,
    });
    scheduler.flushAll();
    await Promise.all([all.finished, filtered.finished]);
    reads = 0;

    const transition = model.setQuery({
      filters: [{ columnId: "score", operator: "gte", value: 4 }],
      sort: [],
      rowGroups: [],
    });
    scheduler.flushAll();
    await transition.finished;
    const cachedAll = model.distinctValues("label", { limit: 10 });
    const rebuiltFiltered = model.distinctValues("label", {
      population: "filtered",
      limit: 10,
    });
    expect(cachedAll.status).toBe("ready");
    expect(rebuiltFiltered.status).toBe("pending");
    scheduler.flushAll();
    await Promise.all([cachedAll.finished, rebuiltFiltered.finished]);
    // Filter membership is already cached in row metadata, so the distinct
    // accessor runs only for the one post-filter row.
    expect(reads).toBe(1);
  });

  test("updates retained dictionaries from setRows metadata", async () => {
    const scheduler = new ManualScheduler();
    const model = createModel({ scheduler });
    const initial = model.distinctValues("label", { limit: 10 });
    scheduler.flushAll();
    await initial.finished;

    model.setRows([
      { id: 1, label: "replacement", score: 1, opaque: { code: "r" } },
      { id: 5, label: "new", score: 5, opaque: { code: "n" } },
    ]);

    const updated = model.distinctValues("label", { limit: 10 });
    expect(updated.status).toBe("ready");
    await expect(updated.finished).resolves.toMatchObject({
      values: [
        { value: "new", count: 1 },
        { value: "replacement", count: 1 },
      ],
      rowModelRevision: 1,
    });
  });

  test("stages retained dictionary callbacks before atomically publishing a transaction", async () => {
    const scheduler = new ManualScheduler();
    let fail = false;
    const failure = new Error("distinct accessor failed");
    const derivations = [
      {
        ...columns[0],
        accessor: (row: Row) => {
          if (fail) throw failure;
          return row.label;
        },
        value: (row: Row) => row.label,
      },
      columns[1],
      columns[2],
    ] as const;
    const model = createLocalRowModel({
      rows: makeRows(),
      columns,
      derivations,
      transitionScheduler: scheduler,
      transitionClock: tickingClock(),
      transitionBudgetMs: 1,
      transitionMaxUnitsPerSlice: 1,
    });
    const initial = model.distinctValues("label", { limit: 10 });
    scheduler.flushAll();
    await initial.finished;
    const before = model.getState();
    const listener = vi.fn();
    model.subscribe(listener);
    fail = true;

    expect(() =>
      model.applyTransaction({
        update: [{ id: 1, changes: { label: "changed" } }],
      }),
    ).toThrow(
      expect.objectContaining({
        code: "accessor-failed",
        operation: "apply-transaction",
        rowId: 1,
        columnId: "label",
        cause: failure,
      }),
    );
    expect(model.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    fail = false;
    await expect(
      model.distinctValues("label", { limit: 10 }).finished,
    ).resolves.toMatchObject({
      values: [
        { value: "alpha", count: 1 },
        { value: "Beta", count: 2 },
      ],
      rowModelRevision: 0,
    });
  });

  test("contains query callback failures without changing model state", async () => {
    const scheduler = new ManualScheduler();
    const failure = new Error("query accessor failed");
    const failingColumns = [
      {
        ...columns[0],
        accessor: (): string | null | undefined => {
          throw failure;
        },
        value: (row: Row) => row.label,
      },
      columns[1],
      columns[2],
    ] as const;
    const model = createLocalRowModel({
      rows: makeRows(),
      columns,
      derivations: failingColumns,
      transitionScheduler: scheduler,
      transitionClock: tickingClock(),
      transitionBudgetMs: 1,
      transitionMaxUnitsPerSlice: 1,
    });
    const before = model.getState();
    const query = model.distinctValues("label", { limit: 10 });
    scheduler.flushAll();

    await expect(query.finished).rejects.toMatchObject({
      code: "accessor-failed",
      operation: "distinct-values",
      rowId: 1,
      columnId: "label",
      cause: failure,
    });
    expect(query.status).toBe("error");
    expect(model.getState()).toBe(before);
  });

  test("rolls comparator failures back without corrupting the retained dictionary", async () => {
    const scheduler = new ManualScheduler();
    let fail = false;
    const failure = new Error("distinct comparator failed");
    const derivations = [
      {
        ...columns[0],
        compare: (
          left: string | null | undefined,
          right: string | null | undefined,
        ) => {
          if (fail) throw failure;
          return String(left).localeCompare(String(right));
        },
      },
      columns[1],
      columns[2],
    ] as const;
    const model = createLocalRowModel({
      rows: makeRows(),
      columns,
      derivations,
      transitionScheduler: scheduler,
      transitionClock: tickingClock(),
      transitionBudgetMs: 1,
      transitionMaxUnitsPerSlice: 1,
    });
    const initial = model.distinctValues("label", { limit: 10 });
    scheduler.flushAll();
    await initial.finished;
    const before = model.getState();
    fail = true;

    expect(() =>
      model.applyTransaction({
        update: [{ id: 1, changes: { label: "changed" } }],
      }),
    ).toThrow(
      expect.objectContaining({
        code: "comparator-failed",
        operation: "apply-transaction",
        rowId: 1,
        columnId: "label",
        cause: failure,
      }),
    );
    expect(model.getState()).toBe(before);
    fail = false;
    await expect(
      model.distinctValues("label", { limit: 10 }).finished,
    ).resolves.toMatchObject({
      values: [
        { value: "alpha", count: 1 },
        { value: "Beta", count: 2 },
      ],
      rowModelRevision: 0,
    });
  });

  test("cancels and releases in-flight work before the final disposal notification", async () => {
    const scheduler = new ManualScheduler();
    const model = createModel({ scheduler });
    const query = model.distinctValues("label", { limit: 10 });
    const observed: unknown[] = [];
    model.subscribe(() => {
      observed.push({
        state: model.getState(),
        queryStatus: query.status,
        diagnostics: getDistinctValueDiagnosticsForTesting(model),
      });
    });
    const rejection = expect(query.finished).rejects.toBeInstanceOf(
      PretableDisposedModelError,
    );

    model.dispose();

    await rejection;
    expect(query.status).toBe("cancelled");
    expect(observed).toEqual([
      {
        state: expect.objectContaining({ status: { kind: "disposed" } }),
        queryStatus: "cancelled",
        diagnostics: expect.objectContaining({
          retainedDictionaryCount: 0,
          buildingDictionaryCount: 0,
          capturedRootCount: 0,
          candidateDeltaCount: 0,
          disposed: true,
        }),
      },
    ]);
    scheduler.flushAll();
    expect(() => model.distinctValues("label")).toThrow(
      expect.objectContaining({
        code: "disposed-model",
        operation: "distinct-values",
      }),
    );
  });

  test("validates ranges and always caps default result arrays", async () => {
    const scheduler = new ManualScheduler();
    const model = createModel({
      scheduler,
      rows: Array.from({ length: 150 }, (_, id) => ({
        id,
        label: `value-${String(id).padStart(3, "0")}`,
        score: id,
        opaque: { code: String(id) },
      })),
    });

    expect(() => model.distinctValues("label", { start: -1 })).toThrow(
      RangeError,
    );
    expect(() => model.distinctValues("label", { start: 1.5 })).toThrow(
      RangeError,
    );
    expect(() => model.distinctValues("label", { limit: 0 })).toThrow(
      RangeError,
    );
    expect(() => model.distinctValues("label", { limit: 1_001 })).toThrow(
      RangeError,
    );
    expect(() => model.distinctValues("missing" as never)).toThrow(
      expect.objectContaining({
        code: "derivation-failed",
        operation: "distinct-values",
        columnId: "missing",
      }),
    );
    const unsupported = model.distinctValues("opaque" as never, { limit: 10 });
    await expect(unsupported.finished).rejects.toMatchObject({
      code: "accessor-failed",
      operation: "distinct-values",
      columnId: "opaque",
    });
    const query = model.distinctValues("label");
    scheduler.flushAll();
    const result = await query.finished;
    expect(result.totalDistinct).toBe(150);
    expect(result.values).toHaveLength(100);
  });
});

// Compile-time contract fixtures live beside the runtime behavior so the
// focused feature file documents exact column/value correlation.
function assertDistinctValueTypes(model: ReturnType<typeof createModel>): void {
  const labels: Promise<
    PretableDistinctValueResult<string | null | undefined>
  > = model.distinctValues("label", {
    search: "a",
    start: 0,
    limit: 10,
  }).finished;
  const scores: Promise<PretableDistinctValueResult<number>> =
    model.distinctValues("score").finished;
  void labels;
  void scores;

  // @ts-expect-error unknown columns are rejected
  model.distinctValues("missing");
  // @ts-expect-error object-valued columns are not filterable dictionaries
  model.distinctValues("opaque");
  // @ts-expect-error search is textual
  model.distinctValues("label", { search: 1 });
  // @ts-expect-error start is numeric
  model.distinctValues("label", { start: "0" });
  // @ts-expect-error limit is numeric
  model.distinctValues("label", { limit: "10" });
  // @ts-expect-error blank ordering is explicit
  model.distinctValues("label", { blankOrder: "middle" });
}
void assertDistinctValueTypes;
