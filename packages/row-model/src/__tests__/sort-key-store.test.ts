import { describe, expect, test, vi } from "vitest";

import {
  compileQuery,
  createColumnHelper,
  createLocalRowModel,
  PretableRowModelError,
  type PretableQueryFor,
} from "../index";
import { compareRecordRows, fillSortKeysFromPrevious } from "../compiled-query";

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

/**
 * Spied accessors on every column so tests can assert exactly which accessors
 * a store fill runs. `label` is inactive in every plan below, so its spy count
 * must be 0 throughout.
 */
function createFixture() {
  const teamAccessor = vi.fn((row: Holding) => row.team);
  const scoreAccessor = vi.fn((row: Holding) => row.score);
  const noteAccessor = vi.fn((row: Holding) => row.note);
  const labelAccessor = vi.fn((row: Holding) => row.label);
  const columns = [
    helper.accessor("team", teamAccessor, { type: "text" }),
    helper.accessor("score", scoreAccessor, { type: "number" }),
    helper.accessor("note", noteAccessor, { type: "text" }),
    helper.accessor("label", labelAccessor, { type: "text" }),
  ] as const;
  return { columns, teamAccessor, scoreAccessor, noteAccessor, labelAccessor };
}

type FixtureColumns = ReturnType<typeof createFixture>["columns"];

const SCORE_ASC = queryFor<FixtureColumns>({
  filters: [],
  sort: [{ columnId: "score", direction: "asc" }],
  rowGroups: [],
});

const NOTE_THEN_SCORE = queryFor<FixtureColumns>({
  filters: [],
  sort: [
    { columnId: "note", direction: "asc" },
    { columnId: "score", direction: "asc" },
  ],
  rowGroups: [],
});

function holding(partial: Partial<Holding> & { id: string }): Holding {
  return {
    team: "Alpha",
    score: 0,
    note: "steady",
    label: "unused",
    ...partial,
  };
}

