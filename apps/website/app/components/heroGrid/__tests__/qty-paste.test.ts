import type { PastePayload } from "@pretable/react";
import { describe, expect, it } from "vitest";

import { planQtyPaste } from "../qty-paste";
import type { PositionRow } from "../types";

const row = (id: string): PositionRow => ({
  id,
  symbol: id,
  name: id,
  sector: "Technology",
  qty: 100,
  last: 10,
  mktValue: 1000,
  dayPnl: 0,
  dayPnlPct: 0,
  weight: 1,
  analyst: "",
  flag: "hold",
});

const payload = (
  parts: Partial<PastePayload<PositionRow>>,
): PastePayload<PositionRow> => ({
  cells: [],
  rejected: [],
  source: { rows: 1, columns: 1 },
  clipped: { rows: 0, columns: 0 },
  ...parts,
});

describe("planQtyPaste", () => {
  it("collects qty cells and counts applied vs total", () => {
    const plan = planQtyPaste(
      payload({
        cells: [
          {
            rowId: "NVDA",
            columnId: "qty",
            value: 900,
            raw: "900",
            row: row("NVDA"),
          },
          {
            rowId: "MSFT",
            columnId: "qty",
            value: 800,
            raw: "800",
            row: row("MSFT"),
          },
        ],
        rejected: [
          { rowId: "NVDA", columnId: "last", raw: "1", reason: "not-editable" },
        ],
      }),
    );
    expect([...plan.qtyById]).toEqual([
      ["NVDA", 900],
      ["MSFT", 800],
    ]);
    expect(plan.summary).toEqual({
      applied: 2,
      total: 3,
      rejected: 1,
      clippedRows: 0,
      clippedColumns: 0,
    });
  });

  it("ignores non-qty and non-finite values", () => {
    const plan = planQtyPaste(
      payload({
        cells: [
          {
            rowId: "NVDA",
            columnId: "note",
            value: "hi",
            raw: "hi",
            row: row("NVDA"),
          },
          {
            rowId: "MSFT",
            columnId: "qty",
            value: Number.NaN,
            raw: "x",
            row: row("MSFT"),
          },
        ],
      }),
    );
    expect(plan.qtyById.size).toBe(0);
    expect(plan.summary.applied).toBe(0);
    expect(plan.summary.total).toBe(2);
  });

  it("passes the clipped row and column counts through", () => {
    const plan = planQtyPaste(payload({ clipped: { rows: 3, columns: 2 } }));
    expect(plan.summary.clippedRows).toBe(3);
    expect(plan.summary.clippedColumns).toBe(2);
  });
});
