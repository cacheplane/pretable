import type { RaceRow } from "./types";

export type ColumnId =
  | "bib"
  | "racer"
  | "gate1"
  | "gate2"
  | "gate3"
  | "finish"
  | "delta"
  | "status"
  | "notes";

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

// Precondition: a and b are in the same tier (caller ensures via STATUS_TIER check).
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
      return ap.latest < bp.latest ? -1 : 1; // safe: times are zero-padded MM:SS.ss so lexicographic order equals numeric order
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

export type SortDirection = "asc" | "desc";

export interface SortState {
  columnId: ColumnId;
  direction: SortDirection;
}

const STATUS_USER_RANK: Record<RaceRow["status"], number> = {
  finished: 0,
  running: 1,
  DNF: 2,
  DSQ: 3,
  dns: 4,
};

function assertNever(x: never): never {
  throw new Error(`Unexpected column id: ${String(x)}`);
}

/**
 * Returns a sink value if either row has an empty value for this column:
 *   0  — both empty (equal)
 *   1  — a is empty (a sinks below b)
 *  -1  — b is empty (b sinks below a)
 *  null — neither is empty; caller should proceed to compare
 *
 * Only gate1, gate2, gate3, finish, and notes are subject to empty-sinking.
 * bib uses +Infinity for "—" so numeric sort already handles it.
 * delta uses +Infinity/-Infinity so numeric sort already handles it.
 */
function getEmptySink(a: RaceRow, b: RaceRow, columnId: ColumnId): number | null {
  if (
    columnId === "gate1" ||
    columnId === "gate2" ||
    columnId === "gate3" ||
    columnId === "finish" ||
    columnId === "notes"
  ) {
    const av = a[columnId] as string;
    const bv = b[columnId] as string;
    if (av === "" && bv === "") return 0;
    if (av === "") return 1;
    if (bv === "") return -1;
  }
  return null;
}

function compareByColumn(
  a: RaceRow,
  b: RaceRow,
  columnId: ColumnId,
): number {
  switch (columnId) {
    case "bib":
      return bibValue(a.bib) - bibValue(b.bib);
    case "racer":
      return a.racer.localeCompare(b.racer);
    case "gate1":
    case "gate2":
    case "gate3":
    case "finish": {
      // Precondition: both values are non-empty (getEmptySink handled the empty cases)
      const av = a[columnId];
      const bv = b[columnId];
      return av < bv ? -1 : av > bv ? 1 : 0;
    }
    case "delta":
      return deltaValue(a.delta) - deltaValue(b.delta);
    case "status":
      return STATUS_USER_RANK[a.status] - STATUS_USER_RANK[b.status];
    case "notes":
      // Precondition: both values are non-empty (getEmptySink handled the empty cases)
      return a.notes.localeCompare(b.notes);
    default:
      return assertNever(columnId);
  }
}

export function applySort(
  rows: readonly RaceRow[],
  sort: SortState | null,
): RaceRow[] {
  if (sort === null) return rankRows(rows);
  const sign = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const sink = getEmptySink(a, b, sort.columnId);
    if (sink !== null) return sink;
    return sign * compareByColumn(a, b, sort.columnId);
  });
}
