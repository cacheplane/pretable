import { describe, expect, it } from "vitest";
import { makePositionColumns } from "../positionColumns";
import type { PositionRow } from "../types";

const cols = makePositionColumns({ getRows: () => [] });

describe("makePositionColumns", () => {
  it("exposes columns in order incl. the sector column", () => {
    expect(cols.map((c) => c.id)).toEqual([
      "symbol", "sector", "qty", "last", "mktValue", "dayPnl", "weight", "analyst",
    ]);
  });
  it("symbol value carries the company name so search matches both", () => {
    const symbol = cols.find((c) => c.id === "symbol")!;
    const row = { symbol: "NVDA", name: "NVIDIA Corp" } as PositionRow;
    expect(String(symbol.value!(row))).toBe("NVDA NVIDIA Corp");
  });
  it("qty is editable with a numeric parse", () => {
    const qty = cols.find((c) => c.id === "qty")!;
    expect(qty.editable).toBe(true);
    expect(qty.parseEditValue!("1,200", {} as never)).toBe(1200);
  });
  it("qty validate rejects a guardrail breach using live NAV", async () => {
    const rows: PositionRow[] = [
      { id: "NVDA", symbol: "NVDA", name: "NVIDIA Corp", sector: "Technology", qty: 100, last: 10,
        mktValue: 1000, dayPnl: 0, dayPnlPct: 0, weight: 0, analyst: "", flag: "hold" },
      { id: "MSFT", symbol: "MSFT", name: "Microsoft", sector: "Technology", qty: 100, last: 1,
        mktValue: 100, dayPnl: 0, dayPnlPct: 0, weight: 0, analyst: "", flag: "hold" },
    ];
    const qty = makePositionColumns({ getRows: () => rows }).find((c) => c.id === "qty")!;
    const input = { rowId: "NVDA", columnId: "qty", row: rows[0]!, column: qty, value: 100 } as never;
    await expect(qty.validate!(1000, input)).resolves.toMatch(/guardrail/i);
    await expect(qty.validate!(120, input)).resolves.toBe(true);
  });
});
