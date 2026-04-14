import type {
  PretableColumn,
  PretableGridOptions,
  PretableRow,
} from "@pretable/core";
import type { HTMLAttributes } from "react";

import {
  type PretableSurfaceProps,
  PretableSurface,
} from "./pretable-surface";

export interface LabeledGridSurfaceFormatValueInput<
  TRow extends PretableRow = PretableRow,
> {
  column: PretableColumn<TRow>;
  row: TRow;
  value: unknown;
}

export interface LabeledGridSurfaceProps<
  TRow extends PretableRow = PretableRow,
> {
  ariaLabel: string;
  bodyCellClassName?: string;
  columns: PretableColumn<TRow>[];
  formatValue?: (input: LabeledGridSurfaceFormatValueInput<TRow>) => string;
  getRowId?: PretableGridOptions<TRow>["getRowId"];
  headerCellClassName?: string;
  labelClassName?: string;
  overscan?: number;
  pinnedClassName?: string;
  rowClassName?: string;
  rows: TRow[];
  selectFocusedRowOnArrowKey?: boolean;
  valueClassName?: string;
  viewportHeight: number;
}

export function LabeledGridSurface<TRow extends PretableRow = PretableRow>({
  ariaLabel,
  bodyCellClassName,
  columns,
  formatValue,
  getRowId,
  headerCellClassName,
  labelClassName,
  overscan,
  pinnedClassName,
  rowClassName,
  rows,
  selectFocusedRowOnArrowKey,
  valueClassName,
  viewportHeight,
}: LabeledGridSurfaceProps<TRow>) {
  const getPinnedClassName = (column: PretableColumn<TRow>) =>
    column.pinned === "left" && pinnedClassName ? pinnedClassName : undefined;
  const getFormattedValue = ({
    column,
    row,
    value,
  }: LabeledGridSurfaceFormatValueInput<TRow>) =>
    formatValue ? formatValue({ column, row, value }) : formatDefaultValue(value);

  return (
    <PretableSurface
      ariaLabel={ariaLabel}
      columns={columns}
      getBodyCellClassName={({ column }) =>
        joinClassNames(bodyCellClassName, getPinnedClassName(column))
      }
      getBodyCellProps={({ column }) =>
        column.pinned === "left"
          ? ({
              "data-pinned": "left",
            } as HTMLAttributes<HTMLDivElement>)
          : undefined
      }
      getHeaderCellClassName={({ column }) =>
        joinClassNames(headerCellClassName, getPinnedClassName(column))
      }
      getHeaderCellProps={({ column }) =>
        column.pinned === "left"
          ? ({
              "data-pinned": "left",
            } as HTMLAttributes<HTMLButtonElement>)
          : undefined
      }
      getRowClassName={() => rowClassName}
      getRowId={getRowId}
      overscan={overscan}
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
          <strong>{getSortLabel(sortDirection)}</strong>
        </>
      )}
      rows={rows}
      selectFocusedRowOnArrowKey={selectFocusedRowOnArrowKey}
      viewportHeight={viewportHeight}
    />
  );
}

function joinClassNames(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(" ") || undefined;
}

function getSortLabel(sortDirection: PretableSurfaceSortDirection) {
  if (sortDirection === "desc") {
    return "Newest";
  }

  if (sortDirection === "asc") {
    return "Oldest";
  }

  return "Sort";
}

function formatDefaultValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.join(", ");
  }

  return String(value ?? "");
}

type PretableSurfaceSortDirection = NonNullable<
  Parameters<NonNullable<PretableSurfaceProps["renderHeaderCell"]>>[0]["sortDirection"]
> | null;
