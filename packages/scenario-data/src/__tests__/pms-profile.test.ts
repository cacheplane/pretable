import { describe, expect, test } from "vitest";

import {
  buildPmsRows,
  derivePmsRow,
  PMS_SECTORS,
  PMS_STRATEGIES,
  pmsColumns,
} from "../pms-profile";

describe("S8 pms-positions generator", () => {
  test("has 40 named columns, two pinned, notes wrapped, every column typed", () => {
    expect(pmsColumns).toHaveLength(40);
    expect(pmsColumns.slice(0, 2).map((c) => c.pinned)).toEqual(["left", "left"]);
    expect(pmsColumns.filter((c) => c.wrap).map((c) => c.id)).toEqual(["notes"]);
    expect(pmsColumns.every((c) => c.type === "number" || c.type === "text")).toBe(true);
    expect(pmsColumns.filter((c) => c.type === "number")).toHaveLength(30);
  });

  test.each([120, 750, 3_000, 20_000])(
    "%i rows hold exactly 88 strategy×sector groups and every strategy and sector",
    (count) => {
      const rows = buildPmsRows(808, count);
      const pairs = new Set(rows.map((r) => `${r.strategy} ${r.sector}`));
      expect(pairs.size).toBe(88);
      expect(new Set(rows.map((r) => r.strategy)).size).toBe(PMS_STRATEGIES.length);
      expect(new Set(rows.map((r) => r.sector)).size).toBe(PMS_SECTORS.length);
    },
  );

  test("is deterministic per seed and row-stable across scales", () => {
    expect(buildPmsRows(808, 300)).toEqual(buildPmsRows(808, 300));
    expect(buildPmsRows(808, 300)).not.toEqual(buildPmsRows(809, 300));
    // Row i at a small scale is row i at a larger one, so a smoke run
    // looks at the same positions target does.
    expect(buildPmsRows(808, 300)).toEqual(buildPmsRows(808, 3_000).slice(0, 300));
  });

  test("derived columns satisfy their formulas on every generated row", () => {
    for (const row of buildPmsRows(808, 750)) {
      expect(derivePmsRow(row)).toEqual({
        marketValue: row.marketValue,
        unrealizedPnl: row.unrealizedPnl,
        dayPnl: row.dayPnl,
        dayChangePct: row.dayChangePct,
      });
      expect(Number(row.lastPrice)).toBeGreaterThan(0);
      expect(Number(row.quantity)).toBeGreaterThan(0);
    }
  });

  test("tickers are unique and the filter probes hit a strict subset", () => {
    const rows = buildPmsRows(808, 3_000);
    expect(new Set(rows.map((r) => r.ticker)).size).toBe(rows.length);
    expect(PMS_SECTORS).toContain("Technology");
    const earnings = rows.filter((r) => String(r.notes).includes("earnings"));
    expect(earnings.length).toBeGreaterThan(0);
    expect(earnings.length).toBeLessThan(rows.length);
  });
});
