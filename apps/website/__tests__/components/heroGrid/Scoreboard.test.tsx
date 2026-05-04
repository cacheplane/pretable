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
});
