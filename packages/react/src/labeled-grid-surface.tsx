import type {
  PretableGridOptions,
  PretableRow,
  PretableSortDirection,
} from "@pretable/core";
import type { HTMLAttributes } from "react";
import type { PretableTelemetry } from "./use-pretable";

import { type PretableSurfaceProps, PretableSurface } from "./pretable-surface";
import type { PretableColumn } from "./types";

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
  getRowId?: PretableGridOptions<TRow>["getRowId"];
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
  const getPinnedClassName = (column: PretableColumn<TRow>) =>
    column.pinned === "left" && pinnedClassName ? pinnedClassName : undefined;
  const activeFilterColumns = new Set(
    Object.entries(state?.filters ?? {})
      .filter(([, value]) => value.trim() !== "")
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
      getBodyCellClassName={({ column }) =>
        joinClassNames(bodyCellClassName, getPinnedClassName(column))
      }
      getBodyCellProps={(input) =>
        mergeProps(
          input.column.pinned === "left"
            ? ({
                "data-pinned": "left",
              } as HTMLAttributes<HTMLDivElement>)
            : undefined,
          getBodyCellProps?.(input),
        )
      }
      getHeaderCellClassName={({ column }) =>
        joinClassNames(
          headerCellClassName,
          getPinnedClassName(column),
          activeFilterColumns.has(column.id) ? "is-filtered" : undefined,
        )
      }
      getHeaderCellProps={(input) =>
        mergeProps(
          input.column.pinned === "left"
            ? ({
                "data-pinned": "left",
              } as HTMLAttributes<HTMLButtonElement>)
            : undefined,
          getHeaderCellProps?.(input),
        )
      }
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
              {sortDirection === "desc" ? "▼" : "▲"}
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

function mergeProps<T extends HTMLAttributes<HTMLElement>>(
  base: T | undefined,
  extra: T | undefined,
) {
  if (!base) {
    return extra;
  }

  if (!extra) {
    return base;
  }

  return {
    ...base,
    ...extra,
  };
}

function formatDefaultValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.join(", ");
  }

  return String(value ?? "");
}
