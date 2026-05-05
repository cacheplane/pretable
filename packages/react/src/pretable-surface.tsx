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

export { ROW_SELECT_COLUMN_ID } from "./constants";
import { ROW_SELECT_COLUMN_ID } from "./constants";
import {
  type CopyPayload,
  type SerializeRangesArgs,
  serializeRangesAsTsv,
} from "./copy";

async function defaultCopyToClipboard(payload: CopyPayload): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.clipboard) return;
  if (
    payload.html &&
    typeof globalThis.ClipboardItem !== "undefined" &&
    typeof navigator.clipboard.write === "function"
  ) {
    await navigator.clipboard.write([
      new globalThis.ClipboardItem({
        "text/plain": new Blob([payload.text], { type: "text/plain" }),
        "text/html": new Blob([payload.html], { type: "text/html" }),
      }),
    ]);
  } else {
    await navigator.clipboard.writeText(payload.text);
  }
}

export interface RowSelectionColumnConfig {
  enabled: true;
  position?: "left";
  pinned?: boolean;
  headerCheckbox?: boolean;
  width?: number;
}

export interface PretableSurfaceMessages {
  selectAllAnnouncement?: (args: {
    rowCount: number;
    columnCount: number;
    isAll: boolean;
  }) => string;
  copyAnnouncement?: (args: {
    rowCount: number;
    columnCount: number;
  }) => string;
  copyFailedAnnouncement?: () => string;
}

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
  rowSelectionColumn?: RowSelectionColumnConfig;
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
  /**
   * When true, Cmd/Ctrl+C copy emits a header row (followed by a blank line)
   * before the selected rows in each range block. Defaults to `false`.
   */
  copyWithHeaders?: boolean;
  /**
   * Override the TSV serialization step. Receives the args that would be
   * passed to {@link serializeRangesAsTsv}; returning `null` cancels the copy.
   */
  onCopy?: (args: SerializeRangesArgs<TRow>) => CopyPayload | null;
  /**
   * Override the clipboard write step. Defaults to writing
   * `payload.text` (and `payload.html` if present) via `navigator.clipboard`.
   */
  copyToClipboard?: (payload: CopyPayload) => void | Promise<void>;
  /**
   * Localized message factories for ARIA live announcements (select-all,
   * copy success, copy failure). Each entry is optional; missing entries
   * fall back to English defaults.
   */
  messages?: PretableSurfaceMessages;
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
  rowSelectionColumn,
  selectFocusedRowOnArrowKey = false,
  tabBehavior = "wrap-rows",
  viewportStyle,
  viewportHeight,
  copyWithHeaders,
  onCopy,
  copyToClipboard,
}: PretableSurfaceProps<TRow>) {
  const [measuredHeights, setMeasuredHeights] = useState<
    Record<string, number>
  >({});
  const [viewportWidth, setViewportWidth] = useState(0);
  const [liveMessage] = useState<string>("");
  const measuredHeightsRef = useRef<Record<string, number>>({});
  const measuredRowKeysRef = useRef<Record<string, string>>({});
  const rowNodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const cellNodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragAnchorRef = useRef<PretableCellAddress | null>(null);
  const dragStartSelectionRef = useRef<PretableSelectionState | null>(null);
  const lastCheckedRowAnchorRef = useRef<string | null>(null);
  const { headerHeight } = useResolvedHeights();
  const bodyViewportHeight = Math.max(viewportHeight - headerHeight, 0);
  const effectiveColumns = useMemo<PretableColumn<TRow>[]>(() => {
    if (!rowSelectionColumn?.enabled) return columns;
    const synth: PretableColumn<TRow> = {
      id: ROW_SELECT_COLUMN_ID,
      header: "",
      widthPx: rowSelectionColumn.width ?? 36,
      sortable: false,
      filterable: false,
      ...((rowSelectionColumn.pinned ?? true) ? { pinned: "left" } : {}),
    };
    return [synth, ...columns];
  }, [columns, rowSelectionColumn]);
  const { grid, snapshot, renderSnapshot, telemetry } = usePretableModel({
    autosize,
    columns: effectiveColumns,
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
  const pinnedOffsets = useMemo(
    () => getPinnedLeftOffsets(effectiveColumns),
    [effectiveColumns],
  );

  const columnIndexById = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < effectiveColumns.length; i += 1) {
      const col = effectiveColumns[i];
      if (col) {
        map.set(col.id, i);
      }
    }
    return map;
  }, [effectiveColumns]);

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

  const { selectedCellKeys, fullySelectedRowIds, indeterminateRowIds } =
    useMemo(() => {
      const cellKeys = new Set<string>();
      const fullyRows = new Set<string>();
      const indeterminateRows = new Set<string>();
      const ranges = snapshot.selection.ranges;

      // Exclude the synthetic row-select column from the "fully selected"
      // calculation — it doesn't participate in cell-range selection.
      const dataColumns = effectiveColumns.filter(
        (c) => c.id !== ROW_SELECT_COLUMN_ID,
      );

      if (ranges.length === 0 || dataColumns.length === 0) {
        return {
          selectedCellKeys: cellKeys,
          fullySelectedRowIds: fullyRows,
          indeterminateRowIds: indeterminateRows,
        };
      }

      for (const row of snapshot.visibleRows) {
        let coveredCount = 0;

        for (const column of dataColumns) {
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

        if (coveredCount === dataColumns.length) {
          fullyRows.add(row.id);
        } else if (coveredCount > 0) {
          indeterminateRows.add(row.id);
        }
      }

      return {
        selectedCellKeys: cellKeys,
        fullySelectedRowIds: fullyRows,
        indeterminateRowIds: indeterminateRows,
      };
    }, [
      snapshot.selection.ranges,
      snapshot.visibleRows,
      effectiveColumns,
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
  }, [snapshot.visibleRows, effectiveColumns, viewportWidth]);

  return (
    <div
      aria-colcount={effectiveColumns.length}
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

        // Cmd/Ctrl+C copy. Skip if focus is in an editable input/textarea.
        if (
          (event.key === "c" || event.key === "C") &&
          (event.metaKey || event.ctrlKey) &&
          !event.shiftKey &&
          !event.altKey &&
          !(event.target instanceof HTMLInputElement) &&
          !(event.target instanceof HTMLTextAreaElement)
        ) {
          event.preventDefault();
          const snap = grid.getSnapshot();
          const args: SerializeRangesArgs<TRow> = {
            ranges: snap.selection.ranges,
            visibleRows: snap.visibleRows,
            columns: effectiveColumns,
            copyWithHeaders: copyWithHeaders ?? false,
          };
          const payload = onCopy ? onCopy(args) : serializeRangesAsTsv(args);
          if (payload) {
            Promise.resolve(
              (copyToClipboard ?? defaultCopyToClipboard)(payload),
            ).catch((err) => {
              // eslint-disable-next-line no-console
              console.warn("[pretable] clipboard copy failed", err);
            });
          }
          return;
        }

        const before = grid.getSnapshot();
        const handled = handleSurfaceKeyDown(event, {
          bodyViewportHeight,
          columns: effectiveColumns,
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
        aria-atomic="true"
        aria-live="polite"
        className="pt-sr-only"
        data-pretable-live-region=""
        role="status"
      >
        {liveMessage}
      </div>
      <div
        aria-rowindex={1}
        data-pretable-header-row=""
        role="row"
        style={getHeaderRowStyle(renderSnapshot.totalWidth, headerHeight)}
      >
        {renderSnapshot.columns.map((plannedCol) => {
          const column = effectiveColumns[plannedCol.index];

          if (!column) {
            return null;
          }

          if (column.id === ROW_SELECT_COLUMN_ID) {
            const pinnedOffset = pinnedOffsets[column.id];
            const positionStyle =
              plannedCol.pinned === "left" && pinnedOffset !== undefined
                ? {
                    ...getHeaderCellStyle(plannedCol.left, plannedCol.width),
                    ...getPinnedCellStyle(pinnedOffset),
                  }
                : getHeaderCellStyle(plannedCol.left, plannedCol.width);
            const visibleRows = snapshot.visibleRows;
            const allFullySelected =
              visibleRows.length > 0 &&
              visibleRows.every((r) => fullySelectedRowIds.has(r.id));
            const anySelected = visibleRows.some(
              (r) =>
                fullySelectedRowIds.has(r.id) || indeterminateRowIds.has(r.id),
            );
            const headerCheckState: "true" | "false" | "mixed" =
              allFullySelected ? "true" : anySelected ? "mixed" : "false";
            const showHeaderCheckbox =
              rowSelectionColumn?.headerCheckbox !== false;

            return (
              <div
                aria-colindex={plannedCol.index + 1}
                data-pretable-header-cell=""
                data-pretable-row-select-header=""
                data-pinned={plannedCol.pinned === "left" ? "left" : undefined}
                key={column.id}
                role="columnheader"
                style={{
                  alignItems: "center",
                  display: "flex",
                  justifyContent: "center",
                  padding: 0,
                  ...positionStyle,
                }}
              >
                {showHeaderCheckbox ? (
                  <button
                    aria-checked={headerCheckState}
                    aria-label="Select all rows"
                    data-pretable-row-select-all="true"
                    onClick={(event) => {
                      event.stopPropagation();
                      const before = grid.getSnapshot();
                      grid.setSelectAllVisible(!allFullySelected);
                      const after = grid.getSnapshot();
                      if (
                        JSON.stringify(before.selection) !==
                        JSON.stringify(after.selection)
                      ) {
                        onSelectionChange?.(after.selection);
                      }
                    }}
                    role="checkbox"
                    type="button"
                  >
                    {headerCheckState === "true"
                      ? "✓"
                      : headerCheckState === "mixed"
                        ? "–"
                        : ""}
                  </button>
                ) : null}
              </div>
            );
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
                const column = effectiveColumns[plannedCol.index];

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

                const isRowSelectCell = column.id === ROW_SELECT_COLUMN_ID;
                const rowCheckState: "true" | "false" | "mixed" =
                  fullySelectedRowIds.has(id)
                    ? "true"
                    : indeterminateRowIds.has(id)
                      ? "mixed"
                      : "false";

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
                    data-row-select-cell={isRowSelectCell ? "true" : undefined}
                    data-selected={cellIsSelected ? "true" : "false"}
                    key={`${id}:${column.id}`}
                    onClick={(event) => {
                      if (column.id === ROW_SELECT_COLUMN_ID) return;
                      handleCellClick({
                        cmd: event.metaKey || event.ctrlKey,
                        columnId: column.id,
                        columns: effectiveColumns,
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
                      if (column.id === ROW_SELECT_COLUMN_ID) return;
                      const cmd = event.metaKey || event.ctrlKey;
                      if (event.shiftKey || cmd) return;

                      dragStartSelectionRef.current =
                        grid.getSnapshot().selection;
                      dragAnchorRef.current = {
                        rowId: id,
                        columnId: column.id,
                      };
                      handleCellClick({
                        cmd: false,
                        columnId: column.id,
                        columns: effectiveColumns,
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
                      if (column.id === ROW_SELECT_COLUMN_ID) return;
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
                          effectiveColumns.filter(
                            (c) => c.id !== ROW_SELECT_COLUMN_ID,
                          ),
                        );
                        const afterFullRow = singleFullRowSelection(
                          after.selection,
                          effectiveColumns.filter(
                            (c) => c.id !== ROW_SELECT_COLUMN_ID,
                          ),
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
                    {isRowSelectCell ? (
                      <button
                        aria-checked={rowCheckState}
                        aria-label="Select row"
                        data-pretable-row-select="true"
                        onClick={(event) => {
                          event.stopPropagation();
                          event.preventDefault();
                          const before = grid.getSnapshot();
                          const visible = before.visibleRows;

                          if (
                            event.shiftKey &&
                            lastCheckedRowAnchorRef.current
                          ) {
                            const anchorId = lastCheckedRowAnchorRef.current;
                            const anchorIdx = visible.findIndex(
                              (r) => r.id === anchorId,
                            );
                            const clickedIdx = visible.findIndex(
                              (r) => r.id === id,
                            );
                            if (anchorIdx >= 0 && clickedIdx >= 0) {
                              const [lo, hi] =
                                anchorIdx <= clickedIdx
                                  ? [anchorIdx, clickedIdx]
                                  : [clickedIdx, anchorIdx];
                              for (let i = lo; i <= hi; i += 1) {
                                const r = visible[i];
                                if (r && !fullySelectedRowIds.has(r.id)) {
                                  grid.toggleRowSelection(r.id);
                                }
                              }
                            }
                          } else {
                            grid.toggleRowSelection(id);
                          }

                          lastCheckedRowAnchorRef.current = id;

                          const after = grid.getSnapshot();
                          if (
                            JSON.stringify(before.selection) !==
                            JSON.stringify(after.selection)
                          ) {
                            onSelectionChange?.(after.selection);
                          }
                        }}
                        role="checkbox"
                        type="button"
                      >
                        {rowCheckState === "true"
                          ? "✓"
                          : rowCheckState === "mixed"
                            ? "–"
                            : ""}
                      </button>
                    ) : renderBodyCell ? (
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

    const dataColumns = columns.filter((c) => c.id !== ROW_SELECT_COLUMN_ID);
    const beforeFullRow = singleFullRowSelection(before.selection, dataColumns);
    const afterFullRow = singleFullRowSelection(after.selection, dataColumns);

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
    columns: allColumns,
    grid,
    onSelectedRowIdChange,
    selectFocusedRowOnArrowKey,
    tabBehavior,
  } = ctx;
  // For keyboard navigation purposes treat the synthetic row-select column as
  // non-existent: Home/End/Tab boundaries and full-row selections operate on
  // data columns only.
  const columns = allColumns.filter((c) => c.id !== ROW_SELECT_COLUMN_ID);
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

    // Snap off the synthetic row-select column if we landed there.
    const after = grid.getSnapshot();
    if (after.focus.columnId === ROW_SELECT_COLUMN_ID && firstColumn) {
      const rowId = after.focus.rowId;
      if (rowId) {
        grid.setFocus({ rowId, columnId: firstColumn.id });
      }
    }

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
