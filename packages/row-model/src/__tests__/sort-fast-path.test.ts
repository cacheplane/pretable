import { describe, expect, test, vi } from "vitest";

import {
  compileQuery,
  createColumnHelper,
  PretableRowModelError,
  resortRecordMetadata,
  type PretableQueryFor,
} from "../index";
import type { CompiledQuery } from "../compiled-query";
import type { LocalRowModelInstrumentation } from "../diagnostics";
import type { RevisionRoot } from "../internal-types";
import { compareOrderStatisticTreeIds } from "../persistent/order-statistic-tree";
import { createPersistentMap } from "../persistent/persistent-map";
import { buildRowStore } from "../row-store";
import { rebuildRootForSortOnlyChange } from "../sort-rebuild";
import type { PretableGroupId } from "../types";
import { createVisibleIndex } from "../visible-index";

interface Holding {
  id: string;
  team: string;
  score: number;
  note: string;
  label: string;
}

const helper = createColumnHelper<Holding>();

/**
 * Checks a query literal against a column tuple, exactly as
 * `query-delta.test.ts` does.
 */
function queryFor<TColumns>(
  value: PretableQueryFor<TColumns>,
): PretableQueryFor<TColumns> {
  return value;
}

const ROW: Holding = {
  id: "r1",
  team: "Alpha",
  score: 10,
  note: "steady",
  label: "unused",
};

/**
 * Builds the shared fixture: spied accessors on every column so tests can
 * assert exactly which accessors a carryover rebuild runs. `label` is inactive
 * in BOTH plans (never sorted, filtered, grouped, or aggregated), so its spy
 * count must be 0 throughout — including the setup `evaluate`.
 */
function createFixture() {
  const teamAccessor = vi.fn((row: Holding) => row.team);
  const scoreAccessor = vi.fn((row: Holding) => row.score);
  const noteAccessor = vi.fn((row: Holding) => row.note);
  const labelAccessor = vi.fn((row: Holding) => row.label);
  const columns = [
    helper.accessor("team", teamAccessor, { type: "text" }),
    helper.accessor("score", scoreAccessor, {
      type: "number",
      aggregate: "sum",
    }),
    helper.accessor("note", noteAccessor, { type: "text" }),
    helper.accessor("label", labelAccessor, { type: "text" }),
  ] as const;
  return { columns, teamAccessor, scoreAccessor, noteAccessor, labelAccessor };
}

type FixtureColumns = ReturnType<typeof createFixture>["columns"];

const SCORE_DESC_TEAM_FILTER = queryFor<FixtureColumns>({
  filters: [{ columnId: "team", operator: "equals", value: "Alpha" }],
  sort: [{ columnId: "score", direction: "desc" }],
  rowGroups: [],
});

const SCORE_ASC_TEAM_FILTER = queryFor<FixtureColumns>({
  filters: [{ columnId: "team", operator: "equals", value: "Alpha" }],
  sort: [{ columnId: "score", direction: "asc" }],
  rowGroups: [],
});

const NOTE_ASC_TEAM_FILTER = queryFor<FixtureColumns>({
  filters: [{ columnId: "team", operator: "equals", value: "Alpha" }],
  sort: [{ columnId: "note", direction: "asc" }],
  rowGroups: [],
});

