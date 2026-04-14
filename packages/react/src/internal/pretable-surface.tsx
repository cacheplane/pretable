import {
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  useMemo,
  useState,
} from "react";
import type {
  PretableColumn,
  PretableGridOptions,
  PretableRow,
} from "@pretable/core";

import { measureRenderedRowHeight } from "../row-height";
import { usePretableModel } from "../use-pretable";
import {
  DEFAULT_ROW_HEIGHT,
  formatCellValue,
  getColumnWidth,
  getNextSortDirection,
  getPinnedLeftOffsets,
  resolveCellValue,
} from "./rendering";
import {
  getHeaderRowStyle,
  getPinnedCellStyle,
  getRowStyle,
  getScrollContentStyle,
  getViewportStyle,
} from "./styles";

interface PretableSurfaceHeaderCellRenderInput<
  TRow extends PretableRow = PretableRow,
> {
  column: PretableColumn<TRow>;
  label: string;
  sortDirection: "asc" | "desc" | null;
}

interface PretableSurfaceBodyCellRenderInput<
  TRow extends PretableRow = PretableRow,
> {
  column: PretableColumn<TRow>;
  isFocused: boolean;
  isSelected: boolean;
  row: TRow;
  rowId: string;
  rowIndex: number;
  value: unknown;
}

interface PretableSurfaceRowClassNameInput<
  TRow extends PretableRow = PretableRow,
> {
  isFocused: boolean;
  isSelected: boolean;
  row: TRow;
  rowId: string;
  rowIndex: number;
}

interface PretableSurfaceHeaderClassNameInput<
  TRow extends PretableRow = PretableRow,
> {
  column: PretableColumn<TRow>;
  sortDirection: "asc" | "desc" | null;
}

type PretableSurfaceBodyCellClassNameInput<
  TRow extends PretableRow = PretableRow,
> = PretableSurfaceBodyCellRenderInput<TRow>;

type PretableSurfaceHeaderAttributesInput<
  TRow extends PretableRow = PretableRow,
> = PretableSurfaceHeaderClassNameInput<TRow>;

type PretableSurfaceBodyAttributesInput<
  TRow extends PretableRow = PretableRow,
> = PretableSurfaceBodyCellRenderInput<TRow>;

interface PretableSurfaceRowAttributesInput<
  TRow extends PretableRow = PretableRow,
> {
  isFocused: boolean;
  isSelected: boolean;
  row: TRow;
  rowId: string;
  rowIndex: number;
}

export interface PretableSurfaceProps<
  TRow extends PretableRow = PretableRow,
> {
  ariaLabel: string;
  columns: PretableColumn<TRow>[];
  getBodyCellClassName?: (
    input: PretableSurfaceBodyCellClassNameInput<TRow>,
  ) => string | undefined;
  getBodyCellProps?: (
    input: PretableSurfaceBodyAttributesInput<TRow>,
  ) => HTMLAttributes<HTMLDivElement> | undefined;
  getHeaderCellClassName?: (
    input: PretableSurfaceHeaderClassNameInput<TRow>,
  ) => string | undefined;
  getHeaderCellProps?: (
    input: PretableSurfaceHeaderAttributesInput<TRow>,
  ) => HTMLAttributes<HTMLButtonElement> | undefined;
  getRowClassName?: (
    input: PretableSurfaceRowClassNameInput<TRow>,
  ) => string | undefined;
  getRowId?: PretableGridOptions<TRow>["getRowId"];
  getRowProps?: (
    input: PretableSurfaceRowAttributesInput<TRow>,
  ) => HTMLAttributes<HTMLDivElement> | undefined;
  overscan?: number;
  onSelectedRowIdChange?: (rowId: string | null) => void;
  renderBodyCell?: (
    input: PretableSurfaceBodyCellRenderInput<TRow>,
  ) => ReactNode;
  renderHeaderCell?: (
    input: PretableSurfaceHeaderCellRenderInput<TRow>,
  ) => ReactNode;
  rows: TRow[];
  selectFocusedRowOnArrowKey?: boolean;
  viewportStyle?: CSSProperties;
  viewportHeight: number;
}