describe("compareRecordRows", () => {
  test("evaluate populates the store: comparison runs no accessors", () => {
    const fixture = createFixture();
    const plan = compileQuery({
      derivations: fixture.columns,
      query: SCORE_ASC,
    });
    const a = {
      rowId: "a",
      row: holding({ id: "a", score: 5 }),
      sourceOrder: 0,
    };
    const b = {
      rowId: "b",
      row: holding({ id: "b", score: 9 }),
      sourceOrder: 1,
    };
    plan.evaluate(a);
    plan.evaluate(b);

    fixture.scoreAccessor.mockClear();
    fixture.teamAccessor.mockClear();
    fixture.noteAccessor.mockClear();

    expect(compareRecordRows(plan, a, b)).toBeLessThan(0);
    expect(compareRecordRows(plan, b, a)).toBeGreaterThan(0);
    expect(fixture.scoreAccessor).not.toHaveBeenCalled();
    expect(fixture.teamAccessor).not.toHaveBeenCalled();
    expect(fixture.noteAccessor).not.toHaveBeenCalled();
    expect(fixture.labelAccessor).not.toHaveBeenCalled();
  });

  test("the store holds the SAME frozen array metadata carries", () => {
    const fixture = createFixture();
    const plan = compileQuery({
      derivations: fixture.columns,
      query: SCORE_ASC,
    });
    const input = {
      rowId: "a",
      row: holding({ id: "a", score: 5 }),
      sourceOrder: 0,
    };
    const metadata = plan.evaluate(input);

    fixture.scoreAccessor.mockClear();
    // Idempotent fill against an already-populated plan surfaces the stored
    // entry, which must be metadata's own array, not a copy.
    const stored = fillSortKeysFromPrevious(plan, plan, input);

    expect(stored).toBe(metadata.sortKeys);
    expect(fixture.scoreAccessor).not.toHaveBeenCalled();
  });

  const orderingTable = [
    {
      name: "number asc",
      columns: [helper.accessor("score", { type: "number" })] as const,
      sort: [{ columnId: "score", direction: "asc" }],
      left: holding({ id: "a", score: 5 }),
      right: holding({ id: "b", score: 9 }),
      expected: -1,
    },
    {
      name: "number desc",
      columns: [helper.accessor("score", { type: "number" })] as const,
      sort: [{ columnId: "score", direction: "desc" }],
      left: holding({ id: "a", score: 5 }),
      right: holding({ id: "b", score: 9 }),
      expected: 1,
    },
    {
      name: "text collation (numeric-aware)",
      columns: [helper.accessor("note", { type: "text" })] as const,
      sort: [{ columnId: "note", direction: "asc" }],
      left: holding({ id: "a", note: "item2" }),
      right: holding({ id: "b", note: "item10" }),
      expected: -1,
    },
    {
      name: "nulls first",
      columns: [helper.accessor("note", { type: "text" })] as const,
      sort: [{ columnId: "note", direction: "asc", nulls: "first" }],
      left: holding({ id: "a", note: null as unknown as string }),
      right: holding({ id: "b", note: "steady" }),
      expected: -1,
    },
    {
      name: "nulls last",
      columns: [helper.accessor("note", { type: "text" })] as const,
      sort: [{ columnId: "note", direction: "asc", nulls: "last" }],
      left: holding({ id: "a", note: null as unknown as string }),
      right: holding({ id: "b", note: "steady" }),
      expected: 1,
    },
    {
      name: "custom comparator",
      columns: [
        helper.accessor("note", {
          type: "text",
          compare: (left: string, right: string) => left.length - right.length,
        }),
      ] as const,
      sort: [{ columnId: "note", direction: "asc" }],
      left: holding({ id: "a", note: "bbb" }),
      right: holding({ id: "b", note: "a" }),
      expected: 1,
    },
    {
      name: "sort-key tie resolves by sourceOrder",
      columns: [helper.accessor("score", { type: "number" })] as const,
      sort: [{ columnId: "score", direction: "asc" }],
      left: holding({ id: "a", score: 5 }),
      right: holding({ id: "b", score: 5 }),
      expected: -1,
    },
  ];

  test.each(orderingTable)(
    "sign-equals compareRows: $name",
    ({ columns, sort, left, right, expected }) => {
      const plan = compileQuery({
        derivations: columns,
        query: {
          filters: [],
          sort,
          rowGroups: [],
        } as unknown as PretableQueryFor<typeof columns>,
      });
      const leftInput = { rowId: left.id, row: left, sourceOrder: 0 };
      const rightInput = { rowId: right.id, row: right, sourceOrder: 1 };
      const leftMeta = plan.evaluate(leftInput);
      const rightMeta = plan.evaluate(rightInput);

      // The metadata comparator is the oracle while it still exists.
      expect(Math.sign(compareRecordRows(plan, leftInput, rightInput))).toBe(
        Math.sign(plan.compareRows(leftMeta, rightMeta)),
      );
      expect(Math.sign(compareRecordRows(plan, rightInput, leftInput))).toBe(
        Math.sign(plan.compareRows(rightMeta, leftMeta)),
      );
      expect(Math.sign(compareRecordRows(plan, leftInput, rightInput))).toBe(
        expected,
      );
    },
  );

  test("fails loud on a row the plan never evaluated", () => {
    const fixture = createFixture();
    const plan = compileQuery({
      derivations: fixture.columns,
      query: SCORE_ASC,
    });
    const known = {
      rowId: "a",
      row: holding({ id: "a", score: 5 }),
      sourceOrder: 0,
    };
    const stranger = {
      rowId: "b",
      row: holding({ id: "b", score: 9 }),
      sourceOrder: 1,
    };
    plan.evaluate(known);

    expect(() => compareRecordRows(plan, known, stranger)).toThrowError(
      /has no sort keys under this plan/,
    );
    expect(() => compareRecordRows(plan, stranger, known)).toThrowError(
      /has no sort keys under this plan/,
    );
  });

  test("TypeError for a foreign plan object", () => {
    const fixture = createFixture();
    const plan = compileQuery({
      derivations: fixture.columns,
      query: SCORE_ASC,
    });
    const input = {
      rowId: "a",
      row: holding({ id: "a", score: 5 }),
      sourceOrder: 0,
    };
    plan.evaluate(input);
    const foreign = { query: SCORE_ASC, derivations: fixture.columns };

    expect(() =>
      compareRecordRows(foreign as never, input, input),
    ).toThrowError(
      new TypeError("Record comparison requires a compiled query plan."),
    );
  });
});

