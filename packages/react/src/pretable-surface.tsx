import {
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AutosizeOptions,
  PretableCellAddress,
  PretableCellRange,
  PretableColumn,
  PretableFocusState,
  PretableGrid,
  PretableGridOptions,
  PretableRow,
  PretableSelectionState,
} from "@pretable/core";

type PretableFocusDirection = "up" | "down" | "left" | "right";

import { measureRenderedRowHeight } from "./row-height";
import {
  type PretableSurfaceState,
  type PretableTelemetry,
  usePretableModel,
} from "./use-pretable";
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
  /**
   * @experimental
   *
   * Inject deterministic sort/filter/selection/focus state. Used internally
   * by the bench harness for plan replay; exposed for advanced consumers
   * who need to drive the grid from external state. Shape may change
   * across minor releases.
   *
   * Each slice ({@link PretableSurfaceState.sort}, `filters`, `selection`,
   * `focus`) follows the same controlled/uncontrolled pattern: when a slice
   * is provided (non-undefined) the engine state is forced to it on every
   * render; when a slice is undefined the engine owns it (uncontrolled).
   */
  state?: PretableSurfaceState | null;
  overscan?: number;
  onSelectedRowIdChange?: (rowId: string | null) => void;
  onSelectionChange?: (next: PretableSelectionState) => void;
  onFocusChange?: (next: PretableFocusState) => void;
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
  /**
   * Tab key behavior. Default `"wrap-rows"` matches AG Grid / Sheets — Tab
   * moves focus right and wraps to the next row's first cell at row end;
   * Shift+Tab wraps backward. `"exit"` lets the browser handle Tab so focus
   * leaves the grid (strict ARIA grid pattern).
   */
  tabBehavior?: "wrap-rows" | "exit";
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
  state,
  overscan = 6,
  onGridReady,
  onSelectedRowIdChange,
  onSelectionChange,
  onFocusChange,
  onSortChange,
  onTelemetryChange,
  renderBodyCell,
  renderHeaderCell,
  rows,
  selectFocusedRowOnArrowKey = false,
  tabBehavior = "wrap-rows",
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
  const cellNodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragAnchorRef = useRef<PretableCellAddress | null>(null);
  const dragStartSelectionRef = useRef<PretableSelectionState | null>(null);
  const { headerHeight } = useResolvedHeights();
  const bodyViewportHeight = Math.max(viewportHeight - headerHeight, 0);
  const { grid, snapshot, renderSnapshot, telemetry } = usePretableModel({
    autosize,
    columns,
    getRowId,
    state: state ?? undefined,
    measuredHeights,
    overscan,
    rows,
    viewportHeight: bodyViewportHeight,
    viewportWidth: viewportWidth || undefined,
    onSelectionChange,
    onFocusChange,
  });
  const pinnedOffsets = useMemo(() => getPinnedLeftOffsets(columns), [columns]);

  const columnIndexById = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < columns.length; i += 1) {
      const col = columns[i];
      if (col) {
        map.set(col.id, i);
      }
    }
    return map;
  }, [columns]);

  const visibleRowIndexById = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < snapshot.visibleRows.length; i += 1) {
      const row = snapshot.visibleRows[i];
      if (row) {
        map.set(row.id, i);
      }
    }
    return map;
  }, [snapshot.visibleRows]);

  const { selectedCellKeys, fullySelectedRowIds } = useMemo(() => {
    const cellKeys = new Set<string>();
    const fullyRows = new Set<string>();
    const ranges = snapshot.selection.ranges;

    if (ranges.length === 0 || columns.length === 0) {
      return { selectedCellKeys: cellKeys, fullySelectedRowIds: fullyRows };
    }

    for (const row of snapshot.visibleRows) {
      let coveredCount = 0;

      for (const column of columns) {
        const inAny = ranges.some((range) =>
          rangeContainsCellLocal(
            range,
            row.id,
            column.id,
            visibleRowIndexById,
            columnIndexById,
          ),
        );

        if (inAny) {
          cellKeys.add(`${row.id}::${column.id}`);
          coveredCount += 1;
        }
      }

      if (coveredCount === columns.length) {
        fullyRows.add(row.id);
      }
    }

    return { selectedCellKeys: cellKeys, fullySelectedRowIds: fullyRows };
  }, [
    snapshot.selection.ranges,
    snapshot.visibleRows,
    columns,
    visibleRowIndexById,
    columnIndexById,
  ]);

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

  // Programmatic focus follow: when the engine's focus address changes, move
  // browser focus to the corresponding cell DOM node so keyboard handlers
  // continue to fire and screen readers track the focused cell.
  useLayoutEffect(() => {
    const { rowId, columnId } = snapshot.focus;

    if (!rowId || !columnId) {
      return;
    }

    const cellNode = cellNodesRef.current.get(`${rowId}::${columnId}`);

    if (cellNode && document.activeElement !== cellNode) {
      cellNode.focus({ preventScroll: true });
    }
  }, [snapshot.focus.rowId, snapshot.focus.columnId]);

  useLayoutEffect(() => {
    const injectedSelectedRowId =
      state?.selection?.ranges[0]?.startRowId ?? null;

    if (!injectedSelectedRowId) {
      return;
    }

    const currentSelectedRowId =
      snapshot.selection.ranges[0]?.startRowId ?? null;

    if (currentSelectedRowId !== injectedSelectedRowId) {
      onSelectedRowIdChange?.(injectedSelectedRowId);
    }
  }, [state, onSelectedRowIdChange, snapshot.selection.ranges]);

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
    // Deps: only re-run when something that could legitimately change row
    // measurements has changed. Without these deps, the effect re-runs on
    // every render — including the re-render triggered by its own
    // setMeasuredHeights call — which under high-churn streaming with
    // wrap:true rows can hit React's "Maximum update depth" guard.
  }, [snapshot.visibleRows, columns, viewportWidth]);

  return (
    <div
      aria-colcount={columns.length}
      aria-label={ariaLabel}
      aria-multiselectable="true"
      aria-rowcount={snapshot.totalRowCount + 1}
      data-pretable-scroll-viewport=""
      ref={viewportRef}
      role="grid"
      tabIndex={-1}
      onKeyDown={(event) => {
        // Esc cancels an in-flight marquee drag by restoring the pre-drag selection.
        if (
          (event.key === "Escape" || event.key === "Esc") &&
          dragAnchorRef.current !== null &&
          dragStartSelectionRef.current !== null
        ) {
          const before = grid.getSnapshot();
          grid.setSelection(dragStartSelectionRef.current);
          dragAnchorRef.current = null;
          dragStartSelectionRef.current = null;
          const after = grid.getSnapshot();
          if (
            JSON.stringify(before.selection) !== JSON.stringify(after.selection)
          ) {
            onSelectionChange?.(after.selection);
          }
          event.preventDefault();
          return;
        }

        const before = grid.getSnapshot();
        const handled = handleSurfaceKeyDown(event, {
          bodyViewportHeight,
          columns,
          grid,
          onSelectedRowIdChange,
          selectFocusedRowOnArrowKey,
          tabBehavior,
        });

        if (handled) {
          event.preventDefault();
          const after = grid.getSnapshot();
          if (
            before.focus.rowId !== after.focus.rowId ||
            before.focus.columnId !== after.focus.columnId
          ) {
            onFocusChange?.(after.focus);
          }
          if (
            JSON.stringify(before.selection) !== JSON.stringify(after.selection)
          ) {
            onSelectionChange?.(after.selection);
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
        aria-rowindex={1}
        data-pretable-header-row=""
        role="row"
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

          const ariaSort: "ascending" | "descending" | "none" =
            sortDirection === "asc"
              ? "ascending"
              : sortDirection === "desc"
                ? "descending"
                : "none";

          return (
            <button
              {...headerProps}
              aria-colindex={plannedCol.index + 1}
              aria-label={`Sort ${label}`}
              aria-sort={ariaSort}
              className={getHeaderCellClassName?.({
                column,
                sortDirection,
              })}
              data-pretable-header-cell=""
              data-pinned={plannedCol.pinned === "left" ? "left" : undefined}
              key={column.id}
              role="columnheader"
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
          const isSelected = fullySelectedRowIds.has(id);
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
              aria-rowindex={rowIndex + 2}
              aria-selected={isSelected ? "true" : undefined}
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
              role="row"
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
                const cellKey = `${id}::${column.id}`;
                const cellIsFocused =
                  isFocused && snapshot.focus.columnId === column.id;
                const cellIsSelected = selectedCellKeys.has(cellKey);
                const bodyInput = {
                  column,
                  isFocused: cellIsFocused,
                  isSelected: cellIsSelected,
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
                    aria-colindex={plannedCol.index + 1}
                    aria-selected={cellIsSelected ? "true" : undefined}
                    className={getBodyCellClassName?.(bodyInput)}
                    data-column-id={column.id}
                    data-focused={cellIsFocused ? "true" : "false"}
                    data-pinned={column.pinned === "left" ? "left" : undefined}
                    data-pretable-cell=""
                    data-pretable-wrap={column.wrap ? "true" : undefined}
                    data-selected={cellIsSelected ? "true" : "false"}
                    key={`${id}:${column.id}`}
                    onClick={(event) => {
                      handleCellClick({
                        cmd: event.metaKey || event.ctrlKey,
                        columnId: column.id,
                        columns,
                        grid,
                        onFocusChange,
                        onSelectedRowIdChange,
                        onSelectionChange,
                        rowId: id,
                        shift: event.shiftKey,
                      });
                    }}
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      const cmd = event.metaKey || event.ctrlKey;
                      if (event.shiftKey || cmd) return;

                      dragStartSelectionRef.current = grid.getSnapshot().selection;
                      dragAnchorRef.current = { rowId: id, columnId: column.id };
                      handleCellClick({
                        cmd: false,
                        columnId: column.id,
                        columns,
                        grid,
                        onFocusChange,
                        onSelectedRowIdChange,
                        onSelectionChange,
                        rowId: id,
                        shift: false,
                      });
                      try {
                        event.currentTarget.setPointerCapture(event.pointerId);
                      } catch {
                        // jsdom / older browsers may not support pointer capture
                      }
                    }}
                    onPointerEnter={() => {
                      if (!dragAnchorRef.current) return;
                      const before = grid.getSnapshot();
                      const addr: PretableCellAddress = {
                        rowId: id,
                        columnId: column.id,
                      };
                      grid.extendRangeFromAnchor(addr);
                      grid.setFocus(addr);
                      const after = grid.getSnapshot();
                      if (
                        before.focus.rowId !== after.focus.rowId ||
                        before.focus.columnId !== after.focus.columnId
                      ) {
                        onFocusChange?.(after.focus);
                      }
                      if (
                        JSON.stringify(before.selection) !==
                        JSON.stringify(after.selection)
                      ) {
                        onSelectionChange?.(after.selection);
                        const beforeFullRow = singleFullRowSelection(
                          before.selection,
                          columns,
                        );
                        const afterFullRow = singleFullRowSelection(
                          after.selection,
                          columns,
                        );
                        if (beforeFullRow !== afterFullRow) {
                          onSelectedRowIdChange?.(afterFullRow);
                        }
                      }
                    }}
                    onPointerUp={() => {
                      dragAnchorRef.current = null;
                    }}
                    onPointerCancel={() => {
                      dragAnchorRef.current = null;
                    }}
                    ref={(node) => {
                      if (node) {
                        cellNodesRef.current.set(cellKey, node);
                      } else {
                        cellNodesRef.current.delete(cellKey);
                      }
                    }}
                    role="gridcell"
                    style={{
                      outline: "none",
                      overflowWrap: column.wrap ? "anywhere" : "normal",
                      whiteSpace: column.wrap ? "pre-wrap" : "nowrap",
                      ...positionStyle,
                    }}
                    tabIndex={cellIsFocused ? 0 : -1}
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

function replaceSelectionWithFullRow<TRow extends PretableRow>(
  grid: PretableGrid<TRow>,
  rowId: string,
  columns: PretableColumn<TRow>[],
): void {
  const firstColumn = columns[0];
  const lastColumn = columns[columns.length - 1];

  if (!firstColumn || !lastColumn) {
    grid.setSelection({ ranges: [], anchor: null });
    return;
  }

  grid.setSelection({
    ranges: [
      {
        startRowId: rowId,
        endRowId: rowId,
        startColumnId: firstColumn.id,
        endColumnId: lastColumn.id,
      },
    ],
    anchor: { rowId, columnId: firstColumn.id },
  });
}

interface HandleCellClickArgs<TRow extends PretableRow> {
  cmd: boolean;
  columnId: string;
  columns: PretableColumn<TRow>[];
  grid: PretableGrid<TRow>;
  onFocusChange?: (next: PretableFocusState) => void;
  onSelectedRowIdChange?: (rowId: string | null) => void;
  onSelectionChange?: (next: PretableSelectionState) => void;
  rowId: string;
  shift: boolean;
}

function handleCellClick<TRow extends PretableRow>(
  args: HandleCellClickArgs<TRow>,
): void {
  const {
    cmd,
    columnId,
    columns,
    grid,
    onFocusChange,
    onSelectedRowIdChange,
    onSelectionChange,
    rowId,
    shift,
  } = args;

  const before = grid.getSnapshot();
  const addr: PretableCellAddress = { rowId, columnId };

  if (shift && !cmd && before.selection.anchor) {
    grid.extendRangeFromAnchor(addr);
    grid.setFocus(addr);
  } else if (cmd) {
    grid.addRange({
      startRowId: rowId,
      endRowId: rowId,
      startColumnId: columnId,
      endColumnId: columnId,
    });
    grid.setFocus(addr);
  } else {
    // Plain click (or shift+click with no anchor — falls back to plain click).
    grid.setFocus(addr);
    grid.setSelection({
      ranges: [
        {
          startRowId: rowId,
          endRowId: rowId,
          startColumnId: columnId,
          endColumnId: columnId,
        },
      ],
      anchor: addr,
    });
  }

  const after = grid.getSnapshot();

  if (
    before.focus.rowId !== after.focus.rowId ||
    before.focus.columnId !== after.focus.columnId
  ) {
    onFocusChange?.(after.focus);
  }

  const selectionChanged =
    JSON.stringify(before.selection) !== JSON.stringify(after.selection);

  if (selectionChanged) {
    onSelectionChange?.(after.selection);

    const beforeFullRow = singleFullRowSelection(before.selection, columns);
    const afterFullRow = singleFullRowSelection(after.selection, columns);

    if (beforeFullRow !== afterFullRow) {
      onSelectedRowIdChange?.(afterFullRow);
    }
  }
}

function singleFullRowSelection<TRow extends PretableRow>(
  selection: PretableSelectionState,
  columns: PretableColumn<TRow>[],
): string | null {
  if (selection.ranges.length !== 1 || columns.length === 0) {
    return null;
  }
  const range = selection.ranges[0];
  if (!range) return null;
  if (range.startRowId !== range.endRowId) return null;

  const firstColumn = columns[0];
  const lastColumn = columns[columns.length - 1];
  if (!firstColumn || !lastColumn) return null;

  const startMatchesFirst = range.startColumnId === firstColumn.id;
  const endMatchesLast = range.endColumnId === lastColumn.id;
  const startMatchesLast = range.startColumnId === lastColumn.id;
  const endMatchesFirst = range.endColumnId === firstColumn.id;

  const coversAllColumns =
    (startMatchesFirst && endMatchesLast) ||
    (startMatchesLast && endMatchesFirst);

  return coversAllColumns ? range.startRowId : null;
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

function rangeContainsCellLocal(
  range: PretableCellRange,
  rowId: string,
  columnId: string,
  rowOrder: ReadonlyMap<string, number>,
  columnOrder: ReadonlyMap<string, number>,
): boolean {
  const rowIdx = rowOrder.get(rowId);
  const startRowIdx = rowOrder.get(range.startRowId);
  const endRowIdx = rowOrder.get(range.endRowId);
  const colIdx = columnOrder.get(columnId);
  const startColIdx = columnOrder.get(range.startColumnId);
  const endColIdx = columnOrder.get(range.endColumnId);

  if (
    rowIdx === undefined ||
    startRowIdx === undefined ||
    endRowIdx === undefined ||
    colIdx === undefined ||
    startColIdx === undefined ||
    endColIdx === undefined
  ) {
    return false;
  }

  const [rowLo, rowHi] =
    startRowIdx <= endRowIdx
      ? [startRowIdx, endRowIdx]
      : [endRowIdx, startRowIdx];
  const [colLo, colHi] =
    startColIdx <= endColIdx
      ? [startColIdx, endColIdx]
      : [endColIdx, startColIdx];

  return (
    rowIdx >= rowLo && rowIdx <= rowHi && colIdx >= colLo && colIdx <= colHi
  );
}

const ARROW_DIRECTIONS: Record<string, PretableFocusDirection> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

interface SurfaceKeyDownContext<TRow extends PretableRow> {
  bodyViewportHeight: number;
  columns: PretableColumn<TRow>[];
  grid: PretableGrid<TRow>;
  onSelectedRowIdChange?: (rowId: string | null) => void;
  selectFocusedRowOnArrowKey: boolean;
  tabBehavior: "wrap-rows" | "exit";
}

function handleSurfaceKeyDown<TRow extends PretableRow>(
  event: ReactKeyboardEvent<HTMLDivElement>,
  ctx: SurfaceKeyDownContext<TRow>,
): boolean {
  const {
    bodyViewportHeight,
    columns,
    grid,
    onSelectedRowIdChange,
    selectFocusedRowOnArrowKey,
    tabBehavior,
  } = ctx;
  const { key } = event;
  const cmd = event.metaKey || event.ctrlKey;
  const shift = event.shiftKey;
  const snapshot = grid.getSnapshot();
  const focus = snapshot.focus;
  const visibleRows = snapshot.visibleRows;
  const firstColumn = columns[0];
  const lastColumn = columns[columns.length - 1];

  // Arrow keys
  const direction = ARROW_DIRECTIONS[key];
  if (direction) {
    grid.moveFocus(direction, {
      extend: shift,
      jumpToEdge: cmd,
    });

    if (selectFocusedRowOnArrowKey) {
      const nextFocus = grid.getSnapshot().focus;
      if (nextFocus.rowId) {
        replaceSelectionWithFullRow(grid, nextFocus.rowId, columns);
        onSelectedRowIdChange?.(nextFocus.rowId);
      }
    }
    return true;
  }

  // Home / End
  if (key === "Home") {
    if (!firstColumn) return false;
    if (cmd) {
      const firstRow = visibleRows[0];
      if (!firstRow) return false;
      grid.setFocus({ rowId: firstRow.id, columnId: firstColumn.id });
    } else if (focus.rowId) {
      grid.setFocus({ rowId: focus.rowId, columnId: firstColumn.id });
    } else {
      const firstRow = visibleRows[0];
      if (!firstRow) return false;
      grid.setFocus({ rowId: firstRow.id, columnId: firstColumn.id });
    }
    return true;
  }

  if (key === "End") {
    if (!lastColumn) return false;
    if (cmd) {
      const lastRow = visibleRows[visibleRows.length - 1];
      if (!lastRow) return false;
      grid.setFocus({ rowId: lastRow.id, columnId: lastColumn.id });
    } else if (focus.rowId) {
      grid.setFocus({ rowId: focus.rowId, columnId: lastColumn.id });
    } else {
      const firstRow = visibleRows[0];
      if (!firstRow) return false;
      grid.setFocus({ rowId: firstRow.id, columnId: lastColumn.id });
    }
    return true;
  }

  // Page Up / Page Down
  if (key === "PageUp" || key === "PageDown") {
    if (visibleRows.length === 0 || !firstColumn) return false;
    const pageRowCount = Math.max(1, Math.floor(bodyViewportHeight / 32));
    const currentRowIdx = focus.rowId
      ? visibleRows.findIndex((r) => r.id === focus.rowId)
      : -1;
    const baseRowIdx = currentRowIdx === -1 ? 0 : currentRowIdx;
    const nextRowIdx =
      key === "PageUp"
        ? Math.max(0, baseRowIdx - pageRowCount)
        : Math.min(visibleRows.length - 1, baseRowIdx + pageRowCount);
    const nextRow = visibleRows[nextRowIdx];
    if (!nextRow) return false;
    const columnId = focus.columnId ?? firstColumn.id;
    const addr: PretableCellAddress = { rowId: nextRow.id, columnId };

    if (shift) {
      // Ensure anchor exists before extending
      if (!snapshot.selection.anchor && focus.rowId && focus.columnId) {
        grid.setSelection({
          ranges: [
            {
              startRowId: focus.rowId,
              endRowId: focus.rowId,
              startColumnId: focus.columnId,
              endColumnId: focus.columnId,
            },
          ],
          anchor: { rowId: focus.rowId, columnId: focus.columnId },
        });
      }
      grid.setFocus(addr);
      grid.extendRangeFromAnchor(addr);
    } else {
      grid.setFocus(addr);
    }
    return true;
  }

  // Tab
  if (key === "Tab") {
    if (tabBehavior === "exit") {
      return false;
    }
    if (visibleRows.length === 0 || columns.length === 0) return false;
    const currentRowIdx = focus.rowId
      ? visibleRows.findIndex((r) => r.id === focus.rowId)
      : -1;
    const currentColIdx = focus.columnId
      ? columns.findIndex((c) => c.id === focus.columnId)
      : -1;
    const baseRowIdx = currentRowIdx === -1 ? 0 : currentRowIdx;
    const baseColIdx = currentColIdx === -1 ? 0 : currentColIdx;

    let nextRowIdx = baseRowIdx;
    let nextColIdx = baseColIdx;
    if (shift) {
      if (baseColIdx === 0) {
        nextColIdx = columns.length - 1;
        nextRowIdx = Math.max(0, baseRowIdx - 1);
        if (baseRowIdx === 0) {
          // already at top-left; clamp
          nextColIdx = 0;
          nextRowIdx = 0;
        }
      } else {
        nextColIdx = baseColIdx - 1;
      }
    } else {
      if (baseColIdx === columns.length - 1) {
        nextColIdx = 0;
        nextRowIdx = Math.min(visibleRows.length - 1, baseRowIdx + 1);
        if (baseRowIdx === visibleRows.length - 1) {
          // already at bottom-right; clamp
          nextColIdx = columns.length - 1;
          nextRowIdx = visibleRows.length - 1;
        }
      } else {
        nextColIdx = baseColIdx + 1;
      }
    }
    const nextRow = visibleRows[nextRowIdx];
    const nextCol = columns[nextColIdx];
    if (!nextRow || !nextCol) return false;
    grid.setFocus({ rowId: nextRow.id, columnId: nextCol.id });
    return true;
  }

  // Cmd/Ctrl + A
  if (cmd && (key === "a" || key === "A")) {
    grid.selectAll();
    return true;
  }

  // Esc
  if (key === "Escape" || key === "Esc") {
    grid.clearSelection();
    return true;
  }

  // Enter / Space — preserve Phase 1 row-selection behavior
  if (key === "Enter" || key === " " || key === "Space") {
    const focusedRowId = focus.rowId;
    if (focusedRowId) {
      replaceSelectionWithFullRow(grid, focusedRowId, columns);
      onSelectedRowIdChange?.(focusedRowId);
      return true;
    }
    return false;
  }

  return false;
}
