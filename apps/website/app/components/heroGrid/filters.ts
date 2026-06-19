import type { ColumnFilter } from "@pretable/core";

export const SECTORS = [
  "All",
  "Technology",
  "Consumer",
  "Health Care",
  "Financials",
  "Energy",
] as const;

export interface FilterState {
  search: string;
  sector: string | null; // null or "All" → no sector filter
}

export function buildFilters(state: FilterState): Record<string, ColumnFilter> {
  const out: Record<string, ColumnFilter> = {};
  const search = state.search.trim();
  if (search) out.symbol = { operator: "contains", value: search };
  if (state.sector && state.sector !== "All") {
    out.sector = { operator: "isAnyOf", value: [state.sector] };
  }
  return out;
}
