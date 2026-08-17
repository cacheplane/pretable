/* eslint-disable @typescript-eslint/no-unused-vars -- the `_`-prefixed aliases
   below ARE the assertions: each is a compile error if its `Expect<...>`
   constraint fails, and nothing needs to read them at runtime. */
import { expectTypeOf, test } from "vitest";

import type { ColumnValueOf } from "../index";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

interface StockItem {
  id: string;
  item: string;
  quantity: number;
}

/**
 * The typed path: a column that declares an `accessor` keeps its exact value
 * type. This is the guarantee everything else here must not cost.
 */
type Accessored = readonly [
  { readonly id: "item"; readonly accessor: (row: StockItem) => string },
  { readonly id: "quantity"; readonly accessor: (row: StockItem) => number },
];
type _AccessoredIsExact = Expect<
  Equal<ColumnValueOf<Accessored, "quantity">, number>
>;

/**
 * A tuple where only SOME columns declare an accessor. The accessor-less
 * members must not widen the accessored ones — `ColumnValueOf` distributes
 * over the column union, so a per-member fallback would union `unknown` into
 * every answer and destroy the precision above.
 */
type Mixed = readonly [
  { readonly id: "item"; readonly accessor: (row: StockItem) => string },
  { readonly id: "quantity" },
];
type _MixedKeepsAccessored = Expect<
  Equal<ColumnValueOf<Mixed, "item">, string>
>;
type _MixedFallsBackForTheRest = Expect<
  Equal<ColumnValueOf<Mixed, "quantity">, unknown>
>;

/**
 * The loose, id-keyed column shape the docs corpus actually teaches
 * (`PretableColumn<TRow>[]`): no accessor, `id: string`. This used to resolve
 * to `never`, which is assignable to everything — so every runtime guard
 * written against such a value (`typeof value === "number"`) compiled while
 * being type-level nonsense. `unknown` is the honest answer: it forces the
 * guard instead of silently accepting it.
 */
type Loose = readonly { readonly id: string }[];
type _LooseIsUnknown = Expect<Equal<ColumnValueOf<Loose, string>, unknown>>;

test("an accessor-less column narrows under a typeof guard", () => {
  const value = 3 as ColumnValueOf<Loose, string>;
  // `never` would make this branch vacuous; `unknown` makes it real.
  expectTypeOf(value).toBeUnknown();
  if (typeof value === "number") {
    expectTypeOf(value).toBeNumber();
  }
});
