import type {
  PretableRow,
  PretableRowId,
  PretableSortDirection,
  PretableQueryFor,
} from "@pretable/core";
import type { HTMLAttributes } from "react";
import type { PretableTelemetry } from "./surface-types";
import { SortAscIcon, SortDescIcon } from "./icons";

import {
  type PretableSurfaceProps,
  type PretableSurfaceQueryColumns,
  PretableSurface,
} from "./pretable-surface";
import type { PretableColumn } from "./types";

const NO_OPERAND_OPERATORS = new Set(["isEmpty", "isNotEmpty"]);

/** Mirrors `isFilterActive` from the engine: a filter with a usable operand. */
function isColumnFilterActive(filter: {
  readonly operator: string;
  readonly value?: unknown;
}): boolean {
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
  formattedValue: string;
}

/**
 * Props for {@link LabeledGridSurface}.
 *
 * @beta
 */
/** Shared fields for controlled and uncontrolled labeled surfaces. @beta */
export interface LabeledGridSurfaceBaseProps<
  TRow extends PretableRow = PretableRow,
  TRowId extends PretableRowId = TRow extends {
    readonly id: infer TId extends PretableRowId;
  }
    ? TId
    : PretableRowId,
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
  getRowId: (row: TRow) => TRowId;
  locale?: PretableSurfaceProps<TRow, TRowId>["locale"];
  headerCellClassName?: string;
  state?: PretableSurfaceProps<TRow, TRowId>["state"];
  labelClassName?: string;
  overscan?: number;
  onSelectedRowIdChange?: (rowId: TRowId | null) => void;
  onSelectionChange?: PretableSurfaceProps<TRow, TRowId>["onSelectionChange"];
  onFocusChange?: PretableSurfaceProps<TRow, TRowId>["onFocusChange"];
  onColumnWidthsChange?: PretableSurfaceProps<
    TRow,
    TRowId
  >["onColumnWidthsChange"];
  onColumnOrderChange?: PretableSurfaceProps<
    TRow,
    TRowId
  >["onColumnOrderChange"];
  onColumnPinnedChange?: PretableSurfaceProps<
    TRow,
    TRowId
  >["onColumnPinnedChange"];
  onTelemetryChange?: (telemetry: PretableTelemetry<TRowId>) => void;
  pinnedClassName?: string;
  rowClassName?: string;
  rows: TRow[];
  rowSelectionColumn?: PretableSurfaceProps<TRow>["rowSelectionColumn"];
  selectFocusedRowOnArrowKey?: boolean;
  tabBehavior?: PretableSurfaceProps<TRow>["tabBehavior"];
  copyWithHeaders?: PretableSurfaceProps<TRow>["copyWithHeaders"];
  onCopy?: PretableSurfaceProps<TRow, TRowId>["onCopy"];
  copyToClipboard?: PretableSurfaceProps<TRow>["copyToClipboard"];
  messages?: PretableSurfaceProps<TRow>["messages"];
  valueClassName?: string;
  viewportHeight: number;
}

/** Props for {@link LabeledGridSurface}. @beta */
export type LabeledGridSurfaceProps<
  TRow extends PretableRow = PretableRow,
  TRowId extends PretableRowId = TRow extends {
    readonly id: infer TId extends PretableRowId;
  }
    ? TId
    : PretableRowId,
> = LabeledGridSurfaceBaseProps<TRow, TRowId> &
  (
    | {
        query: PretableQueryFor<PretableSurfaceQueryColumns<TRow>>;
        onQueryChange: (
          query: PretableQueryFor<PretableSurfaceQueryColumns<TRow>>,
        ) => void;
      }
    | { query?: never; onQueryChange?: never }
  );

/**
 * Special-purpose surface for label/value-style table layouts. Experimental — shape may change before 1.0.
 *
 * @beta
 */
export function LabeledGridSurface<
  TRow extends PretableRow = PretableRow,
  TRowId extends PretableRowId = TRow extends {
    readonly id: infer TId extends PretableRowId;
  }
    ? TId
    : PretableRowId,
>({
  ariaLabel,
  bodyCellClassName,
  columns,
  formatValue,
  getBodyCellProps,
  getHeaderCellProps,
  getRowId,
  locale,
  headerCellClassName,
  state,
  query,
  onQueryChange,
  labelClassName,
  overscan,
  onSelectedRowIdChange,
  onSelectionChange,
  onFocusChange,
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
}: LabeledGridSurfaceProps<TRow, TRowId>) {
  // `pinned` comes off the engine's column plan, not the `columns` prop — pins
  // set through controlled state, `grid.setColumnPinned` or drag-to-pin never
  // write back to the prop.
  const getPinnedClassName = (pinned: "left" | "right" | null) =>
    pinned != null && pinnedClassName ? pinnedClassName : undefined;
  const activeFilterColumns = new Set(
    (query?.filters ?? [])
      .filter((filter) => isColumnFilterActive(filter))
      .map((filter) => filter.columnId),
  );
  const getFormattedValue = ({
    column,
    formattedValue,
    row,
    value,
  }: LabeledGridSurfaceFormatValueInput<TRow>) =>
    formatValue
      ? formatValue({ column, formattedValue, row, value })
      : formattedValue;
  const controlledQueryProps:
    | {
        query: PretableQueryFor<PretableSurfaceQueryColumns<TRow>>;
        onQueryChange: (
          next: PretableQueryFor<PretableSurfaceQueryColumns<TRow>>,
        ) => void;
      }
    | { query?: never; onQueryChange?: never } =
    query === undefined ? {} : { query, onQueryChange: onQueryChange! };

  return (
    <PretableSurface<TRow, TRowId>
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
      locale={locale}
      state={state}
      {...controlledQueryProps}
      overscan={overscan}
      onSelectedRowIdChange={onSelectedRowIdChange}
      onSelectionChange={onSelectionChange}
      onFocusChange={onFocusChange}
      onColumnWidthsChange={onColumnWidthsChange}
      onColumnOrderChange={onColumnOrderChange}
      onColumnPinnedChange={onColumnPinnedChange}
      onTelemetryChange={onTelemetryChange}
      renderBodyCell={({ column, formattedValue, row, value }) => (
        <>
          <span className={labelClassName}>{column.header ?? column.id}</span>
          <span className={valueClassName}>
            {getFormattedValue({
              column,
              formattedValue,
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
