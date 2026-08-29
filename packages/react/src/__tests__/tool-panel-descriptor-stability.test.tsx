// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PretableSurface } from "../public_api";
import type {
  PretableColumn,
  PretableToolPanelConfig,
  PretableToolPanelSection,
} from "../public_api";
import type { PretableSurfaceGrid } from "../pretable-surface";
import type { ToolPanelProps } from "../tool-panel";

/**
 * The descriptor memo's stable-deps rule, PINNED (SP3b spec decision 12).
 *
 * The rule (stated above `toolPanelSections` in `pretable-surface.tsx`):
 * descriptor deps are handles and props-derived values, NEVER engine state.
 * Nothing else enforces it — React reconciles the pane's child by position
 * and type, so an unstable dep costs a rebuilt array and re-rendered
 * sections but breaks no behaviour, and every behavioural gate stays green.
 * This file is the only thing that fails when someone adds engine state to
 * the deps.
 *
 * Mechanism: the module that provides `ToolPanel` is mocked around its real
 * implementation, with the one component wrapped to record each render's
 * `sections` prop IDENTITY. An engine-only change must re-render the panel
 * (the recorder grows) with the SAME array; a `columns`-prop change must
 * rebuild it.
 *
 * The freshness twin — sections observing FRESH engine state despite the
 * stable array — is covered by the filters section's hidden/grouped marker
 * tests in `tool-panel.test.tsx` ("reads hidden LIVE from the engine
 * layout..." and the SP3b grouped-away marker pair); it is not duplicated
 * here.
 */

const recordedSections: ToolPanelProps["sections"][] = [];

// The module pretable-surface imports `ToolPanel` from — `./tool-panel`
// there, which resolves to the same module id as `../tool-panel` here.
// Everything re-exports as-is except `ToolPanel`, which records and
// delegates. (`FiltersSection`/`GroupingSection` come from deeper modules
// and stay untouched.)
vi.mock("../tool-panel", async (importActual) => {
  const actual = await importActual<typeof import("../tool-panel")>();
  const RealToolPanel = actual.ToolPanel;
  return {
    ...actual,
    ToolPanel: (props: ToolPanelProps) => {
      recordedSections.push(props.sections);
      return <RealToolPanel {...props} />;
    },
  };
});

afterEach(() => {
  cleanup();
  recordedSections.length = 0;
});

type Row = { id: string; name: string; amount: number };

const rows: Row[] = [
  { id: "r1", name: "Alpha", amount: 1 },
  { id: "r2", name: "Beta", amount: 2 },
];
const columns: PretableColumn<Row>[] = [
  { id: "name", header: "Name" },
  { id: "amount", header: "Amount", type: "number" },
];

type Grid = PretableSurfaceGrid<Row, string, readonly PretableColumn<Row>[]>;

function mountSurface(
  toolPanel: PretableToolPanelConfig = { defaultActiveSection: "filters" },
) {
  const captured = { current: null as Grid | null };
  const surface = (
    cols: PretableColumn<Row>[],
    panel: PretableToolPanelConfig,
  ) => (
    <PretableSurface<Row>
      ariaLabel="Descriptor stability grid"
      columns={cols}
      rows={rows}
      getRowId={(r: Row) => r.id}
      onGridReady={(g: unknown) => {
        captured.current = g as Grid;
      }}
      toolPanel={panel}
      viewportHeight={300}
    />
  );
  const view = render(surface(columns, toolPanel));
  if (captured.current === null) {
    throw new Error("onGridReady never fired: no grid captured at mount");
  }
  return {
    grid: captured.current,
    rerenderColumns: (next: PretableColumn<Row>[]) =>
      view.rerender(surface(next, toolPanel)),
    rerenderToolPanel: (next: PretableToolPanelConfig) =>
      view.rerender(surface(columns, next)),
  };
}

