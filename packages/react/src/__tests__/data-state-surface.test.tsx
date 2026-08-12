import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { PretableSurface } from "../pretable-surface";
import type { PretableDataState } from "../data-state";
import type { PretableBodyStateKind } from "../public_api";

afterEach(cleanup);

type Row = { id: string; name: string };

const columns = [{ id: "name", header: "Name", widthPx: 120 }];
const oneRow: Row[] = [{ id: "a", name: "Ada" }];

function Surface({
  rows,
  dataState,
}: {
  rows: Row[];
  dataState?: PretableDataState;
}) {
  return (
    <PretableSurface<Row>
      ariaLabel="People"
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      viewportHeight={400}
      dataState={dataState}
      processing={{ filter: "external", sort: "external" }}
    />
  );
}

function renderSurface(rows: Row[], dataState?: PretableDataState) {
  return render(<Surface rows={rows} dataState={dataState} />);
}

function block(view: ReturnType<typeof render>): HTMLElement | null {
  return view.container.querySelector("[data-pretable-body-state]");
}

function wrapper(view: ReturnType<typeof render>): HTMLElement | null {
  return view.container.querySelector("[data-pretable-data-state-wrapper]");
}

function viewport(view: ReturnType<typeof render>): HTMLElement | null {
  return view.container.querySelector("[data-pretable-scroll-viewport]");
}

describe("body-state rendering", () => {
  it("renders nothing extra when dataState is absent", () => {
    const view = renderSurface([]);
    expect(block(view)).toBeNull();
    expect(wrapper(view)).toBeNull();
    expect(screen.getByRole("grid")).not.toHaveAttribute(
      "data-pretable-data-phase",
    );
  });

  it("loading with nothing loaded shows the loading block", () => {
    const view = renderSurface([], { phase: "loading" });
    expect(block(view)).toHaveAttribute("data-pretable-body-state", "loading");
    expect(block(view)).toHaveTextContent("Loading…");
  });

  it("idle with nothing loaded shows the empty block", () => {
    const view = renderSurface([], { phase: "idle" });
    expect(block(view)).toHaveAttribute("data-pretable-body-state", "empty");
    expect(block(view)).toHaveTextContent("No results");
  });

  it("stale with nothing loaded shows loading, not 'no results'", () => {
    const view = renderSurface([], { phase: "stale" });
    expect(block(view)).toHaveAttribute("data-pretable-body-state", "loading");
  });

  it("refreshing with nothing loaded keeps the empty block", () => {
    const view = renderSurface([], { phase: "refreshing" });
    expect(block(view)).toHaveAttribute("data-pretable-body-state", "empty");
  });

  it("error with nothing loaded shows the error block", () => {
    const view = renderSurface([], { phase: "error", message: "boom" });
    expect(block(view)).toHaveAttribute("data-pretable-body-state", "error");
    expect(block(view)).toHaveTextContent("boom");
  });

  it("error with rows keeps the rows and shows a strip", () => {
    const view = renderSurface(oneRow, { phase: "error", message: "boom" });
    expect(block(view)).toHaveAttribute(
      "data-pretable-body-state",
      "error-strip",
    );
    expect(screen.getAllByRole("row").length).toBeGreaterThan(1);
  });

  it("gives the strip no live-region role of its own", () => {
    const view = renderSurface(oneRow, { phase: "error", message: "boom" });
    expect(block(view)).not.toHaveAttribute("role");
    expect(block(view)).not.toHaveAttribute("aria-live");
    // The surface's single permanent live region stays the only one.
    expect(
      document.querySelectorAll("[data-pretable-live-region]"),
    ).toHaveLength(1);
  });

  it("stale with rows renders no block, only the phase attribute", () => {
    const view = renderSurface(oneRow, { phase: "stale" });
    expect(block(view)).toBeNull();
    expect(screen.getByRole("grid")).toHaveAttribute(
      "data-pretable-data-phase",
      "stale",
    );
  });

  it("puts the phase on the wrapper too, so the block is reachable by phase", () => {
    const view = renderSurface(oneRow, { phase: "stale" });
    expect(wrapper(view)).toHaveAttribute("data-pretable-data-phase", "stale");
  });

  it("shows the empty block when an engine filter matches nothing", () => {
    const view = render(
      <PretableSurface<Row>
        ariaLabel="People"
        columns={columns}
        rows={oneRow}
        getRowId={(row) => row.id}
        viewportHeight={400}
        dataState={{ phase: "idle" }}
        query={{
          filters: [{ columnId: "name", operator: "contains", value: "zzzz" }],
          sort: [],
          rowGroups: [],
        }}
        onQueryChange={() => undefined}
      />,
    );
    expect(block(view)).toHaveAttribute("data-pretable-body-state", "empty");
  });

  it("renderBodyState replaces the built-in block", () => {
    const view = render(
      <PretableSurface<Row>
        ariaLabel="People"
        columns={columns}
        rows={[]}
        getRowId={(row) => row.id}
        viewportHeight={400}
        dataState={{ phase: "idle" }}
        renderBodyState={(input) => (
          <span data-testid="custom">
            {input.phase}:{input.loadedRowCount}
          </span>
        )}
      />,
    );
    expect(view.getByTestId("custom")).toHaveTextContent("idle:0");
    // The wrapper element and its kind attribute survive the override.
    expect(block(view)).toHaveAttribute("data-pretable-body-state", "empty");
    expect(block(view)?.textContent).toBe("idle:0");
  });

  it("hands renderBodyState the resolved kind", () => {
    const seen: PretableBodyStateKind[] = [];
    render(
      <PretableSurface<Row>
        ariaLabel="People"
        columns={columns}
        rows={oneRow}
        getRowId={(row) => row.id}
        viewportHeight={400}
        processing={{ filter: "external", sort: "external" }}
        dataState={{ phase: "error", message: "boom" }}
        renderBodyState={(input) => {
          seen.push(input.kind);
          return <span data-testid="custom">{input.kind}</span>;
        }}
      />,
    );
    expect(seen).toContain("error-strip");
  });

  it("never sets aria-busy in any phase", () => {
    for (const phase of [
      "idle",
      "loading",
      "stale",
      "refreshing",
      "loading-more",
    ] as const) {
      cleanup();
      renderSurface(oneRow, { phase });
      expect(screen.getByRole("grid")).not.toHaveAttribute("aria-busy");
    }
  });
});

