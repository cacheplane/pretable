import * as fc from "fast-check";

/**
 * Compatibility seams that the frozen grid-core projector cannot express.
 * Every entry is referenced by an explicit adapter branch in
 * `differential.test.ts`; new-only contracts are asserted separately.
 */
export const APPROVED_INTENTIONAL_DIFFERENCES = Object.freeze([] as const);

export type DifferentialRowId = string | number;
export type DifferentialColumnId = "sector" | "analyst" | "quantity" | "label";

export interface DifferentialRow {
  readonly [key: string]: unknown;
  readonly id: DifferentialRowId;
  readonly sector: string;
  readonly analyst: string;
  readonly quantity: number;
  readonly label: string | null;
}

export type DifferentialFilter =
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
      readonly columnId: DifferentialColumnId;
      readonly operator: "isEmpty" | "isNotEmpty";
    };

export interface DifferentialOrdering {
  readonly columnId: DifferentialColumnId;
  readonly direction: "asc" | "desc";
  readonly nulls?: "first" | "last";
}

export interface DifferentialGroup {
  readonly columnId: "sector" | "analyst";
  readonly direction: "asc" | "desc";
  readonly nulls?: "first" | "last";
}

export interface DifferentialQuery {
  readonly filters: readonly DifferentialFilter[];
  readonly sort: readonly DifferentialOrdering[];
  readonly rowGroups: readonly DifferentialGroup[];
}

export type DifferentialDerivations =
  "sum" | "avg" | "custom-total" | "absolute-quantity" | "reverse-sector";

export type DifferentialOperation =
  | { readonly kind: "add"; readonly row: DifferentialRow }
  | {
      readonly kind: "update";
      readonly id: DifferentialRowId;
      readonly changes: Partial<DifferentialRow>;
    }
  | { readonly kind: "remove"; readonly id: DifferentialRowId }
  | { readonly kind: "setRows"; readonly rows: readonly DifferentialRow[] }
  | { readonly kind: "setQuery"; readonly query: DifferentialQuery }
  | {
      readonly kind: "setDerivations";
      readonly derivations: DifferentialDerivations;
    }
  | {
      readonly kind: "invalidQuery";
      readonly fault: "operator" | "column" | "direction";
    }
  | {
      readonly kind: "duplicateTransaction";
      readonly id: DifferentialRowId;
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
  | { readonly kind: "conflict"; readonly id: DifferentialRowId };

const idArbitrary: fc.Arbitrary<DifferentialRowId> = fc.oneof(
  fc.integer({ min: 0, max: 15 }),
  fc
    .integer({ min: 0, max: 15 })
    .map((id) => (id === 0 ? "__group__:sector=s:S0" : `r${id}`)),
);

const rowArbitrary: fc.Arbitrary<DifferentialRow> = fc.record({
  id: idArbitrary,
  sector: fc.constantFrom("S0", "S/1", "S%2", "S=3"),
  analyst: fc.constantFrom("Ada", "Bob/Two", "Cy=Three"),
  quantity: fc.integer({ min: -20, max: 50 }),
  label: fc.constantFrom(null, "", "item 1", "Item 2", "item 10", "z"),
});

const textFilterArbitrary: fc.Arbitrary<DifferentialFilter> = fc
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

const numericFilterArbitrary: fc.Arbitrary<DifferentialFilter> = fc.oneof(
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

const emptyFilterArbitrary: fc.Arbitrary<DifferentialFilter> = fc
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

const orderingArbitrary: fc.Arbitrary<DifferentialOrdering> = fc.record(
  {
    columnId: fc.constantFrom(
      "sector" as const,
      "analyst" as const,
      "quantity" as const,
      "label" as const,
    ),
    direction: fc.constantFrom("asc" as const, "desc" as const),
    nulls: fc.option(fc.constantFrom("first" as const, "last" as const), {
      nil: undefined,
    }),
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

export const queryArbitrary: fc.Arbitrary<DifferentialQuery> = fc.record({
  filters: fc.array(
    fc.oneof(textFilterArbitrary, numericFilterArbitrary, emptyFilterArbitrary),
    { maxLength: 6 },
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

const updateArbitrary: fc.Arbitrary<DifferentialOperation> = fc
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

const synchronousOperationArbitrary: fc.Arbitrary<DifferentialOperation> =
  fc.oneof(
    rowArbitrary.map((row) => ({ kind: "add" as const, row })),
    updateArbitrary,
    idArbitrary.map((id) => ({ kind: "remove" as const, id })),
    fc
      .array(rowArbitrary, { maxLength: 12 })
      .map((rows) => ({ kind: "setRows" as const, rows })),
    fc.integer({ min: 0, max: 20 }).map((selector) => ({
      kind: "toggleGroup" as const,
      selector,
    })),
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
    idArbitrary.map((id) => ({ kind: "conflict" as const, id })),
    fc
      .tuple(
        idArbitrary,
        fc.constantFrom(
          "add" as const,
          "update" as const,
          "remove" as const,
          "conflict" as const,
        ),
      )
      .map(([id, duplicate]) => ({
        kind: "duplicateTransaction" as const,
        id,
        duplicate,
      })),
  );

export const operationArbitrary: fc.Arbitrary<DifferentialOperation> = fc.oneof(
  synchronousOperationArbitrary,
  queryArbitrary.map((query) => ({ kind: "setQuery" as const, query })),
  fc
    .constantFrom(
      "sum" as const,
      "avg" as const,
      "custom-total" as const,
      "absolute-quantity" as const,
      "reverse-sector" as const,
    )
    .map((derivations) => ({ kind: "setDerivations" as const, derivations })),
  fc
    .constantFrom("operator" as const, "column" as const, "direction" as const)
    .map((fault) => ({ kind: "invalidQuery" as const, fault })),
);

export const scenarioArbitrary = fc.record({
  rows: fc.uniqueArray(rowArbitrary, {
    minLength: 1,
    maxLength: 12,
    selector: (row) => `${typeof row.id}:${String(row.id)}`,
  }),
  query: queryArbitrary,
  aggregateFilteredRows: fc.boolean(),
  operations: fc.array(operationArbitrary, { minLength: 1, maxLength: 40 }),
});

export const transitionScenarioArbitrary = fc.record({
  rows: fc.uniqueArray(rowArbitrary, {
    minLength: 8,
    maxLength: 16,
    selector: (row) => `${typeof row.id}:${String(row.id)}`,
  }),
  first: queryArbitrary,
  second: queryArbitrary,
  updates: fc.array(updateArbitrary, { minLength: 1, maxLength: 8 }),
  concurrent: fc.array(
    fc.oneof(
      synchronousOperationArbitrary,
      queryArbitrary.map((query) => ({ kind: "setQuery" as const, query })),
      fc
        .constantFrom(
          "sum" as const,
          "avg" as const,
          "custom-total" as const,
          "absolute-quantity" as const,
          "reverse-sector" as const,
        )
        .map((derivations) => ({
          kind: "setDerivations" as const,
          derivations,
        })),
    ),
    { minLength: 3, maxLength: 14 },
  ),
});
