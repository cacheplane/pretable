import type {
  ColumnFilter,
  PretableColumn,
  PretableGridOptions,
  PretableRow,
  PretableVisibleRow,
  PretableSortState,
} from "./types";
import { evaluateFilter, isFilterActive } from "./evaluate-filter";

export interface SourceRow<TRow extends PretableRow> {
  id: string;
  row: TRow;
  sourceIndex: number;
}

export function createSourceRows<TRow extends PretableRow>(
  options: PretableGridOptions<TRow>,
): SourceRow<TRow>[] {
  return options.rows.map((row, index) => ({
    id: options.getRowId?.(row, index) ?? String(index),
    row,
    sourceIndex: index,
  }));
}

export function deriveVisibleRows<TRow extends PretableRow>(input: {
  columns: PretableColumn<TRow>[];
  filters: Record<string, ColumnFilter>;
  rows: SourceRow<TRow>[];
  sort: PretableSortState;
}): PretableVisibleRow<TRow>[] {
  const resolvedFilters = resolveFilters(input.columns, input.filters);
  const filtered = input.rows.filter((entry) =>
    matchesFilters(entry.row, resolvedFilters),
  );
  const sorted = sortRows(filtered, input.columns, input.sort);

  return sorted.map(({ id, row, sourceIndex }) => ({
    id,
    row,
    sourceIndex,
  }));
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
        column.filterType ?? "text",
        filter.operator,
        filter.value,
      )
    ) {
      return false;
    }
  }

  return true;
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function sortRows<TRow extends PretableRow>(
  rows: SourceRow<TRow>[],
  columns: PretableColumn<TRow>[],
  sort: PretableSortState,
): SourceRow<TRow>[] {
  if (!sort.columnId || !sort.direction) {
    return [...rows];
  }

  const column = columns.find((candidate) => candidate.id === sort.columnId);

  if (!column) {
    return [...rows];
  }

  const multiplier = sort.direction === "asc" ? 1 : -1;
  const rawKeys = rows.map((entry) => readCellValue(entry.row, column));
  const allNumeric = rawKeys.every((v) => typeof v === "number");

  if (allNumeric) {
    const numKeys = rawKeys as number[];
    const indexed = rows.map((_, i) => i);

    indexed.sort((a, b) => {
      const diff = numKeys[a] - numKeys[b];
      return diff !== 0
        ? diff * multiplier
        : rows[a].sourceIndex - rows[b].sourceIndex;
    });

    return indexed.map((i) => rows[i]);
  }

  const strKeys = rawKeys.map((v) => String(v ?? ""));
  const indexed = rows.map((_, i) => i);

  indexed.sort((a, b) => {
    const comparison = collator.compare(strKeys[a], strKeys[b]);
    return comparison !== 0
      ? comparison * multiplier
      : rows[a].sourceIndex - rows[b].sourceIndex;
  });

  return indexed.map((i) => rows[i]);
}

function readCellValue<TRow extends PretableRow>(
  row: TRow,
  column: PretableColumn<TRow>,
): unknown {
  return column.value ? column.value(row) : row[column.id];
}
