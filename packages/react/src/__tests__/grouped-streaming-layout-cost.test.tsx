// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createColumnHelper } from "@pretable/core";
import { createLocalRowModel } from "@pretable-internal/row-model";
import type { RowLayoutController } from "@pretable-internal/renderer-dom";
// The diagnostics seam is a direct-module export deliberately kept off
// renderer-dom's barrel; `vitest.config.ts` aliases this subpath to its
// source and `tsconfig.typecheck.json` resolves it through the package's
// built `dist/*.d.ts`.
import { getRowLayoutControllerDiagnosticsForTesting } from "@pretable-internal/renderer-dom/row-layout-controller";

/**
 * The GROUPED STREAMING layout bill, pinned END TO END: a steady-state
 * streaming commit (`applyTransaction` under an applied grouping) must cost
 * the row-layout controller NOTHING beyond the incremental journal path —
 * no height-index replacement, and no columns reset.
 *
 * The seam this pins: `CompiledQuery.get query()` mints a fresh defensive
 * copy on every read, so the react layer's `observedQuery` changes identity
 * on every streaming commit and `resolveEffectiveColumns` re-runs. Before
 * the fix it minted the synthetic group column with a FRESH `value` closure
 * each time, so every commit's `controller.setColumns` failed its
 * deep-equality check on `[__pretable_group__].value` alone and paid a
 * synchronous FULL-SET `clearEstimates` walk (and, before #522, a full
 * cooperative re-ingest — ~40% of a traced S5 `group-updates` streaming
 * window's second half). Full-set work per batch-sized commit is exactly
 * the proportionality bug this test forbids.
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

const helper = createColumnHelper<Row>();
const modelColumns = [
  helper.accessor("sector", { type: "text" }),
  helper.accessor("name", { type: "text" }),
  helper.accessor("qty", { type: "number", aggregate: "sum" }),
] as const;

const presentationColumns = [
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

describe("grouped streaming layout cost", () => {
  it("a streaming commit under grouping costs no columns reset and no replacement", async () => {
    const model = createLocalRowModel({
      rows,
      columns: modelColumns,
      getRowId: (row) => (row as Row).id,
      initialExpansion: { kind: "expanded" },
      query: {
        filters: [],
        sort: [],
        rowGroups: [{ columnId: "sector" }],
      },
    });
    const view = render(
      <PretableSurface
        ariaLabel="grouped-streaming-grid"
        columns={presentationColumns}
        model={model as never}
        overscan={0}
        viewportHeight={600}
      />,
    );
    await expect
      .poll(
        () =>
          view.container.querySelectorAll("[data-pretable-group-row]").length,
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0);
    expect(controllers).toHaveLength(1);
    const controller = controllers[0]!;
    await expect.poll(() => controller.getState().status.kind).toBe("ready");
    // Let the mount-time roster/width column effects settle first — they are
    // the grouping APPLY's bill (pinned elsewhere), not streaming's.
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
    // ...and the streamed values are in the DOM: the "Bank" group's sum
    // aggregate must reflect them (its group row always paints at the top;
    // individual data-row membership of the viewport would be fragile).
    const bankSum = rows.reduce((sum, row) => {
      if (row.sector !== "Bank") return sum;
      return sum + row.qty;
    }, 0);
    // Recompute what the streamed grid should now total for "Bank" by
    // replaying the same patch sequence.
    const finalQty = new Map(rows.map((row) => [row.id, row.qty]));
    for (let commit = 0; commit < commits; commit += 1) {
      for (let k = 0; k < 8; k += 1) {
        finalQty.set(
          (commit * 61 + k * 97) % rows.length,
          1_000 + commit * 8 + k,
        );
      }
    }
    const streamedBankSum = rows.reduce(
      (sum, row) => (row.sector === "Bank" ? sum + finalQty.get(row.id)! : sum),
      0,
    );
    expect(streamedBankSum).not.toBe(bankSum);
    await expect
      .poll(() => {
        const groupRows = Array.from(
          view.container.querySelectorAll("[data-pretable-group-row]"),
        );
        return groupRows.some((row) =>
          (row.textContent ?? "").includes(String(streamedBankSum)),
        );
      })
      .toBe(true);
  }, 60_000);
});
