/**
 * A future reader chasing "why doesn't the `setRows` rejected-write guard
 * accept `CompiledQueryValidationError`?" lands here. The answer: the
 * same-reference-mutation branch's recompile (`create-local-row-model.ts:1094`)
 * operates on the stored plan's already-captured, getter-free clones
 * (`:673-674`), not on raw consumer objects — so it structurally cannot throw,
 * and a guard for that fault would be dead code. This file pins that finding.
 */
import { describe, expect, test } from "vitest";

import { compileQuery } from "../compiled-query";
import { createLocalRowModel } from "../create-local-row-model";

type Holding = { id: string; sector: string; qty: number };

const getRowId = (row: Holding) => row.id;

/**
 * `accessor` AND `value` are both required by `validateDerivations`; a
 * derivation carrying only `accessor` fails compilation with "column has no
 * accessor" before any of this file's claims are reached.
 */
function derivation(
  id: "sector" | "qty",
  type: "text" | "number",
  extra: object = {},
) {
  return {
    id,
    type,
    accessor: (row: Holding) => row[id],
    value: (row: Holding) => row[id],
    ...extra,
  };
}

/**
 * A row that RESISTS `Object.freeze`. `inspectRowIntegrity` freezes every
 * extensible row on ingest, and a frozen row can never be mutated in place —
 * so an ordinary object literal cannot reach the same-reference-mutation
 * branch at all. `preventExtensions` leaves existing properties writable, so
 * the inspection falls through to the fingerprint path and a later in-place
 * write is detected as a mutation.
 */
function mutableRow(row: Holding): Holding {
  return Object.preventExtensions({ ...row });
}

describe("the setRows recompile", () => {
  test("fires on a same-reference mutation", () => {
    const diagnostics: string[] = [];
    const first = mutableRow({ id: "h1", sector: "Tech", qty: 10 });
    const rows = [first, { id: "h2", sector: "Energy", qty: 5 }];

    const model = createLocalRowModel({
      rows,
      columns: [derivation("sector", "text"), derivation("qty", "number")],
      getRowId,
      onDiagnostic: (d: { code: string }) => diagnostics.push(d.code),
    } as never) as unknown as { setRows: (r: readonly Holding[]) => unknown };

    first.qty = 999;
    model.setRows([...rows]);

    expect(diagnostics).toContain("same-reference-row-mutation");

    /*
     * POSITIVE CONTROL. Without it this suite can pass vacuously: the original
     * probe behind this pin reported "the branch never fires" only because it
     * passed a diagnostic sink under the wrong option name
     * (`onRowIntegrityDiagnostic`; the real one is `onDiagnostic`). A second
     * mutation must produce a second diagnostic, or the sink is not wired and
     * the assertion above proves nothing.
     */
    first.qty = 1234;
    model.setRows([...rows]);
    expect(
      diagnostics.filter((code) => code === "same-reference-row-mutation"),
    ).toHaveLength(2);
  });

  test("cannot throw, because it recompiles an already-captured plan", () => {
    /*
     * THE CLAIM THIS FILE EXISTS FOR. `setRows` compiles the query on its
     * same-reference-mutation branch (`create-local-row-model.ts:1094`), but
     * it compiles `derivations`/`query` — which hold the stored PLAN's
     * captured clones (`:673-674`), not the raw consumer objects. Capture is
     * getter-free, so no consumer-supplied hostility survives to that
     * recompile.
     *
     * The probe: an aggregate getter that explodes on its SECOND read. If
     * capture re-read consumer objects, the recompile would throw. It is read
     * exactly once, at the first compile.
     *
     * A diagnostic sink is wired below (mirroring test 1's own positive
     * control) so this test cannot pass vacuously. `inspectRowIntegrity`
     * short-circuits `sameReferenceMutation` to `false` under
     * `NODE_ENV=production` (`row-integrity.ts:141-146`), which would make
     * the recompile at `create-local-row-model.ts:1094` never run at all —
     * `reads` would trivially stay 1 and `setRows` would trivially not throw,
     * for a reason that has nothing to do with this file's claim. Asserting
     * the diagnostic fired proves the branch under test actually executed.
     */
    let reads = 0;
    const diagnostics: string[] = [];
    const hostile = [
      derivation("sector", "text"),
      derivation("qty", "number", {
        get aggregate() {
          reads += 1;
          if (reads > 1) throw new Error("second read explodes");
          return "sum";
        },
      }),
    ];

    const first = mutableRow({ id: "h1", sector: "Tech", qty: 10 });
    const rows = [first];
    const model = createLocalRowModel({
      rows,
      columns: hostile,
      getRowId,
      onDiagnostic: (d: { code: string }) => diagnostics.push(d.code),
    } as never) as unknown as { setRows: (r: readonly Holding[]) => unknown };

    expect(reads).toBe(1);

    first.qty = 42;
    expect(() => model.setRows([...rows])).not.toThrow();

    expect(diagnostics).toContain("same-reference-row-mutation");
    expect(reads).toBe(1);
  });

  test("compiling a captured plan again is idempotent", () => {
    const plan = compileQuery({
      derivations: [
        derivation("sector", "text"),
        derivation("qty", "number", { aggregate: "sum" }),
      ],
      query: { filters: [], sort: [], rowGroups: [] },
    } as never) as { derivations: unknown; query: unknown };

    expect(() =>
      compileQuery({
        derivations: plan.derivations,
        query: plan.query,
      } as never),
    ).not.toThrow();
  });
});
