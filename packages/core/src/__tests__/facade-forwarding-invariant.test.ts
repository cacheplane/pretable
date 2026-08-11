import { createGridCore } from "@pretable-internal/grid-core";
import { describe, expect, test } from "vitest";

import { createGrid } from "../index";
import type { PretableGridOptions } from "../index";

/**
 * **The invariant: everything the engine exposes, `@pretable/core` re-exposes.**
 *
 * `createGrid` is a hand-written facade over `createGridCore` — one forwarding
 * line per engine member, 44 of them. Nothing checked that list was complete,
 * and a missing line is invisible: `@pretable/core` builds, publishes, and
 * passes its tests without the method, and `@pretable/react` — which types its
 * grid handle as `PretableGrid` — cannot call it either.
 *
 * That is not hypothetical. `getColumns()` was added to the engine during row
 * grouping SP2 and was left out of this facade; it was found only when the React
 * work went to call it, mid-task, with everything green.
 *
 * So this file does not restate the forwarding list. It builds a live engine and
 * a live facade from the same options, enumerates both, and asserts the engine's
 * members are a subset of the facade's — modulo an explicit allowlist. A new
 * engine method fails here on the day it is added, with no edit to this file
 * unless the omission is deliberate.
 *
 * **What makes it self-enforcing.**
 *
 *  - The engine surface is *discovered*, never listed. Adding a method to
 *    `createGridCore` is the only input this guard needs.
 *  - {@link NOT_FORWARDED} and {@link FACADE_ONLY} are the escape hatches, and
 *    both are deliberately awkward: an entry needs a written justification, and
 *    **an entry that no longer fires is itself a failure**. A stale excuse is
 *    the same drift the guard exists to stop, so the allowlist cannot quietly
 *    become the problem. Both are empty today and should stay that way.
 *  - Enumeration is checked for vacuity. If the engine were ever returned as a
 *    class instance, `Object.entries` would find nothing on it and every
 *    assertion below would pass while checking nothing; that fails instead.
 *  - Members are compared by *kind*, not just by name, so forwarding
 *    `getColumns: engine.getColumns()` — calling where a reference was meant,
 *    freezing a derived value at construction — fails as loudly as omitting it.
 *  - `options` is asserted to still be live through the facade. That is the trap
 *    in the tempting structural fix: `return { kind, ...engine }` would satisfy
 *    every name-level check above while snapshotting the engine's `options`
 *    getter into a dead value.
 *
 * Modelled on `packages/grid-core/src/__tests__/column-model-reconciliation-invariant.test.ts`
 * (#266) — enumerate the live surface, refuse to run vacuously — and on
 * `scripts/__tests__/public-api-forgotten-exports.test.mjs` (#290), which is
 * where the stale-allowlist rule comes from.
 */

interface Row {
  [key: string]: unknown;
  id: string;
  name: string;
  amount: number;
}

const OPTIONS: PretableGridOptions<Row> = {
  columns: [
    { id: "name", header: "Name" },
    { id: "amount", header: "Amount", aggregate: "sum" },
  ],
  rows: [
    { id: "r1", name: "ada", amount: 1 },
    { id: "r2", name: "bo", amount: 2 },
  ],
  getRowId: (row) => row.id,
};

/**
 * Engine members deliberately NOT re-exposed on `PretableGrid`.
 *
 * Every entry MUST carry a justification saying why a consumer of
 * `@pretable/core` is better off without the member — an internal detail that
 * only the React surface may call, say. "Nobody has needed it yet" is not a
 * justification: unforwarded is the failure mode this file exists to catch, and
 * the cheap fix is one line in `create-grid.ts` plus one in `pretable-grid.ts`.
 */
const NOT_FORWARDED: Record<string, string> = {};

/**
 * Facade members with no engine counterpart.
 *
 * Same rule: a justification per entry. A facade-level method is a second
 * implementation of grid behaviour living outside the engine and outside
 * grid-core's reconciliation sweep (#266), so the bar is high.
 */
const FACADE_ONLY: Record<string, string> = {
  kind: "Discriminator, not a capability. Lets a consumer tell a PretableGrid from an arbitrary object; the engine has no need to identify itself to itself.",
};

/** Own enumerable members of a live instance, mapped to their `typeof`. */
function members(target: object): Map<string, string> {
  return new Map(
    Object.entries(target).map(([key, value]) => [key, typeof value]),
  );
}

const ENGINE = members(createGridCore<Row>(OPTIONS));
const FACADE = members(createGrid<Row>(OPTIONS));

function functionNames(surface: Map<string, string>): string[] {
  return [...surface]
    .filter(([, kind]) => kind === "function")
    .map(([name]) => name)
    .sort();
}

const FORWARD_REMEDY = [
  "Forward it, in two places:",
  "  - packages/core/src/create-grid.ts    — `name: engine.name,` (a reference,",
  "    never a call);",
  "  - packages/core/src/pretable-grid.ts  — the member's signature and docs, on",
  "    the public `PretableGrid` interface.",
  "Then: pnpm --filter @pretable/core build && pnpm api  (the API report names",
  "every public member, so it changes too).",
  "",
  "If it genuinely must stay internal, add it to NOT_FORWARDED in this file with",
  "a written justification.",
].join("\n");

