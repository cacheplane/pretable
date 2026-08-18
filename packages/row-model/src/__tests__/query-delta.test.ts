import { describe, expect, test } from "vitest";

import {
  compileQuery,
  createColumnHelper,
  isSortOnlyChange,
  type PretableQueryFor,
} from "../index";

interface Holding {
  id: string;
  sector: string;
  customer: string;
  quantity: number;
}

const helper = createColumnHelper<Holding>();
const columns = [
  helper.accessor("sector", { type: "text" }),
  helper.accessor("customer", { type: "text" }),
  helper.accessor("quantity", { type: "number", aggregate: "sum" }),
] as const;

/**
 * Checks a query literal against a column tuple, exactly as
 * `compiled-query.test.ts` does. `PretableQueryFor<TColumns>` is not an
 * inference site, so the tuple type is named once here.
 */
function queryFor<TColumns>(
  value: PretableQueryFor<TColumns>,
): PretableQueryFor<TColumns> {
  return value;
}

const ASC_QUANTITY = queryFor<typeof columns>({
  filters: [],
  sort: [{ columnId: "quantity", direction: "asc" }],
  rowGroups: [],
});

const DESC_QUANTITY = queryFor<typeof columns>({
  filters: [],
  sort: [{ columnId: "quantity", direction: "desc" }],
  rowGroups: [],
});

describe("isSortOnlyChange", () => {
  test("true when only the sort differs", () => {
    const previous = compileQuery({
      derivations: columns,
      query: ASC_QUANTITY,
    });
    const next = compileQuery({ derivations: columns, query: DESC_QUANTITY });

    expect(isSortOnlyChange(previous, next)).toBe(true);
  });

  test.each([
    {
      name: "direction flip",
      prevSort: [{ columnId: "quantity", direction: "asc" }],
      nextSort: [{ columnId: "quantity", direction: "desc" }],
    },
    {
      name: "added sort column",
      prevSort: [{ columnId: "quantity", direction: "asc" }],
      nextSort: [
        { columnId: "quantity", direction: "asc" },
        { columnId: "sector", direction: "asc" },
      ],
    },
    {
      name: "removal to unsorted",
      prevSort: [{ columnId: "quantity", direction: "asc" }],
      nextSort: [],
    },
  ] as const)("true for $name", ({ prevSort, nextSort }) => {
    const previous = compileQuery({
      derivations: columns,
      query: queryFor<typeof columns>({
        filters: [],
        sort: prevSort,
        rowGroups: [],
      }),
    });
    const next = compileQuery({
      derivations: columns,
      query: queryFor<typeof columns>({
        filters: [],
        sort: nextSort,
        rowGroups: [],
      }),
    });

    expect(isSortOnlyChange(previous, next)).toBe(true);
  });

  test("false when the sort is identical", () => {
    // Two structurally-equal plans compiled independently (no `previous`
    // passed to `compileQuery`), so they are distinct objects.
    const previous = compileQuery({
      derivations: columns,
      query: ASC_QUANTITY,
    });
    const next = compileQuery({
      derivations: columns,
      query: queryFor<typeof columns>({
        filters: [],
        sort: [{ columnId: "quantity", direction: "asc" }],
        rowGroups: [],
      }),
    });

    expect(previous).not.toBe(next);
    expect(isSortOnlyChange(previous, next)).toBe(false);
  });

  test("false when filters also changed", () => {
    const previous = compileQuery({
      derivations: columns,
      query: queryFor<typeof columns>({
        filters: [{ columnId: "sector", operator: "contains", value: "Tech" }],
        sort: [{ columnId: "quantity", direction: "asc" }],
        rowGroups: [],
      }),
    });
    const next = compileQuery({
      derivations: columns,
      query: queryFor<typeof columns>({
        filters: [
          { columnId: "sector", operator: "contains", value: "Energy" },
        ],
        sort: [{ columnId: "quantity", direction: "desc" }],
        rowGroups: [],
      }),
    });

    expect(isSortOnlyChange(previous, next)).toBe(false);
  });

  test("false when rowGroups also changed", () => {
    const previous = compileQuery({
      derivations: columns,
      query: queryFor<typeof columns>({
        filters: [],
        sort: [{ columnId: "quantity", direction: "asc" }],
        rowGroups: [{ columnId: "sector", direction: "asc" }],
      }),
    });
    const next = compileQuery({
      derivations: columns,
      query: queryFor<typeof columns>({
        filters: [],
        sort: [{ columnId: "quantity", direction: "desc" }],
        rowGroups: [{ columnId: "customer", direction: "asc" }],
      }),
    });

    expect(isSortOnlyChange(previous, next)).toBe(false);
  });

  test("false when derivations changed for an active column", () => {
    const quantityA = (row: Holding) => row.quantity;
    const quantityB = (row: Holding) => row.quantity;
    const columnsA = [
      helper.accessor("sector", { type: "text" }),
      helper.accessor("customer", { type: "text" }),
      helper.accessor("quantity", quantityA, {
        type: "number",
        aggregate: "sum",
      }),
    ] as const;
    const columnsB = [
      helper.accessor("sector", { type: "text" }),
      helper.accessor("customer", { type: "text" }),
      helper.accessor("quantity", quantityB, {
        type: "number",
        aggregate: "sum",
      }),
    ] as const;

    const previous = compileQuery({
      derivations: columnsA,
      query: ASC_QUANTITY as unknown as PretableQueryFor<typeof columnsA>,
    });
    const next = compileQuery({
      derivations: columnsB,
      query: DESC_QUANTITY as unknown as PretableQueryFor<typeof columnsB>,
    });

    expect(isSortOnlyChange(previous, next)).toBe(false);
  });

  test("false when filterAuthority differs between plans", () => {
    const previous = compileQuery({
      derivations: columns,
      query: ASC_QUANTITY,
    });
    const next = compileQuery({
      derivations: columns,
      query: DESC_QUANTITY,
      filterAuthority: "external",
    });

    expect(isSortOnlyChange(previous, next)).toBe(false);
  });

  test("false when sortAuthority differs between plans", () => {
    const previous = compileQuery({
      derivations: columns,
      query: ASC_QUANTITY,
    });
    const next = compileQuery({
      derivations: columns,
      query: DESC_QUANTITY,
      sortAuthority: "external",
    });

    expect(isSortOnlyChange(previous, next)).toBe(false);
  });

  test("false when both plans are external sort authority and only the public sort differs", () => {
    const previous = compileQuery({
      derivations: columns,
      query: ASC_QUANTITY,
      sortAuthority: "external",
    });
    const next = compileQuery({
      derivations: columns,
      query: DESC_QUANTITY,
      sortAuthority: "external",
    });

    // Runtime sort is [] for both under external authority, so there is no
    // runtime-level change at all.
    expect(isSortOnlyChange(previous, next)).toBe(false);
  });

  test("false for foreign plan objects in either position", () => {
    const real = compileQuery({ derivations: columns, query: ASC_QUANTITY });
    const foreign = { query: DESC_QUANTITY, derivations: columns };

    expect(isSortOnlyChange(foreign as never, real)).toBe(false);
    expect(isSortOnlyChange(real, foreign as never)).toBe(false);
  });
});
