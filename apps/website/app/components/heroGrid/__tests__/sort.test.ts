import { describe, expect, it } from "vitest";
import { applySort, type SortState } from "../sort";
import type { PositionRow } from "../types";

function row(p: Partial<PositionRow> & { id: string }): PositionRow {
  return {
    symbol: p.id,
    name: p.id,
    sector: "Technology",
    qty: 0,
    last: 0,
    mktValue: 0,
    dayPnl: 0,
    dayPnlPct: 0,
    weight: 0,
    analyst: "",
    flag: "hold",
    ...p,
  };
}

const rows: PositionRow[] = [
  row({ id: "A", weight: 2, dayPnl: -10, symbol: "A" }),
  row({ id: "B", weight: 8, dayPnl: 50, symbol: "B" }),
  row({ id: "C", weight: 5, dayPnl: 0, symbol: "C" }),
];

describe("applySort", () => {
  it("defaults to weight desc when sort is null", () => {
    expect(applySort(rows, null).map((r) => r.id)).toEqual(["B", "C", "A"]);
  });
  it("sorts by a numeric column ascending", () => {
    const s: SortState = { columnId: "dayPnl", direction: "asc" };
    expect(applySort(rows, s).map((r) => r.id)).toEqual(["A", "C", "B"]);
  });
  it("sorts by a numeric column descending", () => {
    const s: SortState = { columnId: "dayPnl", direction: "desc" };
    expect(applySort(rows, s).map((r) => r.id)).toEqual(["B", "C", "A"]);
  });
  it("sorts text columns case-insensitively", () => {
    const s: SortState = { columnId: "symbol", direction: "asc" };
    expect(applySort(rows, s).map((r) => r.id)).toEqual(["A", "B", "C"]);
  });
  it("does not reorder when given a non-sortable column id", () => {
    const s = { columnId: "analyst", direction: "asc" } as unknown as SortState;
    expect(applySort(rows, s).map((r) => r.id)).toEqual(["A", "B", "C"]);
  });
});
