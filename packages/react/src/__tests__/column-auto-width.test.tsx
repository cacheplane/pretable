// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { PretableColumn } from "../public_api";
import { PretableSurface } from "../public_api";
import type { PretableSurfaceGrid } from "../pretable-surface";

/**
 * `setColumnAutoWidth` and the auto-width set, observed at the drawn seam.
 *
 * WHAT JSDOM CAN AND CANNOT SEE — read before trusting these numbers. jsdom
 * performs no text measurement, so "content drives the width" is not
 * observable here; that pixel proof belongs to the Playwright pass (SP5
 * Task 4). What jsdom CAN see is the seam the auto set actually acts
 * through: `mergeRenderColumns` (pretable-model.ts) strips `widthPx` from
 * every column in the auto set, so the renderer — not the engine — owns an
 * auto column's drawn width (`resolveColumnWidth`'s fallback, 140px for an
 * unwrapped column, or a flex share), while a manual column draws at the
 * engine's stored width (grid-core's `DEFAULT_COLUMN_WIDTH_PX` 160 when the
 * props declared none). 140 ≠ 160 ≠ any declared width, so auto-set
 * membership is directly observable as WHICH owner the drawn header width
 * follows: renderer fallback ⇒ auto, engine store ⇒ manual. Every assertion
 * below reads the header cell's inline `style.width` — the real DOM output —
 * never the store.
 */

type DemoRow = {
  id: string;
  fixed: string;
  fluid: string;
};

const rows: DemoRow[] = [{ id: "r1", fixed: "x", fluid: "y" }];

/** The renderer's fallback for an unwrapped column with no `widthPx` —
 *  `FIXED_COLUMN_WIDTH` in renderer-dom's create-renderer.ts. */
const RENDERER_AUTO_WIDTH = 140;
/** grid-core's `DEFAULT_COLUMN_WIDTH_PX`: what the engine stores for a
 *  column whose props declared no width. */
const ENGINE_DEFAULT_WIDTH = 160;
/** The "fixed" column's declared `widthPx`. */
const DECLARED_WIDTH = 120;

const columns: PretableColumn<DemoRow>[] = [
  {
    id: "fixed",
    header: "Fixed",
    widthPx: DECLARED_WIDTH,
    value: (r) => r.fixed,
  },
  { id: "fluid", header: "Fluid", value: (r) => r.fluid },
];

type DemoGrid = PretableSurfaceGrid<
  DemoRow,
  string,
  readonly PretableColumn<DemoRow>[]
>;

function mount(options?: { toolPanel?: boolean }) {
  const captured = { current: null as DemoGrid | null };
  const view = render(
    <PretableSurface<DemoRow>
      ariaLabel="Auto width demo"
      columns={columns}
      getRowId={(row) => row.id}
      onGridReady={(g) => {
        captured.current = g as DemoGrid;
      }}
      rows={rows}
      toolPanel={{
        defaultActiveSection: options?.toolPanel === true ? "columns" : null,
      }}
      viewportHeight={200}
    />,
  );
  if (captured.current === null) {
    throw new Error("onGridReady never fired: no grid captured at mount");
  }
  const grid = captured.current;
  return {
    view,
    grid,
    /** The drawn header width — the inline style the planner wrote. */
    drawnWidth: (columnId: string) => {
      const cell = view.container.querySelector(
        `[data-pretable-header-cell][data-pretable-column-id="${columnId}"]`,
      ) as HTMLElement | null;
      if (cell === null) throw new Error(`No header cell for ${columnId}`);
      return Number.parseFloat(cell.style.width.replace("px", ""));
    },
    /** What the ENGINE stores — distinct from what is drawn. */
    engineWidth: (columnId: string) => {
      const entry = grid
        .getState()
        .columnLayout.find((column) => column.id === columnId);
      if (entry === undefined) throw new Error(`No layout entry ${columnId}`);
      return entry.widthPx;
    },
    resetButton: () =>
      view.container.querySelector(
        "[data-pretable-tool-reset]",
      ) as HTMLButtonElement,
  };
}

afterEach(cleanup);

describe("column auto width", () => {
  it("a column with no declared width starts auto; a declared one does not", () => {
    const h = mount();
    // Manual: the engine's stored (declared) width is what draws.
    expect(h.drawnWidth("fixed")).toBe(DECLARED_WIDTH);
    expect(h.engineWidth("fixed")).toBe(DECLARED_WIDTH);
    // Auto: the engine stores its 160 default, but the RENDERER owns the
    // drawn width — the divergence is the membership proof.
    expect(h.engineWidth("fluid")).toBe(ENGINE_DEFAULT_WIDTH);
    expect(h.drawnWidth("fluid")).toBe(RENDERER_AUTO_WIDTH);
  });

  it("setColumnAutoWidth(id, true) hands the drawn width to the renderer", () => {
    const h = mount();
    act(() => {
      h.grid.setColumnAutoWidth("fixed", true);
    });
    // The drawn width leaves the engine's stored value for the renderer's
    // content-tracking mode (its fallback in jsdom, where nothing measures).
    expect(h.drawnWidth("fixed")).toBe(RENDERER_AUTO_WIDTH);
    // Non-destructive: the engine still remembers the declared width.
    expect(h.engineWidth("fixed")).toBe(DECLARED_WIDTH);
  });

  it("setColumnAutoWidth(id, false) freezes at the engine's stored width", () => {
    const h = mount();
    act(() => {
      h.grid.setColumnAutoWidth("fluid", false);
    });
    // Off means manual at the engine's current stored width (spec B1) —
    // the drawn width now follows the store, not the renderer.
    expect(h.drawnWidth("fluid")).toBe(ENGINE_DEFAULT_WIDTH);
    // The other column is untouched.
    expect(h.drawnWidth("fixed")).toBe(DECLARED_WIDTH);
  });

  it("setColumnWidth still flips auto OFF, and autosizeColumns still sets ALL auto", () => {
    const h = mount();
    // Old behavior 1: an explicit width write turns tracking off AND applies.
    act(() => {
      h.grid.setColumnWidth("fluid", 200);
    });
    expect(h.drawnWidth("fluid")).toBe(200);
    expect(h.engineWidth("fluid")).toBe(200);
    // Old behavior 2: autosizeColumns keeps its all-columns meaning.
    act(() => {
      h.grid.autosizeColumns();
    });
    expect(h.drawnWidth("fixed")).toBe(RENDERER_AUTO_WIDTH);
    expect(h.drawnWidth("fluid")).toBe(RENDERER_AUTO_WIDTH);
    // And the engine still remembers both stored widths underneath.
    expect(h.engineWidth("fixed")).toBe(DECLARED_WIDTH);
    expect(h.engineWidth("fluid")).toBe(200);
  });

  it("Reset columns restores the INITIAL auto set, both directions", () => {
    const h = mount({ toolPanel: true });
    // Drift both ways from the initial state.
    act(() => {
      h.grid.setColumnAutoWidth("fixed", true);
      h.grid.setColumnAutoWidth("fluid", false);
    });
    expect(h.drawnWidth("fixed")).toBe(RENDERER_AUTO_WIDTH);
    expect(h.drawnWidth("fluid")).toBe(ENGINE_DEFAULT_WIDTH);
    // Reset: "fixed" declared a width, so it returns to manual; "fluid"
    // declared none, so it returns to auto.
    act(() => {
      fireEvent.click(h.resetButton());
    });
    expect(h.drawnWidth("fixed")).toBe(DECLARED_WIDTH);
    expect(h.drawnWidth("fluid")).toBe(RENDERER_AUTO_WIDTH);
  });
});
