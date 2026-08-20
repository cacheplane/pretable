/**
 * The membership-verdict migration's behavioural gates. `CompiledRowMetadata`
 * no longer carries `filterPasses` and aggregate leaves no longer carry a
 * filtered twin: a row's verdict is its MEMBERSHIP in the root's visible
 * structure. These tests hold the consequences that a purely mechanical
 * rewrite could get wrong — old-verdict resolution under a same-reference
 * mutation, grouped aggregation under both populations, the distinct-value
 * "filtered" population, and the zero-rebuild claim on the filter fast path.
 */

import { describe, expect, test } from "vitest";

import {
  createColumnHelper,
  createLocalRowModel,
  type PretableAggregator,
  type PretableGroupId,
  type PretableQueryFor,
} from "../index";
import type { CooperativeTransitionScheduler } from "../cooperative-transition";
import { createInstrumentedLocalRowModel } from "../diagnostics";

interface Holding {
  id: string;
  team: string;
  score: number;
}

const helper = createColumnHelper<Holding>();

const trace: PretableAggregator<Holding, number, readonly number[], string> = {
  init: () => [],
  accumulate: (accumulator, value) => [...accumulator, value],
  merge: (left, right) => [...left, ...right],
  finalize: (accumulator) => [...accumulator].sort((a, b) => a - b).join("|"),
};

function createColumns() {
  return [
    helper.accessor("team", (row: Holding) => row.team, { type: "text" }),
    helper.accessor("score", (row: Holding) => row.score, {
      type: "number",
      aggregate: "sum",
    }),
    helper.accessor("id", (row: Holding) => row.score, {
      type: "number",
      aggregate: trace,
    }),
  ] as const;
}

type FixtureColumns = ReturnType<typeof createColumns>;

/** Both teams straddle every threshold used below, in both directions. */
const ROWS: readonly Holding[] = Object.freeze([
  { id: "a1", team: "Alpha", score: 10 },
  { id: "a2", team: "Alpha", score: 50 },
  { id: "a3", team: "Alpha", score: 90 },
  { id: "b1", team: "Beta", score: 20 },
  { id: "b2", team: "Beta", score: 60 },
  { id: "b3", team: "Beta", score: 80 },
]);

function flatQuery(threshold: number): PretableQueryFor<FixtureColumns> {
  return {
    filters: [{ columnId: "score", operator: "gte", value: threshold }],
    sort: [{ columnId: "score", direction: "asc" }],
    rowGroups: [],
  } as PretableQueryFor<FixtureColumns>;
}

function groupedQuery(threshold: number): PretableQueryFor<FixtureColumns> {
  return {
    filters: [{ columnId: "score", operator: "gte", value: threshold }],
    sort: [{ columnId: "score", direction: "asc" }],
    rowGroups: [{ columnId: "team", direction: "asc" }],
  } as PretableQueryFor<FixtureColumns>;
}

class ManualScheduler implements CooperativeTransitionScheduler {
  readonly entries: { readonly task: () => void; cancelled: boolean }[] = [];

  schedule(task: () => void): () => void {
    const entry = { task, cancelled: false };
    this.entries.push(entry);
    return () => {
      entry.cancelled = true;
    };
  }

  flushAll(limit = 1_000_000): void {
    let count = 0;
    for (;;) {
      const entry = this.entries.shift();
      if (entry === undefined) return;
      if (!entry.cancelled) entry.task();
      count += 1;
      if (count > limit) throw new Error("Manual scheduler did not settle.");
    }
  }
}

function visibleDataIds(model: {
  getState(): { snapshot: { range(a: number, b: number): readonly unknown[] } };
}): readonly string[] {
  return model
    .getState()
    .snapshot.range(0, Number.MAX_SAFE_INTEGER)
    .flatMap((row) =>
      (row as { kind: string }).kind === "data"
        ? [String((row as { rowId: unknown }).rowId)]
        : [],
    );
}

function groupSummaries(model: {
  getState(): { snapshot: { range(a: number, b: number): readonly unknown[] } };
}) {
  return model
    .getState()
    .snapshot.range(0, Number.MAX_SAFE_INTEGER)
    .flatMap((row) => {
      const candidate = row as {
        kind: string;
        groupId: PretableGroupId;
        childCount: number;
        aggregates: Readonly<Record<string, unknown>>;
      };
      return candidate.kind === "group"
        ? [
            {
              groupId: candidate.groupId,
              childCount: candidate.childCount,
              aggregates: { ...candidate.aggregates },
            },
          ]
        : [];
    });
}

