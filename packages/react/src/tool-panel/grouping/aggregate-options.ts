// packages/react/src/tool-panel/grouping/aggregate-options.ts
//
// The aggregate picker's closed vocabulary — the pane's validation.
//
// An invalid aggregate DESTROYS a mounted grid (see `setColumnAggregate`'s
// TSDoc in pretable-model.ts): grid-core stores aggregates uninterpreted and
// the compiler's throw happens inside a React commit. So the pane never
// offers a value the compiler could reject: this module mirrors
// compiled-query's rule — the numeric builtins require `type: "number"`,
// `count` fits any type — and the vocabulary-pin test
// (`grouping-aggregate-vocabulary-pin.test.ts`) holds the mirror against the
// real compiler, so a drifting mirror fails the pin, not the user's grid.
import type { ColumnType } from "@pretable/core";

/** A builtin aggregate name the compiler accepts. */
export type BuiltinAggregate = "sum" | "avg" | "min" | "max" | "count";

/**
 * What the pane may write for a column: a builtin, or the `null` sentinel
 * meaning "no aggregate" (stripped by `mergeColumnAggregateOverrides` before
 * the compiler ever sees it).
 */
export type AggregateChoice = BuiltinAggregate | null;

// NOT the engine's `NUMERIC_AGGREGATES` (compiled-query.ts), deliberately:
// that set is the four aggregates RESTRICTED to number columns; this list is
// what the picker OFFERS a number column, which includes `count`.
const AGGREGATES_FOR_NUMBER_COLUMNS: readonly BuiltinAggregate[] = [
  "sum",
  "avg",
  "min",
  "max",
  "count",
];
const AGGREGATES_FOR_DATE_COLUMNS: readonly BuiltinAggregate[] = [
  "min",
  "max",
  "count",
];
const AGGREGATES_FOR_OTHER_COLUMNS: readonly BuiltinAggregate[] = ["count"];

/**
 * Every builtin, canonically — the number list happens to coincide today,
 * but that is a fact about today's vocabulary, not a definition, so the
 * universal set is owned here rather than derived from a type's offering.
 */
export const ALL_BUILTIN_AGGREGATES: readonly BuiltinAggregate[] =
  AGGREGATES_FOR_NUMBER_COLUMNS;

/** Whether a value read back from engine state is a builtin name. */
export function isBuiltinAggregate(value: unknown): value is BuiltinAggregate {
  return (
    typeof value === "string" &&
    (ALL_BUILTIN_AGGREGATES as readonly string[]).includes(value)
  );
}

/**
 * Builtins offerable for a column type — never the `null` sentinel or the
 * "default" entry; those are picker chrome, not aggregate values.
 */
export function builtinAggregatesForType(
  type: ColumnType | undefined,
): readonly BuiltinAggregate[] {
  if (type === "number") return AGGREGATES_FOR_NUMBER_COLUMNS;
  if (type === "date") return AGGREGATES_FOR_DATE_COLUMNS;
  return AGGREGATES_FOR_OTHER_COLUMNS;
}

/**
 * The effective aggregate a column shows, for picker display: the override
 * when the id is present in `columnAggregates` with a defined value, else the
 * prop-declared value. A key carrying `undefined` reads as NO override —
 * `mergeColumnAggregateOverrides` skips such a key, so the grid is showing
 * the declared aggregate and the picker must agree.
 */
export function effectiveAggregate(
  columnId: string,
  declared: unknown,
  columnAggregates: Readonly<Record<string, unknown>>,
): { readonly value: unknown; readonly overridden: boolean } {
  if (Object.hasOwn(columnAggregates, columnId)) {
    const value = columnAggregates[columnId];
    if (value !== undefined) return { value, overridden: true };
  }
  return { value: declared, overridden: false };
}
