import { describe, expect, test } from "vitest";

import { createColumnHelper, createLocalRowModel } from "../index";
import { getLocalRowModelSlotInternalsForTesting } from "../create-local-row-model";
import { getGroupIndex, type GroupIndexRoot } from "../group-index";
import { isScalarAggregateCell } from "../persistent/aggregate-tree";

/**
 * #500 cycle 2 (the insert phase): sum/avg/count columns ride scalar
 * accumulator cells, min/max/custom columns keep the ordered tree, and only
 * the SELECTED population root is built (C1). These tests pin the structural
 * decisions the perf work rests on — the aggregate VALUES are pinned by the
 * existing grouping suites, which must stay green untouched.
 */

interface Row {
  readonly id: string;
  readonly team: string;
  readonly score: number;
  readonly total: number; // sum → scalar cell
  readonly mean: number; // avg → scalar cell
  readonly least: number; // min → ordered tree
  readonly tag: string; // custom → ordered tree
}

const helper = createColumnHelper<Row>();

const traceAggregator = {
  init: () => "",
  accumulate: (accumulator: string, value: unknown) =>
    `${accumulator}${String(value)}`,
  merge: (left: string, right: string) => `${left}${right}`,
  finalize: (accumulator: string) => accumulator,
};

function makeColumns() {
  return [
    helper.accessor("team", { type: "text" }),
    helper.accessor("score", { type: "number", aggregate: "count" }),
    helper.accessor("total", { type: "number", aggregate: "sum" }),
    helper.accessor("mean", { type: "number", aggregate: "avg" }),
    helper.accessor("least", { type: "number", aggregate: "min" }),
    helper.accessor("tag", { type: "text", aggregate: traceAggregator }),
  ] as const;
}

const ROWS: readonly Row[] = [
  { id: "a", team: "Red", score: 30, total: 10, mean: 4, least: 7, tag: "A" },
  { id: "b", team: "Red", score: 10, total: 20, mean: 8, least: 3, tag: "B" },
  { id: "c", team: "Red", score: 20, total: 40, mean: 6, least: 5, tag: "C" },
  { id: "d", team: "Blue", score: 25, total: 5, mean: 2, least: 9, tag: "D" },
  { id: "e", team: "Blue", score: 5, total: 15, mean: 10, least: 1, tag: "E" },
];

function makeModel(options?: {
  readonly aggregateFilteredRows?: boolean;
  readonly minScore?: number;
}) {
  return createLocalRowModel({
    rows: [...ROWS],
    columns: makeColumns(),
    getRowId: (row) => row.id,
    aggregateFilteredRows: options?.aggregateFilteredRows,
    initialExpansion: { kind: "expanded" },
    query: {
      filters:
        options?.minScore === undefined
          ? []
          : [
              {
                columnId: "score",
                operator: "gte",
                value: options.minScore,
              },
            ],
      sort: [{ columnId: "score", direction: "desc" }],
      rowGroups: [{ columnId: "team", direction: "asc" }],
    },
  });
}

function groupIndexOf(model: object): GroupIndexRoot<object, string, unknown> {
  const { root } = getLocalRowModelSlotInternalsForTesting(model);
  const grouped = getGroupIndex(
    (root as unknown as { visible: never }).visible,
  ) as unknown as GroupIndexRoot<object, string, unknown> | undefined;
  expect(grouped).toBeDefined();
  return grouped!;
}

function groupAggregates(model: ReturnType<typeof makeModel>, team: string) {
  const group = model
    .getState()
    .snapshot.range(0, 100)
    .find((row) => row.kind === "group" && row.value === team);
  expect(group).toBeDefined();
  return (group as { aggregates: Readonly<Record<string, unknown>> })
    .aggregates;
}

