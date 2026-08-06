/**
 * A cell value → the boolean a `type: "boolean"` column means by it.
 *
 * The stringy/numeric spellings a JSON or SQL backend might emit (`"true"`,
 * `1`, `"0"`) resolve to the obvious boolean; anything else falls back to
 * plain truthiness. Used for both the checkbox's rendered state and the value
 * a toggle negates, so a click on a coerced cell always flips it visibly.
 *
 * TWIN: `toBooleanCell` in `packages/grid-core/src/evaluate-filter.ts` applies
 * the same rule in the filter engine (grid-core must not depend on
 * @pretable/react). Change one and you must change the other — that is the
 * whole point: a cell holding `1` must render checked *and* match the "True"
 * filter. The shared case table in
 * `../__tests__/pretable-surface-boolean.test.tsx` and its twin in
 * `packages/grid-core/src/__tests__/evaluate-filter-boolean.test.ts` pin them
 * together.
 */
export function toBooleanCell(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === 1 || value === "1") return true;
  if (value === "false" || value === 0 || value === "0") return false;
  return Boolean(value);
}
