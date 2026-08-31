import { describe, expect, test } from "vitest";

import {
  compareRecordRows,
  CompiledQueryValidationError,
  compileQuery,
  createColumnHelper,
  filterVerdict,
  type PretableAggregator,
  type PretableQueryFor,
} from "../index";

describe("canonical calendar-date queries", () => {
  const column = createColumnHelper<{
    id: number;
    asOf: string | null;
    tie: number;
  }>();
  const columns = [
    column.accessor("asOf", { type: "date" }),
    column.accessor("tie", { type: "number" }),
  ] as const;

  test.each([
    ["asc", "first", [2, 7, 1, 8, 6, 4, 5, 3]],
    ["asc", "last", [2, 7, 1, 8, 6, 4, 5, 3]],
    ["desc", "first", [7, 1, 8, 2, 6, 4, 5, 3]],
    ["desc", "last", [7, 1, 8, 2, 6, 4, 5, 3]],
  ] as const)(
    "sorts valid dates first for %s/nulls-%s and leaves terminal values tied",
    (direction, nulls, expected) => {
      const plan = compileQuery<typeof columns>({
        derivations: columns,
        query: {
          filters: [],
          rowGroups: [],
          sort: [
            { columnId: "asOf", direction, nulls },
            { columnId: "tie", direction: "asc" },
          ],
        },
      });
      const rows = [
        { id: 1, asOf: "2026-08-06", tie: 0 },
        { id: 2, asOf: "2025-12-31", tie: 0 },
        { id: 3, asOf: "2026-02-30", tie: 2 },
        { id: 4, asOf: null, tie: 1 },
        { id: 5, asOf: { date: "2026-08-05" }, tie: 1 },
        { id: 6, asOf: undefined, tie: 0 },
        { id: 7, asOf: "2026-08-06", tie: -1 },
        { id: 8, asOf: "2026-08-06", tie: 0 },
      ];
      const evaluated = rows.map((row, sourceOrder) =>
        plan.evaluate({
          rowId: row.id,
          sourceOrder,
          slot: sourceOrder,
          row: row as never,
        }),
      );

      expect(
        evaluated
          .sort((left, right) =>
            compareRecordRows(
              plan,
              { ...left, slot: left.sourceOrder },
              { ...right, slot: right.sourceOrder },
            ),
          )
          .map((row) => row.rowId),
      ).toEqual(expected);
    },
  );

  test.each([
    ["on", "2026-08-06", "2026-08-06", true],
    ["before", "2026-08-06", "2026-08-05", true],
    ["after", "2026-08-06", "2026-08-07", true],
    ["dateBetween", ["2026-08-31", "2026-08-01"], "2026-08-06", true],
    ["on", "2026-02-30", "2026-02-28", false],
  ] as const)(
    "evaluates %s without coercion",
    (operator, value, asOf, expected) => {
      const plan = compileQuery<typeof columns>({
        derivations: columns,
        query: {
          filters: [{ columnId: "asOf", operator, value }],
          rowGroups: [],
          sort: [],
        } as PretableQueryFor<typeof columns>,
      });

      expect(
        filterVerdict(
          plan,
          {
            rowId: 1,
            sourceOrder: 0,
            slot: 0,
            row: { id: 1, asOf, tie: 0 },
          },
        ),
      ).toBe(expected);
    },
  );

  test.each([
    ["Date", "on", new Date("2026-08-06T00:00:00Z")],
    ["number", "on", 0],
    ["object", "on", { date: "2026-08-06" }],
    ["short range", "dateBetween", ["2026-08-06"]],
    ["non-string range", "dateBetween", ["2026-08-01", 0]],
  ])("rejects shape-invalid operands: %s", (_label, operator, value) => {
    expect(() =>
      compileQuery({
        derivations: columns,
        query: {
          filters: [{ columnId: "asOf", operator, value }],
          rowGroups: [],
          sort: [],
        },
      } as never),
    ).toThrow(CompiledQueryValidationError);
  });

  test("lowers date extrema without mutating the public derivations", () => {
    const datedColumns = [
      column.accessor("asOf", { type: "date", aggregate: "min" }),
    ] as const;
    const plan = compileQuery<typeof datedColumns>({
      derivations: datedColumns,
      query: { filters: [], rowGroups: [], sort: [] },
    });
    const first = plan.evaluate({
      rowId: 1,
      sourceOrder: 0,
      slot: 0,
      row: { id: 1, asOf: "2026-08-18", tie: 0 },
    });
    const aggregate = first.aggregateLeaves[0]!.aggregate as PretableAggregator<
      object,
      unknown,
      string | null,
      string | null
    >;

    expect(plan.derivations[0]!.aggregate).toBe("min");
    expect(typeof aggregate).toBe("object");
    expect(
      aggregate.finalize(
        aggregate.accumulate(aggregate.init(), "2025-01-01", {}),
      ),
    ).toBe("2025-01-01");
  });
});