describe("kind-aware aggregation (#500 cycle 2, decision A)", () => {
  test("sum/avg/count ride scalar cells; min and custom keep the ordered tree", () => {
    const model = makeModel();
    const grouped = groupIndexOf(model);
    let inspected = 0;
    for (const [, node] of grouped.groups.entries()) {
      const selected = node.aggregateRoots.filtered;
      expect(isScalarAggregateCell(selected.get("score"))).toBe(true);
      expect(isScalarAggregateCell(selected.get("total"))).toBe(true);
      expect(isScalarAggregateCell(selected.get("mean"))).toBe(true);
      expect(isScalarAggregateCell(selected.get("least"))).toBe(false);
      expect(isScalarAggregateCell(selected.get("tag"))).toBe(false);
      inspected += 1;
    }
    expect(inspected).toBe(2);
  });

  test("an update arrives as remove-then-insert and the scalar cell stays exact", () => {
    // Invariant 2, pinned behaviorally: if any update path mutated a scalar
    // cell WITHOUT the preceding remove, the old value would still be inside
    // the accumulator and the sums below would double-count.
    const model = makeModel();
    expect(groupAggregates(model, "Red")).toMatchObject({
      total: 70,
      mean: 6,
      score: 3,
    });
    model.applyTransaction({
      update: [{ id: "c", changes: { total: 100, mean: 12 } }],
    });
    // sum = 10 + 20 + 100 (NOT 10 + 20 + 40 + 100); avg = (4+8+12)/3.
    expect(groupAggregates(model, "Red")).toMatchObject({
      total: 130,
      mean: 8,
      score: 3,
    });
    // And back down — the inverse must subtract the updated value exactly.
    model.applyTransaction({
      update: [{ id: "c", changes: { total: 40, mean: 6 } }],
    });
    expect(groupAggregates(model, "Red")).toMatchObject({
      total: 70,
      mean: 6,
      score: 3,
    });
    // Removal drains the cell; count proves the row really left.
    model.applyTransaction({ remove: ["c"] });
    expect(groupAggregates(model, "Red")).toMatchObject({
      total: 30,
      mean: 6,
      score: 2,
    });
  });

  test("a row moving between groups carries its exact contribution", () => {
    const model = makeModel();
    model.applyTransaction({
      update: [{ id: "c", changes: { team: "Blue" } }],
    });
    expect(groupAggregates(model, "Red")).toMatchObject({
      total: 30,
      score: 2,
    });
    expect(groupAggregates(model, "Blue")).toMatchObject({
      total: 60,
      score: 3,
    });
  });

  test("the order-sensitive custom aggregator still folds in row-sort order", () => {
    // Invariant 4: string concatenation is associative (the only validated
    // law) but NOT commutative. Insertion order is a,b,c; the sort is
    // score-desc, so the fold must read A(30), C(20), B(10) — a scalar-style
    // accumulate-at-insert would produce "ABC" instead.
    const model = makeModel();
    expect(groupAggregates(model, "Red")).toMatchObject({ tag: "ACB" });
    // An update re-sorts the row and the fold order must follow.
    model.applyTransaction({ update: [{ id: "b", changes: { score: 40 } }] });
    expect(groupAggregates(model, "Red")).toMatchObject({ tag: "BAC" });
  });
});