export function PretableSurface<TRow extends PretableRow = PretableRow>({
  ariaLabel,
  columns,
  getBodyCellClassName,
  getBodyCellProps,
  getHeaderCellClassName,
  getHeaderCellProps,
  getRowClassName,
  getRowId,
  getRowProps,
  overscan = 6,
  onSelectedRowIdChange,
  renderBodyCell,
  renderHeaderCell,
  rows,
  selectFocusedRowOnArrowKey = false,
  viewportStyle,
  viewportHeight,
}: PretableSurfaceProps<TRow>) {
  const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>(
    {},
  );
  const { grid, snapshot, renderSnapshot } = usePretableModel({
    columns,
    getRowId,
    measuredHeights,
    overscan,
    rows,
    viewportHeight,
  });
  const pinnedOffsets = useMemo(() => getPinnedLeftOffsets(columns), [columns]);
  const templateColumns = useMemo(
    () => columns.map((column) => `${getColumnWidth(column)}px`).join(" "),
    [columns],
  );

  const captureMeasuredRow = (rowId: string, node: HTMLDivElement | null) => {
    if (!node) {
      return;
    }

    const measuredHeight = measureRenderedRowHeight(node);

    if (measuredHeight <= DEFAULT_ROW_HEIGHT) {
      return;
    }

    setMeasuredHeights((current) => {
      if (current[rowId] === measuredHeight) {
        return current;
      }

      return {
        ...current,
        [rowId]: measuredHeight,
      };
    });
  };

  return (
    <div
      aria-label={ariaLabel}
      data-pretable-scroll-viewport=""
      role="grid"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          grid.moveFocus(event.key === "ArrowDown" ? 1 : -1);

          const nextFocus = grid.getSnapshot().focus;

          if (nextFocus.rowId && nextFocus.columnId === null && columns[0]) {
            grid.setFocus(nextFocus.rowId, columns[0].id);
          }

          if (selectFocusedRowOnArrowKey && nextFocus.rowId) {
            grid.selectRow(nextFocus.rowId);
            onSelectedRowIdChange?.(nextFocus.rowId);
          }

          event.preventDefault();
          return;
        }

        if (event.key === "Enter" || event.key === " " || event.key === "Space") {
          const focusedRowId = grid.getSnapshot().focus.rowId;

          if (focusedRowId) {
            grid.selectRow(focusedRowId);
            onSelectedRowIdChange?.(focusedRowId);
            event.preventDefault();
          }
        }
      }}
      onScroll={(event) => {
        grid.setViewport({
          scrollTop: event.currentTarget.scrollTop,
          height: viewportHeight,
        });
      }}
      style={{
        ...getViewportStyle(viewportHeight),
        ...viewportStyle,
      }}
    >
      <div style={getHeaderRowStyle(templateColumns)}>
        {columns.map((column) => {
          const label = column.header ?? column.id;
          const sortDirection =
            snapshot.sort.columnId === column.id ? snapshot.sort.direction : null;
          const headerProps =
            getHeaderCellProps?.({
              column,
              sortDirection,
            }) ?? {};

          return (
            <button
              {...headerProps}
              aria-label={`Sort ${label}`}
              className={getHeaderCellClassName?.({
                column,
                sortDirection,
              })}
              key={column.id}
              onClick={() => {
                grid.setSort(column.id, getNextSortDirection(sortDirection));
              }}
              style={{
                alignItems: "start",
                border: 0,
                borderRight: "1px solid rgba(255, 255, 255, 0.06)",
                color: "inherit",
                display: "grid",
                gap: 4,
                padding: "12px",
                textAlign: "left",
                ...getPinnedCellStyle(pinnedOffsets[column.id]),
              }}
              type="button"
            >
              {renderHeaderCell ? (
                renderHeaderCell({
                  column,
                  label,
                  sortDirection,
                })
              ) : (
                <>
                  <span>{label}</span>
                  <strong>
                    {sortDirection === "desc"
                      ? "Newest"
                      : sortDirection === "asc"
                        ? "Oldest"
                        : "Sort"}
                  </strong>
                </>
              )}
            </button>
          );
        })}
      </div>

      <div
        data-pretable-scroll-content=""
        style={getScrollContentStyle(
          renderSnapshot.totalHeight,
          renderSnapshot.totalWidth,
        )}
      >
        {renderSnapshot.rows.map(({ height, id, row, rowIndex, top }) => {
          const isFocused = snapshot.focus.rowId === id;
          const isSelected = snapshot.selection.rowIds.includes(id);
          const rowProps =
            getRowProps?.({
              isFocused,
              isSelected,
              row,
              rowId: id,
              rowIndex,
            }) ?? {};

          return (
            <div
              {...rowProps}
              aria-rowindex={rowIndex + 1}
              aria-selected={isSelected}
              className={getRowClassName?.({
                isFocused,
                isSelected,
                row,
                rowId: id,
                rowIndex,
              })}
              data-focused={isFocused ? "true" : "false"}
              data-pretable-row=""
              data-row-height={height}
              data-row-id={id}
              data-row-index={rowIndex}
              data-selected={isSelected ? "true" : "false"}
              data-testid="pretable-row"
              key={id}
              onClick={() => {
                grid.setFocus(id, columns[0]?.id ?? null);
                grid.selectRow(id);
                onSelectedRowIdChange?.(id);
              }}
              ref={(node) => {
                captureMeasuredRow(id, node);
              }}
              style={getRowStyle(templateColumns, top, height)}
            >
              {columns.map((column) => {
                const value = resolveCellValue(row, column);
                const bodyInput = {
                  column,
                  isFocused,
                  isSelected,
                  row,
                  rowId: id,
                  rowIndex,
                  value,
                } satisfies PretableSurfaceBodyCellRenderInput<TRow>;
                const bodyProps = getBodyCellProps?.(bodyInput) ?? {};

                return (
                  <div
                    {...bodyProps}
                    className={getBodyCellClassName?.(bodyInput)}
                    data-column-id={column.id}
                    data-focused={isFocused ? "true" : "false"}
                    data-pretable-cell=""
                    data-selected={isSelected ? "true" : "false"}
                    key={`${id}:${column.id}`}
                    style={{
                      overflowWrap: column.wrap ? "anywhere" : "normal",
                      whiteSpace: column.wrap ? "pre-wrap" : "nowrap",
                      ...getPinnedCellStyle(pinnedOffsets[column.id]),
                    }}
                  >
                    {renderBodyCell ? (
                      renderBodyCell(bodyInput)
                    ) : (
                      formatCellValue(value)
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
