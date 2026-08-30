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
import { createLocalRowModel } from "@pretable-internal/row-model";
import { createColumnHelper } from "@pretable/core";

/**
 * The ROW-SELECT streaming layout bill, pinned end to end — the sibling of
 * `grouped-streaming-layout-cost.test.tsx` (#529). A steady-state streaming
 * commit (`applyTransaction`) on a grid with `rowSelectionColumn` enabled
 * must cost the row-layout controller NOTHING beyond the incremental journal
 * path — no height-index replacement, and no columns reset.
 *
 * The seam this pins: `CompiledQuery.get query()` mints a fresh defensive
 * copy on every read, so the react layer's `observedQuery` changes identity
 * on every streaming commit and `resolveEffectiveColumns` re-runs. Before
 * the fix it minted the synthetic ROW-SELECT column with a fresh `value`
 * closure each time, so every commit's `controller.setColumns` failed its
 * field-scoped equality check on `[__pretable_row_select__].value` alone and
 * paid a synchronous FULL-SET `clearEstimates` walk (a full cooperative
 * re-ingest before #522). No grouping needed: the columns-reset diagnostics
 * live on the layout controller itself, and the churn is in the synthetic
 * column's construction, not in grouping.
 */

type Row = { id: number; name: string; qty: number };

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

const rows: Row[] = Array.from({ length: 500 }, (_, index) => ({
  id: index,
  name: `row ${index}`,
  qty: index % 97,
}));

const helper = createColumnHelper<Row>();
const modelColumns = [
  helper.accessor("name", { type: "text" }),
  helper.accessor("qty", { type: "number" }),
] as const;

const presentationColumns = [
  { id: "name", header: "Name", widthPx: 140, type: "text" as const },
  { id: "qty", header: "Qty", widthPx: 100, type: "number" as const },
];

describe("row-select streaming layout cost", () => {
  it("a streaming commit with rowSelectionColumn costs no columns reset and no replacement", async () => {
    const model = createLocalRowModel({
      rows,
      columns: modelColumns,
      getRowId: (row) => (row as Row).id,
    });
    const view = render(
      <PretableSurface
        ariaLabel="row-select-streaming-grid"
        columns={presentationColumns}
        model={model as never}
        overscan={0}
        rowSelectionColumn={{ enabled: true }}
        viewportHeight={600}
      />,
    );
    await expect
      .poll(
        () =>
          view.container.querySelectorAll("[data-pretable-row-select]").length +
          view.container.querySelectorAll('input[type="checkbox"]').length,
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0);
    expect(controllers).toHaveLength(1);
    const controller = controllers[0]!;
    await expect.poll(() => controller.getState().status.kind).toBe("ready");
    // Let the mount-time roster/width column effects settle first — they are
    // the mount's bill, not streaming's.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const base = getRowLayoutControllerDiagnosticsForTesting(controller);

    const commits = 20;
    for (let commit = 0; commit < commits; commit += 1) {
      await act(async () => {
        model.applyTransaction({
          update: Array.from({ length: 8 }, (_, k) => ({
            id: (commit * 61 + k * 97) % rows.length,
            changes: { qty: 1_000 + commit * 8 + k },
          })),
        } as never);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const after = getRowLayoutControllerDiagnosticsForTesting(controller);
    // The whole point: steady-state streaming commits ride the incremental
    // journal path. NOTHING may re-ingest or full-walk the height index —
    // not a replacement, not a columns reset (each `clearEstimates` is a
    // synchronous full-set pass), not a reset-path fallback.
    expect(after.columnsResetPathCount - base.columnsResetPathCount).toBe(0);
    expect(after.replacementStartCount - base.replacementStartCount).toBe(0);
    expect(after.columnsResetFallbackCount).toBe(0);
    expect(after.reorderFallbackCount - base.reorderFallbackCount).toBe(0);
    expect(after.refilterFallbackCount - base.refilterFallbackCount).toBe(0);

    // And the stream really landed — the cheap path must not have bought its
    // zeros by dropping commits. The last commit's revision is observed...
    expect(controller.getState().snapshot?.revision).toBe(
      model.getState().snapshot.revision,
    );
    // ...and a streamed value is in the DOM. Row 0 is patched by the very
    // first commit (commit 0, k 0 → id 0 → qty 1000) and never re-patched
    // by a later commit's stride to a different value it stays visible at
    // the top of the viewport.
    const finalQty = new Map(rows.map((row) => [row.id, row.qty]));
    for (let commit = 0; commit < commits; commit += 1) {
      for (let k = 0; k < 8; k += 1) {
        finalQty.set(
          (commit * 61 + k * 97) % rows.length,
          1_000 + commit * 8 + k,
        );
      }
    }
    const streamedRowZeroQty = finalQty.get(0)!;
    expect(streamedRowZeroQty).not.toBe(rows[0]!.qty);
    await expect
      .poll(() => {
        const dataRows = Array.from(
          view.container.querySelectorAll('[role="row"]'),
        );
        return dataRows.some((row) =>
          (row.textContent ?? "").includes(String(streamedRowZeroQty)),
        );
      })
      .toBe(true);
  }, 60_000);
});
