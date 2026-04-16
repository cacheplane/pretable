import type {
  GridCoreColumn,
  GridCoreOptions,
  GridCoreRow,
  GridCoreRowModel,
  GridCoreSortState,
} from "./types";

interface SourceRow<TRow extends GridCoreRow> {
  id: string;
  row: TRow;
  sourceIndex: number;
}

export function createSourceRows<TRow extends GridCoreRow>(
  options: GridCoreOptions<TRow>,
): SourceRow<TRow>[] {
  return options.rows.map((row, index) => ({
    id: options.getRowId?.(row, index) ?? String(index),
    row,
    sourceIndex: index,
  }));
}

export function deriveVisibleRows<TRow extends GridCoreRow>(input: {
  columns: GridCoreColumn<TRow>[];
  filters: Record<string, string>;
  rows: SourceRow<TRow>[];
  sort: GridCoreSortState;
}): GridCoreRowModel<TRow>[] {
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

interface ResolvedFilter<TRow extends GridCoreRow> {
  column: GridCoreColumn<TRow>;
  needle: string;
}

function resolveFilters<TRow extends GridCoreRow>(
  columns: GridCoreColumn<TRow>[],
  filters: Record<string, string>,
): ResolvedFilter<TRow>[] {
  const columnMap = new Map(columns.map((c) => [c.id, c]));
  const resolved: ResolvedFilter<TRow>[] = [];

  for (const [columnId, rawNeedle] of Object.entries(filters)) {
    if (!rawNeedle) {
      continue;
    }

    const column = columnMap.get(columnId);

    if (!column) {
      continue;
    }

    resolved.push({ column, needle: rawNeedle.toLowerCase() });
  }

  return resolved;
}

function matchesFilters<TRow extends GridCoreRow>(
  row: TRow,
  resolvedFilters: ResolvedFilter<TRow>[],
): boolean {
  for (const { column, needle } of resolvedFilters) {
    const haystack = String(readCellValue(row, column)).toLowerCase();

    if (!haystack.includes(needle)) {
      return false;
    }
  }

  return true;
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function sortRows<TRow extends GridCoreRow>(
  rows: SourceRow<TRow>[],
  columns: GridCoreColumn<TRow>[],
  sort: GridCoreSortState,
): SourceRow<TRow>[] {
  if (!sort.columnId || !sort.direction) {
    return [...rows];
  }

  const column = columns.find((candidate) => candidate.id === sort.columnId);

  if (!column) {
    return [...rows];
  }

  const multiplier = sort.direction === "asc" ? 1 : -1;

  return [...rows].sort((left, right) => {
    const leftValue = readCellValue(left.row, column);
    const rightValue = readCellValue(right.row, column);
    const comparison = compareValues(leftValue, rightValue);

    if (comparison !== 0) {
      return comparison * multiplier;
    }

    return left.sourceIndex - right.sourceIndex;
  });
}

function readCellValue<TRow extends GridCoreRow>(
  row: TRow,
  column: GridCoreColumn<TRow>,
): unknown {
  return column.getValue ? column.getValue(row) : row[column.id];
}

function compareValues(left: unknown, right: unknown): number {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  return collator.compare(String(left ?? ""), String(right ?? ""));
}
