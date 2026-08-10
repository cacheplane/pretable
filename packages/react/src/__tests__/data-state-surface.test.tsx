import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { PretableSurface } from "../pretable-surface";
import type { PretableDataState } from "../data-state";

afterEach(cleanup);

type Row = { id: string; name: string };

const columns = [{ id: "name", header: "Name", widthPx: 120 }];
const oneRow: Row[] = [{ id: "a", name: "Ada" }];

function renderSurface(rows: Row[], dataState?: PretableDataState) {
  return render(
    <PretableSurface<Row>
      ariaLabel="People"
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      viewportHeight={400}
      dataState={dataState}
      processing={{ filter: "external", sort: "external" }}
    />,
  );
}

function block(view: ReturnType<typeof render>): HTMLElement | null {
  return view.container.querySelector("[data-pretable-body-state]");
}

describe("body-state rendering", () => {
  it("renders nothing extra when dataState is absent", () => {
    const view = renderSurface([]);
    expect(block(view)).toBeNull();
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

  it("error with rows keeps the rows and shows a status strip", () => {
    const view = renderSurface(oneRow, { phase: "error", message: "boom" });
    expect(block(view)).toHaveAttribute(
      "data-pretable-body-state",
      "error-strip",
    );
    expect(block(view)).toHaveAttribute("role", "status");
    expect(screen.getAllByRole("row").length).toBeGreaterThan(1);
  });

  it("stale with rows renders no block, only the phase attribute", () => {
    const view = renderSurface(oneRow, { phase: "stale" });
    expect(block(view)).toBeNull();
    expect(screen.getByRole("grid")).toHaveAttribute(
      "data-pretable-data-phase",
      "stale",
    );
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
    expect(block(view)).not.toHaveTextContent("No results");
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
