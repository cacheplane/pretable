// packages/react/src/__tests__/grouping-aggregate-vocabulary-pin.test.ts
//
// Pins the PANE's aggregate vocabulary mirror (`aggregate-options.ts`)
// against the REAL compiler. The picker never offers a value the compiler
// could reject — an invalid aggregate destroys a mounted grid (see
// `setColumnAggregate`'s TSDoc in pretable-model.ts) — so the mirror and
// `compiled-query.ts`'s rule must agree exactly. Both directions are pinned:
// every offered builtin must compile, every withheld builtin must throw. A
// drifting mirror fails whichever way it drifts.
//
// `grouping-aggregate-vocabulary.test.tsx` (SP3a) covers a different seam —
// which COLUMNS an override may target through the React surface. This file
// covers which VALUES the pane may write, straight against row-model.
//
// This lives in packages/react, not row-model, following the
// filter-menu-row-model-boundary precedent: react already depends on both
// sides, and row-model must never import from react.
import { describe, expect, test } from "vitest";

import { createColumnHelper, createLocalRowModel } from "@pretable/core";
import { CompiledQueryValidationError } from "@pretable-internal/row-model";
import type { ColumnType } from "@pretable/core";

import {
  builtinAggregatesForType,
  effectiveAggregate,
  type BuiltinAggregate,
} from "../tool-panel/grouping/aggregate-options";

const COLUMN_TYPES = [
  "text",
  "number",
  "date",
  "enum",
  "boolean",
] as const satisfies readonly ColumnType[];
const BUILTINS = [
  "sum",
  "avg",
  "min",
  "max",
  "count",
] as const satisfies readonly BuiltinAggregate[];

// Exhaustiveness probes, asserted by VALUE assignment (a bare conditional
// type checks nothing): if `ColumnType` or `BuiltinAggregate` gains a member
// the rosters above miss, `true` stops being assignable and the typecheck
// names the missing member — the pin must grow with the union, never
// silently under-cover it.
type MissingColumnType = Exclude<ColumnType, (typeof COLUMN_TYPES)[number]>;
type MissingBuiltin = Exclude<BuiltinAggregate, (typeof BUILTINS)[number]>;
const columnTypesExhaustive: [MissingColumnType] extends [never]
  ? true
  : MissingColumnType = true;
const builtinsExhaustive: [MissingBuiltin] extends [never]
  ? true
  : MissingBuiltin = true;

type Row = { id: string; sector: string; v: unknown };

const helper = createColumnHelper<Row>();

/** A neutral alias for the accessor's options parameter — any one valid
 * instantiation serves; the runtime keeps the real `type` and `aggregate`. */
type AccessorOptions = Parameters<typeof helper.accessor<"v", "text">>[1];

/**
 * A fresh model per case (cheap, and isolates cases): a text column to group
 * by plus one column of the case's type carrying the case's aggregate.
 * `createLocalRowModel` runs `compileQuery` synchronously at creation, so an
 * aggregate the compiler rejects throws right here — the same validation an
 * override reaches through `mergeColumnAggregateOverrides` at runtime.
 */
function createModel(type: ColumnType, aggregate: BuiltinAggregate): void {
  const columns = [
    helper.accessor("sector", { type: "text" }),
    // The static option types already forbid the invalid combinations this
    // pin exists to probe, so the cast is the point: drive the RUNTIME
    // validator with every pairing, valid or not.
    helper.accessor("v", { type, aggregate } as unknown as AccessorOptions),
  ] as const;
  createLocalRowModel({
    rows: [],
    columns,
    query: { filters: [], sort: [], rowGroups: [{ columnId: "sector" }] },
  });
}

describe("the pane's vocabulary mirrors the compiler, both directions", () => {
  for (const type of COLUMN_TYPES) {
    for (const builtin of BUILTINS) {
      const offered = builtinAggregatesForType(type).includes(builtin);
      if (offered) {
        test(`${type} × ${builtin}: offered, so the compiler accepts it`, () => {
          expect(() => createModel(type, builtin)).not.toThrow();
        });
      } else {
        test(`${type} × ${builtin}: withheld, so the compiler rejects it`, () => {
          expect(() => createModel(type, builtin)).toThrow(
            CompiledQueryValidationError,
          );
        });
      }
    }
  }

  test("the cross product is complete: 25 cases over exhaustive rosters", () => {
    expect(columnTypesExhaustive).toBe(true);
    expect(builtinsExhaustive).toBe(true);
    expect(COLUMN_TYPES.length * BUILTINS.length).toBe(25);
  });
});

describe("effectiveAggregate: key presence is the signal", () => {
  test("an override equal to the declared value still reads as overridden", () => {
    expect(effectiveAggregate("a", "sum", { a: "sum" })).toEqual({
      value: "sum",
      overridden: true,
    });
  });

  test("a present null sentinel is an override, not an absence", () => {
    expect(effectiveAggregate("a", "sum", { a: null })).toEqual({
      value: null,
      overridden: true,
    });
  });

  test("an absent key falls back to the declared value", () => {
    expect(effectiveAggregate("a", "sum", { b: "count" })).toEqual({
      value: "sum",
      overridden: false,
    });
  });

  test("a present undefined is no override, matching the merge", () => {
    // `mergeColumnAggregateOverrides` skips a key carrying `undefined`
    // (aggregate-overrides.ts), so the grid shows the declared aggregate —
    // the picker must not display an override the grid is not honoring.
    expect(effectiveAggregate("a", "sum", { a: undefined })).toEqual({
      value: "sum",
      overridden: false,
    });
  });
});
