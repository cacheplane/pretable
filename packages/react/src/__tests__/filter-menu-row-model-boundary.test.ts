// packages/react/src/__tests__/filter-menu-row-model-boundary.test.ts
//
// Cross-boundary contract test: pipes the REAL output of the filter menu's
// `toColumnFilter` (this package) into row-model's REAL `compileQuery` (the
// engine `@pretable/core` sits on). Neither package's own unit tests exercise
// this seam — `filter-operators.test.ts` only checks `toColumnFilter` in
// isolation, and row-model's tests only ever construct filters by hand. That
// gap is why a boolean `isAnyOf`/`isNoneOf` filter (the menu emits the string
// literals "true"/"false", per content/docs/grid/filtering.mdx) could throw
// `CompiledQueryValidationError` in production while every package's own
// suite stayed green.
//
// This lives in packages/react, not row-model: react already depends on both
// @pretable/core and @pretable-internal/row-model (see package.json), so a
// test that imports from both sides follows the existing dependency
// direction. row-model must never import from react.
import { describe, expect, it } from "vitest";
import {
  compileQuery,
  createColumnHelper,
  filterVerdict,
  type PretableQueryFor,
} from "@pretable-internal/row-model";
import type { ColumnType, FilterOperator } from "@pretable/core";
import {
  operatorsForType,
  toColumnFilter,
  type FilterDraft,
} from "../filter-menu/filter-operators";

interface Row {
  id: number;
  value: unknown;
}

interface Case {
  type: ColumnType;
  operator: FilterOperator;
  draft: FilterDraft;
  /** A row value the compiled filter must match. */
  matchValue: unknown;
  /** A row value the compiled filter must NOT match. */
  nonMatchValue: unknown;
}

// One case per (type, operator) pair the menu can actually produce —
// `operatorsForType` is asserted against this table below so the two can't
// silently drift apart.
const CASES: Case[] = [
  // text
  {
    type: "text",
    operator: "contains",
    draft: { operator: "contains", text: "lp" },
    matchValue: "Alpha",
    nonMatchValue: "Zeta",
  },
  {
    type: "text",
    operator: "notContains",
    draft: { operator: "notContains", text: "lp" },
    matchValue: "Zeta",
    nonMatchValue: "Alpha",
  },
  {
    type: "text",
    operator: "equals",
    draft: { operator: "equals", text: "alpha" },
    matchValue: "Alpha",
    nonMatchValue: "Zeta",
  },
  {
    type: "text",
    operator: "notEquals",
    draft: { operator: "notEquals", text: "alpha" },
    matchValue: "Zeta",
    nonMatchValue: "Alpha",
  },
  {
    type: "text",
    operator: "startsWith",
    draft: { operator: "startsWith", text: "al" },
    matchValue: "Alpha",
    nonMatchValue: "Zeta",
  },
  {
    type: "text",
    operator: "endsWith",
    draft: { operator: "endsWith", text: "ha" },
    matchValue: "Alpha",
    nonMatchValue: "Zeta",
  },
  {
    type: "text",
    operator: "isEmpty",
    draft: { operator: "isEmpty" },
    matchValue: "",
    nonMatchValue: "Alpha",
  },
  {
    type: "text",
    operator: "isNotEmpty",
    draft: { operator: "isNotEmpty" },
    matchValue: "Alpha",
    nonMatchValue: "",
  },

  // number
  {
    type: "number",
    operator: "equals",
    draft: { operator: "equals", text: "5" },
    matchValue: 5,
    nonMatchValue: 6,
  },
  {
    type: "number",
    operator: "notEquals",
    draft: { operator: "notEquals", text: "5" },
    matchValue: 6,
    nonMatchValue: 5,
  },
  {
    type: "number",
    operator: "gt",
    draft: { operator: "gt", text: "5" },
    matchValue: 6,
    nonMatchValue: 5,
  },
  {
    type: "number",
    operator: "gte",
    draft: { operator: "gte", text: "5" },
    matchValue: 5,
    nonMatchValue: 4,
  },
  {
    type: "number",
    operator: "lt",
    draft: { operator: "lt", text: "5" },
    matchValue: 4,
    nonMatchValue: 5,
  },
  {
    type: "number",
    operator: "lte",
    draft: { operator: "lte", text: "5" },
    matchValue: 5,
    nonMatchValue: 6,
  },
  {
    type: "number",
    operator: "between",
    draft: { operator: "between", min: "1", max: "10" },
    matchValue: 5,
    nonMatchValue: 11,
  },
  {
    type: "number",
    operator: "isEmpty",
    draft: { operator: "isEmpty" },
    matchValue: null,
    nonMatchValue: 5,
  },
  {
    type: "number",
    operator: "isNotEmpty",
    draft: { operator: "isNotEmpty" },
    matchValue: 5,
    nonMatchValue: null,
  },

  // date
  {
    type: "date",
    operator: "on",
    draft: { operator: "on", text: "2026-06-18" },
    matchValue: "2026-06-18",
    nonMatchValue: "2026-06-19",
  },
  {
    type: "date",
    operator: "before",
    draft: { operator: "before", text: "2026-06-18" },
    matchValue: "2026-06-17",
    nonMatchValue: "2026-06-19",
  },
  {
    type: "date",
    operator: "after",
    draft: { operator: "after", text: "2026-06-18" },
    matchValue: "2026-06-19",
    nonMatchValue: "2026-06-17",
  },
  {
    type: "date",
    operator: "dateBetween",
    draft: { operator: "dateBetween", min: "2026-01-01", max: "2026-02-01" },
    matchValue: "2026-01-15",
    nonMatchValue: "2026-03-01",
  },
  {
    type: "date",
    operator: "isEmpty",
    draft: { operator: "isEmpty" },
    matchValue: null,
    nonMatchValue: "2026-06-18",
  },
  {
    type: "date",
    operator: "isNotEmpty",
    draft: { operator: "isNotEmpty" },
    matchValue: "2026-06-18",
    nonMatchValue: null,
  },

  // enum
  {
    type: "enum",
    operator: "isAnyOf",
    draft: { operator: "isAnyOf", selected: ["open"] },
    matchValue: "open",
    nonMatchValue: "closed",
  },
  {
    type: "enum",
    operator: "isNoneOf",
    draft: { operator: "isNoneOf", selected: ["open"] },
    matchValue: "closed",
    nonMatchValue: "open",
  },
  {
    type: "enum",
    operator: "isEmpty",
    draft: { operator: "isEmpty" },
    matchValue: null,
    nonMatchValue: "open",
  },
  {
    type: "enum",
    operator: "isNotEmpty",
    draft: { operator: "isNotEmpty" },
    matchValue: "open",
    nonMatchValue: null,
  },

  // boolean — the regression: BOOLEAN_OPTIONS (filter-operators.ts) emits the
  // string literals "true"/"false", exactly as documented in
  // content/docs/grid/filtering.mdx. This is the shape that used to throw.
  {
    type: "boolean",
    operator: "isAnyOf",
    draft: { operator: "isAnyOf", selected: ["true"] },
    matchValue: true,
    nonMatchValue: false,
  },
  {
    type: "boolean",
    operator: "isNoneOf",
    draft: { operator: "isNoneOf", selected: ["true"] },
    matchValue: false,
    nonMatchValue: true,
  },
  {
    type: "boolean",
    operator: "isEmpty",
    draft: { operator: "isEmpty" },
    matchValue: null,
    nonMatchValue: true,
  },
  {
    type: "boolean",
    operator: "isNotEmpty",
    draft: { operator: "isNotEmpty" },
    matchValue: true,
    nonMatchValue: null,
  },
];

