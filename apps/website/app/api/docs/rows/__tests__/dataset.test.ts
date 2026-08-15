import { describe, expect, test } from "vitest";

import {
  applyDocsQuery,
  DOCS_ORDERS,
  EMPTY_DOCS_QUERY,
  totalFor,
} from "../dataset";

describe("applyDocsQuery", () => {
  test("returns every row for an empty query", () => {
    expect(applyDocsQuery(DOCS_ORDERS, EMPTY_DOCS_QUERY)).toHaveLength(
      DOCS_ORDERS.length,
    );
  });

  test("a contains filter narrows to matching rows only", () => {
    const rows = applyDocsQuery(DOCS_ORDERS, {
      ...EMPTY_DOCS_QUERY,
      filters: [{ columnId: "customer", operator: "contains", value: "a" }],
    });

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(DOCS_ORDERS.length);
    for (const row of rows) expect(row.customer.toLowerCase()).toContain("a");
  });

  test("an isAnyOf filter keeps only the named statuses", () => {
    const rows = applyDocsQuery(DOCS_ORDERS, {
      ...EMPTY_DOCS_QUERY,
      filters: [
        { columnId: "status", operator: "isAnyOf", value: ["open", "shipped"] },
      ],
    });

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(["open", "shipped"]).toContain(row.status);
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
