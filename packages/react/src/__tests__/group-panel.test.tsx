import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { PretableSurface } from "../pretable-surface";
import type { PretableColumn } from "../types";
import type { PretableSurfaceState } from "../use-pretable";

afterEach(() => {
  cleanup();
});

type Holding = {
  id: string;
  sector: string;
  industry: string;
  name: string;
};

const rows: Holding[] = [
  { id: "r1", sector: "Tech", industry: "Software", name: "alpha" },
  { id: "r2", sector: "Tech", industry: "Hardware", name: "beta" },
  { id: "r3", sector: "Energy", industry: "Oil", name: "gamma" },
];

const columns: PretableColumn<Holding>[] = [
  { id: "sector", header: "Sector", widthPx: 100 },
  { id: "industry", header: "Industry", widthPx: 100 },
  { id: "name", header: "Name", widthPx: 100 },
];

interface GridProps {
  groupPanel?: { enabled: boolean; emptyMessage?: string };
  onRowGroupsChange?: (rowGroups: string[]) => void;
  state?: PretableSurfaceState;
  viewportHeight?: number;
}

function Grid({
  groupPanel,
  onRowGroupsChange,
  state,
  viewportHeight,
}: GridProps) {
  return (
    <PretableSurface
      ariaLabel="test-grid"
      columns={columns}
      getRowId={(row: Holding) => row.id}
      groupPanel={groupPanel}
      onRowGroupsChange={onRowGroupsChange}
      overscan={0}
      rows={rows}
      state={state}
      viewportHeight={viewportHeight ?? 600}
    />
  );
}

const renderGrid = (props: GridProps = {}) => render(<Grid {...props} />);

describe("group panel — wrapper and height accounting", () => {
  it("without groupPanel, the root is still the scroll viewport", () => {
    const view = renderGrid();
    const root = view.container.firstElementChild!;
    expect(root).toHaveAttribute("data-pretable-scroll-viewport");
  });

  it("with groupPanel, the viewport is wrapped and keeps every attribute", () => {
    const view = renderGrid({ groupPanel: { enabled: true } });
    const root = view.container.firstElementChild!;
    expect(root).toHaveAttribute("data-pretable-group-panel-wrapper");
    const viewport = root.querySelector("[data-pretable-scroll-viewport]")!;
    expect(viewport).toHaveAttribute("role", "grid");
    expect(viewport).toHaveAttribute("aria-label", "test-grid");
  });

  it("the panel consumes from viewportHeight rather than adding to it", () => {
    // The component must occupy exactly `viewportHeight` either way, so a
    // consumer's layout does not shift when they enable the panel.
    const plain = renderGrid({ viewportHeight: 400 });
    const plainVp = plain.container.querySelector(
      "[data-pretable-scroll-viewport]",
    ) as HTMLElement;
    expect(plainVp.style.height).toBe("400px");

    cleanup();
    const panelled = renderGrid({
      viewportHeight: 400,
      groupPanel: { enabled: true },
    });
    const wrapper = panelled.container.firstElementChild as HTMLElement;
    const vp = panelled.container.querySelector(
      "[data-pretable-scroll-viewport]",
    ) as HTMLElement;
    expect(parseInt(vp.style.height, 10)).toBeLessThan(400);
    // …and the total is still exactly `viewportHeight`.
    expect(wrapper.style.height).toBe("400px");
  });
});
