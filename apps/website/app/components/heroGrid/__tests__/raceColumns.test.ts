import { describe, expect, it } from "vitest";

import { raceColumns } from "../raceColumns";

describe("raceColumns", () => {
  it("declares 9 columns", () => {
    expect(raceColumns).toHaveLength(9);
  });

  it("pins bib left", () => {
    const bib = raceColumns.find((c) => c.id === "bib");
    expect(bib?.pinned).toBe("left");
  });

  it("does not wrap notes column (truncates with ellipsis to keep row height stable)", () => {
    const notes = raceColumns.find((c) => c.id === "notes");
    expect(notes?.wrap).toBe(false);
  });

  it("declares total width of 1000px", () => {
    const total = raceColumns.reduce((sum, c) => sum + (c.widthPx ?? 0), 0);
    expect(total).toBe(1000);
  });
});
