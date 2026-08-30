// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RowLayoutController } from "@pretable-internal/renderer-dom";
// The diagnostics seam is a direct-module export deliberately kept off
// renderer-dom's barrel; `vitest.config.ts` aliases this subpath to its
// source and `tsconfig.typecheck.json` resolves it through the package's
// built `dist/*.d.ts`.
import { getRowLayoutControllerDiagnosticsForTesting } from "@pretable-internal/renderer-dom/row-layout-controller";

/**
 * The grouping-apply layout bill, pinned END TO END: applying a grouping to a
 * mounted react grid must cost exactly ONE height-index replacement — the
 * engine's reset commit, which really does change the row set (group rows
 * enter). It must NOT also pay full-set replacements for the column commits
 * that ride the same gesture (the group column swapping into the roster, and
 * the merged engine widths landing a render later) — those change only the
 * estimator's inputs, and the controller absorbs them in place.
 *
 * Before the columns-reset path existed this gesture cost THREE full 50k
 * ingests in a headed browser (engine reset + two `setColumns` restarts,
 * each cancelling the previous build) — ~0.6s of the grouping-apply settle
 * at S2 target scale.
 */

type Row = { id: number; sector: string; name: string; qty: number };

type Controller = RowLayoutController<Row, number, unknown>;

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

afterEach(() => {
  cleanup();
  controllers.length = 0;
  vi.clearAllMocks();
});

const SECTORS = ["Tech", "Energy", "Health", "Retail", "Bank"];
const rows: Row[] = Array.from({ length: 500 }, (_, index) => ({
  id: index,
  sector: SECTORS[index % SECTORS.length]!,
  name: `row ${index}`,
  qty: index % 97,
}));

const columns = [
  { id: "sector", header: "Sector", widthPx: 100, type: "text" as const },
  { id: "name", header: "Name", widthPx: 140, type: "text" as const },
  {
    id: "qty",
    header: "Qty",
    widthPx: 100,
    type: "number" as const,
    aggregate: "sum" as const,
  },
];

describe("grouping-apply layout cost", () => {
  it("costs exactly one height-index replacement, with the column commits absorbed in place", async () => {
    let grid: { setQuery: (query: unknown) => unknown } | undefined;
    const view = render(
      <PretableSurface
        ariaLabel="grouping-cost-grid"
        columns={columns}
        getRowId={(row: Row) => row.id}
        initialExpansion={{ kind: "expanded" }}
        onGridReady={(readyGrid) => {
          grid = readyGrid as unknown as typeof grid;
        }}
        overscan={0}
        rows={rows}
        viewportHeight={600}
      />,
    );
    await expect
      .poll(() => view.container.querySelectorAll("[data-pretable-row]").length)
      .toBeGreaterThan(0);
    expect(controllers).toHaveLength(1);
    const controller = controllers[0]!;
    await expect.poll(() => controller.getState().status.kind).toBe("ready");

    const base = getRowLayoutControllerDiagnosticsForTesting(controller);

    await act(async () => {
      const transition = grid!.setQuery({
        filters: [],
        sort: [],
        rowGroups: [{ columnId: "sector" }],
      }) as { finished?: Promise<unknown> };
      await transition?.finished;
    });
    await expect
      .poll(
        () =>
          view.container.querySelectorAll("[data-pretable-group-row]").length,
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0);
    await expect
      .poll(() => controller.getState().status.kind, { timeout: 20_000 })
      .toBe("ready");
    // Let the roster/width column effects settle (they land a render after
    // the grouped snapshot publishes).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const after = getRowLayoutControllerDiagnosticsForTesting(controller);
    // ONE replacement: the engine's grouping reset. The group-column roster
    // commit and the merged-width commit that follow it are absorbed by the
    // columns-reset path (or by an in-flight replacement) — never by another
    // full-set ingest.
    expect(after.replacementStartCount - base.replacementStartCount).toBe(1);
    expect(
      after.columnsResetPathCount - base.columnsResetPathCount,
    ).toBeGreaterThanOrEqual(1);
    expect(after.columnsResetFallbackCount).toBe(0);
    // And the grid really is grouped — the cheap path must not have bought
    // its count by dropping the commit.
    expect(controller.getState().snapshot?.visibleRowCount).toBe(
      rows.length + SECTORS.length,
    );
  }, 60_000);
});
