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
    expect(pmsColumns.slice(0, 2).map((c) => c.pinned)).toEqual([
      "left",
      "left",
    ]);
    expect(pmsColumns.filter((c) => c.wrap).map((c) => c.id)).toEqual([
      "notes",
    ]);
    expect(
      pmsColumns.every((c) => c.type === "number" || c.type === "text"),
    ).toBe(true);
    expect(pmsColumns.filter((c) => c.type === "number")).toHaveLength(30);
  });

  test.each([120, 750, 3_000, 20_000])(
    "%i rows hold exactly 88 strategy×sector groups and every strategy and sector",
    (count) => {
      const rows = buildPmsRows(808, count);
      const pairs = new Set(rows.map((r) => `${r.strategy} ${r.sector}`));
      expect(pairs.size).toBe(88);
      expect(new Set(rows.map((r) => r.strategy)).size).toBe(
        PMS_STRATEGIES.length,
      );
      expect(new Set(rows.map((r) => r.sector)).size).toBe(PMS_SECTORS.length);
    },
  );

  test("is deterministic per seed and row-stable across scales", () => {
    expect(buildPmsRows(808, 300)).toEqual(buildPmsRows(808, 300));
    expect(buildPmsRows(808, 300)).not.toEqual(buildPmsRows(809, 300));
    // Row i at a small scale is row i at a larger one, so a smoke run
    // looks at the same positions target does.
    expect(buildPmsRows(808, 300)).toEqual(
      buildPmsRows(808, 3_000).slice(0, 300),
    );
  });

  test("derivePmsRow computes the four ripple columns from primitives", () => {
    const row = {
      id: "x",
      quantity: 100,
      lastPrice: 10.5,
      prevClose: 10,
      avgCost: 9.123,
    };
    expect(derivePmsRow(row)).toEqual({
      marketValue: 1050,
      unrealizedPnl: 137.7, // 1050 - round2(100 * 9.123) = 1050 - 912.3
      dayPnl: 50,
      dayChangePct: 5,
    });
    // Rounding precision is part of the contract: 2 dp for money, 4 dp for the percent.
    expect(
      derivePmsRow({
        id: "y",
        quantity: 3,
        lastPrice: 1.005,
        prevClose: 1.003,
        avgCost: 1,
      }),
    ).toEqual({
      marketValue: 3.01, // round2(3.015) -> 3.01
      unrealizedPnl: 0.01, // round2(3.01 - round2(3)) = round2(0.01)
      dayPnl: 0.01, // round2(3 * 0.002) = round2(0.006)
      dayChangePct: 0.1994, // round4((0.002 / 1.003) * 100)
    });
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

  test("leaf groups are uniform in size, so grouped numbers measure rows not skew", () => {
    const rows = buildPmsRows(808, 20_000);
    const sizes = new Map<string, number>();
    for (const r of rows) {
      const key = `${r.strategy} ${r.sector}`;
      sizes.set(key, (sizes.get(key) ?? 0) + 1);
    }
    const counts = [...sizes.values()];
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    // Pins the assignment formula at the strategy wrap boundary.
    expect(rows[7]!.sector).toBe(rows[0]!.sector);
    expect(rows[8]!.sector).not.toBe(rows[0]!.sector);
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
