// packages/react/src/__tests__/compiled-query-error-name-pin.test.ts
//
// NAMES THE STRING ON ROW-MODEL'S SIDE OF `use-pretable.ts`'s REJECTED-WRITE
// GUARDS.
//
// There are THREE of them now, sharing one mechanism
// (`reportRejectedWrite`), each turning a throw that would escape a layout
// effect and unmount the live grid into a rejected write: one for an invalid
// DERIVATIONS update, one for an invalid QUERY update, one for an invalid
// ROWS update.
//
// THIS PIN COVERS TWO OF THE THREE. The derivations and query guards are both
// built by the `compiledQueryGuard(...)` factory in `use-pretable.ts`, which
// accepts by ERROR NAME — the string pinned below — so a rename moves both
// together and reds both update-path files below. The rows guard is built by
// `rowModelCodeGuard(...)`, which accepts by row-model error CODE and never
// reads `.name`; it is unaffected by this string and is pinned elsewhere
// (`invalid-rows-rejected.test.tsx`). Do not read this file as covering it.
//
// The check matches a BARE STRING (`error.name === "CompiledQueryValidationError"`)
// because it cannot do better: the class is declared in
// `packages/row-model/src/compiled-query.ts`, is not re-exported from
// `@pretable/core`, and row-model is only a devDependency of this package — so
// nothing SHIPPED under `packages/react/src/` may import it, and `instanceof`
// is unavailable to the guard. Test files are the exception, which is how this
// file imports the class below.
//
// WHAT THIS PIN IS FOR: LOCALIZING THE DRIFT, NOT DETECTING IT.
//
// `invalid-derivations-rejected.test.tsx` and `invalid-query-rejected.test.tsx`
// already detect a disarmed guard, and cannot be fooled: their tests assert
// THE GRID SURVIVES, so if a guard stops catching for any reason the error is
// rethrown, the subtree unmounts, and they go red. They do not care what the
// error is called.
//
// What they cannot say is WHICH SIDE MOVED — the two sides fail identically
// from inside those files. This pin is the second coordinate. Measured, by
// mutation (see the commit that added this file); "update-path" below means
// the grid-survives tests in BOTH files — nine in the derivations one, and
// most of the query one's rejection tests — NOT those whole files, whose
// mount pins also assert this name and so move with this one. Because both
// guards come from the same factory, a drift on either side reds both files,
// not one:
//
//   Pin here green, update-path red   -> the GUARDS' literal drifted alone.
//                                        Guards disarmed; fix use-pretable.ts.
//   Pin here red,   update-path red   -> the CLASS's `name` drifted alone.
//                                        Guards disarmed; fix compiled-query.ts,
//                                        or move the accepted literal to match.
//   Pin here red,   update-path GREEN -> a COORDINATED rename. The guards are
//                                        armed and correct and this pin is
//                                        merely stale: update the literal
//                                        below, and nothing else.
//
// So a failure HERE is not by itself evidence of a disarmed guard — read the
// update-path files' results alongside it. What this pin adds is that it names
// the moved string directly, instead of leaving a spread of "the grid
// unmounted" failures to be traced back to a rename in another package.
//
// The literal below is hand-written rather than imported from row-model
// (`CompiledQueryValidationError.name`, or a shared constant): a shared symbol
// would move WITH a rename, erasing the signal in the middle row above. The
// class itself is imported only to prove the error provoked here is the real
// one, which a duck-typed check could not establish.
//
// This lives in packages/react, not row-model, following the
// `grouping-aggregate-vocabulary-pin` precedent: react already depends on both
// sides, and row-model must never import from react.
import { describe, expect, test } from "vitest";

import { createColumnHelper, createLocalRowModel } from "@pretable/core";
import { CompiledQueryValidationError } from "@pretable-internal/row-model";

/**
 * The exact literal `use-pretable.ts` accepts, in the `compiledQueryGuard(...)`
 * factory's `isAccepted`. Written out here, not imported: see the header.
 */
const GUARD_MATCHES = "CompiledQueryValidationError";

type Holding = { id: string; sector: string; qty: number };

const helper = createColumnHelper<Holding>();

const SECTOR = helper.accessor("sector", { type: "text" });
const QTY = helper.accessor("qty", { type: "number", aggregate: "sum" });

/*
 * `aggregate` is a closed union, so an invalid value cannot be spelled through
 * the helper. The cast is the point: this is the shape a JavaScript consumer,
 * a persisted layout, or the tool panel can hand in, and it is what the guard
 * exists to survive.
 */
const INVALID_QTY = {
  ...QTY,
  aggregate: "nonsense",
} as unknown as typeof QTY;

/** Grouping is what makes the compiler validate the aggregate at all. */
const GROUPED_QUERY = {
  filters: [],
  sort: [],
  rowGroups: [{ columnId: "sector" }],
} as const;

describe("the error name the rejected-write guards match", () => {
  test("setDerivations rejects an invalid aggregate with the guarded name", () => {
    /*
     * `setDerivations` specifically, because that is one of the two
     * name-matched calls `use-pretable.ts` wraps in a guarded try/catch (the
     * third, `setRows`, is matched by code). The mount-time compile
     * path raises the same error, but it is already covered end-to-end by the
     * mount pin in `invalid-derivations-rejected.test.tsx`, and exhaustively
     * at the compiler by `grouping-aggregate-vocabulary-pin.test.ts`.
     */
    const model = createLocalRowModel({
      rows: [{ id: "h1", sector: "Tech", qty: 10 }],
      columns: [SECTOR, QTY] as const,
      query: GROUPED_QUERY,
      getRowId: (row: Holding) => row.id,
    });

    let thrown: unknown;
    try {
      model.setDerivations([SECTOR, INVALID_QTY] as const);
    } catch (error) {
      thrown = error;
    }

    /*
     * That something threw at all is its own assertion: if `setDerivations`
     * stopped rejecting invalid aggregates, `thrown` stays `undefined` and the
     * name check below would pass vacuously against nothing.
     */
    expect(thrown).toBeInstanceOf(CompiledQueryValidationError);
    /*
     * The guard's own test, spelled as `use-pretable.ts` spells it. The guard
     * reads `.name` off a value narrowed only to `Error`, so `Object.hasOwn`
     * records the shape that makes that read work: an own instance field
     * (`readonly name = ...`), not the class BINDING name a bundler may
     * rewrite. Move the string to a static or a prototype getter and the
     * `hasOwn` half fails while the value stays the same.
     */
    expect((thrown as Error).name).toBe(GUARD_MATCHES);
    expect(Object.hasOwn(thrown as object, "name")).toBe(true);
  });
});
