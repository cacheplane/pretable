import type { ScenarioDataset } from "@pretable-internal/scenario-data";

/**
 * The jsdom wrapped-scale rule.
 *
 * A jsdom test may not mount a COMPARATOR adapter (ag-grid, mui, tanstack) on a
 * scenario with `wrapped_columns > 0` at any scale other than `smoke`.
 *
 * Why this exists
 * ---------------
 * #415 (f22cf928) made the comparator adapters honour `column.wrap`, which was
 * the right change: before it, every S2 comparison measured pretable doing
 * variable-height text layout against three grids that were not. But it means a
 * wrapped scenario now switches on each comparator's wrapped-cell measurement —
 * AG Grid `wrapText` + `autoHeight`, MUI `getRowHeight: () => "auto"`, TanStack
 * `measureElement`. All three are post-paint corrections: the cell measures
 * itself on mount and the row height is applied a frame later.
 *
 * jsdom has no layout engine, so that correction never converges. The row
 * renderer keeps materialising rows instead of settling on a viewport's worth.
 *
 * Measured paired, both scales in one process, with a drain after mount so the
 * DEFERRED correction is counted rather than just `render()`:
 *
 *   adapter   scale   event loop blocked   DOM nodes after drain
 *   ag-grid   dev         23235-25282ms                   19803
 *   ag-grid   smoke           91-2515ms               1603-4053
 *   tanstack  dev                  ~2ms                     135
 *   tanstack  smoke                ~2ms                     135
 *   mui       dev                  ~2ms                    5094
 *   mui       smoke                ~2ms                    5094
 *
 * AG Grid is the acute case by two orders of magnitude, and that 23s is what
 * timed out the B2 #5b dispatch test (#434) — costing two Releases and two
 * skipped production deploys before #436 treated the one symptom. TanStack's
 * `measureElement` turns out to be inert under jsdom, and MUI's virtualizer
 * caps its rendered window at either scale, so for those two the rule is cheap
 * insurance rather than a fix. It applies to all three because the adapters can
 * change their measurement strategy — as #415 changed all three at once — and
 * a rule that only named ag-grid would go stale the next time that happens.
 *
 * Why it FAILS rather than silently capping the scale
 * ---------------------------------------------------
 * Forcing `smoke` behind the author's back would make a test that counts rows
 * pass while measuring a dataset it never asked for. That is the same class of
 * defect — a check that passes without testing the thing — this codebase has
 * spent a lot of effort removing. So the rule refuses the mount and says what to
 * do about it, and the author makes the choice deliberately.
 *
 * Why "is this test slow?" would be the wrong rule
 * ------------------------------------------------
 * The ag-grid surface test measured only 95-229ms on `main` and still violated
 * this rule. It never awaits, so AG Grid's measurement storm is queued at mount
 * and drains during LATER tests in the file. It externalises its cost rather
 * than avoiding it. A duration-based guard would have called it safe.
 *
 * Scope
 * -----
 * jsdom only. Real-browser runs are exactly where this measurement is supposed
 * to happen, so the rule must never fire under Playwright or `vite preview` —
 * that is what the `isJsdom()` gate is for. pretable is deliberately exempt: the
 * cost is the comparators' wrapped-cell measurement, not pretable's.
 */

/**
 * Restricted to jsdom on purpose.
 *
 * `dev`-scale wrapped comparator runs are the whole point of the benchmark in a
 * real browser. jsdom's user agent is the narrowest true statement of the
 * precondition — no layout engine — and it needs no coupling to a build tool's
 * mode flags, which differ between `vitest`, `vite dev` and `vite build`.
 */
function isJsdom(): boolean {
  return (
    typeof navigator !== "undefined" &&
    navigator.userAgent.toLowerCase().includes("jsdom")
  );
}

/**
 * Throws when `dataset` breaks the jsdom wrapped-scale rule.
 *
 * Called at the top of every comparator adapter component, so it fires before
 * any grid work is queued rather than after the cost has been paid.
 */
export function assertComparatorWrappedScaleIsSmoke(
  adapterId: string,
  dataset: ScenarioDataset,
): void {
  if (!isJsdom()) {
    return;
  }

  // Hand-rolled datasets in the adapter unit tests carry no `scenario`; they are
  // a row or two long and are not what this rule is about. See the note on
  // coverage limits in comparator-wrapped-scale-rule.test.tsx.
  const scenario = dataset.scenario as ScenarioDataset["scenario"] | undefined;

  if (!scenario || scenario.wrapped_columns <= 0) {
    return;
  }

  if (dataset.scale === "smoke") {
    return;
  }

  throw new Error(
    `jsdom wrapped-scale rule: refusing to mount the "${adapterId}" comparator on ` +
      `${scenario.id} at scale="${dataset.scale}".\n\n` +
      `${scenario.id} (${scenario.name}) has wrapped_columns=${scenario.wrapped_columns}, so ` +
      `the comparator adapters switch on wrapped-cell measurement (ag-grid: wrapText + ` +
      `autoHeight, mui: getRowHeight "auto", tanstack: measureElement). Those are post-paint ` +
      `corrections and jsdom has no layout engine, so the measurement never converges and the ` +
      `row renderer materialises a large fraction of this ${dataset.rowCount}-row dataset ` +
      `instead of a viewport's worth. Measured on the ag-grid surface test: at dev the mount ` +
      `blocks the event loop for 23-25s and leaves 19803 DOM nodes, against 0.1-2.5s and ` +
      `1603-4053 nodes at smoke. That is what timed out the B2 #5b dispatch test ` +
      `(#414, #434, #436).\n\n` +
      `Fix: mount this at scale=smoke, e.g.\n` +
      `    <BenchApp search="?adapter=${adapterId}&scenario=${scenario.id}&scale=smoke" ... />\n` +
      `Surface- and dispatch-shaped assertions are scale-independent, so smoke asserts exactly ` +
      `the same thing.\n\n` +
      `If you genuinely need a wrapped comparator at ${dataset.scale} scale, it only means ` +
      `anything where layout exists — write it as a Playwright spec under apps/bench/tests/ ` +
      `(see ag-grid-wrap-auto-height.spec.ts) instead of here.`,
  );
}
