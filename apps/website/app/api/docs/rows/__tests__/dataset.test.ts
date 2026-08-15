import { describe, expect, test } from "vitest";

import {
  applyDocsQuery,
  asksToFail,
  DOCS_COLUMN_TYPES,
  type DocsColumnType,
  DOCS_FILTER_OPERATORS,
  DOCS_ORDERS,
  DocsQueryError,
  type DocsOrder,
  type DocsQuery,
  EMPTY_DOCS_QUERY,
  totalFor,
} from "../dataset";

/** One filter, applied to the whole order book. */
function filterBy(
  columnId: string,
  operator: string,
  value?: unknown,
): DocsOrder[] {
  const filter: DocsQuery["filters"][number] =
    value === undefined
      ? { columnId, operator }
      : { columnId, operator, value };

  return applyDocsQuery(DOCS_ORDERS, { ...EMPTY_DOCS_QUERY, filters: [filter] });
}

/**
 * Every operator test proves the same two things: the server really excluded
 * rows, and every row it kept satisfies the predicate. A filter that returns
 * all 480 rows while the funnel renders as active is the exact failure these
 * pages exist to disprove.
 */
function expectNarrowed(rows: DocsOrder[]): void {
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.length).toBeLessThan(DOCS_ORDERS.length);
}

describe("DOCS_ORDERS", () => {
  test("is 480 rows, pinned against the generator drifting", () => {
    expect(DOCS_ORDERS).toHaveLength(480);
  });

  test("row 0 has the exact shape the docs and e2e depend on", () => {
    expect(DOCS_ORDERS[0]).toEqual({
      id: "ord-0001",
      customer: "Aldridge Foods",
      region: "North",
      status: "open",
      total: 250,
      placedAt: "2026-01-01",
    });
  });

  test("the last row is pinned too, so the tail cannot drift", () => {
    expect(DOCS_ORDERS[479]).toEqual({
      id: "ord-0480",
      customer: "Holloway Optics",
      region: "West",
      status: "cancelled",
      total: 7373,
      placedAt: "2026-12-04",
    });
  });

  test("every column the filter menu can reach has a declared type", () => {
    expect(Object.keys(DOCS_COLUMN_TYPES).sort()).toEqual(
      Object.keys(DOCS_ORDERS[0]!).sort(),
    );
  });
});

describe("applyDocsQuery", () => {
  test("returns every row for an empty query", () => {
    expect(applyDocsQuery(DOCS_ORDERS, EMPTY_DOCS_QUERY)).toHaveLength(
      DOCS_ORDERS.length,
    );
  });

  test("sort orders descending by total", () => {
    const rows = applyDocsQuery(DOCS_ORDERS, {
      ...EMPTY_DOCS_QUERY,
      sort: [{ columnId: "total", direction: "desc" }],
    });

    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i - 1]!.total).toBeGreaterThanOrEqual(rows[i]!.total);
    }
  });
});

describe("text operators", () => {
  test("contains narrows to matching rows only", () => {
    const rows = filterBy("customer", "contains", "a");

    expectNarrowed(rows);
    for (const row of rows) expect(row.customer.toLowerCase()).toContain("a");
  });

  test("notContains keeps only rows without the needle", () => {
    const rows = filterBy("customer", "notContains", "a");

    expectNarrowed(rows);
    for (const row of rows)
      expect(row.customer.toLowerCase()).not.toContain("a");
  });

  // "a" and "s" are chosen because they also appear mid-name: a startsWith or
  // endsWith that quietly degraded to contains would return the extra rows and
  // fail the predicate. An anchored-only needle could not tell the two apart.
  test("startsWith anchors at the front, not anywhere", () => {
    const anchored = filterBy("customer", "startsWith", "a");
    const anywhere = filterBy("customer", "contains", "a");

    expectNarrowed(anchored);
    expect(anchored.length).toBeLessThan(anywhere.length);
    for (const row of anchored)
      expect(row.customer.toLowerCase().startsWith("a")).toBe(true);
  });

  test("endsWith anchors at the back, not anywhere", () => {
    const anchored = filterBy("customer", "endsWith", "s");
    const anywhere = filterBy("customer", "contains", "s");

    expectNarrowed(anchored);
    expect(anchored.length).toBeLessThan(anywhere.length);
    for (const row of anchored)
      expect(row.customer.toLowerCase().endsWith("s")).toBe(true);
  });

  test("equals is case-insensitive, as the engine's is", () => {
    const rows = filterBy("customer", "equals", "aldridge foods");

    expectNarrowed(rows);
    for (const row of rows) expect(row.customer).toBe("Aldridge Foods");
  });

  test("notEquals excludes exactly the equal rows", () => {
    const equal = filterBy("customer", "equals", "Aldridge Foods");
    const notEqual = filterBy("customer", "notEquals", "Aldridge Foods");

    expectNarrowed(notEqual);
    expect(equal.length + notEqual.length).toBe(DOCS_ORDERS.length);
    for (const row of notEqual)
      expect(row.customer).not.toBe("Aldridge Foods");
  });
});

