import { describe, expect, it } from "vitest";
import { summarizeSelection } from "../selection";
import type { PretableSelectionState } from "@pretable/react";

const sel = (ranges: Array<[string, string, string, string]>): PretableSelectionState => ({
  ranges: ranges.map(([startRowId, endRowId, startColumnId, endColumnId]) => ({
    startRowId, endRowId, startColumnId, endColumnId })),
  anchor: null,
});

describe("summarizeSelection", () => {
  it("returns null for an empty selection", () => {
    expect(summarizeSelection(sel([]), ["c1", "c2", "c3"], ["r1", "r2", "r3"])).toBeNull();
  });
  it("counts rows × columns of a single range", () => {
    expect(summarizeSelection(sel([["r1", "r2", "c1", "c2"]]), ["c1", "c2", "c3"], ["r1", "r2", "r3"]))
      .toEqual({ rows: 2, cols: 2 });
  });
  it("counts the union across multiple ranges", () => {
    expect(summarizeSelection(sel([["r1", "r1", "c1", "c1"], ["r3", "r3", "c3", "c3"]]),
      ["c1", "c2", "c3"], ["r1", "r2", "r3"])).toEqual({ rows: 2, cols: 2 });
  });
});
