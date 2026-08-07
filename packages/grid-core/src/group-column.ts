import type { PretableColumn, PretableRow } from "./types";

/**
 * Id of the synthetic column that carries the group label, twisty and child
 * count for every grouping level.
 *
 * It is *derived*, never stored: `options.columns` remains the consumer's
 * truth, and {@link resolveEffectiveColumns} rebuilds this column on read
 * whenever `rowGroups` is non-empty. The alternative — pushing it into
 * `options.columns` — cannot work, because `mergeColumnsFromProps` rebuilds
 * that array by mapping over the consumer's own array and would delete any
 * column props never mentioned.
 *
 * @public
 */
export const GROUP_COLUMN_ID = "__pretable_group__";

/** Width the group column takes when `groupColumn.widthPx` is not supplied. */
const DEFAULT_GROUP_COLUMN_WIDTH_PX = 200;

/**
 * Configuration for the derived group column.
 *
 * @public
 */
export interface PretableGroupColumnOptions {
  /** Header text. Defaults to the header of the first grouped column. */
  header?: string;
  /** Column width. Defaults to 200. */
  widthPx?: number;
  /**
   * Pin the group column to the left. Unpinned by default — pinning it would
   * silently consume the pinned-left region a consumer may already be using.
   */
  pinned?: "left";
}

/**
 * The column list a renderer should draw, derived from the consumer's columns
 * plus the current grouping levels.
 *
 * Ungrouped, this is the consumer's array *by identity* — no allocation, and
 * no observable change for any grid that never groups. Grouped, the synthetic
 * group column leads the list and the grouped columns drop out of the data
 * area (unless `hideGroupedColumns` is `false`).
 *
 * Pure: the caller is responsible for regrouping the result into the
 * array-order-is-visual-order invariant and for caching it.
 */
export function resolveEffectiveColumns<TRow extends PretableRow>(input: {
  columns: readonly PretableColumn<TRow>[];
  rowGroups: readonly string[];
  groupColumn?: PretableGroupColumnOptions;
  hideGroupedColumns?: boolean;
}): readonly PretableColumn<TRow>[] {
  const { columns, rowGroups, groupColumn, hideGroupedColumns } = input;

  if (rowGroups.length === 0) {
    return columns;
  }

  const grouped = new Set(rowGroups);
  const kept =
    hideGroupedColumns === false
      ? columns
      : columns.filter((column) => !grouped.has(column.id));

  return [makeGroupColumn<TRow>(columns, rowGroups, groupColumn), ...kept];
}

function makeGroupColumn<TRow extends PretableRow>(
  columns: readonly PretableColumn<TRow>[],
  rowGroups: readonly string[],
  groupColumn: PretableGroupColumnOptions | undefined,
): PretableColumn<TRow> {
  const firstLevel = columns.find((column) => column.id === rowGroups[0]);

  const column: PretableColumn<TRow> = {
    id: GROUP_COLUMN_ID,
    header: groupColumn?.header ?? firstLevel?.header ?? "",
    widthPx: groupColumn?.widthPx ?? DEFAULT_GROUP_COLUMN_WIDTH_PX,
    // The group column shows a tree, not a value: sorting or filtering it has
    // no meaning, and both would index into a column that has no `value`.
    sortable: false,
    filterable: false,
  };

  return groupColumn?.pinned === "left"
    ? { ...column, pinned: "left" }
    : column;
}
