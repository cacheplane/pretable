import { describe, expect, it } from "vitest";
import { countCells } from "../showcase/useRenderedCellCount";

describe("countCells", () => {
  it("counts [data-pretable-cell] descendants", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div data-pretable-cell></div>
      <div data-pretable-cell></div>
      <span>not a cell</span>
      <div><div data-pretable-cell></div></div>
    `;
    expect(countCells(root)).toBe(3);
  });

  it("returns 0 when there are no cells", () => {
    expect(countCells(document.createElement("div"))).toBe(0);
  });
});
