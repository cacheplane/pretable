// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { PretableColumn } from "../public_api";
import { PretableSurface } from "../public_api";
import type { PretableSurfaceGrid } from "../pretable-surface";

/**
 * `setColumnAutoWidth` and the auto-width set, observed at the drawn seam.
 *
 * WHAT JSDOM CAN AND CANNOT SEE — read before trusting these numbers. jsdom
 * performs no text measurement, so "content drives the width" is not
 * observable here — and would not be anywhere: auto width is a MODE BIT,
 * not a content fit. What jsdom CAN see is the seam the auto set acts
 * through: `mergeRenderColumns` (pretable-model.ts) strips `widthPx` from
 * every column in the auto set, so the renderer — not the engine — owns an
 * auto column's drawn width (`resolveColumnWidth`'s fallback, 140px for an
 * unwrapped column, or a flex share), while a manual column draws at the
 * engine's stored width.
 *
 * Since the width-default unification, the engine's stored width for an
 * undeclared column IS the renderer's fallback (140 — layout-core's
 * `DEFAULT_COLUMN_WIDTH_PX`, seeded through the same `resolveColumnWidth`),
 * so for a never-resized undeclared column the two owners agree by design —
 * that agreement is itself pinned below ("no jump"). Membership therefore
 * has to be made observable by declaring or writing widths that DIFFER from
 * 140 before toggling: renderer fallback ⇒ auto, stored width ⇒ manual.
 * Every assertion reads the header cell's inline `style.width` — the real
 * DOM output — never the store.
 */

type DemoRow = {
  id: string;
  fixed: string;
  fluid: string;
};

const rows: DemoRow[] = [{ id: "r1", fixed: "x", fluid: "y" }];

/** The renderer's fallback for an unwrapped column with no `widthPx` — and,
 *  since the unification, ALSO what the engine stores for such a column:
 *  layout-core's `DEFAULT_COLUMN_WIDTH_PX`, one number, two owners. */
const RENDERER_AUTO_WIDTH = 140;
/** A width no default resolves to, written via `setColumnWidth` where a test
 *  needs manual-vs-auto to be pixel-distinguishable. */
