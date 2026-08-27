import { describe, expect, it } from "vitest";
import { ɵROW_SELECT_COLUMN_ID as ROW_SELECT } from "@pretable/react";
import { GROUP_COLUMN_ID } from "@pretable/core";
import { summarizeSelection } from "../selection";
import type { PretableSelectionState } from "@pretable/core";

const sel = (
  ranges: Array<[string, string, string, string]>,
): PretableSelectionState => ({
  ranges: ranges.map(([startRowId, endRowId, startColumnId, endColumnId]) => ({
    startRowId,
    endRowId,
    startColumnId,
    endColumnId,
  })),
  anchor: null,
});

describe("summarizeSelection", () => {
  it("returns null for an empty selection", () => {
    expect(
      summarizeSelection(sel([]), ["c1", "c2", "c3"], ["r1", "r2", "r3"]),
    ).toBeNull();
  });
  it("counts rows × columns of a single range", () => {
    expect(
      summarizeSelection(
        sel([["r1", "r2", "c1", "c2"]]),
        ["c1", "c2", "c3"],
        ["r1", "r2", "r3"],
      ),
    ).toEqual({ rows: 2, cols: 2 });
  });
  it("counts the union across multiple ranges", () => {
    expect(
      summarizeSelection(
        sel([
          ["r1", "r1", "c1", "c1"],
          ["r3", "r3", "c3", "c3"],
        ]),
        ["c1", "c2", "c3"],
        ["r1", "r2", "r3"],
      ),
    ).toEqual({ rows: 2, cols: 2 });
  });

  /**
   * The drawn column order carries synthetic columns the `columns` prop has
   * never heard of: the row-select column ahead of everything, and — while
   * grouped — the derived group column at the head of the unpinned region (it
   * is unpinned by default, so it sits AFTER any left-pinned columns, not
   * first). `toggleRowSelection` / `setSelectAllVisible` / `selectAll` encode a
   * whole-row range as drawn-first-id → drawn-last-id, which in the hero means
   * every one of them starts on the row-select column.
   *
   * Resolved against the prop order that id does not exist, the range is
   * silently dropped, and the panel reports NOTHING — which is exactly what the
   * hero did before this adoption, measured on a local production build: ⌘A,
   * the row checkboxes and the header select-all each painted a real selection
   * (up to 20 × 8) while the sidebar showed no Selection section at all.
   */
  describe("synthetic columns in the drawn order", () => {
    const DRAWN = [ROW_SELECT, "c1", "c2", "c3"];

    it("reads a full-row range bounded by the row-select column", () => {
      expect(
        summarizeSelection(sel([["r2", "r2", ROW_SELECT, "c3"]]), DRAWN, [
          "r1",
          "r2",
          "r3",
        ]),
      ).toEqual({ rows: 1, cols: 3 });
    });

    it("never counts the row-select column itself", () => {
      // Every data column is covered, and the answer is 3, not 4.
      expect(
        summarizeSelection(
          sel([
            ["r1", "r1", ROW_SELECT, "c3"],
            ["r3", "r3", ROW_SELECT, "c3"],
          ]),
          DRAWN,
          ["r1", "r2", "r3"],
        ),
      ).toEqual({ rows: 2, cols: 3 });
    });

    it("ignores a range that is only the row-select column", () => {
      expect(
        summarizeSelection(sel([["r1", "r2", ROW_SELECT, ROW_SELECT]]), DRAWN, [
          "r1",
          "r2",
          "r3",
        ]),
      ).toBeNull();
    });

    it("counts group rows but NOT the derived group column, while grouped", () => {
      // Grouped by c1: the drawn order loses c1 and gains the group column
      // after the pinned region, and `visibleRows` interleaves group headers
      // with the leaves. They are not symmetric. Group ROWS reach the clipboard
      // — they carry the label and the aggregates — so they count. The group
      // COLUMN does not: it is presentation, dropped from copy/CSV/paste so a
      // block pasted into Excel is the shape Excel expects. Counting it would
      // make the sidebar claim one more column than ⌘C actually copies.
      // So: 3 rows (two leaves and a header) × 2 columns (the survivors).
      expect(
        summarizeSelection(
          sel([["g:A", "r2", ROW_SELECT, "c3"]]),
          [ROW_SELECT, GROUP_COLUMN_ID, "c2", "c3"],
          ["g:A", "r1", "r2", "g:B", "r3"],
        ),
      ).toEqual({ rows: 3, cols: 2 });
    });
  });
});
