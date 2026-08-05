import { describe, expect, it } from "vitest";
import type { PretableSortEntry } from "@pretable/react";
import { applySort } from "../sort";
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
  it("defaults to weight desc when the sort list is empty", () => {
    expect(applySort(rows, []).map((r) => r.id)).toEqual(["B", "C", "A"]);
  });
  it("sorts by a numeric column ascending", () => {
    const s: PretableSortEntry[] = [{ columnId: "dayPnl", direction: "asc" }];
    expect(applySort(rows, s).map((r) => r.id)).toEqual(["A", "C", "B"]);
  });
  it("sorts by a numeric column descending", () => {
    const s: PretableSortEntry[] = [{ columnId: "dayPnl", direction: "desc" }];
    expect(applySort(rows, s).map((r) => r.id)).toEqual(["B", "C", "A"]);
  });
  it("sorts text columns case-insensitively", () => {
    const s: PretableSortEntry[] = [{ columnId: "symbol", direction: "asc" }];
    expect(applySort(rows, s).map((r) => r.id)).toEqual(["A", "B", "C"]);
  });
  it("cascades a two-key sort: sector asc, then dayPnl desc within ties", () => {
    const cascadeRows: PositionRow[] = [
      row({ id: "T1", sector: "Technology", dayPnl: -10 }),
      row({ id: "E1", sector: "Energy", dayPnl: 5 }),
      row({ id: "T2", sector: "Technology", dayPnl: 40 }),
      row({ id: "E2", sector: "Energy", dayPnl: 90 }),
    ];
    const s: PretableSortEntry[] = [
      { columnId: "sector", direction: "asc" },
      { columnId: "dayPnl", direction: "desc" },
    ];
    expect(applySort(cascadeRows, s).map((r) => r.id)).toEqual([
      "E2",
      "E1",
      "T2",
      "T1",
    ]);
  });
  it("keeps input order for rows tied on every sort key", () => {
    const tiedRows: PositionRow[] = [
      row({ id: "X", sector: "Energy", dayPnl: 5 }),
      row({ id: "Y", sector: "Energy", dayPnl: 5 }),
      row({ id: "Z", sector: "Energy", dayPnl: 5 }),
    ];
    const s: PretableSortEntry[] = [
      { columnId: "sector", direction: "asc" },
      { columnId: "dayPnl", direction: "desc" },
    ];
    expect(applySort(tiedRows, s).map((r) => r.id)).toEqual(["X", "Y", "Z"]);
  });
  it("does not reorder when given only non-sortable column ids", () => {
    const s: PretableSortEntry[] = [{ columnId: "analyst", direction: "asc" }];
    expect(applySort(rows, s).map((r) => r.id)).toEqual(["A", "B", "C"]);
  });
  it("skips non-sortable entries but still applies the sortable ones", () => {
    const s: PretableSortEntry[] = [
      { columnId: "analyst", direction: "asc" },
      { columnId: "dayPnl", direction: "asc" },
    ];
    expect(applySort(rows, s).map((r) => r.id)).toEqual(["A", "C", "B"]);
  });
});
