import type { RaceRow } from "./types";

const STATUS_TIER: Record<RaceRow["status"], number> = {
  finished: 0,
  running: 1,
  DNF: 2,
  DSQ: 2,
  dns: 3,
};

function bibValue(bib: RaceRow["bib"]): number {
  return typeof bib === "number" ? bib : Number.POSITIVE_INFINITY;
}

function deltaValue(delta: string): number {
  if (delta === "LEADER") return Number.NEGATIVE_INFINITY;
  if (delta === "") return Number.POSITIVE_INFINITY;
  const n = parseFloat(delta);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

function gateProgress(row: RaceRow): { count: number; latest: string } {
  const gates = [row.gate1, row.gate2, row.gate3, row.finish];
  let count = 0;
  let latest = "";
  for (const g of gates) {
    if (g !== "") {
      count++;
      latest = g;
    }
  }
  return { count, latest };
}

function compareWithinTier(a: RaceRow, b: RaceRow): number {
  const tier = STATUS_TIER[a.status];
  if (tier === 0) {
    // finished: by delta numeric asc (LEADER = -Infinity)
    const d = deltaValue(a.delta) - deltaValue(b.delta);
    if (d !== 0) return d;
    return bibValue(a.bib) - bibValue(b.bib);
  }
  if (tier === 1) {
    // running: gate progress desc, latest gate time asc, bib asc
    const ap = gateProgress(a);
    const bp = gateProgress(b);
    if (ap.count !== bp.count) return bp.count - ap.count;
    if (ap.latest !== bp.latest) {
      if (ap.latest === "") return 1;
      if (bp.latest === "") return -1;
      return ap.latest < bp.latest ? -1 : 1;
    }
    return bibValue(a.bib) - bibValue(b.bib);
  }
  if (tier === 2) {
    // DNF/DSQ: keep original order via stable sort; tie-break bib asc
    return bibValue(a.bib) - bibValue(b.bib);
  }
  // dns: bib asc
  return bibValue(a.bib) - bibValue(b.bib);
}

export function rankRows(rows: readonly RaceRow[]): RaceRow[] {
  return [...rows].sort((a, b) => {
    const ta = STATUS_TIER[a.status];
    const tb = STATUS_TIER[b.status];
    if (ta !== tb) return ta - tb;
    return compareWithinTier(a, b);
  });
}