describe("resortRecordMetadata", () => {
  test("carries sort, filter-verdict, and aggregate values without re-running accessors", () => {
    const fixture = createFixture();
    const previousPlan = compileQuery({
      derivations: fixture.columns,
      query: SCORE_DESC_TEAM_FILTER,
    });
    const nextPlan = compileQuery({
      derivations: fixture.columns,
      query: SCORE_ASC_TEAM_FILTER,
    });
    const previous = previousPlan.evaluate({
      rowId: "r1",
      row: ROW,
      sourceOrder: 0,
    });

    fixture.teamAccessor.mockClear();
    fixture.scoreAccessor.mockClear();
    const rebuilt = resortRecordMetadata(nextPlan, previous);

    expect(rebuilt.filterPasses).toBe(previous.filterPasses);
    expect(rebuilt.filterPasses).toBe(true);
    expect(rebuilt.groupPath).toBe(previous.groupPath);
    expect(rebuilt.sortKeys).toEqual([{ columnId: "score", value: 10 }]);
    expect(rebuilt.aggregateLeaves[0].allLeaf.value).toBe(
      previous.aggregateLeaves[0].allLeaf.value,
    );
    // Every retained value must come from the prior metadata, not a re-run.
    expect(fixture.teamAccessor).not.toHaveBeenCalled();
    expect(fixture.scoreAccessor).not.toHaveBeenCalled();
    // Inactive in BOTH plans, so 0 across setup and rebuild alike.
    expect(fixture.labelAccessor).not.toHaveBeenCalled();
  });

  test("runs the accessor for a newly-active sort column exactly once", () => {
    const fixture = createFixture();
    const previousPlan = compileQuery({
      derivations: fixture.columns,
      query: SCORE_DESC_TEAM_FILTER,
    });
    const nextPlan = compileQuery({
      derivations: fixture.columns,
      query: NOTE_ASC_TEAM_FILTER,
    });
    const previous = previousPlan.evaluate({
      rowId: "r1",
      row: ROW,
      sourceOrder: 0,
    });
    expect(fixture.noteAccessor).toHaveBeenCalledTimes(0);

    const rebuilt = resortRecordMetadata(nextPlan, previous);

    expect(fixture.noteAccessor).toHaveBeenCalledTimes(1);
    expect(rebuilt.sortKeys).toEqual([{ columnId: "note", value: "steady" }]);
  });

  test("aggregate leaves embed the NEW dependency", () => {
    const fixture = createFixture();
    const previousPlan = compileQuery({
      derivations: fixture.columns,
      query: SCORE_DESC_TEAM_FILTER,
    });
    const nextPlan = compileQuery({
      derivations: fixture.columns,
      query: SCORE_ASC_TEAM_FILTER,
    });
    const previous = previousPlan.evaluate({
      rowId: "r1",
      row: ROW,
      sourceOrder: 7,
    });

    const rebuilt = resortRecordMetadata(nextPlan, previous);

    const leaf = rebuilt.aggregateLeaves[0];
    expect(leaf.allLeaf.dependency.sortKeys).toBe(rebuilt.sortKeys);
    expect(leaf.allLeaf.dependency.sourceOrder).toBe(7);
    expect(rebuilt.sourceOrder).toBe(7);
    expect(leaf.filteredLeaf).toBe(leaf.allLeaf);
  });

  test("filteredLeaf is undefined when the row failed the (unchanged) filter", () => {
    const fixture = createFixture();
    const failingRow: Holding = { ...ROW, team: "Beta" };
    const previousPlan = compileQuery({
      derivations: fixture.columns,
      query: SCORE_DESC_TEAM_FILTER,
    });
    const nextPlan = compileQuery({
      derivations: fixture.columns,
      query: SCORE_ASC_TEAM_FILTER,
    });
    const previous = previousPlan.evaluate({
      rowId: "r2",
      row: failingRow,
      sourceOrder: 1,
    });
    expect(previous.filterPasses).toBe(false);

    const rebuilt = resortRecordMetadata(nextPlan, previous);

    expect(rebuilt.filterPasses).toBe(false);
    expect(rebuilt.aggregateLeaves[0].filteredLeaf).toBeUndefined();
  });

  test("seeds the plan's evaluation cache compatibly with evaluate", () => {
    const fixture = createFixture();
    const previousPlan = compileQuery({
      derivations: fixture.columns,
      query: SCORE_DESC_TEAM_FILTER,
    });
    const nextPlan = compileQuery({
      derivations: fixture.columns,
      query: SCORE_ASC_TEAM_FILTER,
    });
    const previous = previousPlan.evaluate({
      rowId: "r1",
      row: ROW,
      sourceOrder: 0,
    });

    const rebuilt = resortRecordMetadata(nextPlan, previous);

    expect(resortRecordMetadata(nextPlan, previous)).toBe(rebuilt);
    expect(
      nextPlan.evaluate({ rowId: "r1", row: ROW, sourceOrder: 0 }),
    ).toBe(rebuilt);
  });

  test("accessor failure surfaces the slow path's error shape", () => {
    const boom = new Error("boom");
    const columns = [
      helper.accessor("team", { type: "text" }),
      helper.accessor("score", { type: "number" }),
      helper.accessor(
        "note",
        // Annotated so the throwing accessor still types as a text column;
        // an inferred `never` value type breaks the tuple under typecheck.
        (): string => {
          throw boom;
        },
        { type: "text" },
      ),
      helper.accessor("label", { type: "text" }),
    ] as const;
    const previousPlan = compileQuery({
      derivations: columns,
      query: queryFor<typeof columns>({
        filters: [],
        sort: [{ columnId: "score", direction: "asc" }],
        rowGroups: [],
      }),
    });
    const nextPlan = compileQuery({
      derivations: columns,
      query: queryFor<typeof columns>({
        filters: [],
        sort: [{ columnId: "note", direction: "asc" }],
        rowGroups: [],
      }),
    });
    const previous = previousPlan.evaluate({
      rowId: "r1",
      row: ROW,
      sourceOrder: 0,
    });

    let caught: unknown;
    try {
      resortRecordMetadata(nextPlan, previous);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PretableRowModelError);
    const error = caught as PretableRowModelError;
    expect(error.code).toBe("accessor-failed");
    expect(error.rowId).toBe("r1");
    expect(error.columnId).toBe("note");
    expect(error.cause).toBe(boom);
  });

  test("TypeError for a foreign plan object", () => {
    const fixture = createFixture();
    const previousPlan = compileQuery({
      derivations: fixture.columns,
      query: SCORE_DESC_TEAM_FILTER,
    });
    const previous = previousPlan.evaluate({
      rowId: "r1",
      row: ROW,
      sourceOrder: 0,
    });
    const foreign = {
      query: SCORE_ASC_TEAM_FILTER,
      derivations: fixture.columns,
    };

    expect(() =>
      resortRecordMetadata(foreign as never, previous),
    ).toThrowError(
      new TypeError("Metadata carryover requires a compiled query plan."),
    );
  });

  test("equivalence: carryover deep-equals a cold evaluate under the next plan", () => {
    const fixture = createFixture();
    const previousPlan = compileQuery({
      derivations: fixture.columns,
      query: SCORE_DESC_TEAM_FILTER,
    });
    const nextPlan = compileQuery({
      derivations: fixture.columns,
      query: SCORE_ASC_TEAM_FILTER,
    });
    // An identical plan compiled WITHOUT `previous` chaining: distinct object,
    // cold cache, so its evaluate takes the full slow path.
    const twinPlan = compileQuery({
      derivations: fixture.columns,
      query: SCORE_ASC_TEAM_FILTER,
    });
    expect(twinPlan).not.toBe(nextPlan);
    const previous = previousPlan.evaluate({
      rowId: "r1",
      row: ROW,
      sourceOrder: 3,
    });

    const rebuilt = resortRecordMetadata(nextPlan, previous);
    const fresh = twinPlan.evaluate({ rowId: "r1", row: ROW, sourceOrder: 3 });

    expect(rebuilt.sortKeys).toEqual(fresh.sortKeys);
    expect(rebuilt.filterPasses).toBe(fresh.filterPasses);
    expect(rebuilt.groupPath).toEqual(fresh.groupPath);
    expect(
      rebuilt.aggregateLeaves.map((leaf) => leaf.allLeaf.value),
    ).toEqual(fresh.aggregateLeaves.map((leaf) => leaf.allLeaf.value));
    expect(
      rebuilt.aggregateLeaves.map((leaf) => leaf.filteredLeaf !== undefined),
    ).toEqual(fresh.aggregateLeaves.map((leaf) => leaf.filteredLeaf !== undefined));
  });
});

