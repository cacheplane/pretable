import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Scoreboard } from "../../../app/components/heroGrid/Scoreboard";
import type { RaceRow } from "../../../app/components/heroGrid/types";

const baseRow: RaceRow = {
  id: "x",
  bib: 0,
  racer: "Test 🇺🇸",
  gate1: "",
  gate2: "",
  gate3: "",
  finish: "",
  delta: "",
  status: "dns",
  notes: "",
};

describe("Scoreboard", () => {
  afterEach(() => cleanup());

  it("hides leader section when no LEADER row exists", () => {
    render(<Scoreboard rows={[]} />);
    expect(screen.queryByTestId("scoreboard-leader")).toBeNull();
  });

  it("shows leader section with finish time, bib, racer when LEADER row exists", () => {
    const rows: RaceRow[] = [
      {
        ...baseRow,
        id: "r-1",
        bib: 12,
        racer: "Thomas Tumler 🇨🇭",
        status: "finished",
        finish: "01:14.89",
        delta: "LEADER",
      },
    ];
    render(<Scoreboard rows={rows} />);
    const leader = screen.getByTestId("scoreboard-leader");
    expect(leader).toHaveTextContent("01:14.89");
    expect(leader).toHaveTextContent("12");
    expect(leader).toHaveTextContent("Thomas Tumler");
  });

  it("hides on-course section when no running rows", () => {
    render(<Scoreboard rows={[]} />);
    expect(screen.queryByTestId("scoreboard-on-course")).toBeNull();
  });

  it("renders one row per running racer with 4 gate dots", () => {
    const rows: RaceRow[] = [
      { ...baseRow, id: "r-1", bib: 15, status: "running", gate1: "00:14.50", gate2: "00:36.00" },
      { ...baseRow, id: "r-2", bib: 14, status: "running", gate1: "00:14.30" },
    ];
    render(<Scoreboard rows={rows} />);
    const section = screen.getByTestId("scoreboard-on-course");
    const racerRows = section.querySelectorAll("[data-testid='scoreboard-racer']");
    expect(racerRows).toHaveLength(2);
    racerRows.forEach((row) => {
      expect(row.querySelectorAll("[data-testid='gate-dot']")).toHaveLength(4);
    });
  });

  it("fills dots based on non-empty gate columns", () => {
    const rows: RaceRow[] = [
      { ...baseRow, id: "r-1", bib: 15, status: "running", gate1: "00:14.50", gate2: "00:36.00" },
    ];
    const { container } = render(<Scoreboard rows={rows} />);
    const dots = container.querySelectorAll("[data-testid='gate-dot']");
    expect([...dots].filter((d) => d.getAttribute("data-filled") === "true")).toHaveLength(2);
    expect([...dots].filter((d) => d.getAttribute("data-filled") === "false")).toHaveLength(2);
  });

  it("excludes telemetry rows (id starts with tel-)", () => {
    const rows: RaceRow[] = [
      { ...baseRow, id: "tel-0001", bib: "—", status: "running", racer: "Sensor: gate 4 wind" },
      { ...baseRow, id: "r-1", bib: 5, status: "running" },
    ];
    render(<Scoreboard rows={rows} />);
    const racerRows = screen.getAllByTestId("scoreboard-racer");
    expect(racerRows).toHaveLength(1);
  });

  it("caps on-course at 5 rows and shows +N more overflow indicator", () => {
    const rows: RaceRow[] = Array.from({ length: 7 }, (_, i) => ({
      ...baseRow,
      id: `r-${i + 1}`,
      bib: i + 1,
      status: "running" as const,
    }));
    render(<Scoreboard rows={rows} />);
    expect(screen.getAllByTestId("scoreboard-racer")).toHaveLength(5);
    expect(screen.getByTestId("scoreboard-overflow")).toHaveTextContent("+2 more");
  });

  it("orders running by gate progress descending", () => {
    const rows: RaceRow[] = [
      { ...baseRow, id: "early", bib: 1, status: "running", gate1: "00:14.00" },
      { ...baseRow, id: "late", bib: 2, status: "running", gate1: "00:14.00", gate2: "00:36.00", gate3: "00:55.00" },
    ];
    render(<Scoreboard rows={rows} />);
    const racerRows = screen.getAllByTestId("scoreboard-racer");
    expect(racerRows[0]).toHaveTextContent("2"); // bib 2 = "late"
    expect(racerRows[1]).toHaveTextContent("1");
  });

  it("hides counters when no finished or DNF rows", () => {
    render(<Scoreboard rows={[]} />);
    expect(screen.queryByTestId("scoreboard-counters")).toBeNull();
  });

  it("shows FIN count when at least one finished row", () => {
    const rows: RaceRow[] = [
      { ...baseRow, id: "r-1", bib: 1, status: "finished", finish: "01:16", delta: "LEADER" },
      { ...baseRow, id: "r-2", bib: 2, status: "finished", finish: "01:17", delta: "+1.00" },
    ];
    render(<Scoreboard rows={rows} />);
    expect(screen.getByTestId("scoreboard-counters")).toHaveTextContent("FIN 2");
  });

  it("shows DNF count when at least one DNF row, hides DNF when zero", () => {
    const rowsNoDnf: RaceRow[] = [
      { ...baseRow, id: "r-1", bib: 1, status: "finished", delta: "LEADER" },
    ];
    const { rerender } = render(<Scoreboard rows={rowsNoDnf} />);
    expect(screen.getByTestId("scoreboard-counters")).not.toHaveTextContent("DNF");

    const rowsWithDnf: RaceRow[] = [
      ...rowsNoDnf,
      { ...baseRow, id: "r-2", bib: 2, status: "DNF" },
    ];
    rerender(<Scoreboard rows={rowsWithDnf} />);
    expect(screen.getByTestId("scoreboard-counters")).toHaveTextContent("DNF 1");
  });
});
