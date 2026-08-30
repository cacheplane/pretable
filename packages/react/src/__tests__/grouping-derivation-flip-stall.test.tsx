// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { createColumnHelper, type PretableQueryFor } from "@pretable/core";

import { PretableSurface } from "../pretable-surface";

/*
 * Regression pin for the jsdom "derivation-flip stall" (diagnosed 2026-08-29,
 * fixed by #522's `setColumns` change in renderer-dom's row-layout
 * controller).
 *
 * THE MECHANISM. A tiny grouped grid's `setDerivations` transition COMMITS
 * SYNCHRONOUSLY once the transition code paths are warm enough to finish
 * inside the first 0.25ms cooperative slice — which in one jsdom process
 * happens after a handful of transitions (hence the old "~4 flips on one
 * grid, ~7 across a module" folklore: it was JIT warm-up, per-PROCESS, not
 * any per-grid or per-module resource). A synchronous commit publishes
 * revision N and notifies while React is still running the same commit's layout
 * effects. The layout controller's `synchronize` starts a replacement
 * targeting revision N — and then `pretable-model`'s `setColumns` layout
 * effect (the columns changed; that is what a derivations flip IS) ran
 * `startReplacement(state.snapshot, …)`: it cancelled the in-flight
 * replacement and restarted from the last PUBLISHED snapshot, revision N-1.
 * That replacement finished, published N-1 as READY, and stamped
 * `observedRevision = N-1`. The model never commits again, so nothing ever
 * re-synchronizes: model at N, DOM at N-1, forever. The `finished` promise
 * had already resolved — the row model was never at fault (it committed
 * revision N correctly every time).
 *
 * THE FIX (#522): `setColumns` leaves an active replacement alone — the
 * in-flight build's own finishing publish honors the new columns — so the
 * revision-N target is never discarded.
 *
 * THE PIN. Ten prop-driven aggregate flips on ONE grid, each awaited in the
 * DOM. Pre-fix this failed deterministically (4/4 at the SP3a commit, on the
 * seventh cumulative flip; at #522's parent, on the second — the hotter the
 * transition code, the earlier the sync commit arrives). The trigger is
 * warmth-dependent, so ten flips rather than two: enough transitions to warm
 * the slice code past the synchronous-commit threshold within this module.
 * The fixture makes each flip observable: over the Tech rows sum is 30 and
 * count is 2, so a flip that does not reach the DOM cannot pass.
 */

type Holding = {
  id: string;
  sector: string;
  qty: number;
};

const helper = createColumnHelper<Holding>();

const SUM_COLUMNS = [
  helper.accessor("sector", { type: "text" }),
  helper.accessor("qty", { type: "number", aggregate: "sum" }),
] as const;

const COUNT_COLUMNS = [
  helper.accessor("sector", { type: "text" }),
  helper.accessor("qty", { type: "number", aggregate: "count" }),
] as const;

const ROWS: readonly Holding[] = [
  { id: "h1", sector: "Tech", qty: 10 },
  { id: "h2", sector: "Tech", qty: 20 },
  { id: "h3", sector: "Energy", qty: 5 },
];

const GROUPED_QUERY: PretableQueryFor<typeof SUM_COLUMNS> = {
  filters: [],
  sort: [],
  rowGroups: [{ columnId: "sector" }],
};

const getRowId = (row: Holding) => row.id;

afterEach(cleanup);

function groupedElement(columns: typeof SUM_COLUMNS | typeof COUNT_COLUMNS) {
  return (
    <PretableSurface<Holding, string, typeof SUM_COLUMNS>
      ariaLabel="holdings"
      columns={columns as unknown as typeof SUM_COLUMNS}
      getRowId={getRowId}
      onQueryChange={() => {}}
      overscan={0}
      query={GROUPED_QUERY}
      rows={ROWS}
      viewportHeight={400}
    />
  );
}

function techAggregateText(container: HTMLElement): string {
  const techGroup = [
    ...container.querySelectorAll("[data-pretable-group-row]"),
  ].find((row) => row.textContent?.includes("Tech"));
  return (
    techGroup?.querySelector('[data-pretable-column-id="qty"]')?.textContent ??
    ""
  );
}

test("ten prop-driven aggregate flips all reach the DOM", async () => {
  const view = render(groupedElement(SUM_COLUMNS));
  await waitFor(() => expect(techAggregateText(view.container)).toBe("30"));

  for (let flip = 1; flip <= 10; flip += 1) {
    const next = flip % 2 === 1 ? COUNT_COLUMNS : SUM_COLUMNS;
    const expected = flip % 2 === 1 ? "2" : "30";
    view.rerender(groupedElement(next));
    await waitFor(
      () => expect(techAggregateText(view.container)).toBe(expected),
      // Generous against a loaded machine; the pre-fix failure mode is not a
      // slow flip but a flip that NEVER lands, so a long timeout cannot mask
      // the regression.
      { timeout: 10_000 },
    );
  }
}, 120_000);