describe("core facade forwarding invariant", () => {
  test("the engine surface is actually enumerable", () => {
    // Guards every assertion below. `Object.entries` sees own enumerable
    // properties only, so an engine returned as a class instance (methods on the
    // prototype) would enumerate to nothing and make this whole file vacuous.
    expect(
      functionNames(ENGINE).length,
      [
        "Enumerating a live engine found no methods.",
        "",
        "`createGridCore` returns an object literal today, so its methods are own",
        "enumerable properties. If it now returns a class instance or hides its",
        "members behind a prototype or a Proxy, every check in this file passes",
        "while checking nothing — fix the enumeration here before trusting it.",
      ].join("\n"),
    ).toBeGreaterThan(20);

    expect(functionNames(FACADE).length).toBeGreaterThan(20);
  });

  test("every engine member is re-exposed on the public facade", () => {
    const missing = [...ENGINE.keys()]
      .filter((name) => !FACADE.has(name) && !(name in NOT_FORWARDED))
      .sort();

    expect(
      missing,
      `${missing.length} engine member(s) never reach @pretable/core:\n` +
        missing.map((name) => `  - ${name}`).join("\n") +
        "\n\nA consumer of the published package cannot call these, and neither can\n" +
        "@pretable/react, which types its handle as `PretableGrid`. This is exactly\n" +
        "how `getColumns()` went missing through row-grouping SP2.\n\n" +
        FORWARD_REMEDY,
    ).toEqual([]);
  });

  test("forwarded members keep their kind", () => {
    const wrong = [...ENGINE]
      .filter(([name, kind]) => FACADE.has(name) && FACADE.get(name) !== kind)
      .map(
        ([name, kind]) =>
          `  - ${name}: engine ${kind}, facade ${FACADE.get(name) ?? "absent"}`,
      )
      .sort();

    expect(
      wrong,
      `${wrong.length} member(s) are forwarded as the wrong kind of value:\n` +
        wrong.join("\n") +
        "\n\nThe usual cause is `name: engine.name()` where `name: engine.name` was\n" +
        "meant — that forwards one construction-time result forever instead of the\n" +
        "method.",
    ).toEqual([]);
  });

  test("the facade adds nothing the engine does not have", () => {
    const extra = [...FACADE.keys()]
      .filter((name) => !ENGINE.has(name) && !(name in FACADE_ONLY))
      .sort();

    expect(
      extra,
      `${extra.length} facade member(s) have no engine counterpart:\n` +
        extra.map((name) => `  - ${name}`).join("\n") +
        "\n\nGrid behaviour implemented in the facade sits outside grid-core's\n" +
        "reconciliation sweep (#266) and outside every grid-core test. Move it into\n" +
        "the engine, or add it to FACADE_ONLY in this file with a justification.",
    ).toEqual([]);
  });

  test("NOT_FORWARDED carries no stale excuses", () => {
    const stale = Object.keys(NOT_FORWARDED)
      .filter((name) => !ENGINE.has(name) || FACADE.has(name))
      .sort();

    expect(
      stale,
      `NOT_FORWARDED excuses ${stale.length} member(s) that no longer need excusing:\n` +
        stale.map((name) => `  - ${name}`).join("\n") +
        "\n\nEach is either gone from the engine or forwarded after all. Delete them\n" +
        "from NOT_FORWARDED in this file — a stale excuse is how an allowlist stops\n" +
        "meaning anything, and this one guards against precisely that.",
    ).toEqual([]);
  });

  test("FACADE_ONLY carries no stale excuses", () => {
    const stale = Object.keys(FACADE_ONLY)
      .filter((name) => !FACADE.has(name) || ENGINE.has(name))
      .sort();

    expect(
      stale,
      `FACADE_ONLY excuses ${stale.length} member(s) that no longer need excusing:\n` +
        stale.map((name) => `  - ${name}`).join("\n") +
        "\n\nEach is either gone from the facade or now backed by the engine. Delete\n" +
        "them from FACADE_ONLY in this file.",
    ).toEqual([]);
  });

  test("non-function members stay live through the facade", () => {
    // `options` is a getter on the engine and is reassigned by the column
    // mutators, so it must be forwarded as a getter too. A spread — the obvious
    // way to delete the forwarding list — would copy today's value and leave the
    // facade reporting stale columns forever, while passing every name check.
    const grid = createGrid<Row>(OPTIONS);

    grid.setColumnWidth("name", 321);

    expect(
      grid.options.columns.find((column) => column.id === "name")?.widthPx,
      "`grid.options` did not follow the engine. It must be forwarded as a getter\n" +
        "(`get options() { return engine.options; }`), not copied — the engine\n" +
        "replaces its own `options` on every column mutation.",
    ).toBe(321);
  });
});
