/**
 * Per-column aggregate OVERRIDES, applied to a derivation list.
 *
 * grid-core stores what a tool panel chose (`PretableGridUiState`'s
 * `columnAggregates`); row-model resolves what an aggregate MEANS. Both layers
 * CAN see both halves — `createGridUiCore` takes a `rowModel` and that
 * interface exposes `setDerivations` — so this is a layering choice, not an
 * impossibility: row-model must not depend on grid-core's state shape, and
 * grid-core deliberately drives no derivations at all (it never calls
 * `setDerivations`). The merge is therefore a pure function that a composing
 * layer calls with both inputs, and the merged list travels the ordinary
 * `setDerivations` / `compileQuery` path from there.
 */

/**
 * Aggregate overrides keyed by column id, as a plain lookup.
 *
 * Values are `unknown` because grid-core stores an aggregate without
 * interpreting one; validation happens where every other aggregate is
 * validated, when the merged derivations are compiled. An unknown builtin name
 * or a malformed aggregator object throws `CompiledQueryValidationError`
 * there, exactly as a bad declared `aggregate` does.
 *
 * @public
 */
export type PretableColumnAggregateOverrides = Readonly<
  Record<string, unknown>
>;

/**
 * Apply `overrides` on top of the `aggregate` each derivation declares.
 *
 * IDS ARE THE SCHEMA VOCABULARY — the `id` on the derivations themselves, the
 * same ids `PretableQueryFor` and `RuntimeColumn` use. grid-core keys
 * `columnAggregates` by the LAYOUT column vocabulary instead (see its doc on
 * `PretableGridUiState.columnAggregates`), so a caller reading that state owes
 * the translation before calling this. Nothing in the signature enforces that:
 * both vocabularies are `string`, so the fence is this sentence.
 *
 * An override LAYER, not a replacement: a derivation whose id is absent from
 * `overrides` keeps whatever it declared, so clearing an override — which
 * strips the key rather than storing `undefined` — restores the declared
 * value. A key carrying `undefined` is likewise treated as no override, so
 * `undefined` never acquires a second meaning here. `null` is the value that
 * says "draw NO aggregate for a column whose prop declares one": the merge
 * strips the declared `aggregate` from that derivation, so `compileQuery`
 * never sees the sentinel and validates nothing new.
 *
 * An override for an id no derivation carries is ignored, never appended: this
 * function only ever rewrites the `aggregate` of derivations it was given, and
 * preserves their order, so a merged list stays positionally comparable with
 * the one it came from — which is what `derivationsEqualForPlan` needs to
 * decide plan reuse.
 *
 * TYPES DESCRIBE THE DECLARED SHAPE, NOT THE MERGED ONE. An override arrives
 * as `unknown`, so the returned list keeps the input's type: a column that
 * declared no `aggregate` but carries an override aggregates at runtime while
 * its type still says it does not, and an override of a different output type
 * is invisible to `PretableAggregatesFor`. The alternative — inferring a new
 * derivation type per override — cannot work off state grid-core stores as
 * `unknown`.
 *
 * IDENTITY: returns the INPUT ARRAY ITSELF when nothing applies, so a caller
 * memoising on identity (React) does not re-request derivations every render;
 * that covers a restated override too, since an override `Object.is`-equal to
 * the declared value changes nothing. It is NOT idempotent on the applying
 * path: two calls with equal inputs return two DISTINCT arrays whenever any
 * override actually applies. A React caller must therefore `useMemo` the merge
 * on `[derivations, overrides]` and hold the MERGED array as its
 * last-requested value, rather than calling this inline inside the effect that
 * compares against it — otherwise every render looks like a change and pays a
 * `compileQuery` before concluding no-op. That memo is sound because
 * grid-core's `columnAggregates` object identity is stable across publishes
 * that do not touch it.
 *
 * @public
 */
export function mergeColumnAggregateOverrides<
  TDerivations extends readonly { readonly id: string }[],
>(
  derivations: TDerivations,
  overrides: PretableColumnAggregateOverrides,
): TDerivations {
  let changed = false;
  const merged = derivations.map((derivation) => {
    if (!Object.hasOwn(overrides, derivation.id)) return derivation;
    const aggregate = overrides[derivation.id];
    if (aggregate === undefined) return derivation;
    const declared = (derivation as { readonly aggregate?: unknown }).aggregate;
    if (aggregate === null) {
      // The "no aggregate" sentinel: strip what the prop declared. A column
      // that declares none is already there — identity, not a change.
      if (declared === undefined && !("aggregate" in derivation))
        return derivation;
      changed = true;
      const stripped = { ...derivation } as { aggregate?: unknown } & {
        readonly id: string;
      };
      delete stripped.aggregate;
      return stripped;
    }
    if (Object.is(declared, aggregate)) return derivation;
    changed = true;
    return { ...derivation, aggregate };
  });
  return changed ? (merged as unknown as TDerivations) : derivations;
}