describe("body-state layout", () => {
  it("overlays the full-bleed block on the body band instead of stacking it", () => {
    const view = renderSurface([], { phase: "loading" });
    const header = view.container.querySelector(
      "[data-pretable-header-row]",
    ) as HTMLElement;

    expect(wrapper(view)).toHaveStyle({ position: "relative" });
    expect(block(view)).toHaveStyle({
      position: "absolute",
      top: header.style.height,
      bottom: "0px",
    });
  });

  it("leaves the error strip in flow above the rows", () => {
    const view = renderSurface(oneRow, { phase: "error", message: "boom" });
    expect(block(view)).not.toHaveStyle({ position: "absolute" });
  });
});

describe("body-state transitions", () => {
  it("keeps the viewport element when dataState goes back to undefined", () => {
    const view = render(
      <Surface rows={oneRow} dataState={{ phase: "idle" }} />,
    );
    const before = viewport(view);
    view.rerender(<Surface rows={oneRow} />);
    expect(viewport(view)).toBe(before);
    expect(wrapper(view)).not.toBeNull();
  });

  it("keeps the viewport element when the error strip appears and clears", () => {
    const view = render(
      <Surface rows={oneRow} dataState={{ phase: "idle" }} />,
    );
    const before = viewport(view);
    view.rerender(
      <Surface rows={oneRow} dataState={{ phase: "error", message: "boom" }} />,
    );
    expect(block(view)).toHaveAttribute(
      "data-pretable-body-state",
      "error-strip",
    );
    expect(viewport(view)).toBe(before);

    view.rerender(<Surface rows={oneRow} dataState={{ phase: "idle" }} />);
    expect(block(view)).toBeNull();
    expect(viewport(view)).toBe(before);
  });

  it("swaps the loading block for rows when loading resolves", async () => {
    const view = render(<Surface rows={[]} dataState={{ phase: "loading" }} />);
    expect(block(view)).toHaveAttribute("data-pretable-body-state", "loading");
    view.rerender(<Surface rows={oneRow} dataState={{ phase: "idle" }} />);
    expect(block(view)).toBeNull();
    await waitFor(() =>
      expect(screen.getAllByRole("row").length).toBeGreaterThan(1),
    );
  });

  it("swaps the loading block for the empty block when a load resolves to nothing", () => {
    const view = render(<Surface rows={[]} dataState={{ phase: "loading" }} />);
    view.rerender(<Surface rows={[]} dataState={{ phase: "idle" }} />);
    expect(block(view)).toHaveAttribute("data-pretable-body-state", "empty");
  });

  it("keeps the empty block through a refresh, never flickering to loading", () => {
    const view = render(<Surface rows={[]} dataState={{ phase: "idle" }} />);
    view.rerender(<Surface rows={[]} dataState={{ phase: "refreshing" }} />);
    expect(block(view)).toHaveAttribute("data-pretable-body-state", "empty");
    view.rerender(<Surface rows={[]} dataState={{ phase: "idle" }} />);
    expect(block(view)).toHaveAttribute("data-pretable-body-state", "empty");
  });
});