describe("store-backed grouped pipeline (reroute pin)", () => {
  /**
   * Regression tripwire for the A2 comparator reroutes: a full cooperative
   * setQuery over groups + aggregates + multi-column sort + a filter, with
   * the final visible order and an aggregate value HARDCODED from the
   * fixture by hand. Written green BEFORE the reroutes; any drift after a
   * reroute is a real behavior change, not a fixture artifact.
   */
  test("cooperative sort+filter change keeps hand-computed order and aggregates", async () => {
    const columns = [
      helper.accessor("team", { type: "text" }),
      helper.accessor("score", { type: "number", aggregate: "sum" }),
      helper.accessor("note", { type: "text" }),
      helper.accessor("label", { type: "text" }),
    ] as const;
    const rows: Holding[] = [
      holding({ id: "r1", team: "A", score: 5, note: "x" }),
      holding({ id: "r2", team: "A", score: 3, note: "y" }),
      holding({ id: "r3", team: "B", score: 8, note: "x" }),
      holding({ id: "r4", team: "B", score: 1, note: "y" }),
      holding({ id: "r5", team: "A", score: 7, note: "x" }),
      holding({ id: "r6", team: "B", score: 9, note: "z" }),
    ];
    const model = createLocalRowModel({
      rows,
      columns,
      // Default aggregation population: the rows the filter keeps.
      initialExpansion: { kind: "expanded" },
      query: {
        filters: [],
        sort: [{ columnId: "score", direction: "asc" }],
        rowGroups: [{ columnId: "team", direction: "asc" }],
      },
    });

    const transition = model.setQuery({
      filters: [{ columnId: "score", operator: "gte", value: 3 }],
      sort: [
        { columnId: "note", direction: "asc" },
        { columnId: "score", direction: "desc" },
      ],
      rowGroups: [{ columnId: "team", direction: "asc" }],
    });
    await transition.finished;

    /*
     * Hand derivation from the fixture:
     * - filter score >= 3 keeps r1(5) r2(3) r3(8) r5(7) r6(9); drops r4(1).
     * - groups by team asc: A = {r1, r2, r5}, B = {r3, r6}.
     * - within-group sort, note asc then score desc:
     *   A: note "x" -> r5(7) then r1(5) (desc), then note "y" -> r2(3).
     *   B: note "x" -> r3, then note "z" -> r6.
     * - aggregate sum(score) over the filtered population (the default):
     *   A = 5 + 3 + 7 = 15;  B = 8 + 9 = 17.
     */
    const snapshot = model.getState().snapshot;
    const shape = snapshot.range(0, 100).map((row) => {
      if (row.kind === "group") {
        return `group:${String(row.value)}:sum=${String(
          (row.aggregates as { score: unknown }).score,
        )}`;
      }
      return row.rowId;
    });
    expect(shape).toEqual([
      "group:A:sum=15",
      "r5",
      "r1",
      "r2",
      "group:B:sum=17",
      "r3",
      "r6",
    ]);
    expect(model.getState().status).toEqual({ kind: "ready" });
  });

  /**
   * The same-reference-mutation recompile is a plan swap: the fresh plan's
   * store must be seeded for carried rows, and the visible index must be
   * rebuilt under the fresh plan (the retired plan's store still holds
   * pre-mutation keys for mutated row objects). Found by probing during the
   * A2 reroutes — without both fixes the mutated row keeps its stale rank
   * and a later update of a carried row throws the fail-loud store miss.
   */
  test("same-reference mutation recompile re-ranks and keeps carried rows comparable", () => {
    interface Simple {
      id: number;
      value: number;
      label: string;
    }
    const simpleHelper = createColumnHelper<Simple>();
    const columns = [
      simpleHelper.accessor("value", { type: "number" }),
    ] as const;
    const mutable = Object.preventExtensions({ id: 1, value: 1, label: "a" });
    const b = { id: 2, value: 2, label: "b" };
    const c = { id: 3, value: 3, label: "c" };
    const model = createLocalRowModel({
      rows: [mutable, b, c],
      columns,
      query: {
        filters: [],
        sort: [{ columnId: "value", direction: "asc" }],
        rowGroups: [],
      },
    });

    // Mutate in place, then reorder the untouched carried rows so one of
    // them flows through the cached-metadata path under the fresh plan.
    mutable.value = 10;
    model.setRows([c, b, mutable]);
    expect(model.getState().snapshot.range(0, 3)).toMatchObject([
      { rowId: 2 },
      { rowId: 3 },
      { rowId: 1 },
    ]);

    // Follow-up update of a carried row: its previous record must resolve
    // from the committed root's (recompiled) plan.
    model.setRows([c, { ...b, value: 5 }, mutable]);
    expect(model.getState().snapshot.range(0, 3)).toMatchObject([
      { rowId: 3 },
      { rowId: 2 },
      { rowId: 1 },
    ]);
  });
});

