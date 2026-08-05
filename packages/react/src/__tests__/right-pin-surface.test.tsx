import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { PretableSurface } from "../pretable-surface";
import type { PretableGrid } from "@pretable/core";

afterEach(() => {
  cleanup();
});

type PinRow = {
  id: string;
  first: string;
  b: string;
  c: string;
  d: string;
  status: string;
  actions: string;
};

// Column order matters: right offsets accumulate from the LAST column
// backwards, so `actions` (last) sits at right: 0 and `status` is offset by
// the width of `actions`.
const RIGHT_LAST_WIDTH = 80; // actions
const RIGHT_PREV_WIDTH = 90; // status
const LEFT_WIDTH = 120; // first

const columns = [
  {
    id: "first",
    header: "First",
    pinned: "left" as const,
    widthPx: LEFT_WIDTH,
  },
  { id: "b", header: "B", widthPx: 100 },
  { id: "c", header: "C", widthPx: 100 },
  { id: "d", header: "D", widthPx: 100 },
  {
    id: "status",
    header: "Status",
    pinned: "right" as const,
    widthPx: RIGHT_PREV_WIDTH,
  },
  {
    id: "actions",
    header: "Actions",
    pinned: "right" as const,
    widthPx: RIGHT_LAST_WIDTH,
  },
];

const rows: PinRow[] = [
  {
    id: "r1",
    first: "one",
    b: "b1",
    c: "c1",
    d: "d1",
    status: "open",
    actions: "edit",
  },
  {
    id: "r2",
    first: "two",
    b: "b2",
    c: "c2",
    d: "d2",
    status: "closed",
    actions: "edit",
  },
];

function renderSurface() {
  return render(
    <PretableSurface
      ariaLabel="pin-grid"
      columns={columns}
      getRowId={(row: PinRow) => row.id}
      overscan={0}
      rows={rows}
      viewportHeight={200}
    />,
  );
}

function bodyCell(container: HTMLElement, columnId: string) {
  return container.querySelector<HTMLElement>(
    `[data-pretable-cell][data-pretable-column-id="${columnId}"]`,
  );
}

function headerCell(container: HTMLElement, columnId: string) {
  return container.querySelector<HTMLElement>(
    `[data-pretable-header-cell][data-pretable-column-id="${columnId}"]`,
  );
}

function resizeHandle(container: HTMLElement, columnId: string) {
  return container.querySelector<HTMLElement>(
    `[data-pretable-resize-handle][data-pretable-column-id="${columnId}"]`,
  );
}

function funnelSlot(container: HTMLElement, columnId: string) {
  return container.querySelector<HTMLElement>(
    `[data-pretable-filter-funnel][data-pretable-column-id="${columnId}"]`,
  )?.parentElement;
}