describe("the tool panel descriptor memo's stable-deps rule", () => {
  it("re-renders on engine-only changes WITHOUT rebuilding the sections array", async () => {
    const h = mountSurface();
    expect(recordedSections.length).toBeGreaterThan(0);
    const before = recordedSections.at(-1)!;
    const renders = recordedSections.length;

    // Engine state only, on BOTH stores a dep could leak from — one change
    // per store, because each mutation candidate (`snapshot`,
    // `rowModelSnapshot`, ...) moves on its own store's writes and a
    // single-store probe leaves the other undetectable:
    //
    // 1. the grid core — hiding a column moves the layout slice (and with it
    //    the projected `snapshot`); the panel repaints (the marker tests
    //    prove the sections SEE it), with the same array;
    act(() => {
      h.grid.setColumnVisible("name", false);
    });
    // 2. the row model — a filter write moves `rowModelSnapshot.query`.
    //    `setQuery` settles cooperatively, so the settled tree is awaited.
    act(() => {
      h.grid.setQuery({
        ...h.grid.rowModel.getState().snapshot.query,
        filters: [{ columnId: "name", operator: "contains", value: "a" }],
      } as never);
    });
    await waitFor(() => {
      expect(
        (h.grid.rowModel.getState().snapshot.query.filters as unknown[]).length,
      ).toBe(1);
    });

    // Non-vacuous both ways: the panel DID render again (a surface that
    // stopped re-rendering the panel would pass the identity check for the
    // wrong reason)…
    expect(recordedSections.length).toBeGreaterThan(renders);
    // …and every one of those renders received the SAME descriptor array.
    for (const sections of recordedSections.slice(renders)) {
      expect(sections).toBe(before);
    }
  });

  it("rebuilds the sections array when the columns PROP changes", () => {
    const h = mountSurface();
    const before = recordedSections.at(-1)!;

    // A label change is the case the memo's deps exist FOR: the filters
    // section's column list carries `header ?? id`, so a stale array here
    // would keep offering the old name.
    h.rerenderColumns([
      { id: "name", header: "Full name" },
      { id: "amount", header: "Amount", type: "number" },
    ]);

    expect(recordedSections.length).toBeGreaterThan(0);
    expect(recordedSections.at(-1)!).not.toBe(before);
  });

  /* ---- SP4 siblings: the roster joins the deps as a consumer prop ------- */

  const customSection: PretableToolPanelSection = {
    id: "my-section",
    icon: () => null,
    label: "My section",
    render: () => null,
  };
  // Held at module scope of the describe: the STABLE roster the rule rewards.
  const stableRoster = ["filters", customSection] as const;

  it("a STABLE custom roster keeps the sections array identity across engine-only changes", () => {
    const h = mountSurface({
      defaultActiveSection: "filters",
      sections: stableRoster,
    });
    expect(recordedSections.length).toBeGreaterThan(0);
    const before = recordedSections.at(-1)!;
    expect(before.map((s) => s.id)).toEqual(["filters", "my-section"]);
    const renders = recordedSections.length;

    // Engine-only, like the built-in test above: the panel must re-render
    // (non-vacuous) with the SAME resolved array.
    act(() => {
      h.grid.setColumnVisible("name", false);
    });
    expect(recordedSections.length).toBeGreaterThan(renders);
    for (const sections of recordedSections.slice(renders)) {
      expect(sections).toBe(before);
    }
  });

  it("a REBUILT inline roster changes the sections array identity", () => {
    const h = mountSurface({
      defaultActiveSection: "filters",
      sections: stableRoster,
    });
    const before = recordedSections.at(-1)!;

    // Same entries, new array — the inline-roster cost the config documents:
    // a rebuilt descriptor array, and nothing else.
    h.rerenderToolPanel({
      defaultActiveSection: "filters",
      sections: [...stableRoster],
    });

    expect(recordedSections.length).toBeGreaterThan(0);
    expect(recordedSections.at(-1)!).not.toBe(before);
    expect(recordedSections.at(-1)!.map((s) => s.id)).toEqual([
      "filters",
      "my-section",
    ]);
  });
});