describe("only the selected population root is built (#500 cycle 2, C1)", () => {
  for (const aggregateFilteredRows of [false, true]) {
    test(`twin: aggregates under filter (aggregateFilteredRows: ${aggregateFilteredRows})`, () => {
      // The filter (score >= 15) removes b and e, so the two populations
      // genuinely disagree — a wrong-root read cannot match both twins.
      const model = makeModel({ aggregateFilteredRows, minScore: 15 });
      const red = ROWS.filter(
        (row) =>
          row.team === "Red" && (aggregateFilteredRows || row.score >= 15),
      );
      expect(groupAggregates(model, "Red")).toMatchObject({
        score: red.length,
        total: red.reduce((sum, row) => sum + row.total, 0),
        mean: red.reduce((sum, row) => sum + row.mean, 0) / red.length,
        least: Math.min(...red.map((row) => row.least)),
      });
      // Control: the twins disagree on every pinned value source.
      expect(
        ROWS.filter((row) => row.team === "Red" && row.score >= 15).length,
      ).not.toBe(ROWS.filter((row) => row.team === "Red").length);
    });

    test(`the unselected population root is not constructed (aggregateFilteredRows: ${aggregateFilteredRows})`, () => {
      // The structural probe for C1: the write-only root must be ABSENT, on
      // the initial build and after incremental updates. Reverting C1 (build
      // both) fails here directly.
      const model = makeModel({ aggregateFilteredRows, minScore: 15 });
      const assertOnlySelected = () => {
        const grouped = groupIndexOf(model);
        let inspected = 0;
        for (const [, node] of grouped.groups.entries()) {
          const selected = aggregateFilteredRows
            ? node.aggregateRoots.all
            : node.aggregateRoots.filtered;
          const unselected = aggregateFilteredRows
            ? node.aggregateRoots.filtered
            : node.aggregateRoots.all;
          expect(selected.size).toBe(5);
          expect(unselected.size).toBe(0);
          inspected += 1;
        }
        expect(inspected).toBeGreaterThan(0);
      };
      assertOnlySelected();
      model.applyTransaction({
        update: [{ id: "a", changes: { total: 11 } }],
        add: [
          {
            id: "f",
            team: "Green",
            score: 50,
            total: 1,
            mean: 1,
            least: 1,
            tag: "F",
          },
        ],
      });
      assertOnlySelected();
      expect(groupAggregates(model, "Green")).toMatchObject({ total: 1 });
    });

    test(`the cooperative build draft also skips the unselected root (aggregateFilteredRows: ${aggregateFilteredRows})`, () => {
      // The initial grouped build above runs the synchronous path; a
      // cooperative setQuery over BUILTIN-ONLY aggregates runs
      // `createGroupIndexBuildDraft` (a custom aggregator would route to the
      // incremental path and probe nothing new). C1 must hold there too —
      // this probe fails if the draft path builds (or ghost-writes) the
      // write-only root.
      const scheduler: {
        entries: (() => void)[];
        schedule(task: () => void): () => void;
        flushOne(): boolean;
      } = {
        entries: [],
        schedule(task) {
          this.entries.push(task);
          return () => {};
        },
        flushOne() {
          const task = this.entries.shift();
          if (task === undefined) return false;
          task();
          return true;
        },
      };
      const model = createLocalRowModel({
        rows: [...ROWS],
        columns: [
          helper.accessor("team", { type: "text" }),
          helper.accessor("score", { type: "number", aggregate: "count" }),
          helper.accessor("total", { type: "number", aggregate: "sum" }),
          helper.accessor("mean", { type: "number", aggregate: "avg" }),
          helper.accessor("least", { type: "number", aggregate: "min" }),
        ] as const,
        getRowId: (row) => row.id,
        aggregateFilteredRows,
        initialExpansion: { kind: "expanded" },
        query: { filters: [], sort: [], rowGroups: [] },
        transitionScheduler: scheduler,
        transitionClock: () => 0,
      });
      model.setQuery({
        filters: [{ columnId: "score", operator: "gte", value: 15 }],
        sort: [{ columnId: "score", direction: "desc" }],
        rowGroups: [{ columnId: "team", direction: "asc" }],
      });
      let flushed = 0;
      while (scheduler.flushOne()) {
        flushed += 1;
        if (flushed > 100_000) throw new Error("Transition did not settle.");
      }
      expect(model.getState().status).toEqual({ kind: "ready" });
      const grouped = groupIndexOf(model);
      let inspected = 0;
      for (const [, node] of grouped.groups.entries()) {
        const selected = aggregateFilteredRows
          ? node.aggregateRoots.all
          : node.aggregateRoots.filtered;
        const unselected = aggregateFilteredRows
          ? node.aggregateRoots.filtered
          : node.aggregateRoots.all;
        expect(selected.size).toBe(4);
        expect(unselected.size).toBe(0);
        inspected += 1;
      }
      expect(inspected).toBeGreaterThan(0);
    });
  }

  test("a filtered-out row contributes nothing to the post-filter population", () => {
    // Under the default config the selected root is the post-filter one; a
    // row failing the filter must not touch it on insert, and re-passing
    // must add it back exactly once.
    const model = makeModel({ minScore: 15 });
    expect(groupAggregates(model, "Red")).toMatchObject({
      total: 50,
      score: 2,
    });
    // b (score 10) starts filtered out; raise it over the bar.
    model.applyTransaction({ update: [{ id: "b", changes: { score: 16 } }] });
    expect(groupAggregates(model, "Red")).toMatchObject({
      total: 70,
      score: 3,
    });
    // And back out — the removal must unwind the verdict it entered under.
    model.applyTransaction({ update: [{ id: "b", changes: { score: 10 } }] });
    expect(groupAggregates(model, "Red")).toMatchObject({
      total: 50,
      score: 2,
    });
  });
});