describe("number operators", () => {
  test("gt keeps totals strictly above the operand", () => {
    const rows = filterBy("total", "gt", 9000);

    expectNarrowed(rows);
    for (const row of rows) expect(row.total).toBeGreaterThan(9000);
  });

  test("gte includes the boundary that gt excludes", () => {
    const boundary = DOCS_ORDERS[0]!.total;
    const gte = filterBy("total", "gte", boundary);
    const gt = filterBy("total", "gt", boundary);

    expect(gte.length).toBe(gt.length + 1);
    for (const row of gte) expect(row.total).toBeGreaterThanOrEqual(boundary);
  });

  test("lt keeps totals strictly below the operand", () => {
    const rows = filterBy("total", "lt", 1000);

    expectNarrowed(rows);
    for (const row of rows) expect(row.total).toBeLessThan(1000);
  });

  test("lte includes the boundary that lt excludes", () => {
    const lte = filterBy("total", "lte", 250);
    const lt = filterBy("total", "lt", 250);

    expect(lt).toHaveLength(0);
    expect(lte).toHaveLength(1);
    expect(lte[0]!.total).toBe(250);
  });

  test("equals matches the one row with that total", () => {
    const rows = filterBy("total", "equals", 250);

    expectNarrowed(rows);
    expect(rows).toHaveLength(1);
    for (const row of rows) expect(row.total).toBe(250);
  });

  test("notEquals excludes exactly the equal rows", () => {
    const rows = filterBy("total", "notEquals", 250);

    expect(rows).toHaveLength(DOCS_ORDERS.length - 1);
    for (const row of rows) expect(row.total).not.toBe(250);
  });

  test("between is inclusive at both ends", () => {
    const rows = filterBy("total", "between", [1000, 2000]);

    expectNarrowed(rows);
    for (const row of rows) {
      expect(row.total).toBeGreaterThanOrEqual(1000);
      expect(row.total).toBeLessThanOrEqual(2000);
    }
  });
});

describe("date operators", () => {
  test("on matches the exact calendar day", () => {
    const rows = filterBy("placedAt", "on", "2026-01-01");

    expectNarrowed(rows);
    for (const row of rows) expect(row.placedAt).toBe("2026-01-01");
  });

  // Both boundaries are days the order book actually contains — a boundary no
  // row sits on cannot tell `before` from "before or on".
  test("before excludes the boundary day itself", () => {
    const boundary = "2026-01-13";
    const rows = filterBy("placedAt", "before", boundary);

    expect(filterBy("placedAt", "on", boundary).length).toBeGreaterThan(0);
    expectNarrowed(rows);
    for (const row of rows) expect(row.placedAt < boundary).toBe(true);
  });

  test("after excludes the boundary day itself", () => {
    const boundary = "2026-12-04";
    const rows = filterBy("placedAt", "after", boundary);

    expect(filterBy("placedAt", "on", boundary).length).toBeGreaterThan(0);
    expectNarrowed(rows);
    for (const row of rows) expect(row.placedAt > boundary).toBe(true);
  });

  test("dateBetween is inclusive at both ends", () => {
    const rows = filterBy("placedAt", "dateBetween", [
      "2026-03-01",
      "2026-04-30",
    ]);

    expectNarrowed(rows);
    for (const row of rows) {
      expect(row.placedAt >= "2026-03-01").toBe(true);
      expect(row.placedAt <= "2026-04-30").toBe(true);
    }
  });
});