/**
 * Seven rows chosen so the three orders that matter are pairwise-distinct
 * permutations (asserted below): source order, score-desc order, note-asc
 * order. `h3` fails the team filter; `h4`/`h5` tie on `note`, and `h5`
 * appears BEFORE `h4` in source order while its id sorts AFTER — so the
 * engine's real tie resolution (compareRows falls through to sourceOrder)
 * and an id-based one produce OPPOSITE orders for the tied pair, and the
 * expectations below can disprove either mistake.
 */
const ROOT_ROWS: readonly Holding[] = Object.freeze([
  { id: "h1", team: "Alpha", score: 50, note: "delta", label: "u" },
  { id: "h2", team: "Alpha", score: 10, note: "alpha", label: "u" },
  { id: "h3", team: "Beta", score: 99, note: "aaaa", label: "u" },
  { id: "h5", team: "Alpha", score: 70, note: "bravo", label: "u" },
  { id: "h4", team: "Alpha", score: 30, note: "bravo", label: "u" },
  { id: "h6", team: "Alpha", score: 20, note: "echo", label: "u" },
  { id: "h7", team: "Alpha", score: 60, note: "charlie", label: "u" },
]);

const SOURCE_VISIBLE_ORDER = ["h1", "h2", "h5", "h4", "h6", "h7"] as const;
const OLD_VISIBLE_ORDER = ["h5", "h7", "h1", "h4", "h6", "h2"] as const;
const NEW_VISIBLE_ORDER = ["h2", "h5", "h4", "h7", "h1", "h6"] as const;

