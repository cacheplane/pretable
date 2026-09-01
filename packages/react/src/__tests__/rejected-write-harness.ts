/**
 * Shared harness for the four "an invalid X update is rejected, not fatal"
 * suites: `invalid-derivations-rejected`, `invalid-query-rejected`,
 * `invalid-rows-rejected` and `invalid-local-rows-rejected`.
 *
 * What lives here is what all four need IDENTICALLY: the `@pretable/core`
 * module proxy that counts one row-model method and can be armed to throw
 * (re-exported from `rejected-write-core-proxy.ts` — see that file for why the
 * split is load-bearing, and for the two traps the proxy carries), the
 * `Holding` fixture, the warn-spy lifecycle, and the row-count probe.
 *
 * What deliberately does NOT live here: each suite's own faults. The invalid
 * `Query` shapes, the grouped/aggregate columns, the bad-row arrays and the
 * `FAULTS` tables differ between suites, and forcing them together would make a
 * failure harder to localise than the duplication is worth.
 */
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

import { createColumnHelper } from "@pretable/core";

import { resetDevWarnings } from "../dev-warn";

export {
  proxiedCoreModule,
  rowModelMethodProxy,
  type RowModelMethodProxy,
} from "./rejected-write-core-proxy";

import { resetRowModelProxies } from "./rejected-write-core-proxy";

export type Holding = {
  id: string;
  sector: string;
  qty: number;
};

export const columnHelper = createColumnHelper<Holding>();

/**
 * `qty` declares `sum`. Over the Tech rows sum is 30 and count is 2 — two
 * distinct numbers, so "the rejected update did NOT land" and "the recovery
 * update DID land" are distinguishable at the pixel. A fixture whose
 * aggregates agreed would pass either way.
 *
 * DO NOT REORDER THIS ARRAY, and do not insert a column ahead of `qty`.
 * `invalid-derivations-rejected.test.tsx` indexes it POSITIONALLY —
 * `COLUMNS[0]` is `sector`, `COLUMNS[1]` is the `qty` it spreads a bad
 * `aggregate` onto — and it asserts on the compiler's index-bearing `path`
 * strings (`derivations[1].aggregate.init`, and `derivations[0].aggregate`
 * after that suite deliberately swaps the two). A reorder here does not fail
 * as a type error; it reads as that suite asserting the wrong column.
 *
 * Appending a column is safe for those indices, but note that every suite
 * renders this array, so a new column changes what each one draws.
 */
export const COLUMNS = [
  columnHelper.accessor("sector", { type: "text" }),
  columnHelper.accessor("qty", { type: "number", aggregate: "sum" }),
] as const;

export const getRowId = (row: Holding) => row.id;

/**
 * Three data rows, two sectors, and THREE of them against the two-row
 * `RECOVERY_ROWS` below — so every "the grid kept its previous rows" assertion
 * is disproving. A baseline whose count equalled the recovery count could not
 * tell a kept row set from a replaced one, and `Energy` matching exactly one
 * row is what lets a narrowing query move the rendered count from 3 to 1.
 */
export const ROWS: readonly Holding[] = [
  { id: "h1", sector: "Tech", qty: 10 },
  { id: "h2", sector: "Tech", qty: 20 },
  { id: "h3", sector: "Energy", qty: 5 },
];

/** TWO rows, against the baseline's three. See `ROWS`. */
export const RECOVERY_ROWS: readonly Holding[] = [
  { id: "r1", sector: "Tech", qty: 1 },
  { id: "r2", sector: "Energy", qty: 2 },
];

/** A row-model error carrying `code`, the field the guard accepts on. */
export function rowModelError(code: string, message: string): Error {
  const error = new Error(message);
  Object.defineProperty(error, "name", { value: "PretableRowModelError" });
  Object.defineProperty(error, "code", { value: code });
  return error;
}

export function dataRowCount(container: HTMLElement): number {
  return container.querySelectorAll("[data-pretable-row]").length;
}

type WarnSpy = ReturnType<typeof vi.spyOn>;

/**
 * Register the warn-spy lifecycle every one of these suites needs, and reset
 * the whole proxy registry around each test.
 *
 * Takes no handles ON PURPOSE. It sweeps every handle the `vi.mock` factory
 * created, so a file cannot intercept a method and then forget to hand its
 * handle over — see `resetRowModelProxies`.
 *
 * Returns a GETTER, not the spy: the spy is recreated per test, so a value
 * captured once would go stale. Call it inside the test — `warnSpy()`.
 *
 * `resetDevWarnings()` is not optional. `warnOnce` keeps its emitted keys in
 * MODULE state, so without the reset the second test to provoke the same fault
 * would see no warning at all.
 */
export function installWarnSpy(): () => WarnSpy {
  let warnSpy: WarnSpy | null = null;

  beforeEach(() => {
    resetDevWarnings();
    resetRowModelProxies();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    resetRowModelProxies();
    // `cleanup()` FIRST: unmount runs with the spy still installed, so a
    // warning emitted on the way down is captured rather than escaping to the
    // real console. No such warning exists on these paths today.
    cleanup();
    warnSpy?.mockRestore();
    warnSpy = null;
  });

  return () => {
    if (warnSpy === null) {
      throw new Error("warnSpy read outside a test — `beforeEach` has not run");
    }
    return warnSpy;
  };
}
