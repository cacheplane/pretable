export const SECTORS = [
  "All", "Technology", "Consumer", "Health Care", "Financials", "Energy",
] as const;

export interface FilterState {
  search: string;
  sector: string | null; // null or "All" → no sector filter
}

export function buildFilters(state: FilterState): Record<string, string> {
  const out: Record<string, string> = {};
  const search = state.search.trim();
  if (search) out.symbol = search;
  if (state.sector && state.sector !== "All") out.sector = state.sector;
  return out;
}
