import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PipelineDiagram } from "../../app/components/PipelineDiagram";

describe("PipelineDiagram", () => {
  afterEach(() => cleanup());

  it("renders all five stage names", () => {
    render(<PipelineDiagram />);
    for (const name of ["Source", "Engine", "Viewport", "Renderer", "Frame"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it("renders all five package badges", () => {
    render(<PipelineDiagram />);
    expect(screen.getByText(/stream-adapter/)).toBeInTheDocument();
    expect(screen.getByText(/grid-core/)).toBeInTheDocument();
    expect(screen.getByText(/layout-core \+ text-core/)).toBeInTheDocument();
    expect(screen.getByText(/renderer-dom/)).toBeInTheDocument();
    expect(screen.getByText(/browser/)).toBeInTheDocument();
  });

  it("renders the four output-shape arrow labels in order", () => {
    const { container } = render(<PipelineDiagram />);
    const text = container.textContent ?? "";
    const order = ["Row[] | Patch", "Snapshot", "RenderPlan", "Element[]"];
    let cursor = 0;
    for (const label of order) {
      const next = text.indexOf(label, cursor);
      expect(
        next,
        `expected to find ${label} after position ${cursor}`,
      ).toBeGreaterThan(-1);
      cursor = next + label.length;
    }
  });

  it("exposes a testid root and an accessible region label", () => {
    render(<PipelineDiagram />);
    const root = screen.getByTestId("pipeline-diagram");
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute(
      "aria-label",
      expect.stringMatching(/render pipeline/i),
    );
  });
});