function createRoot<TColumns>(
  queryPlan: CompiledQuery<TColumns>,
  rows: readonly Holding[],
): RevisionRoot<Holding, string, TColumns> {
  const store = buildRowStore<Holding, string, TColumns>({
    rows,
    getRowId: (row) => row.id,
    queryPlan,
  });
  const defaultPolicy = Object.freeze({ kind: "expanded" as const });
  const expansion = Object.freeze({
    default: defaultPolicy,
    overrides: createPersistentMap<PretableGroupId, boolean>(),
    state: Object.freeze({ default: defaultPolicy, overrideCount: 0 }),
  });
  return Object.freeze({
    revision: 0,
    parentRevision: null,
    rows: store.rows,
    sourceOrder: store.sourceOrder,
    visible: createVisibleIndex(
      store.records,
      queryPlan,
      false,
      expansion.overrides,
    ),
    queryPlan,
    expansion,
    cause: Object.freeze({ kind: "initial" as const }),
  });
}

function rankedIds(
  visible: RevisionRoot<Holding, string, unknown>["visible"],
): readonly string[] {
  const ids: string[] = [];
  for (let index = 0; index < visible.rows.size; index += 1) {
    ids.push(visible.rows.entryAt(index)!.rowId);
  }
  return ids;
}

function testInstrumentation(): LocalRowModelInstrumentation {
  return {
    work: {
      rowsEvaluated: 0,
      hamtNodesCopied: 0,
      orderNodesCopied: 0,
      groupNodesCopied: 0,
      aggregateMerges: 0,
      transitionRows: 0,
      snapshotOutputRowsRead: 0,
      synchronousRebuilds: 0,
      synchronousRebuildMs: 0,
      schedulerSliceDurations: [],
    },
    snapshotRoots: new WeakMap(),
    retainedSnapshots: new Map(),
    scheduledCallbacks: new Set(),
    currentRevisionRoot: undefined,
    model: undefined,
  };
}

