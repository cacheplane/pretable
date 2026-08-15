import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import {
  createScenarioDataset,
  listScenarios,
  type ScenarioDefinition,
} from "@pretable-internal/scenario-data";

import { adapterRegistry } from "../bench-app";
import { assertComparatorWrappedScaleIsSmoke } from "../comparator-wrapped-scale-rule";

/**
 * The fence for the jsdom wrapped-scale rule. See
 * comparator-wrapped-scale-rule.ts for what the rule is and why it exists.
 *
 * Two layers, because either alone has a hole:
 *
 * 1. Unit tests on the assertion itself — that it fires on a wrapped scenario
 *    above smoke, and stays silent on the three near-misses (smoke, an
 *    unwrapped scenario, a dataset with no scenario at all). Without the
 *    negative arms an assertion that threw unconditionally would pass.
 *
 * 2. A behavioural fitness test that every comparator in `adapterRegistry`
 *    actually refuses the mount. This is the layer that survives a NEW adapter:
 *    the comparator list is derived from the registry, so an adapter added to
 *    bench-app.tsx without the guard call fails here rather than quietly
 *    re-opening the trap. It asserts behaviour, not the presence of a call, so
 *    it cannot be satisfied by an import that is never reached.
 *
 * What this cannot catch, stated plainly:
 *
 * - A hand-rolled dataset. The adapter unit tests mount duck-typed objects with
 *   no `scenario` field (`dataset as never`); the rule is defined over
 *   scenarios, so those are out of its scope by construction. They are one or
 *   two rows long, which is why they are not the trap. A test that hand-rolled
 *   750 wrapped rows would evade the rule.
 * - Cost that is not wrapped-cell measurement. Mounting MUI at S1/dev is not a
 *   rule violation even if it is slow; this rule is about one specific trap.
 * - Anything outside jsdom. That is deliberate — `dev`-scale wrapped comparator
 *   runs are the entire point of the benchmark in a real browser.
 */

const comparatorEntries = Object.entries(adapterRegistry).filter(
  ([adapterId]) => adapterId !== "pretable",
);

const wrappedScenarios: readonly ScenarioDefinition[] = listScenarios().filter(
  (scenario) => scenario.wrapped_columns > 0,
);

describe("jsdom wrapped-scale rule", () => {
  afterEach(() => {
    cleanup();
  });

  // Guards the guard's own inputs: if scenario-data ever stopped carrying a
  // wrapped scenario, every assertion below would pass vacuously.
  test("is defined over a non-empty, derived set of wrapped scenarios", () => {
    expect(wrappedScenarios.length).toBeGreaterThan(0);
    // Derived, not hardcoded to S2/S7 — S4 and S5 also wrap columns, and the
    // list has drifted before.
    expect(wrappedScenarios.map((scenario) => scenario.id)).toEqual(
      expect.arrayContaining(["S2", "S4", "S5", "S7"]),
    );
    expect(comparatorEntries.length).toBeGreaterThan(0);
    expect(comparatorEntries.map(([adapterId]) => adapterId)).not.toContain(
      "pretable",
    );
  });

  test.each(wrappedScenarios.map((scenario) => scenario.id))(
    "refuses a comparator on %s above smoke",
    (scenarioId) => {
      const dataset = createScenarioDataset(scenarioId, { scale: "dev" });

      expect(() =>
        assertComparatorWrappedScaleIsSmoke("ag-grid", dataset),
      ).toThrow(/jsdom wrapped-scale rule/);
      // The message has to be actionable, not just loud: it names the fix.
      expect(() =>
        assertComparatorWrappedScaleIsSmoke("ag-grid", dataset),
      ).toThrow(/scale=smoke/);
    },
  );

  test("allows a comparator on a wrapped scenario at smoke", () => {
    const dataset = createScenarioDataset("S2", { scale: "smoke" });

    expect(() =>
      assertComparatorWrappedScaleIsSmoke("ag-grid", dataset),
    ).not.toThrow();
  });

  test("allows a comparator on an unwrapped scenario at dev", () => {
    const dataset = createScenarioDataset("S1", { scale: "dev" });

    expect(dataset.scenario.wrapped_columns).toBe(0);
    expect(() =>
      assertComparatorWrappedScaleIsSmoke("ag-grid", dataset),
    ).not.toThrow();
  });

  test("ignores a hand-rolled dataset carrying no scenario", () => {
    const dataset = {
      columns: [{ id: "wrapped", header: "Wrapped", wrap: true, widthPx: 220 }],
      rows: [{ id: "1", wrapped: "a much longer sentence that wraps" }],
    };

    expect(() =>
      assertComparatorWrappedScaleIsSmoke("ag-grid", dataset as never),
    ).not.toThrow();
  });

  // The layer that survives a new adapter. Derived from the registry, so
  // adding a comparator to bench-app.tsx without the guard call reddens this.
  test.each(comparatorEntries)(
    "the %s adapter refuses to mount a wrapped scenario above smoke",
    (adapterId, definition) => {
      const AdapterSurface = definition.render;
      const dataset = createScenarioDataset("S2", { scale: "dev" });

      expect(() =>
        render(<AdapterSurface dataset={dataset} runKey={0} />),
      ).toThrow(/jsdom wrapped-scale rule/);
    },
  );

  /**
   * The positive twin — that these adapters still MOUNT at smoke, so the guard
   * cannot pass by refusing everything — is deliberately not re-asserted here.
   * comparator-dom-contract.test.tsx already mounts all three comparators on
   * `createScenarioDataset("S2", { scale: "smoke" })` and asserts each answers
   * to its own profile selectors, which is a strictly stronger claim than
   * "did not throw".
   *
   * Duplicating it here was measurably harmful: mounting MUI X DataGrid costs
   * 1-2s under jsdom (inherent, not scale-driven — see the note on the MUI
   * surface test in bench-app.test.tsx), and the extra copy in a parallel
   * worker timed out at 6892-7926ms and starved sibling `waitFor` windows in
   * bench-app.test.tsx. A fence should not cost more than the trap it guards.
   */
});
