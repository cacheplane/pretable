import {
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AutosizeOptions,
  PretableColumn,
  PretableGrid,
  PretableGridOptions,
  PretableRow,
} from "@pretable/core";

import { measureRenderedRowHeight } from "../row-height";
import { type PretableTelemetry, usePretableModel } from "../use-pretable";
import { useResolvedHeights } from "./density";
import {
  DEFAULT_ROW_HEIGHT,
  formatCellValue,
  getNextSortDirection,
  getPinnedLeftOffsets,
  resolveCellValue,
} from "./rendering";
import {
  getCellStyle,
  getHeaderCellStyle,
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

interface PretableSurfaceInteractionState {
  filters?: Record<string, string>;
  focusedRowId?: string | null;
  selectedRowId?: string | null;
  sort?: {
    columnId: string;
    direction: "asc" | "desc";
  } | null;
}

export interface PretableSurfaceProps<TRow extends PretableRow = PretableRow> {
  ariaLabel: string;
  autosize?: boolean | AutosizeOptions;
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
  interactionState?: PretableSurfaceInteractionState | null;
  overscan?: number;
  onSelectedRowIdChange?: (rowId: string | null) => void;
  onSortChange?: (
    sort: { columnId: string; direction: "asc" | "desc" } | null,
  ) => void;
  onTelemetryChange?: (telemetry: PretableTelemetry) => void;
  onGridReady?: (grid: PretableGrid<TRow>) => void;
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
  autosize,
  columns,
  getBodyCellClassName,
  getBodyCellProps,
  getHeaderCellClassName,
  getHeaderCellProps,
  getRowClassName,
  getRowId,
  getRowProps,
  interactionState,
  overscan = 6,
  onGridReady,
  onSelectedRowIdChange,
  onSortChange,
  onTelemetryChange,
  renderBodyCell,
  renderHeaderCell,
  rows,
  selectFocusedRowOnArrowKey = false,
  viewportStyle,
  viewportHeight,
}: PretableSurfaceProps<TRow>) {
  const [measuredHeights, setMeasuredHeights] = useState<
    Record<string, number>
  >({});
  const [viewportWidth, setViewportWidth] = useState(0);
  const measuredHeightsRef = useRef<Record<string, number>>({});
  const measuredRowKeysRef = useRef<Record<string, string>>({});
  const rowNodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const viewportRef = useRef<HTMLDivElement>(null);
  const { headerHeight } = useResolvedHeights();
  const bodyViewportHeight = Math.max(viewportHeight - headerHeight, 0);
  const { grid, snapshot, renderSnapshot, telemetry } = usePretableModel({
    autosize,
    columns,
    getRowId,
    interactionOverrides: interactionState ?? undefined,
    measuredHeights,
    overscan,
    rows,
    viewportHeight: bodyViewportHeight,
    viewportWidth: viewportWidth || undefined,
  });
  const pinnedOffsets = useMemo(() => getPinnedLeftOffsets(columns), [columns]);

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (el && viewportWidth === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: measuring DOM width in useLayoutEffect requires synchronous state update
      setViewportWidth(el.clientWidth);
    }
  });

  useLayoutEffect(() => {
    onTelemetryChange?.(telemetry);
  }, [onTelemetryChange, telemetry]);

  useLayoutEffect(() => {
    onGridReady?.(grid);
  }, [grid, onGridReady]);

  useLayoutEffect(() => {
    if (!interactionState?.selectedRowId) {
      return;
    }

    const currentSelectedRowId = snapshot.selection.rowIds[0] ?? null;

    if (currentSelectedRowId !== interactionState.selectedRowId) {
      onSelectedRowIdChange?.(interactionState.selectedRowId);
    }
  }, [interactionState, onSelectedRowIdChange, snapshot.selection.rowIds]);

  useLayoutEffect(() => {
    let nextHeights = measuredHeightsRef.current;
    let nextKeys = measuredRowKeysRef.current;
    let changed = false;

    for (const [rowId, node] of rowNodesRef.current) {
      const plannedHeight = Number(node.getAttribute("data-row-height"));
      const cachedHeight = nextHeights[rowId];
      const currentRowKey = getRowMeasurementKey(node);
      const cachedRowKey = nextKeys[rowId];

      if (
        Number.isFinite(plannedHeight) &&
        cachedHeight !== undefined &&
        cachedHeight === plannedHeight &&
        cachedRowKey === currentRowKey
      ) {
        continue;
      }

      const measuredHeight = measureRenderedRowHeight(node);

      if (measuredHeight <= DEFAULT_ROW_HEIGHT) {
        if (cachedHeight !== undefined && cachedRowKey !== currentRowKey) {
          const restHeights = { ...nextHeights };
          delete restHeights[rowId];
          const restKeys = { ...nextKeys };
          delete restKeys[rowId];

          nextHeights = restHeights;
          nextKeys = restKeys;
          changed = true;
        }

        continue;
      }

      if (nextHeights[rowId] === measuredHeight) {
        if (cachedRowKey !== currentRowKey) {
          nextKeys = { ...nextKeys, [rowId]: currentRowKey };
        }

        continue;
      }

      nextHeights = { ...nextHeights, [rowId]: measuredHeight };
      nextKeys = { ...nextKeys, [rowId]: currentRowKey };
      changed = true;
    }

    measuredHeightsRef.current = nextHeights;
    measuredRowKeysRef.current = nextKeys;

    if (changed) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: measuring DOM in useLayoutEffect requires synchronous state update
      setMeasuredHeights(nextHeights);
    }
  });

  return (
    <div
      aria-label={ariaLabel}
      data-pretable-scroll-viewport=""
      ref={viewportRef}
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

        if (
          event.key === "Enter" ||
          event.key === " " ||
          event.key === "Space"
        ) {
          const focusedRowId = grid.getSnapshot().focus.rowId;

          if (focusedRowId) {
            grid.selectRow(focusedRowId);
            onSelectedRowIdChange?.(focusedRowId);
            event.preventDefault();
          }
        }
      }}
      onScroll={(event) => {
        const el = event.currentTarget;
        grid.setViewport({
          scrollTop: el.scrollTop,
          scrollLeft: el.scrollLeft,
          height: bodyViewportHeight,
          width: el.clientWidth,
        });
        if (el.clientWidth !== viewportWidth) {
          setViewportWidth(el.clientWidth);
        }
      }}
      style={{
        ...getViewportStyle(viewportHeight),
        ...viewportStyle,
      }}
    >
      <div
        data-pretable-header-row=""
        style={getHeaderRowStyle(renderSnapshot.totalWidth, headerHeight)}
      >
        {renderSnapshot.columns.map((plannedCol) => {
          const column = columns[plannedCol.index];

          if (!column) {
            return null;
          }

          const label = column.header ?? column.id;
          const sortDirection =
            snapshot.sort.columnId === column.id
              ? snapshot.sort.direction
              : null;
          const headerProps =
            getHeaderCellProps?.({
              column,
              sortDirection,
            }) ?? {};
          const pinnedOffset = pinnedOffsets[column.id];
          const positionStyle =
            plannedCol.pinned === "left" && pinnedOffset !== undefined
              ? {
                  ...getHeaderCellStyle(plannedCol.left, plannedCol.width),
                  ...getPinnedCellStyle(pinnedOffset),
                }
              : getHeaderCellStyle(plannedCol.left, plannedCol.width);

          return (
            <button
              {...headerProps}
              aria-label={`Sort ${label}`}
              className={getHeaderCellClassName?.({
                column,
                sortDirection,
              })}
              data-pretable-header-cell=""
              data-pinned={plannedCol.pinned === "left" ? "left" : undefined}
              key={column.id}
              onClick={() => {
                const nextDirection = getNextSortDirection(sortDirection);
                grid.setSort(column.id, nextDirection);
                if (nextDirection) {
                  onSortChange?.({
                    columnId: column.id,
                    direction: nextDirection,
                  });
                } else {
                  onSortChange?.(null);
                }
              }}
              style={{
                alignItems: "start",
                border: 0,
                borderRight: "1px solid rgba(255, 255, 255, 0.06)",
                color: "inherit",
                display: "grid",
                gap: 4,
                textAlign: "left",
                ...positionStyle,
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
                if (node) {
                  rowNodesRef.current.set(id, node);
                } else {
                  rowNodesRef.current.delete(id);
                }
              }}
              style={getRowStyle(top, height)}
            >
              {renderSnapshot.columns.map((plannedCol) => {
                const column = columns[plannedCol.index];

                if (!column) {
                  return null;
                }

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
                const pinnedOffset = pinnedOffsets[column.id];
                const positionStyle =
                  plannedCol.pinned === "left" && pinnedOffset !== undefined
                    ? {
                        ...getCellStyle(plannedCol.left, plannedCol.width),
                        ...getPinnedCellStyle(pinnedOffset),
                      }
                    : getCellStyle(plannedCol.left, plannedCol.width);

                return (
                  <div
                    {...bodyProps}
                    className={getBodyCellClassName?.(bodyInput)}
                    data-column-id={column.id}
                    data-focused={isFocused ? "true" : "false"}
                    data-pinned={column.pinned === "left" ? "left" : undefined}
                    data-pretable-cell=""
                    data-pretable-wrap={column.wrap ? "true" : undefined}
                    data-selected={isSelected ? "true" : "false"}
                    key={`${id}:${column.id}`}
                    style={{
                      overflowWrap: column.wrap ? "anywhere" : "normal",
                      whiteSpace: column.wrap ? "pre-wrap" : "nowrap",
                      ...positionStyle,
                    }}
                  >
                    {renderBodyCell
                      ? renderBodyCell(bodyInput)
                      : formatCellValue(value)}
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

function getRowMeasurementKey(rowNode: HTMLDivElement) {
  const rowParts = [
    rowNode.getAttribute("class") ?? "",
    normalizeStyleSignature(rowNode.getAttribute("style") ?? ""),
    rowNode.getAttribute("aria-selected") ?? "",
    rowNode.getAttribute("data-focused") ?? "",
    rowNode.getAttribute("data-selected") ?? "",
  ];

  const cellParts = [
    ...rowNode.querySelectorAll<HTMLElement>("[data-pretable-cell]"),
  ].map((cell) =>
    [
      cell.getAttribute("data-column-id") ?? "",
      cell.getAttribute("class") ?? "",
      cell.getAttribute("style") ?? "",
      cell.getAttribute("data-pretable-wrap") ?? "",
      cell.getAttribute("data-focused") ?? "",
      cell.getAttribute("data-selected") ?? "",
      cell.textContent ?? "",
    ].join(":"),
  );

  return [...rowParts, ...cellParts].join("|");
}

function normalizeStyleSignature(styleValue: string) {
  return styleValue
    .split(";")
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .filter((declaration) => !/^top\s*:/i.test(declaration))
    .join(";");
}