const MANUAL_WIDTH = 200;
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
    // Auto: the renderer owns the drawn width — AND the engine's stored
    // default is the same number, seeded through the renderer's own
    // resolver. Stored == drawn is the unification's whole point: freezing
    // this column later must be a no-op, not a jump.
    expect(h.engineWidth("fluid")).toBe(RENDERER_AUTO_WIDTH);
    expect(h.drawnWidth("fluid")).toBe(RENDERER_AUTO_WIDTH);
  });

  it("setColumnAutoWidth(id, true) hands the drawn width to the renderer", () => {
    const h = mount();
    act(() => {
      h.grid.setColumnAutoWidth("fixed", true);
    });
    // The drawn width leaves the engine's stored value for the renderer's
    // own default — auto is a MODE BIT handing the renderer ownership (spec
    // Fact 2); nothing measures content anywhere in this path.
    expect(h.drawnWidth("fixed")).toBe(RENDERER_AUTO_WIDTH);
    // Non-destructive: the engine still remembers the declared width.
    expect(h.engineWidth("fixed")).toBe(DECLARED_WIDTH);
  });

  it("setColumnAutoWidth(id, false) freezes at the engine's stored width — a no-op pixel for a never-resized column", () => {
    const h = mount();
    act(() => {
      h.grid.setColumnAutoWidth("fluid", false);
    });
    // Off means manual at the engine's current stored width (spec B1). For
    // a never-resized column that stored width IS the renderer's default —
    // the old 140→160 jump is gone by construction.
    expect(h.drawnWidth("fluid")).toBe(RENDERER_AUTO_WIDTH);
    expect(h.engineWidth("fluid")).toBe(RENDERER_AUTO_WIDTH);
    // The other column is untouched.
    expect(h.drawnWidth("fixed")).toBe(DECLARED_WIDTH);
    // And the column really is MANUAL now, not still auto at the same
    // pixel: store a different width (which is a manual write anyway), turn
    // auto on, then off again — the freeze lands on the stored 200, which
    // only a store-following column can draw.
    act(() => {
      h.grid.setColumnWidth("fluid", MANUAL_WIDTH);
      h.grid.setColumnAutoWidth("fluid", true);
    });
    expect(h.drawnWidth("fluid")).toBe(RENDERER_AUTO_WIDTH);
    act(() => {
      h.grid.setColumnAutoWidth("fluid", false);
    });
    expect(h.drawnWidth("fluid")).toBe(MANUAL_WIDTH);
  });

  it("setColumnWidth still flips auto OFF, and setAllColumnsAutoWidth moves the whole roster both ways", () => {
    const h = mount();
    // Old behavior 1: an explicit width write turns tracking off AND applies.
    act(() => {
      h.grid.setColumnWidth("fluid", MANUAL_WIDTH);
    });
    expect(h.drawnWidth("fluid")).toBe(MANUAL_WIDTH);
    expect(h.engineWidth("fluid")).toBe(MANUAL_WIDTH);
    // The all-columns form, on: every column joins the auto set.
    act(() => {
      h.grid.setAllColumnsAutoWidth(true);
    });
    expect(h.drawnWidth("fixed")).toBe(RENDERER_AUTO_WIDTH);
    expect(h.drawnWidth("fluid")).toBe(RENDERER_AUTO_WIDTH);
    // And the engine still remembers both stored widths underneath.
    expect(h.engineWidth("fixed")).toBe(DECLARED_WIDTH);
    expect(h.engineWidth("fluid")).toBe(MANUAL_WIDTH);
    // The symmetric half the old `autosizeColumns()` name never offered:
    // off freezes EVERY column at its stored width.
    act(() => {
      h.grid.setAllColumnsAutoWidth(false);
    });
    expect(h.drawnWidth("fixed")).toBe(DECLARED_WIDTH);
    expect(h.drawnWidth("fluid")).toBe(MANUAL_WIDTH);
  });

  it("double-clicking the resize handle hands the column's width to the grid", () => {
    const h = mount();
    // Manual at its declared width before the gesture.
    expect(h.drawnWidth("fixed")).toBe(DECLARED_WIDTH);
    const handle = h.view.container.querySelector(
      `[data-pretable-resize-handle][data-pretable-column-id="fixed"]`,
    ) as HTMLElement | null;
    if (handle === null) throw new Error("No resize handle for fixed");
    act(() => {
      fireEvent.doubleClick(handle);
    });
    // The double-click is the pointer shortcut for setColumnAutoWidth(id,
    // true): the RENDERER owns the drawn width now (mode bit, not a content
    // fit — nothing measured anything)...
    expect(h.drawnWidth("fixed")).toBe(RENDERER_AUTO_WIDTH);
    // ...and non-destructively: the engine still stores the declared width.
    expect(h.engineWidth("fixed")).toBe(DECLARED_WIDTH);
  });

  it("the auto bit survives a controlled columnWidths round trip", () => {
    // The shape of the column-layout docs example: `state.columnWidths` is
    // controlled and `onColumnWidthsChange` feeds it back, so every commit
    // re-renders the consumer and the write-back effect replays the whole
    // widths map through `setColumnWidth`.
    //
    // That replay used to clear the auto bit for every column in the map,
    // which made auto width unusable for any controlled consumer: the
    // double-click below (and the tool panel's toggle, identically) set the
    // bit and had it un-set before paint. `setColumnWidth` now clears the
    // bit only when it MOVES the stored width, and a replay of unchanged
    // widths moves none.
    function Controlled() {
      const [columnWidths, setColumnWidths] = useState<
        Partial<Record<string, number>>
      >(() => ({ fixed: DECLARED_WIDTH }));
      return (
        <PretableSurface<DemoRow>
          ariaLabel="Controlled widths"
          columns={columns}
          getRowId={(row) => row.id}
          onColumnWidthsChange={setColumnWidths}
          onGridReady={() => undefined}
          rows={rows}
          state={{ columnWidths }}
          viewportHeight={200}
        />
      );
    }
    const view = render(<Controlled />);
    const drawn = (columnId: string) => {
      const cell = view.container.querySelector(
        `[data-pretable-header-cell][data-pretable-column-id="${columnId}"]`,
      ) as HTMLElement | null;
      if (cell === null) throw new Error(`No header cell for ${columnId}`);
      return Number.parseFloat(cell.style.width.replace("px", ""));
    };
    expect(drawn("fixed")).toBe(DECLARED_WIDTH);

    const handle = view.container.querySelector(
      `[data-pretable-resize-handle][data-pretable-column-id="fixed"]`,
    ) as HTMLElement | null;
    if (handle === null) throw new Error("No resize handle for fixed");
    act(() => {
      fireEvent.doubleClick(handle);
    });

    // The renderer owns the drawn width, and it STAYS owned across the
    // controlled re-render the gesture provokes — this is the assertion that
    // fails (120, the declared width, reasserted) without the guard.
    expect(drawn("fixed")).toBe(RENDERER_AUTO_WIDTH);
    // A second, unrelated commit through the same controlled loop must not
    // undo it either: nothing about `state` changing is a width write.
    act(() => {
      view.rerender(<Controlled />);
    });
    expect(drawn("fixed")).toBe(RENDERER_AUTO_WIDTH);
  });

  it("Reset columns restores the INITIAL auto set, both directions", () => {
    const h = mount({ toolPanel: true });
    // Drift both ways from the initial state — the manual drift goes
    // through `setColumnWidth` so it is pixel-distinguishable from auto.
    act(() => {
      h.grid.setColumnAutoWidth("fixed", true);
      h.grid.setColumnWidth("fluid", MANUAL_WIDTH);
    });
    expect(h.drawnWidth("fixed")).toBe(RENDERER_AUTO_WIDTH);
    expect(h.drawnWidth("fluid")).toBe(MANUAL_WIDTH);
    // Reset: "fixed" declared a width, so it returns to manual; "fluid"
    // declared none, so it returns to auto.
    act(() => {
      fireEvent.click(h.resetButton());
    });
    expect(h.drawnWidth("fixed")).toBe(DECLARED_WIDTH);
    expect(h.drawnWidth("fluid")).toBe(RENDERER_AUTO_WIDTH);
  });
});
