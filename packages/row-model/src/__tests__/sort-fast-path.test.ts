import { describe, expect, test, vi } from "vitest";

import {
  compileQuery,
  createColumnHelper,
  PretableRowModelError,
  resortRecordMetadata,
  type PretableQueryFor,
} from "../index";

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
        () => {
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
