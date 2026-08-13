import { describe, expect, it } from "vitest";

import { cellAddressFromElement } from "../marquee-drag";

/**
 * `cellAddressFromElement` is the pure half of resolving a marquee drag's
 * hovered cell — the DOM traversal from a hit-tested element up to its
 * `{ rowId, columnId }` address. It is deliberately factored out of
 * `cellAddressFromPoint` so this part CAN be exercised in jsdom, unlike the
 * `document.elementFromPoint` call that feeds it in production (always
 * returns `null` in jsdom — see the module doc in `../marquee-drag.ts`).
 *
 * This does not, and cannot, prove the pointer-capture bug is fixed: jsdom
 * does not implement capture retargeting, so it never observed the failure in
 * the first place. That proof is `apps/website/e2e/range-selection.spec.ts`,
 * driven with real `page.mouse` events in Chromium and WebKit.
 */
function buildCell(rowId: string, columnId: string) {
  const row = document.createElement("div");
  row.setAttribute("data-pretable-row-id", rowId);

  const cell = document.createElement("div");
  cell.setAttribute("data-pretable-cell", "");
  cell.setAttribute("data-pretable-column-id", columnId);

  const label = document.createElement("span");
  cell.appendChild(label);
  row.appendChild(cell);
  document.body.appendChild(row);

  return { row, cell, label };
}

describe("cellAddressFromElement", () => {
  it("reads the row and column id off the nearest cell and row ancestors", () => {
    const { cell } = buildCell("row-2", "qty");
    expect(cellAddressFromElement(cell)).toEqual({
      rowId: "row-2",
      columnId: "qty",
    });
  });

  it("walks up from a descendant of the cell (e.g. text content under the pointer)", () => {
    const { label } = buildCell("row-9", "name");
    expect(cellAddressFromElement(label)).toEqual({
      rowId: "row-9",
      columnId: "name",
    });
  });

  it("returns null for an element outside any cell", () => {
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    expect(cellAddressFromElement(outside)).toBeNull();
  });

  it("returns null for null input (elementFromPoint missed the document)", () => {
    expect(cellAddressFromElement(null)).toBeNull();
  });

  it("returns null when a cell is missing its row-id ancestor", () => {
    const cell = document.createElement("div");
    cell.setAttribute("data-pretable-cell", "");
    cell.setAttribute("data-pretable-column-id", "name");
    document.body.appendChild(cell);
    expect(cellAddressFromElement(cell)).toBeNull();
  });

  it("returns null when the cell carries no column id", () => {
    const row = document.createElement("div");
    row.setAttribute("data-pretable-row-id", "row-1");
    const cell = document.createElement("div");
    cell.setAttribute("data-pretable-cell", "");
    row.appendChild(cell);
    document.body.appendChild(row);
    expect(cellAddressFromElement(cell)).toBeNull();
  });
});