describe("same-reference mutation that flips a verdict", () => {
  /**
   * The case a row-object-keyed verdict store could not serve: the row OBJECT
   * is unchanged, so nothing keyed by it can hold two answers at once. The
   * OLD verdict comes from the committed root's membership and the NEW one is
   * computed under the drafting plan — two distinct authorities, and the
   * visible set is only right if each site asked the right one.
   */
  function mutatingFixture(from: number, to: number) {
    // `preventExtensions` (not `freeze`): the model fingerprints extensible
    // rows and rejects in-place edits to them, so this is how a real consumer
    // reaches the same-reference-mutation path.
    const rows: Holding[] = ROWS.map((row) =>
      Object.preventExtensions({ ...row }),
    );
    const diagnostics: { readonly code: string }[] = [];
    const model = createLocalRowModel({
      rows,
      columns: createColumns(),
      getRowId: (row) => row.id,
      query: flatQuery(50),
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    expect(visibleDataIds(model)).toEqual(["a2", "b2", "b3", "a3"]);
    const target = rows.find((row) => row.score === from)!;
    // In place: same object, same id, same source order.
    target.score = to;
    return { model, rows, target, diagnostics };
  }

  /** Proof the fixture reached the path it claims to test. */
  function expectSameReferenceMutation(
    diagnostics: readonly { readonly code: string }[],
  ) {
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "same-reference-row-mutation",
    );
  }

  test("a row mutated INTO the filter is inserted at its sorted position", () => {
    const { model, rows, target, diagnostics } = mutatingFixture(10, 55);

    model.setRows(rows);

    expectSameReferenceMutation(diagnostics);
    expect(target.id).toBe("a1");
    expect(visibleDataIds(model)).toEqual(["a2", "a1", "b2", "b3", "a3"]);
  });

  test("a row mutated OUT of the filter is removed", () => {
    const { model, rows, target, diagnostics } = mutatingFixture(90, 5);

    model.setRows(rows);

    expectSameReferenceMutation(diagnostics);
    expect(target.id).toBe("a3");
    expect(visibleDataIds(model)).toEqual(["a2", "b2", "b3"]);
  });

  test("a mutation that does NOT flip the verdict leaves membership alone", () => {
    const { model, rows, target, diagnostics } = mutatingFixture(90, 70);

    model.setRows(rows);

    expectSameReferenceMutation(diagnostics);
    expect(target.id).toBe("a3");
    expect(visibleDataIds(model)).toEqual(["a2", "b2", "a3", "b3"]);
  });

  test("the grouped shape survives the same flip", () => {
    // `preventExtensions` (not `freeze`): the model fingerprints extensible
    // rows and rejects in-place edits to them, so this is how a real consumer
    // reaches the same-reference-mutation path.
    const rows: Holding[] = ROWS.map((row) =>
      Object.preventExtensions({ ...row }),
    );
    const diagnostics: { readonly code: string }[] = [];
    const model = createLocalRowModel({
      rows,
      columns: createColumns(),
      getRowId: (row) => row.id,
      initialExpansion: { kind: "expanded" },
      query: groupedQuery(50),
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    expect(visibleDataIds(model)).toEqual(["a2", "a3", "b2", "b3"]);
    rows.find((row) => row.id === "a1")!.score = 55;

    model.setRows(rows);

    expectSameReferenceMutation(diagnostics);
    expect(visibleDataIds(model)).toEqual(["a2", "a1", "a3", "b2", "b3"]);
    const alpha = groupSummaries(model).find((group) =>
      group.groupId.includes("Alpha"),
    )!;
    expect(alpha.childCount).toBe(3);
  });
});

describe("a rows replacement that flips a verdict", () => {
  /**
   * `replaceFlatRowsDraft` removes a row from the visible draft on its OLD
   * verdict and re-inserts on its NEW one. Reading the new verdict for the
   * removal leaves a flipped-out row stranded in the visible tree.
   */
  function replaced(edit: (row: Holding) => Holding) {
    const model = createLocalRowModel({
      rows: ROWS,
      columns: createColumns(),
      getRowId: (row) => row.id,
      query: flatQuery(50),
    });
    expect(visibleDataIds(model)).toEqual(["a2", "b2", "b3", "a3"]);
    model.setRows(ROWS.map((row) => edit({ ...row })));
    return model;
  }

  test("a row edited OUT of the filter leaves the visible set", () => {
    const model = replaced((row) =>
      row.id === "b2" ? { ...row, score: 5 } : row,
    );

    expect(visibleDataIds(model)).toEqual(["a2", "b3", "a3"]);
  });

  test("a row edited INTO the filter joins at its sorted position", () => {
    const model = replaced((row) =>
      row.id === "a1" ? { ...row, score: 55 } : row,
    );

    expect(visibleDataIds(model)).toEqual(["a2", "a1", "b2", "b3", "a3"]);
  });

  test("an unrelated edit leaves membership alone", () => {
    const model = replaced((row) =>
      row.id === "b1" ? { ...row, team: "Gamma" } : row,
    );

    expect(visibleDataIds(model)).toEqual(["a2", "b2", "b3", "a3"]);
  });
});

describe("a transaction update that flips a verdict emits the right ops", () => {
  /**
   * The old-verdict sites in `applyFlatTransactionDraft` decide whether the
   * row is REMOVED from the visible draft and whether a `remove`/`move` op
   * carries a `previousIndex`. Resolving them against the drafting plan
   * instead of the committed root's membership silently drops both.
   */
  function transactionFixture() {
    const model = createLocalRowModel({
      rows: ROWS,
      columns: createColumns(),
      getRowId: (row) => row.id,
      query: flatQuery(50),
    });
    expect(visibleDataIds(model)).toEqual(["a2", "b2", "b3", "a3"]);
    return { model, before: model.getState().snapshot.revision };
  }

  function operationsSince(
    model: ReturnType<typeof transactionFixture>["model"],
    before: number,
  ) {
    const sequence = model.changesSince(before);
    if (sequence.kind !== "changes")
      throw new Error(`Expected per-row changes, got ${sequence.kind}.`);
    return sequence.changes.flatMap((change) => [...change.operations]);
  }

  test("flipping OUT removes the row from its old index", () => {
    const { model, before } = transactionFixture();

    model.applyTransaction({ update: [{ id: "b2", changes: { score: 5 } }] });

    expect(visibleDataIds(model)).toEqual(["a2", "b3", "a3"]);
    expect(operationsSince(model, before)).toEqual([
      { kind: "remove", ref: { kind: "data", rowId: "b2" }, previousIndex: 1 },
    ]);
  });

  test("flipping IN inserts the row at its new index", () => {
    const { model, before } = transactionFixture();

    model.applyTransaction({ update: [{ id: "a1", changes: { score: 55 } }] });

    expect(visibleDataIds(model)).toEqual(["a2", "a1", "b2", "b3", "a3"]);
    expect(operationsSince(model, before)).toEqual([
      { kind: "insert", ref: { kind: "data", rowId: "a1" }, index: 1 },
    ]);
  });

  test("staying IN while moving emits move + update, not remove + insert", () => {
    const { model, before } = transactionFixture();

    model.applyTransaction({ update: [{ id: "a2", changes: { score: 99 } }] });

    expect(visibleDataIds(model)).toEqual(["b2", "b3", "a3", "a2"]);
    expect(operationsSince(model, before)).toEqual([
      {
        kind: "move",
        ref: { kind: "data", rowId: "a2" },
        previousIndex: 0,
        index: 3,
      },
      {
        kind: "update",
        ref: { kind: "data", rowId: "a2" },
        index: 3,
        fields: ["row"],
      },
    ]);
  });

  test("staying OUT emits nothing at all", () => {
    const { model, before } = transactionFixture();

    model.applyTransaction({ update: [{ id: "a1", changes: { score: 15 } }] });

    expect(visibleDataIds(model)).toEqual(["a2", "b2", "b3", "a3"]);
    expect(operationsSince(model, before)).toEqual([]);
  });
});

describe("grouped equivalence with a cold model", () => {
  function warmGrouped(aggregateFilteredRows: boolean) {
    const scheduler = new ManualScheduler();
    let tick = 0;
    const model = createLocalRowModel({
      rows: ROWS,
      columns: createColumns(),
      getRowId: (row) => row.id,
      aggregateFilteredRows,
      initialExpansion: { kind: "expanded" },
      query: groupedQuery(0),
      transitionScheduler: scheduler,
      transitionClock: () => tick++,
      transitionBudgetMs: 1,
    });
    model.setQuery(groupedQuery(55));
    scheduler.flushAll();
    return model;
  }

  function coldGrouped(aggregateFilteredRows: boolean) {
    return createLocalRowModel({
      rows: ROWS,
      columns: createColumns(),
      getRowId: (row) => row.id,
      aggregateFilteredRows,
      initialExpansion: { kind: "expanded" },
      query: groupedQuery(55),
    });
  }

  for (const aggregateFilteredRows of [false, true]) {
    test(`the cooperative rebuild matches a cold build (aggregateFilteredRows: ${aggregateFilteredRows})`, () => {
      const warm = warmGrouped(aggregateFilteredRows);
      const cold = coldGrouped(aggregateFilteredRows);

      expect(visibleDataIds(warm)).toEqual(visibleDataIds(cold));
      expect(groupSummaries(warm)).toEqual(groupSummaries(cold));
      // Control: the rebuild really did move rows out of the population.
      expect(visibleDataIds(cold)).toEqual(["a3", "b2", "b3"]);
    });
  }

  test("the two populations disagree, so the aggregate assertions can fail", () => {
    const filtered = groupSummaries(coldGrouped(false)).find((group) =>
      group.groupId.includes("Alpha"),
    )!;
    const all = groupSummaries(coldGrouped(true)).find((group) =>
      group.groupId.includes("Alpha"),
    )!;

    // Filtered population: only a3 (90) survives `score >= 55`.
    expect(filtered.aggregates).toEqual({ score: 90, id: "90" });
    // All population: every Alpha row counts, filtered out or not.
    expect(all.aggregates).toEqual({ score: 150, id: "10|50|90" });
    expect(filtered.childCount).toBe(1);
    expect(all.childCount).toBe(1);
  });

  /**
   * The BULK group builder (`createGroupIndexBuildDraft`) is chosen only when
   * every aggregate is a builtin, so the fixture above — which carries a
   * custom aggregator — never reaches it. This one does, and it is the path
   * that lost the per-leaf filtered wrapper.
   */
  function builtinColumns() {
    return [
      helper.accessor("team", (row: Holding) => row.team, { type: "text" }),
      helper.accessor("score", (row: Holding) => row.score, {
        type: "number",
        aggregate: "sum",
      }),
    ] as const;
  }

  for (const aggregateFilteredRows of [false, true]) {
    test(`the BULK grouped builder aggregates the right population (aggregateFilteredRows: ${aggregateFilteredRows})`, () => {
      const scheduler = new ManualScheduler();
      let tick = 0;
      const columns = builtinColumns();
      const query = (threshold: number) =>
        ({
          filters: [{ columnId: "score", operator: "gte", value: threshold }],
          sort: [{ columnId: "score", direction: "asc" }],
          rowGroups: [{ columnId: "team", direction: "asc" }],
        }) as PretableQueryFor<ReturnType<typeof builtinColumns>>;
      const warm = createLocalRowModel({
        rows: ROWS,
        columns,
        getRowId: (row) => row.id,
        aggregateFilteredRows,
        initialExpansion: { kind: "expanded" },
        query: query(0),
        transitionScheduler: scheduler,
        transitionClock: () => tick++,
        transitionBudgetMs: 1,
      });
      warm.setQuery(query(55));
      scheduler.flushAll();
      const cold = createLocalRowModel({
        rows: ROWS,
        columns,
        getRowId: (row) => row.id,
        aggregateFilteredRows,
        initialExpansion: { kind: "expanded" },
        query: query(55),
      });

      expect(groupSummaries(warm)).toEqual(groupSummaries(cold));
      expect(
        groupSummaries(warm).find((group) => group.groupId.includes("Alpha"))!
          .aggregates,
      ).toEqual({ score: aggregateFilteredRows ? 150 : 90 });
    });
  }

  test("the cooperative rebuild reaches the same aggregates for BOTH populations", () => {
    expect(
      groupSummaries(warmGrouped(false)).find((group) =>
        group.groupId.includes("Alpha"),
      )!.aggregates,
    ).toEqual({ score: 90, id: "90" });
    expect(
      groupSummaries(warmGrouped(true)).find((group) =>
        group.groupId.includes("Alpha"),
      )!.aggregates,
    ).toEqual({ score: 150, id: "10|50|90" });
  });
});

describe("distinct values read the population from membership", () => {
  async function distinct(
    query: PretableQueryFor<FixtureColumns>,
    population: "all" | "filtered",
  ) {
    const scheduler = new ManualScheduler();
    let tick = 0;
    const model = createLocalRowModel({
      rows: ROWS,
      columns: createColumns(),
      getRowId: (row) => row.id,
      initialExpansion: { kind: "expanded" },
      query,
      transitionScheduler: scheduler,
      transitionClock: () => tick++,
      transitionBudgetMs: 1,
    });
    const pending = model.distinctValues("team", { limit: 10, population });
    scheduler.flushAll();
    const result = await pending.finished;
    return result.values.map((value) => ({
      value: value.value,
      count: value.count,
    }));
  }

  test("a FLAT root's filtered population counts only members", async () => {
    expect(await distinct(flatQuery(55), "filtered")).toEqual([
      { value: "Alpha", count: 1 },
      { value: "Beta", count: 2 },
    ]);
    expect(await distinct(flatQuery(55), "all")).toEqual([
      { value: "Alpha", count: 3 },
      { value: "Beta", count: 3 },
    ]);
  });

  test("a GROUPED root's filtered population counts only leaf members", async () => {
    // The grouped root's flat visible tree is empty, so a membership read
    // that only consulted it would report an empty filtered population here.
    expect(await distinct(groupedQuery(55), "filtered")).toEqual([
      { value: "Alpha", count: 1 },
      { value: "Beta", count: 2 },
    ]);
    expect(await distinct(groupedQuery(55), "all")).toEqual([
      { value: "Alpha", count: 3 },
      { value: "Beta", count: 3 },
    ]);
  });
});

describe("the filter fast path rebuilds no records", () => {
  function fastPathFixture() {
    const scheduler = new ManualScheduler();
    let tick = 0;
    const instrumented = createInstrumentedLocalRowModel({
      rows: ROWS,
      columns: createColumns(),
      getRowId: (row: Holding) => row.id,
      query: flatQuery(50),
      transitionScheduler: scheduler,
      transitionClock: () => tick++,
      transitionBudgetMs: 1,
    });
    return { ...instrumented, scheduler };
  }

  test("a filter-only change copies ZERO rows-map nodes, and still moves rows", () => {
    const { model, diagnostics, scheduler } = fastPathFixture();
    const before = diagnostics.read().work.hamtNodesCopied;

    model.setQuery(flatQuery(15));

    const work = diagnostics.read().work;
    // The rows HAMT is the only persistent map on this path, and it is never
    // opened: no record is reconstructed, so nothing is written to it.
    expect(work.hamtNodesCopied - before).toBe(0);
    expect(work.filterRebuilds).toBe(1);
    // Positive twin: real work happened and the answer is right.
    expect(work.filterRowsFlipped).toBeGreaterThan(0);
    expect(visibleDataIds(model)).toEqual(["b1", "a2", "b2", "b3", "a3"]);
    expect(scheduler.entries).toHaveLength(0);
  });

  test("mutation twin: a rows change on the same model DOES copy map nodes", () => {
    const { model, diagnostics } = fastPathFixture();
    const before = diagnostics.read().work.hamtNodesCopied;

    model.applyTransaction({ update: [{ id: "a1", changes: { score: 99 } }] });

    expect(diagnostics.read().work.hamtNodesCopied - before).toBeGreaterThan(0);
  });
});

describe("nearestVisibleRef", () => {
  function snapshotFor(query: PretableQueryFor<FixtureColumns>) {
    return createLocalRowModel({
      rows: ROWS,
      columns: createColumns(),
      getRowId: (row) => row.id,
      initialExpansion: { kind: "expanded" },
      query,
    }).getState().snapshot;
  }

  test("a FLAT root answers for members and refuses for non-members", () => {
    const snapshot = snapshotFor(flatQuery(55));

    expect(snapshot.nearestVisibleRef({ kind: "data", rowId: "a3" })).toEqual({
      kind: "data",
      rowId: "a3",
    });
    // "a1" scores 10: present in the rows map, absent from the visible tree —
    // the same absence the verdict now reads.
    expect(
      snapshot.nearestVisibleRef({ kind: "data", rowId: "a1" }),
    ).toBeUndefined();
    expect(
      snapshot.nearestVisibleRef({ kind: "data", rowId: "never-seen" }),
    ).toBeUndefined();
  });

  test("a GROUPED root still falls back to the parent group, unchanged", () => {
    const snapshot = snapshotFor(groupedQuery(55));

    expect(snapshot.nearestVisibleRef({ kind: "data", rowId: "a3" })).toEqual({
      kind: "data",
      rowId: "a3",
    });
    expect(snapshot.nearestVisibleRef({ kind: "data", rowId: "a1" })).toEqual({
      kind: "group",
      groupId: "__group__:team=s:Alpha",
    });
    expect(
      snapshot.nearestVisibleRef({ kind: "data", rowId: "never-seen" }),
    ).toBeUndefined();
  });
});
