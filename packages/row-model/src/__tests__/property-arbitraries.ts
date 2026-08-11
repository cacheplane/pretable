import * as fc from "fast-check";

export type PropertyRowId = string | number;
export type PropertyColumnId = "sector" | "analyst" | "quantity" | "label";

export interface PropertyRow {
  readonly id: PropertyRowId;
  readonly sector: string;
  readonly analyst: string;
  readonly quantity: number;
  readonly label: string | null;
}

export type PropertyFilter =
  | {
      readonly columnId: "quantity";
      readonly operator: "equals" | "notEquals" | "gt" | "gte" | "lt" | "lte";
      readonly value: number;
    }
  | {
      readonly columnId: "quantity";
      readonly operator: "between";
      readonly value: readonly [number, number];
    }
  | {
      readonly columnId: "sector" | "analyst" | "label";
      readonly operator:
        | "contains"
        | "notContains"
        | "equals"
        | "notEquals"
        | "startsWith"
        | "endsWith";
      readonly value: string;
    }
  | {
      readonly columnId: PropertyColumnId;
      readonly operator: "isEmpty" | "isNotEmpty";
    };

export interface PropertyOrdering {
  readonly columnId: PropertyColumnId;
  readonly direction: "asc" | "desc";
  readonly nulls?: "first" | "last";
}

export interface PropertyGroup {
  readonly columnId: "sector" | "analyst";
  readonly direction: "asc" | "desc";
  readonly nulls?: "first" | "last";
}

export interface PropertyQuery {
  readonly filters: readonly PropertyFilter[];
  readonly sort: readonly PropertyOrdering[];
  readonly rowGroups: readonly PropertyGroup[];
}

export type PropertyDerivations =
  "sum" | "avg" | "custom-total" | "absolute-quantity" | "reverse-sector";

export type PropertyOperation =
  | { readonly kind: "add"; readonly row: PropertyRow }
  | {
      readonly kind: "update";
      readonly id: PropertyRowId;
      readonly changes: Partial<Omit<PropertyRow, "id">>;
    }
  | { readonly kind: "remove"; readonly id: PropertyRowId }
  | { readonly kind: "setRows"; readonly rows: readonly PropertyRow[] }
  | { readonly kind: "setQuery"; readonly query: PropertyQuery }
  | {
      readonly kind: "setDerivations";
      readonly derivations: PropertyDerivations;
    }
  | {
      readonly kind: "invalidQuery";
      readonly fault: "operator" | "column" | "direction";
    }
  | {
      readonly kind: "duplicateTransaction";
      readonly id: PropertyRowId;
      readonly duplicate: "add" | "update" | "remove" | "conflict";
    }
  | { readonly kind: "toggleGroup"; readonly selector: number }
  | {
      readonly kind: "setExpansionDefault";
      readonly policy:
        | { readonly kind: "expanded" }
        | { readonly kind: "collapsed" }
        | { readonly kind: "through-depth"; readonly depth: number };
    }
  | { readonly kind: "expandAll" }
  | { readonly kind: "collapseAll" }
  | { readonly kind: "conflict"; readonly id: PropertyRowId };

const idArbitrary: fc.Arbitrary<PropertyRowId> = fc.oneof(
  fc.integer({ min: 0, max: 15 }),
  fc
    .integer({ min: 0, max: 15 })
    .map((id) => (id === 0 ? "__group__:sector=s:S0" : `r${id}`)),
);

export const propertyRowArbitrary: fc.Arbitrary<PropertyRow> = fc.record({
  id: idArbitrary,
  sector: fc.constantFrom("S0", "S/1", "S%2", "S=3"),
  analyst: fc.constantFrom("Ada", "Bob/Two", "Cy=Three"),
  quantity: fc.integer({ min: -20, max: 50 }),
  label: fc.constantFrom(null, "", "item 1", "Item 2", "item 10", "z"),
});

const textFilterArbitrary: fc.Arbitrary<PropertyFilter> = fc
  .tuple(
    fc.constantFrom("sector" as const, "analyst" as const, "label" as const),
    fc.constantFrom(
      "contains" as const,
      "notContains" as const,
      "equals" as const,
      "notEquals" as const,
      "startsWith" as const,
      "endsWith" as const,
    ),
    fc.constantFrom("", "a", "A", "S", "item", "/", "="),
  )
  .map(([columnId, operator, value]) => ({ columnId, operator, value }));

const numericFilterArbitrary: fc.Arbitrary<PropertyFilter> = fc.oneof(
  fc
    .tuple(
      fc.constantFrom(
        "equals" as const,
        "notEquals" as const,
        "gt" as const,
        "gte" as const,
        "lt" as const,
        "lte" as const,
      ),
      fc.integer({ min: -20, max: 50 }),
    )
    .map(([operator, value]) => ({
      columnId: "quantity" as const,
      operator,
      value,
    })),
  fc
    .tuple(fc.integer({ min: -20, max: 50 }), fc.integer({ min: -20, max: 50 }))
    .map(([left, right]) => ({
      columnId: "quantity" as const,
      operator: "between" as const,
      value: [Math.min(left, right), Math.max(left, right)] as const,
    })),
);