describe("right-pinned columns — surface sticky sites", () => {
  it("body cells of right-pinned columns are sticky to the right edge", () => {
    const { container } = renderSurface();

    const last = bodyCell(container, "actions");
    const prev = bodyCell(container, "status");

    expect(last).not.toBeNull();
    expect(last).toHaveAttribute("data-pretable-pinned", "right");
    expect(last).toHaveStyle({ position: "sticky", right: "0px" });

    expect(prev).toHaveAttribute("data-pretable-pinned", "right");
    expect(prev).toHaveStyle({
      position: "sticky",
      right: `${RIGHT_LAST_WIDTH}px`,
    });
  });

  it("header buttons of right-pinned columns are sticky to the right edge", () => {
    const { container } = renderSurface();

    const last = headerCell(container, "actions");
    const prev = headerCell(container, "status");

    expect(last).toHaveAttribute("data-pretable-pinned", "right");
    expect(last).toHaveStyle({ position: "sticky", right: "0px" });

    expect(prev).toHaveAttribute("data-pretable-pinned", "right");
    expect(prev).toHaveStyle({
      position: "sticky",
      right: `${RIGHT_LAST_WIDTH}px`,
    });
  });

  it("resize handles of right-pinned columns stick to the column's trailing edge", () => {
    const { container } = renderSurface();

    // The handle is a 4px strip whose RIGHT edge sits on the column's trailing
    // edge. `plannedCol.right` already measures that trailing edge from the
    // viewport's right edge, so the sticky inset is exactly `plannedCol.right`
    // (no `+ width` term — that only appears on the left because the left form
    // starts from the column's LEADING edge).
    expect(resizeHandle(container, "actions")).toHaveStyle({
      position: "sticky",
      right: "0px",
    });
    expect(resizeHandle(container, "status")).toHaveStyle({
      position: "sticky",
      right: `${RIGHT_LAST_WIDTH}px`,
    });
  });

  it("filter-funnel slots of right-pinned columns sit just inside the resize strip", () => {
    const { container } = renderSurface();

    // The 18px funnel sits immediately left of the 4px resize strip, so its
    // RIGHT edge is 4px inside the column's trailing edge.
    expect(funnelSlot(container, "actions")).toHaveStyle({
      position: "sticky",
      right: "4px",
    });
    expect(funnelSlot(container, "status")).toHaveStyle({
      position: "sticky",
      right: `${RIGHT_LAST_WIDTH + 4}px`,
    });
  });

  it("two right-pinned columns stack in column order", () => {
    const { container } = renderSurface();

    const pinnedRight = Array.from(
      container.querySelectorAll<HTMLElement>(
        '[data-pretable-header-cell][data-pretable-pinned="right"]',
      ),
    ).map((el) => el.getAttribute("data-pretable-column-id"));

    expect(pinnedRight).toEqual(["status", "actions"]);
  });

  it("left- and right-pinned columns coexist on opposite edges", () => {
    const { container } = renderSurface();

    const leftHeader = headerCell(container, "first");
    expect(leftHeader).toHaveAttribute("data-pretable-pinned", "left");
    expect(leftHeader).toHaveStyle({ position: "sticky", left: "0px" });

    const leftBody = bodyCell(container, "first");
    expect(leftBody).toHaveAttribute("data-pretable-pinned", "left");
    expect(leftBody).toHaveStyle({ position: "sticky", left: "0px" });

    // Left-side overlay geometry is untouched: leading edge + width - N.
    expect(resizeHandle(container, "first")).toHaveStyle({
      position: "sticky",
      left: `${LEFT_WIDTH - 4}px`,
    });
    expect(funnelSlot(container, "first")).toHaveStyle({
      position: "sticky",
      left: `${LEFT_WIDTH - 22}px`,
    });

    expect(bodyCell(container, "actions")).toHaveStyle({
      position: "sticky",
      right: "0px",
    });
  });

  it("unpinned columns are unaffected", () => {
    const { container } = renderSurface();

    const header = headerCell(container, "c");
    expect(header).not.toHaveAttribute("data-pretable-pinned");
    expect(header).toHaveStyle({ position: "absolute" });

    const cell = bodyCell(container, "c");
    expect(cell).not.toHaveAttribute("data-pretable-pinned");
    expect(cell).toHaveStyle({ position: "absolute" });

    expect(resizeHandle(container, "c")).toHaveStyle({ position: "absolute" });
    expect(funnelSlot(container, "c")).toHaveStyle({ position: "absolute" });
  });

  it("controlled state.columnPinned round-trips 'right' into the engine", () => {
    let capturedGrid: PretableGrid<PinRow> | null = null;
    render(
      <PretableSurface
        ariaLabel="controlled-pin-grid"
        columns={[
          { id: "first", header: "First", widthPx: 120 },
          { id: "b", header: "B", widthPx: 100 },
          { id: "c", header: "C", widthPx: 100 },
          { id: "d", header: "D", widthPx: 100 },
          { id: "status", header: "Status", widthPx: 90 },
          { id: "actions", header: "Actions", widthPx: 80 },
        ]}
        getRowId={(row: PinRow) => row.id}
        onGridReady={(g) => {
          capturedGrid = g;
        }}
        overscan={0}
        rows={rows}
        state={{ columnPinned: { actions: "right", first: "left", c: null } }}
        viewportHeight={200}
      />,
    );

    const cols = capturedGrid!.options.columns;
    expect(cols.find((col) => col.id === "actions")?.pinned).toBe("right");
    expect(cols.find((col) => col.id === "first")?.pinned).toBe("left");
    expect(cols.find((col) => col.id === "c")?.pinned).toBeUndefined();
  });
});
