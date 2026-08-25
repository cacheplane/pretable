// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  createColumnHelper,
  createLocalRowModel,
  type PretableVisibleRowRef,
} from "@pretable/core";
import type { RowLayoutController } from "@pretable-internal/renderer-dom";
// The diagnostics seam is a direct-module export deliberately kept off
// renderer-dom's barrel; `vitest.config.ts` aliases this subpath to its
// source and `tsconfig.typecheck.json` resolves it through the package's
// built `dist/*.d.ts`.
import { getRowLayoutControllerDiagnosticsForTesting } from "@pretable-internal/renderer-dom/row-layout-controller";

/**
 * The dense-identity layout seam (Amendment I), pinned END TO END: a react
 * grid over a flat local row model must run every filter transition on the
 * DENSE refilter path — `refilterPathCount` advances, `refilterFallbackCount`
 * stays 0 — and a measured row's height must survive being filtered out and
 * back in.
 *
 * ## Why the dense-lane probe below is load-bearing
 *
 * `refilterFallbackCount === 0` alone cannot catch the dense lane silently
 * rotting away: a controller whose source never declares `denseCapacity`
 * (say, a react-side snapshot wrapper that drops the `ɵ` seam) refilters
 * happily on the STRING lane with zero fallbacks — green counters, dead fast
 * path. Likewise the builder-phase escape hatch (a half-dense source throws,
 * one restart lands on the string lane) keeps the grid working AND the
 * fallback counter clean, because the drop happens at build time, not at
 * refilter time. So this pin also asserts the mounted index actually IS
 * dense, via layout-core's own contract: a DENSE generation refuses an
 * operation without a `denseKey`. Break the stamping (`denseKey: undefined`
 * in the controller's dense source) and the probe — not the counters — turns
 * this file red; break the refilter-time stamping only and the counters do.
 */

type Row = { id: number; score: number; label: string };

const column = createColumnHelper<Row>();
const columns = [
  column.accessor("score", { type: "number" }),
  column.accessor("label", { type: "text", wrap: true, widthPx: 200 }),
] as const;

const rows: readonly Row[] = Array.from({ length: 200 }, (_, index) => ({
  id: index,
  score: index,
  label: `row ${index}`,
}));

type Controller = RowLayoutController<Row, number, typeof columns>;

const controllers: Controller[] = [];

vi.mock("@pretable-internal/renderer-dom", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@pretable-internal/renderer-dom")>();
  const createRowLayoutController: typeof actual.createRowLayoutController = (
    options,
  ) => {
    const controller = actual.createRowLayoutController(options);
    controllers.push(controller as unknown as Controller);
    return controller;
  };
  return { ...actual, createRowLayoutController };
});

const { PretableSurface } = await import("../pretable-surface");

const dataRef = (rowId: number): PretableVisibleRowRef<number> => ({
  kind: "data",
  rowId,
});

/**
 * Layout-core's dense contract, used as a lane probe: a DENSE generation
 * refuses any operation that arrives without a `denseKey`; a string-lane
 * generation accepts it. `apply` is persistent and throws before producing
 * anything, so probing never perturbs the published index.
 */
function isDenseIndex(controller: Controller): boolean {
  const rowHeights = controller.getState().rowHeights;
  try {
    rowHeights.apply([{ kind: "update", ref: dataRef(0), index: 0 }]);
    return false;
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/dense/i);
    return true;
  }
}

afterEach(() => {
  cleanup();
  controllers.length = 0;
  vi.clearAllMocks();
});

describe("dense layout seam, end to end", () => {
  test("filter transitions ride the dense refilter path and measured heights survive a flip-out/flip-in", async () => {
    const model = createLocalRowModel({ rows, columns });
    const { container } = render(
      <PretableSurface
        ariaLabel="Dense seam grid"
        model={model}
        overscan={0}
        viewportHeight={120}
      />,
    );
    await waitFor(() => {
      expect(
        container.querySelectorAll("[data-pretable-row]").length,
      ).toBeGreaterThan(0);
    });
    expect(controllers).toHaveLength(1);
    const controller = controllers[0]!;
    await waitFor(() => {
      expect(controller.getState().status.kind).toBe("ready");
    });

    // The react-mounted grid actually engaged the DENSE lane — see the module
    // docblock for why the counters alone cannot vouch for this.
    expect(isDenseIndex(controller)).toBe(true);

    // Measured OUTSIDE the planned viewport, so jsdom's zero-height DOM
    // measurements of the visible rows never contest it.
    const measured = dataRef(150);
    act(() => {
      controller.measure(measured, 63);
    });
    expect(controller.getState().rowHeights.hasMeasurement(measured)).toBe(
      true,
    );

    const base = getRowLayoutControllerDiagnosticsForTesting(controller);

    const setFilter = async (
      value: number | undefined,
      expectedVisible: number,
    ) => {
      await act(async () => {
        const transition = model.setQuery({
          filters:
            value === undefined
              ? []
              : [{ columnId: "score", operator: "gt", value }],
          sort: [],
          rowGroups: [],
        });
        await transition.finished;
      });
      await waitFor(() => {
        const state = controller.getState();
        expect(state.status.kind).toBe("ready");
        expect(state.snapshot?.visibleRowCount).toBe(expectedVisible);
      });
    };

    // filter-on → narrow (row 150 flips OUT) → widen (row 150 flips back
    // IN) → filter-off. Scores are 0..199, `gt` is strict.
    await setFilter(100, 99);
    await setFilter(180, 19);
    await setFilter(100, 99);

    // The measurement survived the flip-out/flip-in — restored from the
    // identity-keyed retention, never re-estimated.
    const widened = controller.getState();
    expect(widened.rowHeights.hasMeasurement(measured)).toBe(true);
    const rank = widened.snapshot!.indexOf(measured);
    expect(rank).toBeGreaterThanOrEqual(0);
    expect(widened.rowHeights.getHeight(rank)).toBe(63);

    await setFilter(undefined, 200);
    const final = controller.getState();
    expect(final.rowHeights.getHeight(final.snapshot!.indexOf(measured))).toBe(
      63,
    );

    // Every transition rode the in-place refilter path, and none fell back
    // to a full replacement — the dense fast path ran, silently-fallback
    // free.
    const diagnostics = getRowLayoutControllerDiagnosticsForTesting(controller);
    expect(diagnostics.refilterPathCount - base.refilterPathCount).toBe(4);
    expect(diagnostics.refilterFallbackCount).toBe(0);
    expect(diagnostics.reorderFallbackCount).toBe(0);

    // And the index is STILL dense — no transition quietly dropped the
    // generation to the string lane.
    expect(isDenseIndex(controller)).toBe(true);

    model.dispose();
  }, 30_000);
});