describe("fillSortKeysFromPrevious", () => {
  test("carries overlapping sort columns and evaluates newly-active ones once", () => {
    const fixture = createFixture();
    const previousPlan = compileQuery({
      derivations: fixture.columns,
      query: SCORE_ASC,
    });
    const nextPlan = compileQuery({
      derivations: fixture.columns,
      query: NOTE_THEN_SCORE,
    });
    const input = {
      rowId: "a",
      row: holding({ id: "a", score: 5, note: "steady" }),
      sourceOrder: 0,
    };
    previousPlan.evaluate(input);

    fixture.scoreAccessor.mockClear();
    fixture.noteAccessor.mockClear();
    const keys = fillSortKeysFromPrevious(nextPlan, previousPlan, input);

    expect(keys).toEqual([
      { columnId: "note", value: "steady" },
      { columnId: "score", value: 5 },
    ]);
    // Overlapping column carried from the previous plan's store, not re-run.
    expect(fixture.scoreAccessor).not.toHaveBeenCalled();
    // Newly-active column evaluated exactly once.
    expect(fixture.noteAccessor).toHaveBeenCalledTimes(1);
    expect(Object.isFrozen(keys)).toBe(true);
    // The fill makes the next plan's record comparator usable.
    const other = {
      rowId: "b",
      row: holding({ id: "b", score: 9, note: "zzz" }),
      sourceOrder: 1,
    };
    fillSortKeysFromPrevious(nextPlan, previousPlan, other);
    expect(compareRecordRows(nextPlan, input, other)).toBeLessThan(0);
  });

  test("idempotent: a second fill returns the same array with zero accessor runs", () => {
    const fixture = createFixture();
    const previousPlan = compileQuery({
      derivations: fixture.columns,
      query: SCORE_ASC,
    });
    const nextPlan = compileQuery({
      derivations: fixture.columns,
      query: NOTE_THEN_SCORE,
    });
    const input = {
      rowId: "a",
      row: holding({ id: "a", score: 5 }),
      sourceOrder: 0,
    };
    previousPlan.evaluate(input);
    const first = fillSortKeysFromPrevious(nextPlan, previousPlan, input);

    fixture.teamAccessor.mockClear();
    fixture.scoreAccessor.mockClear();
    fixture.noteAccessor.mockClear();
    const second = fillSortKeysFromPrevious(nextPlan, previousPlan, input);

    expect(second).toBe(first);
    expect(fixture.teamAccessor).not.toHaveBeenCalled();
    expect(fixture.scoreAccessor).not.toHaveBeenCalled();
    expect(fixture.noteAccessor).not.toHaveBeenCalled();
  });

  test("runs the accessor even when the previous plan never saw the row", () => {
    const fixture = createFixture();
    const previousPlan = compileQuery({
      derivations: fixture.columns,
      query: SCORE_ASC,
    });
    const nextPlan = compileQuery({
      derivations: fixture.columns,
      query: NOTE_THEN_SCORE,
    });
    const input = {
      rowId: "a",
      row: holding({ id: "a", score: 5, note: "steady" }),
      sourceOrder: 0,
    };
    // No previousPlan.evaluate: nothing to carry, every column re-runs.
    const keys = fillSortKeysFromPrevious(nextPlan, previousPlan, input);

    expect(keys).toEqual([
      { columnId: "note", value: "steady" },
      { columnId: "score", value: 5 },
    ]);
    expect(fixture.scoreAccessor).toHaveBeenCalledTimes(1);
    expect(fixture.noteAccessor).toHaveBeenCalledTimes(1);
  });

  test("accessor failure surfaces evaluate's error shape", () => {
    const boom = new Error("boom");
    const columns = [
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
    const input = {
      rowId: "r1",
      row: holding({ id: "r1", score: 5 }),
      sourceOrder: 0,
    };
    previousPlan.evaluate(input);

    let caught: unknown;
    try {
      fillSortKeysFromPrevious(nextPlan, previousPlan, input);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PretableRowModelError);
    const error = caught as PretableRowModelError;
    expect(error.code).toBe("accessor-failed");
    expect(error.operation).toBe("set-query");
    expect(error.rowId).toBe("r1");
    expect(error.columnId).toBe("note");
    expect(error.cause).toBe(boom);
  });

  test("TypeError for foreign plan objects in either position", () => {
    const fixture = createFixture();
    const plan = compileQuery({
      derivations: fixture.columns,
      query: SCORE_ASC,
    });
    const input = {
      rowId: "a",
      row: holding({ id: "a", score: 5 }),
      sourceOrder: 0,
    };
    plan.evaluate(input);
    const foreign = { query: SCORE_ASC, derivations: fixture.columns };

    expect(() =>
      fillSortKeysFromPrevious(foreign as never, plan, input),
    ).toThrowError(
      new TypeError("Sort-key carryover requires compiled query plans."),
    );
    expect(() =>
      fillSortKeysFromPrevious(plan, foreign as never, input),
    ).toThrowError(
      new TypeError("Sort-key carryover requires compiled query plans."),
    );
  });
});