describe("filter menu -> row-model boundary", () => {
  it("covers every operator each column type's menu actually offers", () => {
    for (const type of ["text", "number", "date", "enum", "boolean"] as const) {
      const covered = CASES.filter((c) => c.type === type).map(
        (c) => c.operator,
      );
      const offered = operatorsForType(type);
      expect(new Set(covered)).toEqual(new Set(offered));
    }
  });

  it.each(CASES.map((c) => [`${c.type} ${c.operator}`, c] as const))(
    "toColumnFilter(%s) compiles and evaluates correctly against row-model",
    (_label, { type, operator, draft, matchValue, nonMatchValue }) => {
      const filter = toColumnFilter(type, draft);
      expect(filter).not.toBeNull();
      const resolved = filter!;
      expect(resolved.operator).toBe(operator);

      const column = createColumnHelper<Row>();
      const columns = [
        column.accessor("value", { type: type as never }),
      ] as const;
      const query = {
        filters: [{ columnId: "value", ...resolved }],
        rowGroups: [],
        sort: [],
      } as PretableQueryFor<typeof columns>;

      // Must not throw CompiledQueryValidationError: this is the exact call
      // path pretable-surface.tsx's setColumnFilter feeds into
      // createLocalRowModel(...).setQuery().
      const plan = compileQuery<typeof columns>({
        derivations: columns,
        query,
      });

      expect(
        filterVerdict(plan, {
          rowId: 1,
          row: { id: 1, value: matchValue },
          sourceOrder: 0,
          slot: 0,
        }),
      ).toBe(true);
      expect(
        filterVerdict(plan, {
          rowId: 2,
          row: { id: 2, value: nonMatchValue },
          sourceOrder: 0,
          slot: 1,
        }),
      ).toBe(false);
    },
  );
});