const emptyFilterArbitrary: fc.Arbitrary<PropertyFilter> = fc
  .tuple(
    fc.constantFrom(
      "sector" as const,
      "analyst" as const,
      "quantity" as const,
      "label" as const,
    ),
    fc.constantFrom("isEmpty" as const, "isNotEmpty" as const),
  )
  .map(([columnId, operator]) => ({ columnId, operator }));

const orderingArbitrary: fc.Arbitrary<PropertyOrdering> = fc.record(
  {
    columnId: fc.constantFrom("sector", "analyst", "quantity", "label"),
    direction: fc.constantFrom("asc", "desc"),
    nulls: fc.option(fc.constantFrom("first", "last"), { nil: undefined }),
  },
  { requiredKeys: ["columnId", "direction"] },
);

const groupArbitrary = (columnId: "sector" | "analyst") =>
  fc.record(
    {
      columnId: fc.constant(columnId),
      direction: fc.constantFrom("asc" as const, "desc" as const),
      nulls: fc.option(fc.constantFrom("first" as const, "last" as const), {
        nil: undefined,
      }),
    },
    { requiredKeys: ["columnId", "direction"] },
  );

export const propertyQueryArbitrary: fc.Arbitrary<PropertyQuery> = fc.record({
  filters: fc.array(
    fc.oneof(textFilterArbitrary, numericFilterArbitrary, emptyFilterArbitrary),
    { maxLength: 5 },
  ),
  sort: fc.uniqueArray(orderingArbitrary, {
    maxLength: 4,
    selector: (entry) => entry.columnId,
  }),
  rowGroups: fc.oneof(
    fc.constant([] as const),
    groupArbitrary("sector").map((group) => [group]),
    groupArbitrary("analyst").map((group) => [group]),
    fc.tuple(groupArbitrary("sector"), groupArbitrary("analyst")),
    fc.tuple(groupArbitrary("analyst"), groupArbitrary("sector")),
  ),
});

const updateArbitrary: fc.Arbitrary<PropertyOperation> = fc
  .tuple(
    idArbitrary,
    fc.record(
      {
        sector: fc.constantFrom("S0", "S/1", "S%2", "S=3"),
        analyst: fc.constantFrom("Ada", "Bob/Two", "Cy=Three"),
        quantity: fc.integer({ min: -20, max: 50 }),
        label: fc.constantFrom(null, "", "item 1", "Item 2", "item 10", "z"),
      },
      { requiredKeys: [] },
    ),
  )
  .map(([id, changes]) => ({ kind: "update" as const, id, changes }));

const rowMutationArbitrary: fc.Arbitrary<PropertyOperation> = fc.oneof(
  propertyRowArbitrary.map((row) => ({ kind: "add" as const, row })),
  updateArbitrary,
  idArbitrary.map((id) => ({ kind: "remove" as const, id })),
  fc.array(propertyRowArbitrary, { maxLength: 10 }).map((rows) => ({
    kind: "setRows" as const,
    rows,
  })),
);

const expansionArbitrary: fc.Arbitrary<PropertyOperation> = fc.oneof(
  fc
    .nat({ max: 20 })
    .map((selector) => ({ kind: "toggleGroup" as const, selector })),
  fc
    .oneof(
      fc.constant({ kind: "expanded" as const }),
      fc.constant({ kind: "collapsed" as const }),
      fc.integer({ min: 0, max: 2 }).map((depth) => ({
        kind: "through-depth" as const,
        depth,
      })),
    )
    .map((policy) => ({ kind: "setExpansionDefault" as const, policy })),
  fc.constant({ kind: "expandAll" as const }),
  fc.constant({ kind: "collapseAll" as const }),
);

export const propertyOperationArbitrary: fc.Arbitrary<PropertyOperation> =
  fc.oneof(
    rowMutationArbitrary,
    propertyQueryArbitrary.map((query) => ({
      kind: "setQuery" as const,
      query,
    })),
    fc
      .constantFrom(
        "sum",
        "avg",
        "custom-total",
        "absolute-quantity",
        "reverse-sector",
      )
      .map((derivations) => ({ kind: "setDerivations" as const, derivations })),
    fc.constantFrom("operator", "column", "direction").map((fault) => ({
      kind: "invalidQuery" as const,
      fault,
    })),
    fc
      .tuple(
        idArbitrary,
        fc.constantFrom("add", "update", "remove", "conflict"),
      )
      .map(([id, duplicate]) => ({
        kind: "duplicateTransaction" as const,
        id,
        duplicate,
      })),
    expansionArbitrary,
    idArbitrary.map((id) => ({ kind: "conflict" as const, id })),
  );

export const propertyScenarioArbitrary = fc.record({
  rows: fc.uniqueArray(propertyRowArbitrary, {
    minLength: 1,
    maxLength: 12,
    selector: (row) => `${typeof row.id}:${String(row.id)}`,
  }),
  query: propertyQueryArbitrary,
  aggregateFilteredRows: fc.boolean(),
  operations: fc.array(propertyOperationArbitrary, {
    minLength: 1,
    maxLength: 24,
  }),
});

export const propertyTransitionScenarioArbitrary = fc.record({
  rows: fc.uniqueArray(propertyRowArbitrary, {
    minLength: 6,
    maxLength: 14,
    selector: (row) => `${typeof row.id}:${String(row.id)}`,
  }),
  first: propertyQueryArbitrary,
  second: propertyQueryArbitrary,
  concurrent: fc.array(rowMutationArbitrary, { minLength: 1, maxLength: 10 }),
});
