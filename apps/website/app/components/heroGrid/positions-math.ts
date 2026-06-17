import type { PositionRow } from "./types";

export function computeNav(rows: readonly PositionRow[]): number {
  return rows.reduce((sum, r) => sum + r.mktValue, 0);
}

/** Return rows with `weight` derived from each mktValue against total NAV (percent, 1 dp). */
export function withDerivedWeights(
  rows: readonly PositionRow[],
): PositionRow[] {
  const nav = computeNav(rows);
  return rows.map((r) => {
    const weight = nav > 0 ? Number(((r.mktValue / nav) * 100).toFixed(1)) : 0;
    return weight === r.weight ? r : { ...r, weight };
  });
}
