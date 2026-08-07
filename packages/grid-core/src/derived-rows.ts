import type {
  ColumnFilter,
  PretableColumn,
  PretableGridOptions,
  PretableRow,
  PretableVisibleRow,
  PretableSortEntry,
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
  sort: PretableSortEntry[];
}): PretableVisibleRow<TRow>[] {
  const resolvedFilters = resolveFilters(input.columns, input.filters);
  const filtered = input.rows.filter((entry) =>
    matchesFilters(entry.row, resolvedFilters),
  );
  const sorted = sortRows(filtered, input.columns, input.sort);

  return sorted.map(({ id, row, sourceIndex }) => ({
    kind: "data" as const,
    id,
    row,
    sourceIndex,
    depth: 0,
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

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

type SortKey =
  | { kind: "num"; keys: number[]; multiplier: number }
  | { kind: "str"; keys: string[]; multiplier: number };

function sortRows<TRow extends PretableRow>(
  rows: SourceRow<TRow>[],
  columns: PretableColumn<TRow>[],
  sort: PretableSortEntry[],
): SourceRow<TRow>[] {
  // Precompute per-entry key arrays once — preserves the single-key perf shape.
  const keys = sort
    .map((entry): SortKey | null => {
      const column = columns.find((c) => c.id === entry.columnId);
      if (!column) return null;
      const rawKeys = rows.map((r) => readCellValue(r.row, column));
      const allNumeric = rawKeys.every((v) => typeof v === "number");
      const multiplier = entry.direction === "asc" ? 1 : -1;
      return allNumeric
        ? { kind: "num", keys: rawKeys as number[], multiplier }
        : {
            kind: "str",
            keys: rawKeys.map((v) => String(v ?? "")),
            multiplier,
          };
    })
    .filter((k): k is SortKey => k !== null);

  if (keys.length === 0) {
    return [...rows];
  }

  const indexed = rows.map((_, i) => i);
  indexed.sort((a, b) => {
    for (const key of keys) {
      const cmp =
        key.kind === "num"
          ? key.keys[a] - key.keys[b]
          : collator.compare(key.keys[a], key.keys[b]);
      if (cmp !== 0) {
        return cmp * key.multiplier;
      }
    }
    return rows[a].sourceIndex - rows[b].sourceIndex;
  });

  return indexed.map((i) => rows[i]);
}

/**
 * Read a column's value from a row — the single definition used by filtering,
 * sorting, grouping keys and aggregate inputs alike.
 *
 * @internal
 */
export function readCellValue<TRow extends PretableRow>(
  row: TRow,
  column: PretableColumn<TRow>,
): unknown {
  return column.value ? column.value(row) : row[column.id];
}
