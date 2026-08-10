import type {
  ColumnFilter,
  PretableGridOptions,
  PretableRow,
  PretableSortDirection,
} from "@pretable/core";
import type { HTMLAttributes } from "react";
import type { PretableTelemetry } from "./use-pretable";

import { type PretableSurfaceProps, PretableSurface } from "./pretable-surface";
import type { PretableColumn } from "./types";
import { SortAscIcon, SortDescIcon } from "./icons";

const NO_OPERAND_OPERATORS = new Set(["isEmpty", "isNotEmpty"]);

/** Mirrors `isFilterActive` from the engine: a filter with a usable operand. */
function isColumnFilterActive(filter: ColumnFilter): boolean {
  const { operator, value } = filter;
  if (NO_OPERAND_OPERATORS.has(operator)) return true;
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true; // number
}

/**
 * Input passed to a {@link LabeledGridSurface} format function.
 *
 * @beta
 */
export interface LabeledGridSurfaceFormatValueInput<
  TRow extends PretableRow = PretableRow,
> {
  column: PretableColumn<TRow>;
  row: TRow;
  value: unknown;
}

/**
 * Props for {@link LabeledGridSurface}.
 *
 * @beta
 */
export interface LabeledGridSurfaceProps<
  TRow extends PretableRow = PretableRow,
> {
  ariaLabel: string;
  bodyCellClassName?: string;
  columns: PretableColumn<TRow>[];
  formatValue?: (input: LabeledGridSurfaceFormatValueInput<TRow>) => string;
  getBodyCellProps?: (
    input: LabeledGridSurfaceFormatValueInput<TRow>,
  ) => HTMLAttributes<HTMLDivElement> | undefined;
  getHeaderCellProps?: (input: {
    column: PretableColumn<TRow>;
    sortDirection: PretableSortDirection;
  }) => HTMLAttributes<HTMLButtonElement> | undefined;
  /**
   * Stable identity for a row, derived from the row's own data. Required — see
   * {@link PretableGridOptions.getRowId}. There is no positional default at any
   * pretable entry point.
   */
  getRowId: PretableGridOptions<TRow>["getRowId"];
  headerCellClassName?: string;
  state?: PretableSurfaceProps<TRow>["state"];
  labelClassName?: string;
  overscan?: number;
  onSelectedRowIdChange?: (rowId: string | null) => void;
  onSelectionChange?: PretableSurfaceProps<TRow>["onSelectionChange"];
  onFocusChange?: PretableSurfaceProps<TRow>["onFocusChange"];
  onSortChange?: PretableSurfaceProps<TRow>["onSortChange"];
  onColumnWidthsChange?: PretableSurfaceProps<TRow>["onColumnWidthsChange"];
  onColumnOrderChange?: PretableSurfaceProps<TRow>["onColumnOrderChange"];
  onColumnPinnedChange?: PretableSurfaceProps<TRow>["onColumnPinnedChange"];
  onTelemetryChange?: (telemetry: PretableTelemetry) => void;
  pinnedClassName?: string;
  rowClassName?: string;
  rows: TRow[];
  rowSelectionColumn?: PretableSurfaceProps<TRow>["rowSelectionColumn"];
  selectFocusedRowOnArrowKey?: boolean;
  tabBehavior?: PretableSurfaceProps<TRow>["tabBehavior"];
  copyWithHeaders?: PretableSurfaceProps<TRow>["copyWithHeaders"];
  onCopy?: PretableSurfaceProps<TRow>["onCopy"];
  copyToClipboard?: PretableSurfaceProps<TRow>["copyToClipboard"];
  messages?: PretableSurfaceProps<TRow>["messages"];
  valueClassName?: string;
  viewportHeight: number;
}

/**
 * Special-purpose surface for label/value-style table layouts. Experimental — shape may change before 1.0.
 *
 * @beta
 */
export function LabeledGridSurface<TRow extends PretableRow = PretableRow>({
  ariaLabel,
  bodyCellClassName,
  columns,
  formatValue,
  getBodyCellProps,
  getHeaderCellProps,
  getRowId,
  headerCellClassName,
  state,
  labelClassName,
  overscan,
  onSelectedRowIdChange,
  onSelectionChange,
  onFocusChange,
  onSortChange,
  onColumnWidthsChange,
  onColumnOrderChange,
  onColumnPinnedChange,
  onTelemetryChange,
  pinnedClassName,
  rowClassName,
  rows,
  rowSelectionColumn,
  selectFocusedRowOnArrowKey,
  tabBehavior,
  copyWithHeaders,
  onCopy,
  copyToClipboard,
  messages,
  valueClassName,
  viewportHeight,
}: LabeledGridSurfaceProps<TRow>) {
  // `pinned` comes off the engine's column plan, not the `columns` prop — pins
  // set through controlled state, `grid.setColumnPinned` or drag-to-pin never
  // write back to the prop.
  const getPinnedClassName = (pinned: "left" | "right" | null) =>
    pinned != null && pinnedClassName ? pinnedClassName : undefined;
  const activeFilterColumns = new Set(
    Object.entries(state?.filters ?? {})
      .filter(([, filter]) => isColumnFilterActive(filter))
      .map(([columnId]) => columnId),
  );
  const getFormattedValue = ({
    column,
    row,
    value,
  }: LabeledGridSurfaceFormatValueInput<TRow>) =>
    formatValue
      ? formatValue({ column, row, value })
      : formatDefaultValue(value);

  return (
    <PretableSurface
      ariaLabel={ariaLabel}
      columns={columns}
      getBodyCellClassName={({ pinned }) =>
        joinClassNames(bodyCellClassName, getPinnedClassName(pinned))
      }
      getBodyCellProps={getBodyCellProps}
      getHeaderCellClassName={({ column, pinned }) =>
        joinClassNames(
          headerCellClassName,
          getPinnedClassName(pinned),
          activeFilterColumns.has(column.id) ? "is-filtered" : undefined,
        )
      }
      getHeaderCellProps={getHeaderCellProps}
      getRowClassName={() => rowClassName}
      getRowId={getRowId}
      state={state}
      overscan={overscan}
      onSelectedRowIdChange={onSelectedRowIdChange}
      onSelectionChange={onSelectionChange}
      onFocusChange={onFocusChange}
      onSortChange={onSortChange}
      onColumnWidthsChange={onColumnWidthsChange}
      onColumnOrderChange={onColumnOrderChange}
      onColumnPinnedChange={onColumnPinnedChange}
      onTelemetryChange={onTelemetryChange}
      renderBodyCell={({ column, row, value }) => (
        <>
          <span className={labelClassName}>{column.header ?? column.id}</span>
          <span className={valueClassName}>
            {getFormattedValue({
              column,
              row,
              value,
            })}
          </span>
        </>
      )}
      renderHeaderCell={({ label, sortDirection }) => (
        <>
          <span>{label}</span>
          {sortDirection ? (
            <span className="sort-indicator">
              {sortDirection === "desc" ? <SortDescIcon /> : <SortAscIcon />}
            </span>
          ) : null}
        </>
      )}
      rows={rows}
      rowSelectionColumn={rowSelectionColumn}
      selectFocusedRowOnArrowKey={selectFocusedRowOnArrowKey}
      tabBehavior={tabBehavior}
      copyWithHeaders={copyWithHeaders}
      onCopy={onCopy}
      copyToClipboard={copyToClipboard}
      messages={messages}
      viewportHeight={viewportHeight}
    />
  );
}

function joinClassNames(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(" ") || undefined;
}

function formatDefaultValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.join(", ");
  }

  return String(value ?? "");
}
