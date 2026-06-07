import {
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  memo,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AutosizeOptions,
  PretableCellAddress,
  PretableCellRange,
  PretableFocusState,
  PretableGrid,
  PretableGridOptions,
  PretableGridSnapshot,
  PretableRow,
  PretableSelectionState,
} from "@pretable/core";
import type {
  PretableCellRenderInput,
  PretableColumn,
  PretableHeaderRenderInput,
} from "./types";

type PretableFocusDirection = "up" | "down" | "left" | "right";

import { measureRenderedRowHeight } from "./row-height";
import {
  type PretableSurfaceState,
  type PretableTelemetry,
  usePretable,
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

/**
 * Configuration for the synthetic row-select column rendered by {@link PretableSurface} when `rowSelectionColumn` is enabled.
 *
 * @public
 */
export interface RowSelectionColumnConfig {
  enabled: true;
  position?: "left";
  pinned?: boolean;
  headerCheckbox?: boolean;
  width?: number;
}

/**
 * Localizable user-facing strings rendered by {@link PretableSurface}. Pass to override the English defaults.
 *
 * @public
 */
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

const defaultMessages: Required<PretableSurfaceMessages> = {
  selectAllAnnouncement: ({ rowCount, columnCount, isAll }) =>
    isAll
      ? "All rows selected"
      : `${rowCount} rows × ${columnCount} columns selected`,
  copyAnnouncement: ({ rowCount, columnCount }) =>
    `${rowCount} rows × ${columnCount} columns copied`,
  copyFailedAnnouncement: () => "Copy failed",
};

const ANNOUNCE_DEBOUNCE_MS = 500;

const REORDER_THRESHOLD_PX = 5;

interface PretableSurfaceHeaderCellRenderInput<
  TRow extends PretableRow = PretableRow,
> {
  column: PretableColumn<TRow>;
  label: string;
  sortDirection: "asc" | "desc" | null;
}

type PretableSurfaceBodyCellRenderInput<
  TRow extends PretableRow = PretableRow,
> = PretableCellRenderInput<TRow>;

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

/**
 * Props for {@link PretableSurface}.
 *
 * @public
 */
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
  onColumnWidthsChange?: (next: Record<string, number>) => void;
  onColumnOrderChange?: (next: readonly string[]) => void;
  onColumnPinnedChange?: (next: Record<string, "left" | null>) => void;
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
   * Tab key behavior. Default `"wrap-rows"` matches Grid Alpha / Sheets — Tab
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

interface MemoizedCellContentProps {
  rowId: string;
  columnId: string;
  value: unknown;
  formattedValue: string;
  isFocused: boolean;
  isSelected: boolean;
  renderRef:
    | ((input: PretableCellRenderInput<PretableRow>) => ReactNode)
    | null;
  fallbackRenderRef:
    | ((input: PretableCellRenderInput<PretableRow>) => ReactNode)
    | null;
  cellRenderInput: PretableCellRenderInput<PretableRow>;
}

function CellContentImpl({
  formattedValue,
  renderRef,
  fallbackRenderRef,
  cellRenderInput,
}: MemoizedCellContentProps) {
  if (renderRef) {
    return <>{renderRef(cellRenderInput)}</>;
  }
  if (fallbackRenderRef) {
    return <>{fallbackRenderRef(cellRenderInput)}</>;
  }
  return <>{formattedValue}</>;
}

function cellContentPropsEqual(
  prev: MemoizedCellContentProps,
  next: MemoizedCellContentProps,
): boolean {
  return (
    prev.rowId === next.rowId &&
    prev.columnId === next.columnId &&
    prev.value === next.value &&
    prev.formattedValue === next.formattedValue &&
    prev.isFocused === next.isFocused &&
    prev.isSelected === next.isSelected &&
    prev.renderRef === next.renderRef &&
    prev.fallbackRenderRef === next.fallbackRenderRef
  );
}

const MemoizedCellContent = memo(CellContentImpl, cellContentPropsEqual);

interface MemoizedHeaderContentProps {
  columnId: string;
  label: string;
  sortDirection: "asc" | "desc" | null;
  isSorted: boolean;
  width: number;
  isSortable: boolean;
  renderHeaderRef:
    | ((input: PretableHeaderRenderInput<PretableRow>) => ReactNode)
    | null;
  fallbackRenderHeaderRef:
    | ((input: {
        column: PretableColumn<PretableRow>;
        label: string;
        sortDirection: "asc" | "desc" | null;
      }) => ReactNode)
    | null;
  headerRenderInput: PretableHeaderRenderInput<PretableRow>;
}

function HeaderContentImpl({
  label,
  sortDirection,
  renderHeaderRef,
  fallbackRenderHeaderRef,
  headerRenderInput,
}: MemoizedHeaderContentProps) {
  if (renderHeaderRef) {
    return <>{renderHeaderRef(headerRenderInput)}</>;
  }
  if (fallbackRenderHeaderRef) {
    return (
      <>
        {fallbackRenderHeaderRef({
          column: headerRenderInput.column,
          label,
          sortDirection,
        })}
      </>
    );
  }
  return (
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
  );
}

function headerContentPropsEqual(
  prev: MemoizedHeaderContentProps,
  next: MemoizedHeaderContentProps,
): boolean {
  return (
    prev.columnId === next.columnId &&
    prev.label === next.label &&
    prev.sortDirection === next.sortDirection &&
    prev.isSorted === next.isSorted &&
    prev.width === next.width &&
    prev.isSortable === next.isSortable &&
    prev.renderHeaderRef === next.renderHeaderRef &&
    prev.fallbackRenderHeaderRef === next.fallbackRenderHeaderRef
  );
}

const MemoizedHeaderContent = memo(HeaderContentImpl, headerContentPropsEqual);

/**
 * Controlled grid surface. The primary React component. Pass `state` to control any subset of sort/filter/selection/focus/column-layout from the outside; omit slices you want the grid to own.
 *
 * @public
 */
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
  onColumnWidthsChange,
  onColumnOrderChange,
  onColumnPinnedChange,
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
  messages,
}: PretableSurfaceProps<TRow>) {
  const [measuredHeights, setMeasuredHeights] = useState<
    Record<string, number>
  >({});
  const [dragLiveWidth, setDragLiveWidth] = useState<{
    columnId: string;
    width: number;
  } | null>(null);
  const resizeStateRef = useRef<{
    columnId: string;
    startX: number;
    startWidth: number;
    pointerId: number;
  } | null>(null);
  const wasResizingRef = useRef(false);
  const wasReorderingRef = useRef(false);
  const reorderStateRef = useRef<{
    columnId: string;
    pointerId: number;
    startX: number;
    startY: number;
    dragging: boolean;
  } | null>(null);
  const [reorderDrag, setReorderDrag] = useState<{
    columnId: string;
    cursorX: number;
    cursorY: number;
    dropIndex: number;
    ghostWidth: number;
    ghostHeight: number;
    ghostHeader: string;
  } | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [liveMessage, setLiveMessage] = useState<string>("");
  const announceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingAnnouncementRef = useRef<string | null>(null);

  const scheduleAnnouncement = useCallback((message: string) => {
    pendingAnnouncementRef.current = message;
    if (announceTimerRef.current !== null) {
      clearTimeout(announceTimerRef.current);
    }
    announceTimerRef.current = setTimeout(() => {
      if (pendingAnnouncementRef.current !== null) {
        setLiveMessage(pendingAnnouncementRef.current);
        pendingAnnouncementRef.current = null;
      }
      announceTimerRef.current = null;
    }, ANNOUNCE_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (announceTimerRef.current !== null) {
        clearTimeout(announceTimerRef.current);
      }
    };
  }, []);

  const effectiveMessages = useMemo(
    () => ({
      selectAllAnnouncement:
        messages?.selectAllAnnouncement ??
        defaultMessages.selectAllAnnouncement,
      copyAnnouncement:
        messages?.copyAnnouncement ?? defaultMessages.copyAnnouncement,
      copyFailedAnnouncement:
        messages?.copyFailedAnnouncement ??
        defaultMessages.copyFailedAnnouncement,
    }),
    [messages],
  );
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
  const { grid, snapshot, renderSnapshot, telemetry } = usePretable({
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
  const focusedRowId = snapshot.focus.rowId;
  const focusedColumnId = snapshot.focus.columnId;
  const pinnedOffsets = useMemo(
    () => getPinnedLeftOffsets(effectiveColumns),
    [effectiveColumns],
  );

  // Build per-column left/width arrays indexed by effectiveColumn index.
  // After a reorder, grid.options.columns (engine state, used to build
  // renderSnapshot) and effectiveColumns (prop-derived) diverge in order.
  // Look up columns by id so render aligns with the engine's order.
  const columnsById = useMemo(() => {
    const map = new Map<string, PretableColumn<TRow>>();
    for (const col of effectiveColumns) {
      map.set(col.id, col);
    }
    return map;
  }, [effectiveColumns]);

  // Used by the reorder gesture to compute drop positions without DOM
  // measurement (so it works in jsdom). Pulled from renderSnapshot.columns
  // where available; columns outside the rendered window fall back to the
  // accumulated width sum. Indexed by renderSnapshot column position
  // (= engine order), NOT by effectiveColumns position.
  const { columnLefts, columnWidths } = useMemo(() => {
    const engineColumns = grid.options.columns;
    const lefts = new Array<number>(engineColumns.length).fill(0);
    const widths = new Array<number>(engineColumns.length).fill(0);
    for (const planned of renderSnapshot.columns) {
      lefts[planned.index] = planned.left;
      widths[planned.index] = planned.width;
    }
    // Fill any gaps (off-screen columns) by accumulating widths in
    // engine order.
    let acc = 0;
    for (let i = 0; i < engineColumns.length; i += 1) {
      const col = engineColumns[i]!;
      if (widths[i] === 0) {
        widths[i] = col.widthPx ?? 0;
        lefts[i] = acc;
      }
      acc = lefts[i]! + widths[i]!;
    }
    return { columnLefts: lefts, columnWidths: widths };
  }, [renderSnapshot.columns, grid.options.columns]);

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

  const dataColumnIndex = useMemo(() => {
    const dataColumns = effectiveColumns.filter(
      (c) => c.id !== ROW_SELECT_COLUMN_ID,
    );
    const idxById = new Map<string, number>();
    for (let i = 0; i < dataColumns.length; i += 1) {
      idxById.set(dataColumns[i]!.id, i);
    }
    return { dataColumns, idxById };
  }, [effectiveColumns]);

  const { fullySelectedRowIds, indeterminateRowIds } = useMemo(() => {
    const fullyRows = new Set<string>();
    const indeterminateRows = new Set<string>();
    const ranges = snapshot.selection.ranges;
    const { dataColumns, idxById: dataColIdxByColId } = dataColumnIndex;

    if (ranges.length === 0 || dataColumns.length === 0) {
      return {
        fullySelectedRowIds: fullyRows,
        indeterminateRowIds: indeterminateRows,
      };
    }

    const visibleRows = snapshot.visibleRows;
    const colCount = dataColumns.length;

    // Fast path: ≤30 data columns → 32-bit bitmask per row, single OR per
    // range-row. Cmd+A on 3000 rows × 9 cols → 3000 Map ops, no Set
    // allocations. Falls back to Set-based coverage for wider grids.
    if (colCount <= 30) {
      const rowMask = new Map<number, number>();
      for (const range of ranges) {
        const r1 = visibleRowIndexById.get(range.startRowId);
        const r2 = visibleRowIndexById.get(range.endRowId);
        if (r1 === undefined || r2 === undefined) continue;
        const rowLo = Math.min(r1, r2);
        const rowHi = Math.max(r1, r2);

        const startSynth = range.startColumnId === ROW_SELECT_COLUMN_ID;
        const endSynth = range.endColumnId === ROW_SELECT_COLUMN_ID;
        let dataColLo: number;
        let dataColHi: number;
        if (startSynth && endSynth) {
          continue;
        }
        if (startSynth || endSynth) {
          dataColLo = 0;
          dataColHi = colCount - 1;
        } else {
          const a = dataColIdxByColId.get(range.startColumnId);
          const b = dataColIdxByColId.get(range.endColumnId);
          if (a === undefined || b === undefined) continue;
          dataColLo = Math.min(a, b);
          dataColHi = Math.max(a, b);
        }
        const spanWidth = dataColHi - dataColLo + 1;
        const spanMask =
          ((spanWidth >= 30 ? 0x3fffffff : (1 << spanWidth) - 1) <<
            dataColLo) >>>
          0;
        for (let rowIdx = rowLo; rowIdx <= rowHi; rowIdx += 1) {
          rowMask.set(rowIdx, (rowMask.get(rowIdx) ?? 0) | spanMask);
        }
      }
      const fullMask =
        colCount >= 30 ? 0x3fffffff : ((1 << colCount) - 1) >>> 0;
      for (const [rowIdx, mask] of rowMask) {
        if (mask === 0) continue;
        const row = visibleRows[rowIdx];
        if (!row) continue;
        if (mask === fullMask) fullyRows.add(row.id);
        else indeterminateRows.add(row.id);
      }
    } else {
      const rowCoverage = new Map<number, Set<number>>();
      for (const range of ranges) {
        const r1 = visibleRowIndexById.get(range.startRowId);
        const r2 = visibleRowIndexById.get(range.endRowId);
        if (r1 === undefined || r2 === undefined) continue;
        const rowLo = Math.min(r1, r2);
        const rowHi = Math.max(r1, r2);
        const startSynth = range.startColumnId === ROW_SELECT_COLUMN_ID;
        const endSynth = range.endColumnId === ROW_SELECT_COLUMN_ID;
        let dataColLo: number;
        let dataColHi: number;
        if (startSynth && endSynth) continue;
        if (startSynth || endSynth) {
          dataColLo = 0;
          dataColHi = colCount - 1;
        } else {
          const a = dataColIdxByColId.get(range.startColumnId);
          const b = dataColIdxByColId.get(range.endColumnId);
          if (a === undefined || b === undefined) continue;
          dataColLo = Math.min(a, b);
          dataColHi = Math.max(a, b);
        }
        for (let rowIdx = rowLo; rowIdx <= rowHi; rowIdx += 1) {
          let cov = rowCoverage.get(rowIdx);
          if (!cov) {
            cov = new Set<number>();
            rowCoverage.set(rowIdx, cov);
          }
          for (let colIdx = dataColLo; colIdx <= dataColHi; colIdx += 1) {
            cov.add(colIdx);
          }
        }
      }
      for (const [rowIdx, cov] of rowCoverage) {
        const row = visibleRows[rowIdx];
        if (!row) continue;
        if (cov.size === 0) continue;
        if (cov.size === colCount) fullyRows.add(row.id);
        else indeterminateRows.add(row.id);
      }
    }

    return {
      fullySelectedRowIds: fullyRows,
      indeterminateRowIds: indeterminateRows,
    };
  }, [
    snapshot.selection.ranges,
    snapshot.visibleRows,
    dataColumnIndex,
    visibleRowIndexById,
  ]);

  // Per-cell selection check. Materializing a 27k-key Set on Cmd+A was the
  // bottleneck — instead, scan the (typically ≤3) ranges per visible cell,
  // and only the ~18 actually-rendered cells call this.
  const isCellSelected = useCallback(
    (rowId: string, columnId: string): boolean => {
      const ranges = snapshot.selection.ranges;
      if (ranges.length === 0) return false;
      const rIdx = visibleRowIndexById.get(rowId);
      if (rIdx === undefined) return false;
      const cIdx = dataColumnIndex.idxById.get(columnId);
      if (cIdx === undefined) return false;
      for (const range of ranges) {
        const r1 = visibleRowIndexById.get(range.startRowId);
        const r2 = visibleRowIndexById.get(range.endRowId);
        if (r1 === undefined || r2 === undefined) continue;
        if (rIdx < Math.min(r1, r2) || rIdx > Math.max(r1, r2)) continue;
        const startSynth = range.startColumnId === ROW_SELECT_COLUMN_ID;
        const endSynth = range.endColumnId === ROW_SELECT_COLUMN_ID;
        if (startSynth && endSynth) continue;
        if (startSynth || endSynth) return true;
        const a = dataColumnIndex.idxById.get(range.startColumnId);
        const b = dataColumnIndex.idxById.get(range.endColumnId);
        if (a === undefined || b === undefined) continue;
        if (cIdx >= Math.min(a, b) && cIdx <= Math.max(a, b)) return true;
      }
      return false;
    },
    [snapshot.selection.ranges, visibleRowIndexById, dataColumnIndex],
  );

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (el && viewportWidth === 0) {
      setViewportWidth(el.clientWidth);
    }
  }, [viewportWidth]);

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
    if (!focusedRowId || !focusedColumnId) {
      return;
    }

    const cellNode = cellNodesRef.current.get(
      `${focusedRowId}::${focusedColumnId}`,
    );

    if (cellNode && document.activeElement !== cellNode) {
      cellNode.focus({ preventScroll: true });
    }
  }, [focusedRowId, focusedColumnId]);

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
      const plannedHeight = Number(
        node.getAttribute("data-pretable-row-height"),
      );
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
        // Esc during reorder drag cancels without engine mutation.
        if (
          (event.key === "Escape" || event.key === "Esc") &&
          reorderStateRef.current?.dragging
        ) {
          reorderStateRef.current = null;
          setReorderDrag(null);
          event.preventDefault();
          return;
        }
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
          if (snap.selection.ranges.length === 0) {
            return;
          }
          const args: SerializeRangesArgs<TRow> = {
            ranges: snap.selection.ranges,
            visibleRows: snap.visibleRows,
            columns: effectiveColumns,
            copyWithHeaders: copyWithHeaders ?? false,
          };
          const payload = onCopy ? onCopy(args) : serializeRangesAsTsv(args);
          if (payload) {
            const extent = computeSelectionExtent(
              snap.selection.ranges,
              snap,
              effectiveColumns,
            );
            Promise.resolve(
              (copyToClipboard ?? defaultCopyToClipboard)(payload),
            )
              .then(() => {
                scheduleAnnouncement(
                  effectiveMessages.copyAnnouncement({
                    rowCount: extent.rowCount,
                    columnCount: extent.columnCount,
                  }),
                );
              })
              .catch((err) => {
                console.warn("[pretable] clipboard copy failed", err);
                scheduleAnnouncement(
                  effectiveMessages.copyFailedAnnouncement(),
                );
              });
          }
          return;
        }

        const isSelectAll =
          (event.metaKey || event.ctrlKey) &&
          (event.key === "a" || event.key === "A") &&
          !event.shiftKey &&
          !event.altKey;

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
          if (isSelectAll) {
            const extent = computeSelectionExtent(
              after.selection.ranges,
              after,
              effectiveColumns,
            );
            scheduleAnnouncement(
              effectiveMessages.selectAllAnnouncement({
                rowCount: extent.rowCount,
                columnCount: extent.columnCount,
                isAll: extent.isAll,
              }),
            );
          }
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
        {renderSnapshot.columns.flatMap((plannedCol) => {
          const column = columnsById.get(plannedCol.id);

          if (!column) {
            return [];
          }

          const effWidth =
            dragLiveWidth?.columnId === column.id
              ? dragLiveWidth.width
              : plannedCol.width;

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

            // Note: data-pretable-column-id is intentionally absent here — the
            // row-select column is a synthetic UI column (ROW_SELECT_COLUMN_ID),
            // not a user data column, so it has no meaningful column id to expose.
            return (
              <div
                aria-colindex={plannedCol.index + 1}
                data-pretable-header-cell=""
                data-pretable-row-select-header=""
                data-pretable-pinned={
                  plannedCol.pinned === "left" ? "left" : undefined
                }
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
                      const setting = !allFullySelected;
                      grid.setSelectAllVisible(setting);
                      const after = grid.getSnapshot();
                      if (
                        JSON.stringify(before.selection) !==
                        JSON.stringify(after.selection)
                      ) {
                        onSelectionChange?.(after.selection);
                      }
                      if (setting) {
                        const extent = computeSelectionExtent(
                          after.selection.ranges,
                          after,
                          effectiveColumns,
                        );
                        scheduleAnnouncement(
                          effectiveMessages.selectAllAnnouncement({
                            rowCount: extent.rowCount,
                            columnCount: extent.columnCount,
                            isAll: extent.isAll,
                          }),
                        );
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
                  ...getHeaderCellStyle(plannedCol.left, effWidth),
                  ...getPinnedCellStyle(pinnedOffset),
                }
              : getHeaderCellStyle(plannedCol.left, effWidth);

          const ariaSort: "ascending" | "descending" | "none" =
            sortDirection === "asc"
              ? "ascending"
              : sortDirection === "desc"
                ? "descending"
                : "none";

          const showResizeHandle = column.resizable !== false;
          const isDragging = dragLiveWidth?.columnId === column.id;
          const handleLeft = plannedCol.left + effWidth - 4;
          const handlePinnedStyle =
            plannedCol.pinned === "left" && pinnedOffset !== undefined
              ? {
                  position: "sticky" as const,
                  zIndex: 3,
                  left: pinnedOffset + effWidth - 4,
                }
              : null;

          return [
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
              data-pretable-column-id={column.id}
              data-pretable-pinned={
                plannedCol.pinned === "left" ? "left" : undefined
              }
              key={column.id}
              role="columnheader"
              onClick={(event) => {
                if (wasReorderingRef.current) {
                  event.preventDefault();
                  wasReorderingRef.current = false;
                  return;
                }
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
              {...(column.id !== ROW_SELECT_COLUMN_ID &&
              column.reorderable !== false
                ? {
                    onPointerDown: (
                      event: ReactPointerEvent<HTMLButtonElement>,
                    ) => {
                      if (event.button !== 0) return;
                      if (event.shiftKey || event.metaKey || event.ctrlKey)
                        return;
                      reorderStateRef.current = {
                        columnId: column.id,
                        pointerId: event.pointerId,
                        startX: event.clientX,
                        startY: event.clientY,
                        dragging: false,
                      };
                    },
                    onPointerMove: (
                      event: ReactPointerEvent<HTMLButtonElement>,
                    ) => {
                      const drag = reorderStateRef.current;
                      if (!drag || drag.columnId !== column.id) return;
                      if (event.pointerId !== drag.pointerId) return;

                      const dx = event.clientX - drag.startX;
                      const dy = event.clientY - drag.startY;
                      const dist = Math.hypot(dx, dy);

                      const surfaceRect =
                        viewportRef.current?.getBoundingClientRect();
                      const surfaceLeft = surfaceRect?.left ?? 0;

                      if (!drag.dragging) {
                        if (dist < REORDER_THRESHOLD_PX) return;
                        drag.dragging = true;
                        try {
                          event.currentTarget.setPointerCapture(
                            event.pointerId,
                          );
                        } catch {
                          // jsdom — no-op
                        }
                        const headerEl = event.currentTarget as HTMLElement;
                        const rect = headerEl.getBoundingClientRect();
                        setReorderDrag({
                          columnId: column.id,
                          cursorX: event.clientX,
                          cursorY: event.clientY,
                          dropIndex: computeDropIndex(
                            event.clientX,
                            effectiveColumns.length,
                            columnLefts,
                            columnWidths,
                            surfaceLeft,
                          ),
                          ghostWidth: rect.width || effWidth,
                          ghostHeight: rect.height || headerHeight,
                          ghostHeader: String(column.header ?? column.id),
                        });
                        return;
                      }

                      setReorderDrag((prev) =>
                        prev
                          ? {
                              ...prev,
                              cursorX: event.clientX,
                              cursorY: event.clientY,
                              dropIndex: computeDropIndex(
                                event.clientX,
                                effectiveColumns.length,
                                columnLefts,
                                columnWidths,
                                surfaceLeft,
                              ),
                            }
                          : null,
                      );
                    },
                    onPointerUp: (
                      event: ReactPointerEvent<HTMLButtonElement>,
                    ) => {
                      const drag = reorderStateRef.current;
                      if (!drag || drag.columnId !== column.id) return;
                      if (event.pointerId !== drag.pointerId) return;

                      const current = reorderDrag;
                      if (drag.dragging && current) {
                        wasReorderingRef.current = true;
                        const beforePinned = buildPinnedMap(grid);
                        grid.moveColumn(column.id, current.dropIndex);
                        const afterOrder = grid.options.columns
                          .map((c) => c.id)
                          .filter((id) => id !== ROW_SELECT_COLUMN_ID);
                        onColumnOrderChange?.(afterOrder);
                        const afterPinned = buildPinnedMap(grid);
                        if (!pinnedMapsEqual(beforePinned, afterPinned)) {
                          onColumnPinnedChange?.(afterPinned);
                        }
                      }

                      try {
                        event.currentTarget.releasePointerCapture(
                          event.pointerId,
                        );
                      } catch {
                        // jsdom — no-op
                      }
                      reorderStateRef.current = null;
                      setReorderDrag(null);
                    },
                    onPointerCancel: () => {
                      reorderStateRef.current = null;
                      setReorderDrag(null);
                    },
                  }
                : {})}
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
              <MemoizedHeaderContent
                columnId={column.id}
                label={label}
                sortDirection={sortDirection}
                isSorted={sortDirection !== null}
                width={effWidth}
                isSortable={column.sortable !== false}
                renderHeaderRef={
                  (column.renderHeader as
                    | ((
                        input: PretableHeaderRenderInput<PretableRow>,
                      ) => ReactNode)
                    | undefined) ?? null
                }
                fallbackRenderHeaderRef={
                  (renderHeaderCell as
                    | ((input: {
                        column: PretableColumn<PretableRow>;
                        label: string;
                        sortDirection: "asc" | "desc" | null;
                      }) => ReactNode)
                    | undefined) ?? null
                }
                headerRenderInput={
                  {
                    column,
                    label,
                    sortDirection,
                    isSorted: sortDirection !== null,
                  } as unknown as PretableHeaderRenderInput<PretableRow>
                }
              />
            </button>,
            showResizeHandle ? (
              <div
                key={`${column.id}::resize-handle`}
                data-pretable-resize-handle=""
                data-pretable-column-id={column.id}
                data-pretable-dragging={isDragging ? "true" : "false"}
                style={{
                  position: "absolute",
                  top: 0,
                  height: "100%",
                  width: 4,
                  left: handleLeft,
                  cursor: "col-resize",
                  zIndex: 4,
                  touchAction: "none",
                  userSelect: "none",
                  ...(handlePinnedStyle ?? {}),
                }}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.stopPropagation();
                  const startWidth =
                    column.widthPx ??
                    plannedCol.width ??
                    Math.max(column.minWidthPx ?? 40, 80);
                  resizeStateRef.current = {
                    columnId: column.id,
                    startX: event.clientX,
                    startWidth,
                    pointerId: event.pointerId,
                  };
                  wasResizingRef.current = false;
                  try {
                    event.currentTarget.setPointerCapture(event.pointerId);
                  } catch {
                    // jsdom — no-op
                  }
                  setDragLiveWidth({ columnId: column.id, width: startWidth });
                }}
                onPointerMove={(event) => {
                  const drag = resizeStateRef.current;
                  if (!drag || drag.columnId !== column.id) return;
                  const min = column.minWidthPx ?? 40;
                  const max = column.maxWidthPx ?? Infinity;
                  const next = Math.max(
                    min,
                    Math.min(
                      max,
                      drag.startWidth + (event.clientX - drag.startX),
                    ),
                  );
                  if (Math.abs(next - drag.startWidth) > 0) {
                    wasResizingRef.current = true;
                  }
                  setDragLiveWidth({ columnId: column.id, width: next });
                }}
                onPointerUp={(event) => {
                  const drag = resizeStateRef.current;
                  if (!drag || drag.columnId !== column.id) return;
                  const finalWidth = dragLiveWidth?.width ?? drag.startWidth;
                  try {
                    event.currentTarget.releasePointerCapture(drag.pointerId);
                  } catch {
                    // jsdom — no-op
                  }
                  grid.setColumnWidth(column.id, finalWidth);
                  onColumnWidthsChange?.(buildWidthsMap(grid));
                  resizeStateRef.current = null;
                  setDragLiveWidth(null);
                }}
                onPointerCancel={() => {
                  resizeStateRef.current = null;
                  setDragLiveWidth(null);
                  wasResizingRef.current = false;
                }}
                onDoubleClick={(event) => {
                  if (wasResizingRef.current) {
                    event.preventDefault();
                    wasResizingRef.current = false;
                    return;
                  }
                  grid.autosizeColumn(column.id);
                  onColumnWidthsChange?.(buildWidthsMap(grid));
                }}
              />
            ) : null,
          ];
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
              data-pretable-focused={isFocused ? "true" : "false"}
              data-pretable-row=""
              data-pretable-row-height={height}
              data-pretable-row-id={id}
              data-pretable-row-index={rowIndex}
              data-pretable-selected={isSelected ? "true" : "false"}
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
                const column = columnsById.get(plannedCol.id);

                if (!column) {
                  return null;
                }

                const value = resolveCellValue(row, column);
                const cellKey = `${id}::${column.id}`;
                const cellIsFocused =
                  isFocused && snapshot.focus.columnId === column.id;
                const cellIsSelected = isCellSelected(id, column.id);
                const formattedValue = column.format
                  ? column.format({ value, row, column })
                  : formatCellValue(value);
                const bodyInput = {
                  column,
                  formattedValue,
                  isFocused: cellIsFocused,
                  isSelected: cellIsSelected,
                  row,
                  rowId: id,
                  rowIndex,
                  value,
                } satisfies PretableSurfaceBodyCellRenderInput<TRow>;
                const bodyProps = getBodyCellProps?.(bodyInput) ?? {};
                const pinnedOffset = pinnedOffsets[column.id];
                const cellEffWidth =
                  dragLiveWidth?.columnId === column.id
                    ? dragLiveWidth.width
                    : plannedCol.width;
                const positionStyle =
                  plannedCol.pinned === "left" && pinnedOffset !== undefined
                    ? {
                        ...getCellStyle(plannedCol.left, cellEffWidth),
                        ...getPinnedCellStyle(pinnedOffset),
                      }
                    : getCellStyle(plannedCol.left, cellEffWidth);

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
                    data-pretable-column-id={column.id}
                    data-pretable-focused={cellIsFocused ? "true" : "false"}
                    data-pretable-pinned={
                      column.pinned === "left" ? "left" : undefined
                    }
                    data-pretable-cell=""
                    data-pretable-wrap={column.wrap ? "true" : undefined}
                    data-pretable-row-select-cell={
                      isRowSelectCell ? "true" : undefined
                    }
                    data-pretable-selected={cellIsSelected ? "true" : "false"}
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
                    ) : (
                      <MemoizedCellContent
                        rowId={id}
                        columnId={column.id}
                        value={value}
                        formattedValue={formattedValue}
                        isFocused={cellIsFocused}
                        isSelected={cellIsSelected}
                        renderRef={
                          (column.render as
                            | ((
                                input: PretableCellRenderInput<PretableRow>,
                              ) => ReactNode)
                            | undefined) ?? null
                        }
                        fallbackRenderRef={
                          (renderBodyCell as
                            | ((
                                input: PretableCellRenderInput<PretableRow>,
                              ) => ReactNode)
                            | undefined) ?? null
                        }
                        cellRenderInput={
                          bodyInput as unknown as PretableCellRenderInput<PretableRow>
                        }
                      />
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {reorderDrag ? (
        <>
          <div
            data-pretable-reorder-ghost=""
            style={{
              left: reorderDrag.cursorX + 8,
              top: reorderDrag.cursorY + 8,
              width: reorderDrag.ghostWidth,
              height: reorderDrag.ghostHeight,
              display: "flex",
              alignItems: "center",
              paddingLeft: 12,
            }}
          >
            {reorderDrag.ghostHeader}
          </div>
          <div
            data-pretable-reorder-drop-indicator=""
            style={{
              left: computeDropIndicatorLeft(
                reorderDrag.dropIndex,
                columnLefts,
                columnWidths,
              ),
              height: reorderDrag.ghostHeight + bodyViewportHeight,
            }}
          />
        </>
      ) : null}
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
    rowNode.getAttribute("data-pretable-focused") ?? "",
    rowNode.getAttribute("data-pretable-selected") ?? "",
  ];

  const cellParts = [
    ...rowNode.querySelectorAll<HTMLElement>("[data-pretable-cell]"),
  ].map((cell) =>
    [
      cell.getAttribute("data-pretable-column-id") ?? "",
      cell.getAttribute("class") ?? "",
      cell.getAttribute("style") ?? "",
      cell.getAttribute("data-pretable-wrap") ?? "",
      cell.getAttribute("data-pretable-focused") ?? "",
      cell.getAttribute("data-pretable-selected") ?? "",
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

function computeSelectionExtent<TRow extends PretableRow>(
  ranges: readonly PretableCellRange[],
  snapshot: PretableGridSnapshot<TRow>,
  effectiveColumns: readonly PretableColumn<TRow>[],
): { rowCount: number; columnCount: number; isAll: boolean } {
  const visibleRows = snapshot.visibleRows;
  const dataColumns = effectiveColumns.filter(
    (c) => c.id !== ROW_SELECT_COLUMN_ID,
  );

  if (
    ranges.length === 0 ||
    visibleRows.length === 0 ||
    dataColumns.length === 0
  ) {
    return { rowCount: 0, columnCount: 0, isAll: false };
  }

  const rowOrder = new Map<string, number>();
  for (let i = 0; i < visibleRows.length; i += 1) {
    const r = visibleRows[i];
    if (r) rowOrder.set(r.id, i);
  }
  const columnOrder = new Map<string, number>();
  for (let i = 0; i < effectiveColumns.length; i += 1) {
    const c = effectiveColumns[i];
    if (c) columnOrder.set(c.id, i);
  }

  const coveredRows = new Set<string>();
  const coveredCols = new Set<string>();

  for (const range of ranges) {
    // Resolve row span from range bounds. O(span), not O(rows × cols).
    const r1 = rowOrder.get(range.startRowId);
    const r2 = rowOrder.get(range.endRowId);
    if (r1 === undefined || r2 === undefined) continue;
    const rowLo = Math.min(r1, r2);
    const rowHi = Math.max(r1, r2);

    // Resolve column span. The synthetic row-select column expands to "all
    // data columns" when it appears as a range bound (this is how full-row
    // selections encode themselves).
    const startSynth = range.startColumnId === ROW_SELECT_COLUMN_ID;
    const endSynth = range.endColumnId === ROW_SELECT_COLUMN_ID;
    let colsForRange: PretableColumn<TRow>[];

    if (startSynth && endSynth) {
      // Range spans only the synthetic column — no data cells covered.
      continue;
    }

    if (startSynth || endSynth) {
      colsForRange = dataColumns.slice();
    } else {
      const c1 = columnOrder.get(range.startColumnId);
      const c2 = columnOrder.get(range.endColumnId);
      if (c1 === undefined || c2 === undefined) continue;
      const colLo = Math.min(c1, c2);
      const colHi = Math.max(c1, c2);
      colsForRange = [];
      for (let i = colLo; i <= colHi; i += 1) {
        const col = effectiveColumns[i];
        if (col && col.id !== ROW_SELECT_COLUMN_ID) {
          colsForRange.push(col);
        }
      }
    }

    if (colsForRange.length === 0) continue;

    for (let i = rowLo; i <= rowHi; i += 1) {
      const row = visibleRows[i];
      if (row) coveredRows.add(row.id);
    }
    for (const col of colsForRange) {
      coveredCols.add(col.id);
    }
  }

  const rowCount = coveredRows.size;
  const columnCount = coveredCols.size;
  const isAll =
    rowCount === visibleRows.length && columnCount === dataColumns.length;

  return { rowCount, columnCount, isAll };
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

function buildWidthsMap<TRow extends PretableRow>(
  grid: PretableGrid<TRow>,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const col of grid.options.columns) {
    if (col.id === ROW_SELECT_COLUMN_ID) continue;
    if (typeof col.widthPx === "number") {
      result[col.id] = col.widthPx;
    }
  }
  return result;
}

function buildPinnedMap<TRow extends PretableRow>(
  grid: PretableGrid<TRow>,
): Record<string, "left" | null> {
  const result: Record<string, "left" | null> = {};
  for (const col of grid.options.columns) {
    if (col.id === ROW_SELECT_COLUMN_ID) continue;
    result[col.id] = col.pinned === "left" ? "left" : null;
  }
  return result;
}

function pinnedMapsEqual(
  a: Record<string, "left" | null>,
  b: Record<string, "left" | null>,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

function computeDropIndex(
  cursorX: number,
  columnCount: number,
  columnLefts: number[],
  columnWidths: number[],
  surfaceLeft: number,
): number {
  // Cursor X is in viewport coordinates. Convert to surface-relative.
  const x = cursorX - surfaceLeft;
  for (let i = 0; i < columnCount; i += 1) {
    const left = columnLefts[i] ?? 0;
    const width = columnWidths[i] ?? 0;
    const mid = left + width / 2;
    if (x < mid) {
      return i;
    }
  }
  return Math.max(0, columnCount - 1);
}

function computeDropIndicatorLeft(
  dropIndex: number,
  columnLefts: number[],
  columnWidths: number[],
): number {
  if (dropIndex >= columnLefts.length) {
    const lastIdx = columnLefts.length - 1;
    if (lastIdx < 0) return 0;
    return (columnLefts[lastIdx] ?? 0) + (columnWidths[lastIdx] ?? 0);
  }
  return columnLefts[dropIndex] ?? 0;
}
