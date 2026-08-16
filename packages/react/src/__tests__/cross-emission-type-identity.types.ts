/**
 * Type-only. Compiled by `tsconfig.typecheck.json` (which maps every workspace
 * dependency to its built `.d.ts` and, unlike `tsconfig.json`, includes tests),
 * so these assertions run under `pnpm typecheck`. There is nothing to execute:
 * a failure here is a compile error, not a red test.
 *
 * **What it pins.** `@pretable/core` bundles `@pretable-internal/grid-core` and
 * `@pretable-internal/row-model` (`noExternal`), so `tsup`'s bundled `.d.ts`
 * re-emits their declarations alongside the copies `tsc` already wrote into
 * each package's own `dist`. Two emissions of one declaration must be the SAME
 * type. When they are not, this package pays for it: it compiles against both
 * at once, and every crossing needs a cast.
 *
 * That is not a hypothetical. `pretable-model.ts` used to carry two
 * `as unknown as` casts, and the first of them reported:
 *
 * ```
 * Property '[groupIdBrand]' is missing in type
 * 'String & { readonly [groupIdBrand]: "PretableGroupId"; }' but required in
 * type '{ readonly [groupIdBrand]: "PretableGroupId"; }'.
 * ```
 *
 * — the same declaration, twice, unrelated, because a `unique symbol` is
 * nominal per declaration file.
 *
 * The `RowOf` / `ColumnsOf` assertions below cover the half that never produced
 * an error at all: those match structurally on the row-model brand, so across
 * the seam they quietly resolved to `never`.
 *
 * `scripts/__tests__/public-api-symbol-brands.test.mjs` is the other side of
 * this: it fails if a symbol-keyed brand reappears in a published API report.
 * This file fails if the two emissions drift apart by any mechanism at all —
 * including the deferred-conditional-alias mismatch that a brand change cannot
 * reach.
 */
import type {
  PretableColumnAccessorKind as EngineColumnAccessorKind,
  PretableColumnDefinition as EngineColumnDefinition,
  PretableGroupId as EngineGroupId,
  PretableRowModel as EngineRowModel,
  PretableUninferredColumnValue as EngineUninferredColumnValue,
  PretableVisibleRowRef as EngineVisibleRowRef,
} from "@pretable-internal/row-model";
import type {
  ColumnsOf as CoreColumnsOf,
  PretableColumnAccessorKind as CoreColumnAccessorKind,
  PretableColumnDefinition as CoreColumnDefinition,
  PretableGridUiCore as CoreGridUiCore,
  PretableGroupId as CoreGroupId,
  PretableRowModel as CoreRowModel,
  PretableUninferredColumnValue as CoreUninferredColumnValue,
  PretableVisibleRowRef as CoreVisibleRowRef,
  RowIdOf as CoreRowIdOf,
  RowOf as CoreRowOf,
} from "@pretable/core";
import type { PretableGridUiCore as EngineGridUiCore } from "@pretable-internal/grid-core";

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;

type Expect<T extends true> = T;

interface Position {
  readonly id: string;
  readonly symbol: string;
  readonly quantity: number;
}

type Columns = readonly [
  CoreColumnDefinition<Position, "symbol", string, "text"> &
    CoreColumnAccessorKind<"direct">,
];

// --- the four brands that crossed the seam -------------------------------
// `groupIdBrand`. The one the first cast paid for.
type _GroupIdBrand = Expect<Equal<CoreGroupId, EngineGroupId>>;
type _GroupRefBrand = Expect<
  Equal<CoreVisibleRowRef<string>, EngineVisibleRowRef<string>>
>;

// `columnDescriptor`, in both of its roles: the carrier's key...
type _ColumnBrand = Expect<
  Equal<CoreColumnAccessorKind<"direct">, EngineColumnAccessorKind<"direct">>
>;
// ...and the "value not inferred yet" sentinel it also used to serve.
type _ColumnSentinel = Expect<
  Equal<CoreUninferredColumnValue, EngineUninferredColumnValue>
>;

// `gridUiCoreType`, the store's compile-time invariance marker. Asserted on the
// KEY SET rather than with `Equal` on the whole store: the marker was optional,
// so it never blocked an assignment even while split — a missing optional
// property is assignable — and the key set is the thing the brand decided. A
// split shows up here as two different `unique symbol`s in `keyof`.
//
// `Equal` on the whole interface is deliberately not the bar. It fails for a
// reason that has nothing to do with brands: `beginEdit` is generic over
// `ColumnValueOf<TColumns, TEditColumnId>`, and TypeScript relates a deferred
// conditional type by the identity of its alias declaration, which two
// emissions cannot share. Assignability — which is what any caller actually
// needs, and what the two deleted casts were paying for — is asserted below.
type _GridUiCoreBrand = Expect<
  Equal<
    keyof CoreGridUiCore<Position, string, Columns, "symbol">,
    keyof EngineGridUiCore<Position, string, Columns, "symbol">
  >
>;

declare const engineGridCore: EngineGridUiCore<
  Position,
  string,
  Columns,
  "symbol"
>;
export const engineGridCoreIsCoreGridCore: CoreGridUiCore<
  Position,
  string,
  Columns,
  "symbol"
> = engineGridCore;

// `rowModelDescriptor`. Asserted in the direction that FAILED SILENTLY: these
// extractors match structurally on the brand, so a split resolved them to
// `never` with no diagnostic anywhere. `Equal` is used rather than a bare
// assignability check for exactly that reason — `never` is assignable to
// everything, so a weaker assertion would have passed while broken.
type _RowModelRowOf = Expect<
  Equal<CoreRowOf<EngineRowModel<Position, string, Columns>>, Position>
>;
type _RowModelRowIdOf = Expect<
  Equal<CoreRowIdOf<EngineRowModel<Position, string, Columns>>, string>
>;
type _RowModelColumnsOf = Expect<
  Equal<CoreColumnsOf<EngineRowModel<Position, string, Columns>>, Columns>
>;

// --- and the whole model, both ways --------------------------------------
// Assignability, not `Equal`: this is the crossing `usePretableModel` performs
// when it hands its `PretableRowModel` to the engine, and it is what the second
// `as unknown as` cast used to hide. It survives a brand fix alone only because
// nothing else in the chain is compared by alias identity either — a deferred
// conditional such as `PretableAggregateOutputOf<TAggregate>` is, which is why
// `@pretable-internal/renderer-dom` reaches the engine through `@pretable/core`
// rather than through the pre-bundle packages.
declare const engineModel: EngineRowModel<Position, string, Columns>;
declare const coreModel: CoreRowModel<Position, string, Columns>;

export const engineModelIsCoreModel: CoreRowModel<Position, string, Columns> =
  engineModel;
export const coreModelIsEngineModel: EngineRowModel<Position, string, Columns> =
  coreModel;

// The column DEFINITION itself, which carries the same brand as its accessor
// kind and is the type every `createColumnHelper` result is built from.
type _ColumnDefinition = Expect<
  Equal<
    CoreColumnDefinition<Position, "symbol", string, "text">,
    EngineColumnDefinition<Position, "symbol", string, "text">
  >
>;

// Referenced so none of the aliases above can be deleted without a compile
// error — an unreferenced `type _X = Expect<...>` is still checked, but this
// makes the set explicit and reviewable in one place.
export type CrossEmissionAssertions = [
  _GroupIdBrand,
  _GroupRefBrand,
  _ColumnBrand,
  _ColumnSentinel,
  _ColumnDefinition,
  _GridUiCoreBrand,
  _RowModelRowOf,
  _RowModelRowIdOf,
  _RowModelColumnsOf,
];