describe("rebuildRootForSortOnlyChange", () => {
  function createRebuildFixture() {
    const fixture = createFixture();
    const previousPlan = compileQuery({
      derivations: fixture.columns,
      query: SCORE_DESC_TEAM_FILTER,
    });
    const nextPlan = compileQuery({
      derivations: fixture.columns,
      query: NOTE_ASC_TEAM_FILTER,
    });
    const captured = createRoot(previousPlan, ROOT_ROWS);
    // Fixture controls: the three orders must be pairwise-distinct
    // permutations, or a rebuild that ignores the sort could still pass.
    expect(rankedIds(captured.visible)).toEqual(OLD_VISIBLE_ORDER);
    expect(OLD_VISIBLE_ORDER).not.toEqual(NEW_VISIBLE_ORDER);
    expect(OLD_VISIBLE_ORDER).not.toEqual(SOURCE_VISIBLE_ORDER);
    expect(NEW_VISIBLE_ORDER).not.toEqual(SOURCE_VISIBLE_ORDER);
    expect([...OLD_VISIBLE_ORDER].sort()).toEqual([...NEW_VISIBLE_ORDER].sort());
    // Tiebreak control: the note-tied pair's source order OPPOSES its id
    // order, so ties resolved by rowId instead of the engine's sourceOrder
    // fallthrough (compareRows' final clause) cannot pass by luck — and the
    // NEW_VISIBLE_ORDER expectation pins the sourceOrder resolution (h5
    // before h4).
    expect(SOURCE_VISIBLE_ORDER.indexOf("h5")).toBeLessThan(
      SOURCE_VISIBLE_ORDER.indexOf("h4"),
    );
    expect(compareOrderStatisticTreeIds("h4", "h5")).toBeLessThan(0);
    return { fixture, previousPlan, nextPlan, captured };
  }

  test("the rebuilt root's visible order equals a cold build under nextPlan", () => {
    const { fixture, nextPlan, captured } = createRebuildFixture();

    const rebuilt = rebuildRootForSortOnlyChange({
      captured,
      nextPlan,
      revision: 1,
      now: () => 0,
    });

    // Oracle: an identical plan compiled WITHOUT `previous` chaining (cold
    // cache), evaluated from scratch, sorted with the same composite order
    // the visible tree maintains.
    const twinPlan = compileQuery({
      derivations: fixture.columns,
      query: NOTE_ASC_TEAM_FILTER,
    });
    expect(twinPlan).not.toBe(nextPlan);
    const expected = ROOT_ROWS.map((row, sourceOrder) => ({
      rowId: row.id,
      metadata: twinPlan.evaluate({ rowId: row.id, row, sourceOrder }),
    }))
      .filter((entry) => entry.metadata.filterPasses)
      .sort(
        (left, right) =>
          twinPlan.compareRows(left.metadata, right.metadata) ||
          compareOrderStatisticTreeIds(left.rowId, right.rowId),
      )
      .map((entry) => entry.rowId);
    expect(expected).toEqual([...NEW_VISIBLE_ORDER]);
    expect(rankedIds(rebuilt.visible)).toEqual(expected);
  });

  test("filtered-out rows stay out of visible but keep updated records in rows", () => {
    const { nextPlan, captured } = createRebuildFixture();

    const rebuilt = rebuildRootForSortOnlyChange({
      captured,
      nextPlan,
      revision: 1,
      now: () => 0,
    });

    expect(rebuilt.visible.rows.rankOf("h3")).toBeUndefined();
    const record = rebuilt.rows.get("h3");
    expect(record).toBeDefined();
    expect(record!.metadata.filterPasses).toBe(false);
    // Metadata was rebuilt under the NEW plan: sort keys are note, not score.
    expect(record!.metadata.sortKeys).toEqual([
      { columnId: "note", value: "aaaa" },
    ]);
    expect(rebuilt.rows.size).toBe(ROOT_ROWS.length);
    expect(rebuilt.visible.rows.size).toBe(NEW_VISIBLE_ORDER.length);
  });

  test("revision, parentRevision, queryPlan, and cause are the requested values", () => {
    const { nextPlan, captured } = createRebuildFixture();

    const rebuilt = rebuildRootForSortOnlyChange({
      captured,
      nextPlan,
      revision: 5,
      now: () => 0,
    });

    expect(rebuilt.revision).toBe(5);
    expect(rebuilt.parentRevision).toBe(4);
    expect(rebuilt.queryPlan).toBe(nextPlan);
    expect(rebuilt.cause).toEqual({ kind: "set-query" });
  });

  test("sourceOrder and expansion are carried by reference from the captured root", () => {
    const { nextPlan, captured } = createRebuildFixture();

    const rebuilt = rebuildRootForSortOnlyChange({
      captured,
      nextPlan,
      revision: 1,
      now: () => 0,
    });

    expect(rebuilt.sourceOrder).toBe(captured.sourceOrder);
    expect(rebuilt.expansion).toBe(captured.expansion);
  });

  test("publicRow and integrity are carried by reference per record", () => {
    const { nextPlan, captured } = createRebuildFixture();

    const rebuilt = rebuildRootForSortOnlyChange({
      captured,
      nextPlan,
      revision: 1,
      now: () => 0,
    });

    for (const row of ROOT_ROWS) {
      const before = captured.rows.get(row.id)!;
      const after = rebuilt.rows.get(row.id)!;
      expect(after).not.toBe(before);
      expect(after.publicRow).toBe(before.publicRow);
      expect(after.integrity).toBe(before.integrity);
      expect(after.row).toBe(before.row);
      expect(after.sourceOrder).toBe(before.sourceOrder);
    }
  });

  test("instrumentation counts one rebuild and the measured duration", () => {
    const { nextPlan, captured } = createRebuildFixture();
    const instrumentation = testInstrumentation();
    const ticks = [0, 7];
    let call = 0;

    rebuildRootForSortOnlyChange({
      captured,
      nextPlan,
      revision: 1,
      now: () => ticks[call++] ?? 7,
      instrumentation,
    });

    expect(instrumentation.work.synchronousRebuilds).toBe(1);
    expect(instrumentation.work.synchronousRebuildMs).toBe(7);
  });

  test("throws TypeError when the plans are not a sort-only change", () => {
    const { fixture, captured } = createRebuildFixture();
    const filterChangedPlan = compileQuery({
      derivations: fixture.columns,
      query: queryFor<FixtureColumns>({
        filters: [{ columnId: "team", operator: "equals", value: "Beta" }],
        sort: [{ columnId: "note", direction: "asc" }],
        rowGroups: [],
      }),
    });

    expect(() =>
      rebuildRootForSortOnlyChange({
        captured,
        nextPlan: filterChangedPlan,
        revision: 1,
        now: () => 0,
      }),
    ).toThrowError(
      new TypeError("Synchronous rebuild requires a sort-only plan change."),
    );
  });

  test("throws TypeError for a grouped next plan", () => {
    const fixture = createFixture();
    const groupedPrevious = compileQuery({
      derivations: fixture.columns,
      query: queryFor<FixtureColumns>({
        filters: [{ columnId: "team", operator: "equals", value: "Alpha" }],
        sort: [{ columnId: "score", direction: "desc" }],
        rowGroups: [{ columnId: "team", direction: "asc" }],
      }),
    });
    const groupedNext = compileQuery({
      derivations: fixture.columns,
      query: queryFor<FixtureColumns>({
        filters: [{ columnId: "team", operator: "equals", value: "Alpha" }],
        sort: [{ columnId: "score", direction: "asc" }],
        rowGroups: [{ columnId: "team", direction: "asc" }],
      }),
    });
    const captured = createRoot(groupedPrevious, ROOT_ROWS);

    expect(() =>
      rebuildRootForSortOnlyChange({
        captured,
        nextPlan: groupedNext,
        revision: 1,
        now: () => 0,
      }),
    ).toThrowError(
      new TypeError("Synchronous rebuild requires an ungrouped query."),
    );
  });
});
