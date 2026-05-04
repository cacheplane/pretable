import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CourseVisualization } from "../../../app/components/heroGrid/CourseVisualization";
import type { RaceRow } from "../../../app/components/heroGrid/types";

const baseRow: RaceRow = {
  id: "r-001",
  bib: 1,
  racer: "Test Racer",
  gate1: "",
  gate2: "",
  gate3: "",
  finish: "",
  delta: "",
  status: "dns",
  notes: "",
};

describe("CourseVisualization", () => {
  afterEach(() => cleanup());

  it("renders an SVG root with data-testid + accessible label", () => {
    render(<CourseVisualization rows={[]} />);
    const root = screen.getByTestId("course-viz");
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute(
      "aria-label",
      expect.stringMatching(/course/i),
    );
  });

  it("renders 5 gate-tick labels (G1, G2, G3, G4, FIN)", () => {
    render(<CourseVisualization rows={[]} />);
    for (const label of ["G1", "G2", "G3", "G4", "FIN"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("renders one dot per running racer (skips dns/finished/DNF)", () => {
    const rows: RaceRow[] = [
      { ...baseRow, id: "r-001", status: "running", gate1: "00:14.32" },
      { ...baseRow, id: "r-002", bib: 2, status: "dns" },
      { ...baseRow, id: "r-003", bib: 3, status: "running" },
      {
        ...baseRow,
        id: "r-004",
        bib: 4,
        status: "finished",
        finish: "01:18",
        delta: "LEADER",
      },
    ];
    const { container } = render(<CourseVisualization rows={rows} />);
    const dots = container.querySelectorAll("[data-testid='racer-dot']");
    expect(dots).toHaveLength(2);
  });

  it("marks the leader's dot with data-leader='true'", () => {
    const rows: RaceRow[] = [
      { ...baseRow, id: "r-001", status: "running", delta: "LEADER" },
    ];
    const { container } = render(<CourseVisualization rows={rows} />);
    const leaderDot = container.querySelector("[data-leader='true']");
    expect(leaderDot).not.toBeNull();
  });

  it("ignores telemetry rows (id starts with tel-)", () => {
    const rows: RaceRow[] = [
      {
        ...baseRow,
        id: "tel-0001",
        bib: "—",
        status: "running",
        racer: "Sensor: gate 4 wind",
      },
      { ...baseRow, id: "r-002", bib: 2, status: "running" },
    ];
    const { container } = render(<CourseVisualization rows={rows} />);
    const dots = container.querySelectorAll("[data-testid='racer-dot']");
    expect(dots).toHaveLength(1);
  });
});