describe("selection operators", () => {
  test("isAnyOf keeps only the named statuses", () => {
    const rows = filterBy("status", "isAnyOf", ["open", "shipped"]);

    expectNarrowed(rows);
    for (const row of rows) expect(["open", "shipped"]).toContain(row.status);
  });

  test("isNoneOf keeps exactly the rows isAnyOf drops", () => {
    const anyOf = filterBy("status", "isAnyOf", ["open", "shipped"]);
    const noneOf = filterBy("status", "isNoneOf", ["open", "shipped"]);

    expectNarrowed(noneOf);
    expect(anyOf.length + noneOf.length).toBe(DOCS_ORDERS.length);
    for (const row of noneOf)
      expect(["open", "shipped"]).not.toContain(row.status);
  });

  test("an empty selection excludes nothing, as the engine's does", () => {
    expect(filterBy("status", "isAnyOf", [])).toHaveLength(DOCS_ORDERS.length);
  });
});

describe("emptiness operators", () => {
  // The order book has no blank cells, so DOCS_ORDERS alone cannot show these
  // narrowing. `applyDocsQuery` is pure over its rows argument, so a synthetic
  // set proves the predicate without moving the numbers Task 9's e2e pins.
  const SPARSE: DocsOrder[] = [
    { ...DOCS_ORDERS[0]!, id: "blank", region: "" },
    { ...DOCS_ORDERS[1]!, id: "whitespace", region: "   " },
    { ...DOCS_ORDERS[2]!, id: "present", region: "North" },
  ];

  function sparseFilter(operator: string): DocsOrder[] {
    return applyDocsQuery(SPARSE, {
      ...EMPTY_DOCS_QUERY,
      filters: [{ columnId: "region", operator }],
    });
  }

  test("isEmpty keeps blank and whitespace-only cells", () => {
    const rows = sparseFilter("isEmpty");

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(SPARSE.length);
    expect(rows.map((row) => row.id)).toEqual(["blank", "whitespace"]);
  });

  test("isNotEmpty keeps exactly the rows isEmpty drops", () => {
    const rows = sparseFilter("isNotEmpty");

    expect(rows.map((row) => row.id)).toEqual(["present"]);
  });

  test("NaN counts as empty, matching the engine", () => {
    const rows = applyDocsQuery(
      [
        { ...DOCS_ORDERS[0]!, id: "nan", total: Number.NaN },
        { ...DOCS_ORDERS[1]!, id: "number" },
      ],
      {
        ...EMPTY_DOCS_QUERY,
        filters: [{ columnId: "total", operator: "isEmpty" }],
      },
    );

    expect(rows.map((row) => row.id)).toEqual(["nan"]);
  });

  test("the order book itself has no empty cells", () => {
    expect(filterBy("region", "isEmpty")).toHaveLength(0);
    expect(filterBy("region", "isNotEmpty")).toHaveLength(
      DOCS_ORDERS.length,
    );
  });
});

describe("every selection the filter menu can produce", () => {
  /**
   * A well-formed operand for each (column, operator) the menu can emit. The
   * enum operands are real values of their own column — a status value handed
   * to the region column would still prove "does not throw", but it would
   * quietly stop proving anything about region.
   */
  function operandFor(
    columnId: string,
    type: DocsColumnType,
    operator: string,
  ): unknown {
    if (operator === "isEmpty" || operator === "isNotEmpty") return undefined;
    if (operator === "between") return [500, 1000];
    if (operator === "dateBetween") return ["2026-01-01", "2026-06-30"];
    if (type === "number") return 500;
    if (type === "date") return "2026-01-13";
    if (type === "enum") return columnId === "region" ? ["North"] : ["open"];
    return "a";
  }

  const SELECTIONS = Object.entries(DOCS_COLUMN_TYPES).flatMap(
    ([columnId, type]) =>
      [...DOCS_FILTER_OPERATORS[type]].map((operator) => ({
        columnId,
        type,
        operator,
      })),
  );

  test("covers every column/operator pair, six columns wide", () => {
    // id 8 (text) + customer 8 (text) + region 4 (enum) + status 4 (enum)
    // + total 9 (number) + placedAt 6 (date).
    //
    // The docs pages surface five filterable columns — customer, region,
    // status, total, placedAt — which is 31 of these pairs. `id` is not among
    // them. Its 8 pairs are deliberate headroom, not drift: this suite pins the
    // fixture's own contract, so a page that later exposes `id` finds it works.
    expect(SELECTIONS).toHaveLength(39);
  });

  test("covers all 19 members of the engine's FilterOperator union", () => {
    // Spelled out rather than derived: the whole point is that the fixture no
    // longer implements a subset. Compare against packages/grid-core/src/types.ts.
    expect([...new Set(SELECTIONS.map((s) => s.operator))].sort()).toEqual(
      [
        "after",
        "before",
        "between",
        "contains",
        "dateBetween",
        "endsWith",
        "equals",
        "gt",
        "gte",
        "isAnyOf",
        "isEmpty",
        "isNoneOf",
        "isNotEmpty",
        "lt",
        "lte",
        "notContains",
        "notEquals",
        "on",
        "startsWith",
      ].sort(),
    );
  });

  test.each(SELECTIONS)(
    "$columnId ($type) $operator reaches a real implementation",
    ({ columnId, type, operator }) => {
      // The bug this guards: an unimplemented operator that returns all 480
      // rows while the funnel renders as active, which reads as "the server
      // ignored your filter" on pages about who filtered what.
      expect(() =>
        filterBy(columnId, operator, operandFor(columnId, type, operator)),
      ).not.toThrow();
    },
  );
});

