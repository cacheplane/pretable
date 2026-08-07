import type {
  ColumnFilter,
  PretableColumn,
  PretableRow,
  PretableVisibleRow,
  PretableSortEntry,
} from "./types";
import { evaluateFilter, isFilterActive } from "./evaluate-filter";
import { buildGroupedRows } from "./group-rows";
import { readCellValue, type SourceRow } from "./row-utils";

export {
  collator,
  createSourceRows,
  readCellValue,
  sortRows,
  type SourceRow,
} from "./row-utils";

const NO_OVERRIDES: ReadonlySet<string> = new Set<string>();

/** Input to the full derived-rows pipeline: `filter → group → aggregate → sort → flatten`. */
export interface DeriveVisibleRowsInput<TRow extends PretableRow> {
  columns: PretableColumn<TRow>[];
  filters: Record<string, ColumnFilter>;
  rows: SourceRow<TRow>[];
  sort: PretableSortEntry[];
  /** Grouping columns, outermost first. Omit or pass `[]` for a flat list. */
  rowGroups?: string[];
  /** Group ids whose expanded state differs from `groupsDefaultExpanded`. */
  groupExpansionOverrides?: ReadonlySet<string>;
  /** Expanded state for groups with no override. Default `true`. */
  groupsDefaultExpanded?: boolean;
  /** Fold aggregates over rows the active filter hides. Default `false`. */
  aggregateFilteredRows?: boolean;
}

export function deriveVisibleRows<TRow extends PretableRow>(
  input: DeriveVisibleRowsInput<TRow>,
): PretableVisibleRow<TRow>[] {
  const resolvedFilters = resolveFilters(input.columns, input.filters);
  const filtered = input.rows.filter((entry) =>
    matchesFilters(entry.row, resolvedFilters),
  );

  return buildGroupedRows<TRow>({
    rows: filtered,
    // Only worth carrying the pre-filter set when it can actually differ.
    allRows:
      input.aggregateFilteredRows && filtered.length !== input.rows.length
        ? input.rows
        : undefined,
    columns: input.columns,
    rowGroups: input.rowGroups ?? [],
    sort: input.sort,
    groupExpansionOverrides: input.groupExpansionOverrides ?? NO_OVERRIDES,
    defaultExpanded: input.groupsDefaultExpanded ?? true,
  });
}

interface ResolvedFilter<TRow extends PretableRow> {
  column: PretableColumn<TRow>;
  filter: ColumnFilter;
}

function resolveFilters<TRow extends PretableRow>(
  columns: PretableColumn<TRow>[],
  filters: Record<string, ColumnFilter>,
): ResolvedFilter<TRow>[] {
  const columnMap = new Map(columns.map((c) => [c.id, c]));
  const resolved: ResolvedFilter<TRow>[] = [];

  for (const [columnId, filter] of Object.entries(filters)) {
    if (!filter || !isFilterActive(filter)) continue;
    const column = columnMap.get(columnId);
    if (!column || column.filterable === false) continue;
    resolved.push({ column, filter });
  }

  return resolved;
}

function matchesFilters<TRow extends PretableRow>(
  row: TRow,
  resolvedFilters: ResolvedFilter<TRow>[],
): boolean {
  for (const { column, filter } of resolvedFilters) {
    const cell = readCellValue(row, column);
    if (
      !evaluateFilter(
        cell,
        column.type ?? "text",
        filter.operator,
        filter.value,
      )
    ) {
      return false;
    }
  }

  return true;
}
