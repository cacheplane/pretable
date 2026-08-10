import * as fc from "fast-check";

/**
 * Approved differences excluded from the shared projector domain. New-only
 * contracts are still generated and checked against the reference reducer.
 */
export const APPROVED_INTENTIONAL_DIFFERENCES = Object.freeze([
  "collapsed-default-expansion",
  "typed-null-and-nan-ordering",
  "independent-group-direction",
  "strict-correlated-query-validation",
  "multiple-filters-per-column",
  "date-signed-zero-and-object-group-identity",
  "exact-numeric-aggregation",
  "number-row-ids",
  "structured-transaction-results",
  "monotonic-transaction-source-tokens",
  "custom-derivation-replacement",
] as const);

export interface DifferentialRow {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly sector: string;
  readonly analyst: string;
  readonly quantity: number;
  readonly label: string;
}

export interface DifferentialQuery {
  readonly minimum: number | undefined;
  readonly direction: "asc" | "desc" | undefined;
  readonly groups: readonly ("sector" | "analyst")[];
}

export type DifferentialOperation =
  | { readonly kind: "add"; readonly row: DifferentialRow }
  | {
      readonly kind: "update";
      readonly id: string;
      readonly changes: Partial<DifferentialRow>;
    }
  | { readonly kind: "remove"; readonly id: string }
  | { readonly kind: "setRows"; readonly rows: readonly DifferentialRow[] }
  | { readonly kind: "setQuery"; readonly query: DifferentialQuery }
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
  | { readonly kind: "conflict"; readonly id: string };

const idArbitrary = fc
  .integer({ min: 0, max: 15 })
  .map((id) => (id === 0 ? "__group__:sector=s:S0" : `r${id}`));

const rowArbitrary: fc.Arbitrary<DifferentialRow> = fc.record({
  id: idArbitrary,
  sector: fc.constantFrom("S0", "S/1", "S%2", "S=3"),
  analyst: fc.constantFrom("Ada", "Bob/Two", "Cy=Three"),
  quantity: fc.integer({ min: -20, max: 50 }),
  label: fc.constantFrom("item 1", "Item 2", "item 10", "z"),
});

export const queryArbitrary: fc.Arbitrary<DifferentialQuery> = fc.record({
  minimum: fc.option(fc.integer({ min: -20, max: 50 }), {
    nil: undefined,
  }),
  direction: fc.option(fc.constantFrom("asc" as const, "desc" as const), {
    nil: undefined,
  }),
  groups: fc.constantFrom(
    [] as const,
    ["sector"] as const,
    ["analyst"] as const,
    ["sector", "analyst"] as const,
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
        label: fc.constantFrom("item 1", "Item 2", "item 10", "z"),
      },
      { requiredKeys: [] },
    ),
  )
  .map(([id, changes]) => ({ kind: "update" as const, id, changes }));

export const operationArbitrary: fc.Arbitrary<DifferentialOperation> = fc.oneof(
  rowArbitrary.map((row) => ({ kind: "add" as const, row })),
  updateArbitrary,
  idArbitrary.map((id) => ({ kind: "remove" as const, id })),
  fc
    .array(rowArbitrary, { maxLength: 12 })
    .map((rows) => ({ kind: "setRows" as const, rows })),
  queryArbitrary.map((query) => ({ kind: "setQuery" as const, query })),
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
);

export const scenarioArbitrary = fc.record({
  rows: fc.uniqueArray(rowArbitrary, {
    minLength: 1,
    maxLength: 12,
    selector: (row) => row.id,
  }),
  query: queryArbitrary,
  aggregateFilteredRows: fc.boolean(),
  operations: fc.array(operationArbitrary, { minLength: 1, maxLength: 40 }),
});

export const transitionScenarioArbitrary = fc.record({
  rows: fc.uniqueArray(rowArbitrary, {
    minLength: 8,
    maxLength: 16,
    selector: (row) => row.id,
  }),
  first: queryArbitrary,
  second: queryArbitrary,
  updates: fc.array(updateArbitrary, { minLength: 1, maxLength: 8 }),
});