describe("queries this fixture cannot answer", () => {
  test("an operator outside FilterOperator throws rather than passing rows through", () => {
    expect(() => filterBy("customer", "soundsLike", "aldridge")).toThrow(
      DocsQueryError,
    );
  });

  test("an operator the column type cannot use throws", () => {
    expect(() => filterBy("placedAt", "contains", "2026")).toThrow(
      /cannot use operator "contains"/,
    );
  });

  test("an unknown column throws", () => {
    expect(() => filterBy("shippedBy", "contains", "a")).toThrow(
      /Unknown column "shippedBy"/,
    );
  });

  test("a missing operand throws", () => {
    expect(() => filterBy("customer", "contains")).toThrow(
      /missing its operand/,
    );
  });

  test("a number operand of the wrong shape throws", () => {
    expect(() => filterBy("total", "gt", "9000")).toThrow(
      /non-NaN number operand/,
    );
  });

  test("a date range of the wrong length throws", () => {
    expect(() => filterBy("placedAt", "dateBetween", ["2026-01-01"])).toThrow(
      /exactly two valid ISO dates/,
    );
  });

  test("an unparseable date operand throws", () => {
    expect(() => filterBy("placedAt", "on", "the first of January")).toThrow(
      /valid ISO date operand/,
    );
  });

  test("a selection operand that is not an array throws", () => {
    expect(() => filterBy("status", "isAnyOf", "open")).toThrow(
      /array of selected values/,
    );
  });
});

describe("totalFor", () => {
  test("exact reports the matched count", () => {
    expect(totalFor("exact", 137, 0, 25)).toEqual({ kind: "exact", count: 137 });
  });

  test("estimate rounds, and does not report the matched count", () => {
    const total = totalFor("estimate", 137, 0, 25);

    expect(total.kind).toBe("estimate");
    expect(total).not.toEqual({ kind: "exact", count: 137 });
    expect(total).toEqual({ kind: "estimate", count: 150 });
  });

  test("unknown reports only what the response proves", () => {
    expect(totalFor("unknown", 137, 50, 25)).toEqual({
      kind: "unknown",
      atLeast: 75,
    });
  });
});

describe("asksToFail", () => {
  function query(filter?: DocsQuery["filters"][number]): DocsQuery {
    return { ...EMPTY_DOCS_QUERY, filters: filter ? [filter] : [] };
  }

  test("a value containing fail asks for the error path", () => {
    expect(
      asksToFail(
        query({ columnId: "customer", operator: "contains", value: "fail" }),
      ),
    ).toBe(true);
  });

  test("it is case-insensitive", () => {
    expect(
      asksToFail(
        query({ columnId: "customer", operator: "contains", value: "FAIL" }),
      ),
    ).toBe(true);
  });

  test("a customer name that merely starts with fai does not", () => {
    expect(
      asksToFail(
        query({
          columnId: "customer",
          operator: "contains",
          value: "Fairhaven",
        }),
      ),
    ).toBe(false);
  });

  test("an ordinary selection does not", () => {
    expect(
      asksToFail(
        query({
          columnId: "status",
          operator: "isAnyOf",
          value: ["open", "shipped"],
        }),
      ),
    ).toBe(false);
  });

  test("an omitted value does not", () => {
    expect(
      asksToFail(query({ columnId: "region", operator: "isEmpty" })),
    ).toBe(false);
  });

  test("an empty query does not", () => {
    expect(asksToFail(query())).toBe(false);
  });
});
