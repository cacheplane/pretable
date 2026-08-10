import type {
  ColumnFilter,
  PretableColumn,
  PretableRow,
  PretableVisibleRow,
  PretableSortEntry,
} from "./types";
import { evaluateFilter, isFilterActive } from "./evaluate-filter";
import {
  buildGroupModel,
  flattenGroupModel,
  type GroupedRowModel,
} from "./group-rows";
import { readCellValue, type SourceRow } from "./row-utils";

export {
  assertGetRowId,
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
  filters: Readonly<Record<string, ColumnFilter>>;
  rows: SourceRow<TRow>[];
  sort: readonly PretableSortEntry[];
  /** Grouping columns, outermost first. Omit or pass `[]` for a flat list. */
  rowGroups?: string[];
  /** Group ids whose expanded state differs from `groupsDefaultExpanded`. */
  groupExpansionOverrides?: ReadonlySet<string>;
  /** Expanded state for groups with no override. Default `true`. */
  groupsDefaultExpanded?: boolean;
  /** Fold aggregates over rows the active filter hides. Default `false`. */
  aggregateFilteredRows?: boolean;
}

/** Output of the pipeline: the flat visible model plus the count behind it. */
export interface DeriveVisibleRowsResult<TRow extends PretableRow> {
  rows: PretableVisibleRow<TRow>[];
  /**
   * How many source rows survived the filter pass — post-filter, pre-grouping.
   * Deliberately reported here rather than recomputed: it is not derivable from
   * `rows` (group synthesis adds header rows and collapsed branches hide their
   * children), and a second filter pass would double the pipeline's cost.
   */
  filteredCount: number;
}

/**
 * The half of the pipeline that expansion state cannot reach: `filter → group →
 * aggregate`. Everything an expand/collapse changes lives in
 * `flattenDerivedRowModel`, so a caller that holds one of these across toggles
 * pays only the flatten.
 *
 * Note the input type: it is `DeriveVisibleRowsInput` minus the two expansion
 * fields, which is the type-level statement of that claim — this function
 * cannot read them because it is not given them.
 */
export interface DerivedRowModel<TRow extends PretableRow> {
  readonly groups: GroupedRowModel<TRow>;
  /** See `DeriveVisibleRowsResult.filteredCount`. */
  readonly filteredCount: number;
}

export type BuildDerivedRowModelInput<TRow extends PretableRow> = Omit<
  DeriveVisibleRowsInput<TRow>,
  "groupExpansionOverrides" | "groupsDefaultExpanded"
>;

export function buildDerivedRowModel<TRow extends PretableRow>(
  input: BuildDerivedRowModelInput<TRow>,
): DerivedRowModel<TRow> {
  const resolvedFilters = resolveFilters(input.columns, input.filters);
  const filtered = input.rows.filter((entry) =>
    matchesFilters(entry.row, resolvedFilters),
  );

  return {
    groups: buildGroupModel<TRow>({
      rows: filtered,
      // Only worth carrying the pre-filter set when it can actually differ.
      // Equal lengths mean the filter removed nothing, so `filtered` is a copy
      // of `input.rows` in the same order and the two sort identically —
      // `buildGroupModel` sorts whichever it folds over, so skipping here does
      // not change the fold order.
      allRows:
        input.aggregateFilteredRows && filtered.length !== input.rows.length
          ? input.rows
          : undefined,
      columns: input.columns,
      rowGroups: input.rowGroups ?? [],
      sort: input.sort,
    }),
    filteredCount: filtered.length,
  };
}

export function flattenDerivedRowModel<TRow extends PretableRow>(
  model: DerivedRowModel<TRow>,
  groupExpansionOverrides: ReadonlySet<string> | undefined,
  groupsDefaultExpanded: boolean | undefined,
): DeriveVisibleRowsResult<TRow> {
  return {
    rows: flattenGroupModel<TRow>(
      model.groups,
      groupExpansionOverrides ?? NO_OVERRIDES,
      groupsDefaultExpanded ?? true,
    ),
    filteredCount: model.filteredCount,
  };
}

export function deriveVisibleRows<TRow extends PretableRow>(
  input: DeriveVisibleRowsInput<TRow>,
): DeriveVisibleRowsResult<TRow> {
  return flattenDerivedRowModel(
    buildDerivedRowModel(input),
    input.groupExpansionOverrides,
    input.groupsDefaultExpanded,
  );
}

interface ResolvedFilter<TRow extends PretableRow> {
  column: PretableColumn<TRow>;
  filter: ColumnFilter;
}

function resolveFilters<TRow extends PretableRow>(
  columns: PretableColumn<TRow>[],
  filters: Readonly<Record<string, ColumnFilter>>,
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
