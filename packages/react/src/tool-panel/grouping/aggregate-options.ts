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

const NUMBER_AGGREGATES: readonly BuiltinAggregate[] = [
  "sum",
  "avg",
  "min",
  "max",
  "count",
];
const ANY_TYPE_AGGREGATES: readonly BuiltinAggregate[] = ["count"];

/**
 * Builtins offerable for a column type — never the `null` sentinel or the
 * "default" entry; those are picker chrome, not aggregate values.
 */
export function builtinAggregatesForType(
  type: ColumnType | undefined,
): readonly BuiltinAggregate[] {
  return type === "number" ? NUMBER_AGGREGATES : ANY_TYPE_AGGREGATES;
}

/**
 * The effective aggregate a column shows, for picker display: the override
 * when the id is PRESENT in `columnAggregates` (key presence is the signal,
 * exactly as `mergeColumnAggregateOverrides` reads it), else the
 * prop-declared value.
 */
export function effectiveAggregate(
  columnId: string,
  declared: unknown,
  columnAggregates: Readonly<Record<string, unknown>>,
): { readonly value: unknown; readonly overridden: boolean } {
  if (Object.hasOwn(columnAggregates, columnId)) {
    return { value: columnAggregates[columnId], overridden: true };
  }
  return { value: declared, overridden: false };
}
