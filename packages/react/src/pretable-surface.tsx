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
  ColumnFilter,
  PretableCellAddress,
  PretableCellRange,
  PretableEditInput,
  PretableFocusState,
  PretableGrid,
  PretableGridOptions,
  PretableGridSnapshot,
  PretableRow,
  PretableSelectionState,
  PretableSortEntry,
  PretableVisibleRow,
} from "@pretable/core";
import type {
  PretableCellRenderInput,
  PretableColumn,
  PretableEditorInput,
  PretableHeaderRenderInput,
} from "./types";
import {
  scrollLeftToReveal,
  scrollTopToReveal,
} from "@pretable-internal/renderer-dom";

type PretableFocusDirection = "up" | "down" | "left" | "right";

import { planColumnLayout } from "@pretable-internal/renderer-dom";
import { computeColumnDropTarget } from "./column-drag-geometry";
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
  resolveCellValue,
} from "./rendering";
import {
  getCellStyle,
  getHeaderCellStyle,
  getHeaderOverlayAnchorStyle,
  getHeaderRowStyle,
  getPinnedCellStyle,
  getPinnedRightCellStyle,
  getPinnedRightEdge,
  getRowStyle,
  getScrollContentStyle,
  getViewportStyle,
} from "./styles";

export { ROW_SELECT_COLUMN_ID } from "./constants";
import { ROW_SELECT_COLUMN_ID } from "./constants";
import { useCellEditController } from "./use-cell-edit-controller";
import { CellEditor } from "./cell-editor";
import { BooleanCellControl } from "./editors/BooleanCellControl";
import { toBooleanCell } from "./editors/boolean-utils";
import {
  FilterMenu,
  FunnelButton,
  popoverStyle,
  useFilterPopover,
} from "./filter-menu";
import { resolveColumnOptions } from "./filter-menu/filter-operators";
import { OverlayPortal } from "./overlay/OverlayPortal";
import { useHydrated } from "./use-hydrated";
import {
  type CopyPayload,
  type SerializeRangesArgs,
  serializeRangesAsTsv,
} from "./copy";
import {
  mapPasteToTargets,
  type PastedCell,
  type PastePayload,
  parseTsv,
  type RejectedPasteCell,
} from "./paste";
import { parseDraftForType } from "./editors/type-parsing";

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

/**
 * How many `scrollTop` writes scroll-into-view may make for a single focus
 * address before it gives up and leaves the target slightly off.
 *
 * Scrolling to a distant row uses *estimated* heights for every row in
 * between, because only rendered rows are ever measured. When the target
 * finally renders it gets measured, every offset after it shifts, and the
 * offset we just wrote is a little wrong — so the effect re-asserts on the
 * next measurement pass. That normally converges in one or two passes:
 * `scrollTopToReveal` returns `null` as soon as the target is fully revealed
 * (including when it is clamped against the scroll extent), which is what ends
 * the loop. This bound exists purely so a pathological case — heights that
 * never settle, e.g. wrapped text re-measured under high-frequency streaming —
 * degrades to "slightly off" instead of scrolling forever.
 */
const MAX_SCROLL_REVEAL_WRITES = 4;

const REORDER_THRESHOLD_PX = 5;
/**
 * How many pasted cells are gated (`editable`/`validate`) at a time. Both hooks
 * may be async and may call a server, so a spreadsheet-sized block is worked
 * through in batches instead of putting every cell in flight at once. Purely an
 * execution detail — the payload is the same whatever the batch size.
 */
const PASTE_GATE_BATCH_SIZE = 256;

interface PretableSurfaceHeaderCellRenderInput<
  TRow extends PretableRow = PretableRow,
> {
  column: PretableColumn<TRow>;
  label: string;
  sortDirection: "asc" | "desc" | null;
  /**
   * Authoritative pin side, from the engine's column plan rather than the
   * `columns` prop. Normalized to `null` when unpinned.
   */
  pinned: "left" | "right" | null;
}

type PretableSurfaceBodyCellRenderInput<
  TRow extends PretableRow = PretableRow,
> = PretableCellRenderInput<TRow>;

/**
 * Input passed to {@link PretableSurfaceProps.onRowActivate}.
 *
 * @public
 */
export interface PretableRowActivateInput<
  TRow extends PretableRow = PretableRow,
> {
  row: TRow;
  rowId: string;
  /** Index within the currently visible (sorted, filtered) rows. */
  rowIndex: number;
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
  /**
   * Authoritative pin side, from the engine's column plan rather than the
   * `columns` prop. Normalized to `null` when unpinned.
   */
  pinned: "left" | "right" | null;
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
  /**
   * Called when the user activates a row — a plain click on it, or Enter/Space
   * on the focused cell. This is "open the record this row stands for", which
   * is a different intent from selecting cells: a modifier-click and a
   * drag-select are range selection and do not activate.
   */
  onRowActivate?: (input: PretableRowActivateInput<TRow>) => void;
  onSelectedRowIdChange?: (rowId: string | null) => void;
  onSelectionChange?: (next: PretableSelectionState) => void;
  onFocusChange?: (next: PretableFocusState) => void;
  /**
   * Called after a header click mutates the sort. Receives the engine's full
   * ordered sort list (index = priority; `[]` = unsorted). Use to mirror sort
   * state externally (e.g. controlled `state.sort`).
   */
  onSortChange?: (sort: PretableSortEntry[]) => void;
  onColumnWidthsChange?: (next: Record<string, number>) => void;
  onColumnOrderChange?: (next: readonly string[]) => void;
  onColumnPinnedChange?: (
    next: Record<string, "left" | "right" | null>,
  ) => void;
  onTelemetryChange?: (telemetry: PretableTelemetry) => void;
  /**
   * Called when the built-in column filter menu mutates the active filter set.
   * Receives the engine's full `filters` map after the change. Use to mirror
   * filter state externally (e.g. controlled `state.filters`).
   */
  onFiltersChange?: (filters: Record<string, ColumnFilter>) => void;
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
  /**
   * Called when a cell edit commits successfully. The grid is controlled:
   * update your own `rows` from this callback. Return a promise to keep the
   * edit in its `saving` phase until it resolves (rejection enters `error`).
   */
  onCellEdit?: (payload: {
    rowId: string;
    columnId: string;
    value: unknown;
    row: TRow;
  }) => void | Promise<void>;
  /**
   * Called once per clipboard paste, with every cell the block landed on that
   * survived the gate (`parseEditValue`/type coercion → `editable` →
   * `validate`), the ones that did not, and how much of the block fell off the
   * grid's edges. The grid is controlled and never mutates rows: apply
   * `cells` in a single state update.
   *
   * Paste is opt-in — without this prop the surface leaves paste events alone.
   * Pastes that land while an `input`/`textarea` inside the grid has focus (a
   * cell editor, or a filter menu's field) belong to that input.
   *
   * The payload is a **snapshot**: `PastedCell.row` is the row as it was when
   * the paste started, and `editable`/`validate` ran against those pre-tick
   * values. Apply the cells against your *current* state and no-op on row ids
   * that have since vanished — the same contract as {@link onCellEdit}.
   */
  onPaste?: (payload: PastePayload<TRow>) => void | Promise<void>;
}

interface MemoizedCellContentProps {
  rowId: string;
  columnId: string;
  value: unknown;
  formattedValue: string;
  isFocused: boolean;
  isSelected: boolean;
  /** Mirrors `cellRenderInput.pinned` so the memo comparator can see it. */
  pinned: "left" | "right" | null;
  renderRef:
    ((input: PretableCellRenderInput<PretableRow>) => ReactNode) | null;
  fallbackRenderRef:
    ((input: PretableCellRenderInput<PretableRow>) => ReactNode) | null;
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
    prev.pinned === next.pinned &&
    prev.renderRef === next.renderRef &&
    prev.fallbackRenderRef === next.fallbackRenderRef
  );
}

const MemoizedCellContent = memo(CellContentImpl, cellContentPropsEqual);

interface MemoizedHeaderContentProps {
  columnId: string;
  label: string;
  sortDirection: "asc" | "desc" | null;
  /** 1-based cascade priority; null unless 2+ columns are sorted. */
  sortPriority: number | null;
  isSorted: boolean;
  width: number;
  isSortable: boolean;
  /** Mirrors `headerRenderInput.pinned` so the memo comparator can see it. */
  pinned: "left" | "right" | null;
  renderHeaderRef:
    ((input: PretableHeaderRenderInput<PretableRow>) => ReactNode) | null;
  fallbackRenderHeaderRef:
    | ((input: {
        column: PretableColumn<PretableRow>;
        label: string;
        sortDirection: "asc" | "desc" | null;
        pinned: "left" | "right" | null;
      }) => ReactNode)
    | null;
  headerRenderInput: PretableHeaderRenderInput<PretableRow>;
}

function HeaderContentImpl({
  label,
  sortDirection,
  sortPriority,
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
          pinned: headerRenderInput.pinned,
        })}
      </>
    );
  }
  // Direction glyph rather than words: this default read
  // "Newest"/"Oldest"/"Sort", which is date vocabulary applied to every column
  // — wrong on a name or a number. The button already carries `aria-label`
  // ("Sort <label>") and `aria-sort`, so the glyph is decorative, and the data
  // attribute gives themes something to target.
  return (
    <>
      <span>{label}</span>
      <strong>
        {sortDirection ? (
          <span aria-hidden="true" data-pretable-sort-indicator={sortDirection}>
            {sortDirection === "asc" ? "▲" : "▼"}
          </span>
        ) : null}
        {sortPriority !== null ? (
          <span data-pretable-sort-priority="">{sortPriority}</span>
        ) : null}
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
    prev.sortPriority === next.sortPriority &&
    prev.isSorted === next.isSorted &&
    prev.width === next.width &&
    prev.isSortable === next.isSortable &&
    prev.pinned === next.pinned &&
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
  onRowActivate,
  onSelectedRowIdChange,
  onSelectionChange,
  onFocusChange,
  onSortChange,
  onColumnWidthsChange,
  onColumnOrderChange,
  onColumnPinnedChange,
  onTelemetryChange,
  onFiltersChange,
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
  onCellEdit,
  onPaste,
}: PretableSurfaceProps<TRow>) {
  // Server-rendered grids paint their full chrome — header buttons, funnels,
  // checkboxes, resize handles — before React has attached a single listener,
  // so every one of those controls is visible and clickable while still inert.
  // Publishing that state as `data-pretable-hydrated` on the root lets a
  // consumer (or a test) gate on "live", not merely "painted".
  const hydrated = useHydrated();
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
    /**
     * +1 normally, -1 for right-pinned columns. A right-pinned column's
     * trailing edge is anchored to the scrollport and cannot move, so the only
     * edge a resize can move is the LEADING one — and it moves left as the
     * column grows. Adding the raw pointer delta would therefore grow the
     * column away from the pointer; negating it keeps the movable edge
     * travelling in the same direction as the pointer.
     */
    widthSign: 1 | -1;
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
    // Content-space offset for the drop indicator, resolved from the same
    // pointer event as `dropIndex` so the two can never disagree.
    indicatorLeft: number;
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
  // Set when a pointer-drag extended the selection past its origin cell. The
  // click that ends such a drag is a range selection, not a row activation.
  const dragExtendedRef = useRef(false);
  const dragStartSelectionRef = useRef<PretableSelectionState | null>(null);
  const lastCheckedRowAnchorRef = useRef<string | null>(null);
  const { headerHeight } = useResolvedHeights();
  const bodyViewportHeight = Math.max(viewportHeight - headerHeight, 0);
  // Depend on the primitive fields, not the rowSelectionColumn object: callers
  // typically pass it inline (`rowSelectionColumn={{ enabled: true }}`), so a new
  // object every render would churn effectiveColumns — and recreate the grid,
  // discarding selection/focus — on every streamed row update.
  const rowSelectEnabled = rowSelectionColumn?.enabled ?? false;
  const rowSelectWidth = rowSelectionColumn?.width;
  const rowSelectPinned = rowSelectionColumn?.pinned;
  const effectiveColumns = useMemo<PretableColumn<TRow>[]>(() => {
    if (!rowSelectEnabled) return columns;
    const synth: PretableColumn<TRow> = {
      id: ROW_SELECT_COLUMN_ID,
      header: "",
      widthPx: rowSelectWidth ?? 36,
      sortable: false,
      filterable: false,
      ...((rowSelectPinned ?? true) ? { pinned: "left" } : {}),
    };
    return [synth, ...columns];
  }, [columns, rowSelectEnabled, rowSelectWidth, rowSelectPinned]);
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

  // The columns in the order they are DRAWN, which is the engine's order —
  // drag-to-reorder moves columns there and leaves the `columns` prop in
  // declaration order. Anything that walks columns left to right (clipboard
  // copy's serialization, paste's geometry) has to read this rather than the
  // prop, or a reordered grid serializes and lands cells in an order the user
  // never sees. Definitions still come from the props, looked up by id — the
  // same split the header row uses for pin state.
  const columnsInVisualOrder = useMemo(() => {
    const byId = new Map(effectiveColumns.map((column) => [column.id, column]));
    return grid.options.columns.flatMap((engineColumn) => {
      const definition = byId.get(engineColumn.id);
      return definition ? [definition] : [];
    });
  }, [effectiveColumns, grid.options.columns]);

  // Cell editing. `useCellEditController` memoizes on `grid` only, so the
  // closures it captures would otherwise go stale across renders. Keep refs to
  // the latest columns/rows/onCellEdit and read them through stable wrappers so
  // the (memoized) controller always sees current data. Refs are synced in a
  // layout effect (every render, no deps) — they only need to be current before
  // event handlers / async resolutions read them, which happen post-commit.
  const editColumnsRef = useRef(effectiveColumns);
  const visualOrderColumnsRef = useRef(columnsInVisualOrder);
  const editVisibleRowsRef = useRef(snapshot.visibleRows);
  const onCellEditRef = useRef(onCellEdit);
  const onPasteRef = useRef(onPaste);
  useLayoutEffect(() => {
    editColumnsRef.current = effectiveColumns;
    visualOrderColumnsRef.current = columnsInVisualOrder;
    editVisibleRowsRef.current = snapshot.visibleRows;
    onCellEditRef.current = onCellEdit;
    onPasteRef.current = onPaste;
  });
  // Which entry path opened the active edit. Type-to-replace seeds the draft
  // with the typed character, so the editor must not select it (the next
  // keystroke would replace it). Every begin() that opens an editor sets this,
  // batched with the begin in the same event, so the editor mounts knowing it.
  //
  // It is surface state rather than something the controller derives from
  // `initialDraft !== undefined`, because deriving it would still not cover
  // the one path that can go stale: `grid.beginEdit()` called imperatively
  // bypasses the controller entirely, so an editor opened that way inherits
  // whichever value the *previous* edit left behind. Closing that hole means
  // carrying the flag in the engine's edit state, which is a public-API
  // decision, not a rendering detail. The consequence today is cosmetic: an
  // imperatively opened editor may put the caret at the end instead of
  // selecting the draft.
  const [seededFromTyping, setSeededFromTyping] = useState(false);
  const editController = useCellEditController<TRow>({
    grid,
    getColumns: useCallback(() => editColumnsRef.current, []),
    getRowById: useCallback(
      (id: string) =>
        editVisibleRowsRef.current.find((r) => r.id === id)?.row ?? null,
      [],
    ),
    onCellEdit: useCallback(
      (payload: {
        rowId: string;
        columnId: string;
        value: unknown;
        row: TRow;
      }) => onCellEditRef.current?.(payload),
      [],
    ),
  });

  // Boolean cells toggle-and-commit directly through the edit lifecycle (no
  // popover): begin seeds the negated value as the draft, commit runs the
  // usual parse/validate/onCellEdit path (async `editable` gates and staleness
  // tokens all apply).
  const toggleBooleanCell = async (
    rowId: string,
    column: PretableColumn<TRow>,
  ) => {
    if (!column.editable) return;
    const editing = grid.getSnapshot().editing;
    if (editing) {
      // A FAILED edit on this same cell (validate reject leaves status
      // "editing" with error set; onCellEdit throw leaves status "error") is
      // cancelled so the click becomes a fresh toggle attempt. Anything
      // in-flight — including a just-begun edit from a rapid double-click
      // (status "editing", no error) — or another cell's edit still bails.
      const failedHere =
        editing.rowId === rowId &&
        editing.columnId === column.id &&
        (editing.status === "error" ||
          (editing.status === "editing" && editing.error != null));
      if (!failedHere) return;
      editController.cancel();
    }
    const row = editVisibleRowsRef.current.find((r) => r.id === rowId)?.row;
    if (!row) return;
    // Negate the value the checkbox is *showing*, not raw truthiness: a cell
    // holding `"false"` renders unchecked, so its toggle must commit `true`.
    const current = toBooleanCell(resolveCellValue(row, column));
    await editController.begin({ rowId, columnId: column.id }, !current);
    await editController.commit();
  };

  // ---------------------------------------------------------------------
  // Clipboard paste
  // ---------------------------------------------------------------------
  // Monotonic token mirroring useCellEditController's: the async gate captures
  // it before awaiting and re-checks after, so a paste that resolves once a
  // newer paste has started (or after unmount) is discarded rather than firing
  // a stale onPaste. Deliberately NOT bumped when rows/columns change identity:
  // a streaming grid replaces `visibleRows` constantly, and the payload is
  // addressed by row id — the consumer applies it against its own current
  // state, exactly as it does for onCellEdit.
  const pasteTokenRef = useRef(0);

  const handlePaste = useCallback(
    (event: ClipboardEvent) => {
      const onPasteFn = onPasteRef.current;
      if (!onPasteFn) return; // paste is opt-in, exactly like onCellEdit
      // A text-entry element inside the grid owns its own paste. This is a
      // blanket check, not a cell-editor check: the built-in filter menu's
      // fields live inside the surface too, and a paste aimed at one of them is
      // not a grid paste. Mirrors the Cmd+C guard's target check, plus an
      // activeElement check so an event that targets the grid root while such
      // an element holds focus is ignored too.
      //
      // `contenteditable` counts: a column's `renderEditor` is free to return
      // one (rich-text editors do), and it takes typed input like any other
      // field. `isContentEditable` is inherited, so it also covers a paste
      // landing on a node *inside* the editable region.
      const ownsItsOwnPaste = (node: unknown): boolean => {
        if (
          node instanceof HTMLInputElement ||
          node instanceof HTMLTextAreaElement
        ) {
          return true;
        }
        if (!(node instanceof HTMLElement)) return false;
        // `isContentEditable` is the authoritative answer in a browser — it
        // accounts for inheritance and designMode — but jsdom does not
        // implement it, so the attribute is checked too, walking up for the
        // inherited case. Either one saying yes is enough.
        return (
          node.isContentEditable ||
          node.closest('[contenteditable]:not([contenteditable="false"])') !==
            null
        );
      };
      if (ownsItsOwnPaste(event.target)) return;
      if (ownsItsOwnPaste(viewportRef.current?.ownerDocument.activeElement)) {
        return;
      }

      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (text === "") return;
      const matrix = parseTsv(text);
      if (matrix.length === 0) return;

      const snap = grid.getSnapshot();
      // Paste geometry walks columns left to right, so it walks the DRAWN
      // order: anchored on a column the user dragged rightward, the prop order
      // would run the block off its end (cells silently clipped) or land them
      // in columns to the left of where the user aimed.
      const columns = visualOrderColumnsRef.current;
      const anchored = resolvePasteAnchor(
        snap.selection.ranges,
        snap.focus,
        snap.visibleRows,
        columns,
      );
      if (!anchored) return; // nothing selected or focused: not ours to handle

      const targets = mapPasteToTargets<TRow>({
        matrix,
        anchor: anchored.anchor,
        selectionSize: anchored.selectionSize,
        visibleRows: snap.visibleRows,
        columns,
      });

      // From here the grid owns this paste; the browser must not also insert it.
      event.preventDefault();

      let sourceColumns = 0;
      for (const row of matrix) {
        sourceColumns = Math.max(sourceColumns, row.length);
      }

      const myToken = (pasteTokenRef.current += 1);
      const columnById = new Map(columns.map((c) => [c.id, c]));
      const rowById = new Map(snap.visibleRows.map((r) => [r.id, r.row]));

      // One slot per target, so outcomes keep the block's row-major order.
      const outcomes = new Array<PastedCell<TRow> | RejectedPasteCell | null>(
        targets.cells.length,
      ).fill(null);
      const candidates: {
        index: number;
        target: (typeof targets.cells)[number];
        input: PretableEditInput<TRow>;
      }[] = [];

      targets.cells.forEach((target, index) => {
        const column = columnById.get(target.columnId);
        const row = rowById.get(target.rowId);
        if (!column || !row) return;
        const input: PretableEditInput<TRow> = {
          rowId: target.rowId,
          columnId: target.columnId,
          row,
          column,
          value: resolveCellValue(row, column),
        };
        candidates.push({ index, target, input });
      });

      const gate = async (): Promise<void> => {
        // Within one candidate the order is `editable` → coercion →
        // `validate`:
        //  - `editable` first, so a cell the user could never write reports
        //    "not-editable" rather than a coercion complaint about a value that
        //    was never going to land ("abc" into a read-only number column).
        //  - `validate` last, so it sees the coerced, typed value.
        // Each candidate is wrapped on its own: one flaky `editable`/`validate`
        // rejects THAT cell as "invalid" instead of dropping the whole paste.
        const gateOne = async ({
          target,
          input,
        }: (typeof candidates)[number]): Promise<
          PastedCell<TRow> | RejectedPasteCell
        > => {
          try {
            const editable = input.column.editable ?? false;
            const allowed =
              typeof editable === "function" ? await editable(input) : editable;
            if (!allowed) return { ...target, reason: "not-editable" };

            // Same coercion a committed edit gets: the column's
            // parseEditValue wins, otherwise the built-in per-type parse — so
            // number/date/enum columns yield typed values instead of clipboard
            // strings.
            let value: unknown;
            if (input.column.parseEditValue) {
              value = input.column.parseEditValue(target.raw, input);
            } else {
              const parsed = parseDraftForType(input.column, target.raw);
              if (!parsed.ok) {
                return {
                  ...target,
                  reason: "invalid",
                  message: parsed.message,
                };
              }
              value = parsed.value;
            }

            if (input.column.validate) {
              const result = await input.column.validate(value, input);
              if (result !== true) {
                return { ...target, reason: "invalid", message: result };
              }
            }
            return {
              rowId: target.rowId,
              columnId: target.columnId,
              raw: target.raw,
              value,
              row: input.row,
            };
          } catch (err) {
            return {
              ...target,
              reason: "invalid",
              message: err instanceof Error ? err.message : String(err),
            };
          }
        };

        // Gated in batches rather than all at once: `editable` and `validate`
        // may be async and may call a server, and a spreadsheet-sized block
        // would otherwise put every cell in flight simultaneously. Batches run
        // in order and results are stored by the candidate's own index, so
        // this is an execution detail — the payload is identical either way.
        // The staleness check sits between batches too, so a superseded paste
        // stops working instead of running to completion first.
        for (let i = 0; i < candidates.length; i += PASTE_GATE_BATCH_SIZE) {
          const batch = candidates.slice(i, i + PASTE_GATE_BATCH_SIZE);
          const resolved = await Promise.all(batch.map(gateOne));
          if (myToken !== pasteTokenRef.current) return; // stale
          batch.forEach((candidate, j) => {
            outcomes[candidate.index] = resolved[j]!;
          });
        }

        const cells: PastedCell<TRow>[] = [];
        const rejected: RejectedPasteCell[] = [];
        for (const outcome of outcomes) {
          if (!outcome) continue;
          if ("reason" in outcome) rejected.push(outcome);
          else cells.push(outcome);
        }
        await onPasteFn({
          cells,
          rejected,
          source: { rows: matrix.length, columns: sourceColumns },
          clipped: targets.clipped,
        });
      };

      void gate().catch((err) => {
        console.warn("[pretable] paste failed", err);
      });
    },
    [grid],
  );

  useEffect(() => {
    // The listener lives on the surface root, not the document, so two grids
    // on one page never handle each other's paste.
    const node = viewportRef.current;
    if (!node) return;
    node.addEventListener("paste", handlePaste);
    return () => {
      node.removeEventListener("paste", handlePaste);
      pasteTokenRef.current += 1; // unmount invalidates an in-flight gate
    };
  }, [handlePaste]);

  // Built-in column filter menu: one open-state for the whole surface.
  const {
    openState: filterOpenState,
    toggle: toggleFilter,
    close: closeFilter,
  } = useFilterPopover();

  // Pin state and pinned offsets are read from the PLANNED column
  // (`renderSnapshot.columns`), never from the prop column. The engine is the
  // single source of truth: controlled `state.columnPinned`, imperative
  // `grid.setColumnPinned` and drag-to-reorder all mutate engine state, and
  // `mergeColumnsFromProps` only re-runs on an id-list change (and gives
  // engine state precedence), so the `columns` prop can be permanently stale.
  // `PlannedColumn.left` is a left-pinned column's sticky offset — the summed
  // width of the left-pinned columns before it, measured with engine widths so
  // it also tracks resize and autosize.

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

  // One plan over the whole engine column set, shared by the two features that
  // need to reason about columns `renderSnapshot.columns` does not carry:
  // reorder hit-testing (a scrolled-out column is still a legitimate drop
  // target) and scroll-into-view (an off-window column is the only reason it
  // runs). Both want identical geometry, so they read the same object rather
  // than each deriving one — see `planColumnLayout` for why that matters.
  // Content order, and each entry's `index` is its engine index — what
  // grid.moveColumn takes.
  const columnLayout = useMemo(
    () => planColumnLayout(grid.options.columns),
    [grid.options.columns],
  );

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

  // Positions of the data columns as DRAWN. A selection range is a pair of
  // column ids with everything between them implied, so resolving membership
  // against the prop order after a reorder paints cells the user can see are
  // outside their selection — and mis-reports which rows are fully covered.
  const dataColumnIndex = useMemo(() => {
    const dataColumns = columnsInVisualOrder.filter(
      (c) => c.id !== ROW_SELECT_COLUMN_ID,
    );
    const idxById = new Map<string, number>();
    for (let i = 0; i < dataColumns.length; i += 1) {
      idxById.set(dataColumns[i]!.id, i);
    }
    return { dataColumns, idxById };
  }, [columnsInVisualOrder]);

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

  // Right-pinned columns resolve their sticky inset against the scrollport's
  // width, so a container resize has to re-render them — `onScroll` alone would
  // leave them parked at the old edge until the user happens to scroll. This
  // also keeps the column plan's horizontal window honest on resize.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setViewportWidth((prev) =>
        prev === el.clientWidth ? prev : el.clientWidth,
      );
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);

  useLayoutEffect(() => {
    onTelemetryChange?.(telemetry);
  }, [onTelemetryChange, telemetry]);

  useLayoutEffect(() => {
    onGridReady?.(grid);
  }, [grid, onGridReady]);

  // Programmatic focus follow: when the engine's focus address changes, move
  // browser focus to the corresponding cell DOM node so keyboard handlers
  // continue to fire and screen readers track the focused cell.
  //
  // The target is frequently NOT rendered on the commit that changed the
  // address — rows and columns are both virtualized, and Cmd+End / PageDown /
  // Cmd+Arrow all land far outside the window. The scroll effect below brings
  // it in, but that is a later commit, so this effect has to be able to finish
  // the job then. It therefore runs on the *rendered set* as well as on the
  // address, which means it can fire at essentially any time — including on
  // every streamed row patch. Two things keep that from turning into focus
  // theft:
  //
  //   1. `pendingFocusFollowRef` is set only when the address CHANGES, and is
  //      cleared the moment the move is applied or abandoned. A run with no
  //      pending move returns immediately, so the steady state (focus already
  //      on a rendered cell, rows streaming underneath it) can never grab
  //      anything.
  //   2. Even with a pending move, focus is only taken from somewhere it is
  //      ours to take — see `isFocusOursToMove` — and never while an edit is
  //      open.
  const focusFollowAddressRef = useRef<string | null>(null);
  const pendingFocusFollowRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (!focusedRowId || !focusedColumnId) {
      focusFollowAddressRef.current = null;
      pendingFocusFollowRef.current = null;
      return;
    }

    const address = `${focusedRowId}::${focusedColumnId}`;

    if (focusFollowAddressRef.current !== address) {
      focusFollowAddressRef.current = address;
      pendingFocusFollowRef.current = address;
    }

    if (pendingFocusFollowRef.current === null) {
      // Already applied (or deliberately abandoned) for this address. This is
      // the hot path under streaming: one ref read and out.
      return;
    }

    if (snapshot.editing) {
      // An edit owns the keyboard for its whole lifecycle — the editor input
      // lives *inside* the cell, so it would pass the containment check below.
      // Blurring it would also blur-commit the draft (use-editor-field.ts).
      // Keep the move pending: `snapshot.editing` is a dependency, so the
      // effect re-runs when the edit ends and the address is honoured then.
      return;
    }

    const cellNode = cellNodesRef.current.get(pendingFocusFollowRef.current);

    if (!cellNode) {
      // Outside the virtualization window. Stay pending; the rendered-set
      // dependency re-runs this once the scroll effect has brought it in.
      return;
    }

    // One attempt per address, applied or not: a move that is refused because
    // the user is somewhere else is refused for good, not retried on the next
    // patch.
    pendingFocusFollowRef.current = null;

    if (document.activeElement === cellNode) {
      return;
    }

    if (!isFocusOursToMove(viewportRef.current, document.activeElement)) {
      return;
    }

    // `preventScroll` is deliberate, and must stay. The surface owns
    // scroll-into-view itself (the effect directly below), computed from
    // layout-core against the *unoccluded* band. The browser's native
    // focus-scroll knows nothing about the sticky header or the sticky
    // pinned column groups, so it would happily park the cell underneath one
    // — and, running after ours, it would overwrite the offset we just
    // computed. It also cannot help in the case that motivated all of this:
    // when the target cell is outside the virtualization window there is no
    // node here to scroll to at all.
    cellNode.focus({ preventScroll: true });
  }, [
    focusedColumnId,
    focusedRowId,
    // The rendered set. Both arrays are rebuilt whenever the virtualization
    // window moves, and nothing else can tell this effect that the target's
    // node has appeared — `cellNodesRef` is a ref, invisible to the scheduler.
    renderSnapshot.columns,
    renderSnapshot.rows,
    snapshot.editing,
  ]);

  // Scroll-into-view for keyboard focus. The engine's focus address can move
  // to a cell that is outside the virtualization window, or behind a sticky
  // pinned column group; either way the browser will not move the viewport for
  // us (see the `preventScroll` note above), so we compute the minimal offset
  // and assign it ourselves.
  //
  // Deliberately does NOT call `grid.setViewport`: assigning scroll fires a
  // native `scroll` event, and the existing `onScroll` handler already feeds
  // the engine. Reporting it here as well would double-report.
  const scrollRevealRef = useRef<{
    rowId: string;
    columnId: string;
    /** `scrollTop` writes made for this address; see MAX_SCROLL_REVEAL_WRITES. */
    writes: number;
    /** Vertically resolved — nothing this effect can usefully do any more. */
    settled: boolean;
  } | null>(null);
  const scrollRevealColumnIdRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    const el = viewportRef.current;

    if (!el || !focusedRowId || !focusedColumnId) {
      scrollRevealRef.current = null;
      scrollRevealColumnIdRef.current = null;
      return;
    }

    // Runs on focus changes AND on every subsequent layout pass for the same
    // address, which is what lets a distant target be re-asserted once its
    // real height is measured. Everything below hinges on `pending` carrying
    // over across those passes: once an address is satisfied it is marked
    // settled and never scrolls again, so a user who scrolls the focused cell
    // out of view is not yanked back on the next measurement or row update.
    const previous = scrollRevealRef.current;
    const pending =
      previous !== null &&
      previous.rowId === focusedRowId &&
      previous.columnId === focusedColumnId
        ? previous
        : {
            rowId: focusedRowId,
            columnId: focusedColumnId,
            writes: 0,
            settled: false,
          };
    scrollRevealRef.current = pending;

    // Horizontal, only when the focused COLUMN changed — or when no earlier
    // pass managed to resolve it. Column geometry does not depend on row
    // measurement, so the vertical re-assert passes have nothing new to say
    // about it, and skipping keeps `scrollLeftToReveal`'s O(columns) scan off
    // the ArrowDown hot path, where the column never moves. The
    // trade-off is that a user who scrolls horizontally away from the focused
    // column is not dragged back by a later vertical move, which matches the
    // no-fighting rule the rest of this effect follows.
    //
    // "Resolved" is doing real work in that first sentence: the ref is the
    // latch, so it may only be consumed by a pass that actually decided
    // something. See the `undefined` branch below.
    if (scrollRevealColumnIdRef.current !== focusedColumnId) {
      const nextScrollLeft = scrollLeftToReveal({
        plan: columnLayout,
        targetColumnId: focusedColumnId,
        scrollLeft: el.scrollLeft,
        // 0 before the scrollport is measured (SSR, the first commit, a grid
        // inside a `display: none` tab or a collapsed accordion). That is a
        // real state, not a bug: `scrollLeftToReveal` reports it as undecidable
        // rather than inventing an offset we would only have to undo.
        viewportWidth,
      });

      // Consume the ref only on a pass that could actually decide. `undefined`
      // means the band was empty — an unmeasured scrollport, or pinned groups
      // wider than it — and advancing on that would disarm this column for
      // good: `viewportWidth` is a dependency, so a later pass with a real
      // width re-runs this effect, but it would find the ref already spent and
      // skip. The bug that motivated this: focus moves to a far-right column
      // while the grid is in a hidden tab, the user opens the tab, and the
      // vertical reveal works while `scrollLeft` stays parked at 0.
      if (nextScrollLeft !== undefined) {
        scrollRevealColumnIdRef.current = focusedColumnId;

        if (nextScrollLeft !== null) {
          el.scrollLeft = nextScrollLeft;
        }
      }
    }

    if (pending.settled || pending.writes >= MAX_SCROLL_REVEAL_WRITES) {
      return;
    }

    // O(1) per keypress: `visibleRowIndexById` is memoized on
    // `snapshot.visibleRows` identity. A linear scan here would land on
    // ArrowDown's p95 < 16ms budget.
    const targetIndex = visibleRowIndexById.get(focusedRowId);

    if (targetIndex === undefined) {
      // The row model does not produce this row *yet*: an address set for a row
      // that arrives on a later streaming patch, or one a filter is currently
      // hiding. That is "nothing to reveal now", not "nothing to reveal ever",
      // so do NOT settle — settling here would mean the viewport never scrolls
      // to the row once it appears, even though focus and the DOM focus-follow
      // both land on it correctly.
      //
      // Retrying is free: the miss is the same O(1) `Map.get` above, with no
      // allocation, so a row id that never arrives costs one lookup per pass
      // rather than unbounded work.
      return;
    }

    const nextScrollTop = scrollTopToReveal({
      // Covers *every* visible row, not just the windowed ones, so this is
      // valid for a target that is nowhere in the DOM.
      rowMetrics: renderSnapshot.rowMetrics,
      targetIndex,
      scrollTop: el.scrollTop,
      // The band below the sticky header — the same height fed to the row
      // planner, and the coordinate space row offsets live in.
      viewportHeight: bodyViewportHeight,
    });

    if (nextScrollTop === undefined) {
      // Band not resolvable yet (`viewportHeight <= headerHeight`). Same rule as
      // the horizontal axis: a pass that measured nothing must not latch.
      return;
    }

    if (nextScrollTop === null) {
      pending.settled = true;
      return;
    }

    pending.writes += 1;
    el.scrollTop = nextScrollTop;
  }, [
    bodyViewportHeight,
    columnLayout,
    focusedColumnId,
    focusedRowId,
    // `renderSnapshot` is rebuilt whenever `measuredHeights` changes, which is
    // the signal the convergence re-assert waits for.
    renderSnapshot,
    viewportWidth,
    visibleRowIndexById,
  ]);

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
    // Runs after every render: row heights depend on the full rendered output
    // (row/cell classes from getRowClassName, cell content, etc.), not just the
    // grid snapshot — and a render-prop change can alter height without changing
    // any row data. The per-row key+height check above skips unchanged rows, and
    // measureRenderedRowHeight is idempotent (it measures intrinsic content, not
    // the stretched box), so the setMeasuredHeights re-render converges instead
    // of looping — even under high-churn streaming with wrap:true rows.
  });

  return (
    <div
      aria-colcount={effectiveColumns.length}
      aria-label={ariaLabel}
      aria-multiselectable="true"
      aria-rowcount={snapshot.totalRowCount + 1}
      data-pretable-hydrated={hydrated ? "true" : "false"}
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

        // While a cell edit is active the editor input owns the keyboard. Its
        // own keydown handler stop-propagates Enter/Tab/Escape; every other key
        // (typing, arrows, Home/End, Cmd+A) must drive the input, not the grid,
        // so bail before any copy/select/navigation handling. Do NOT
        // preventDefault — the input still needs default text behavior.
        // EXCEPTION: boolean edits have no editor input mounted (the cell
        // control commits directly), so nothing else can handle Escape after a
        // failed commit — cancel here or the failed edit is a dead-end.
        if (snapshot.editing) {
          if (event.key === "Escape" || event.key === "Esc") {
            const editingColumn = effectiveColumns.find(
              (c) => c.id === snapshot.editing?.columnId,
            );
            if (editingColumn?.type === "boolean") {
              editController.cancel();
              event.preventDefault();
            }
          }
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
            // Drawn order, not the prop's: a range is bounded by the columns
            // the user highlighted, and resolving those bounds against the
            // declaration order after a reorder both reorders the TSV and
            // changes which columns fall inside the range.
            columns: columnsInVisualOrder,
            copyWithHeaders: copyWithHeaders ?? false,
          };
          const payload = onCopy ? onCopy(args) : serializeRangesAsTsv(args);
          if (payload) {
            const extent = computeSelectionExtent(
              snap.selection.ranges,
              snap,
              columnsInVisualOrder,
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

        // Begin-edit triggers (Enter / F2 / type-to-replace). Only when no edit
        // is active and the focused cell's column is editable; otherwise fall
        // through so Enter/Space keep their row-selection behavior. When an edit
        // IS active the editor input owns keystrokes (Enter/Tab/Escape are
        // stop-propagated inside CellEditor), so this handler is not reached.
        if (!snapshot.editing) {
          const focusAddr =
            snapshot.focus.rowId && snapshot.focus.columnId
              ? {
                  rowId: snapshot.focus.rowId,
                  columnId: snapshot.focus.columnId,
                }
              : null;
          const focusedColumn = focusAddr
            ? effectiveColumns.find((c) => c.id === focusAddr.columnId)
            : undefined;
          if (focusAddr && focusedColumn?.editable) {
            const cmd = event.metaKey || event.ctrlKey;
            // Editable boolean columns toggle in place on Enter/Space; no
            // popover editing ever applies (F2/type-to-replace included).
            // Non-editable boolean columns skip this whole block, so
            // Enter/Space keep their row-selection behavior untouched.
            if (focusedColumn.type === "boolean") {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                void toggleBooleanCell(focusAddr.rowId, focusedColumn);
                return;
              }
              if (event.key === "F2") {
                event.preventDefault();
                return;
              }
              // Everything else (arrows, shortcuts) falls through to normal
              // grid handling — printable keys must not seed a popover draft.
            } else if (event.key === "Enter" || event.key === "F2") {
              event.preventDefault();
              setSeededFromTyping(false);
              void editController.begin(focusAddr);
              return;
            }
            // type-to-replace: a single printable, non-whitespace character
            // seeds the draft. Space is reserved for row selection. Never
            // applies to boolean columns (no popover draft to seed).
            if (
              focusedColumn.type !== "boolean" &&
              event.key.length === 1 &&
              event.key !== " " &&
              !cmd &&
              !event.altKey
            ) {
              event.preventDefault();
              setSeededFromTyping(true);
              void editController.begin(focusAddr, event.key);
              return;
            }
          }
        }

        const isSelectAll =
          (event.metaKey || event.ctrlKey) &&
          (event.key === "a" || event.key === "A") &&
          !event.shiftKey &&
          !event.altKey;

        const before = grid.getSnapshot();
        const handled = handleSurfaceKeyDown(event, {
          bodyViewportHeight,
          // Drawn order: Home/End and the full-row range this builds are
          // bounded by the first and last columns ON SCREEN.
          columns: columnsInVisualOrder,
          grid,
          onRowActivate,
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
              columnsInVisualOrder,
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
            const pinnedRightEdge =
              plannedCol.pinned === "right" && plannedCol.right !== undefined
                ? getPinnedRightEdge(viewportWidth, plannedCol.right)
                : undefined;
            const positionStyle =
              plannedCol.pinned === "left"
                ? {
                    ...getHeaderCellStyle(plannedCol.left, plannedCol.width),
                    ...getPinnedCellStyle(plannedCol.left),
                  }
                : pinnedRightEdge !== undefined
                  ? {
                      ...getHeaderCellStyle(plannedCol.left, plannedCol.width),
                      ...getPinnedRightCellStyle(
                        pinnedRightEdge,
                        plannedCol.width,
                      ),
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
                data-pretable-pinned={plannedCol.pinned}
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
                          columnsInVisualOrder,
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
          const sortIndex = snapshot.sort.findIndex(
            (entry) => entry.columnId === column.id,
          );
          const sortEntry = sortIndex === -1 ? null : snapshot.sort[sortIndex];
          const sortDirection = sortEntry?.direction ?? null;
          const sortPriority =
            sortIndex !== -1 && snapshot.sort.length > 1 ? sortIndex + 1 : null;
          const headerProps =
            getHeaderCellProps?.({
              column,
              sortDirection,
              pinned: plannedCol.pinned ?? null,
            }) ?? {};
          // `plannedCol.right` is the column's trailing-edge offset from the
          // viewport's right edge, and unlike `plannedCol.left` it has to be
          // resolved against the live viewport width, because right-pinning is
          // expressed as a sticky `left` inset (see getPinnedRightEdge).
          const pinnedRightEdge =
            plannedCol.pinned === "right" && plannedCol.right !== undefined
              ? getPinnedRightEdge(viewportWidth, plannedCol.right)
              : undefined;
          const positionStyle =
            plannedCol.pinned === "left"
              ? {
                  ...getHeaderCellStyle(plannedCol.left, effWidth),
                  ...getPinnedCellStyle(plannedCol.left),
                }
              : pinnedRightEdge !== undefined
                ? {
                    ...getHeaderCellStyle(plannedCol.left, effWidth),
                    ...getPinnedRightCellStyle(pinnedRightEdge, effWidth),
                  }
                : getHeaderCellStyle(plannedCol.left, effWidth);

          const ariaSort: "ascending" | "descending" | "none" =
            sortDirection === "asc"
              ? "ascending"
              : sortDirection === "desc"
                ? "descending"
                : "none";

          const showResizeHandle = column.resizable !== false;
          const showFilterFunnel = column.filterable !== false;
          const isDragging = dragLiveWidth?.columnId === column.id;
          // Both header overlays hang off one zero-width anchor parked on the
          // column's trailing edge — `pinnedRightEdge` for a right-pinned
          // column, `plannedCol.left + effWidth` for every other column (that
          // is also a left-pinned overlay anchor's flow position, which is
          // exactly why the anchor holds at scrollLeft 0; see
          // getHeaderOverlayAnchorStyle).
          const overlayAnchorStyle = getHeaderOverlayAnchorStyle(
            pinnedRightEdge ?? plannedCol.left + effWidth,
            plannedCol.pinned === "left" || pinnedRightEdge !== undefined,
          );

          return [
            <button
              {...headerProps}
              aria-colindex={plannedCol.index + 1}
              aria-label={`Sort ${label}`}
              aria-sort={ariaSort}
              className={getHeaderCellClassName?.({
                column,
                sortDirection,
                pinned: plannedCol.pinned ?? null,
              })}
              data-pretable-header-cell=""
              data-pretable-column-id={column.id}
              data-pretable-pinned={plannedCol.pinned}
              key={column.id}
              role="columnheader"
              onClick={(event) => {
                if (wasReorderingRef.current) {
                  event.preventDefault();
                  wasReorderingRef.current = false;
                  return;
                }
                if (column.sortable === false) {
                  return;
                }
                if (event.shiftKey) {
                  // Shift-click mirrors the plain-click cycle per column:
                  // absent → append desc; desc → flip to asc in place;
                  // asc → remove just this entry (others keep positions).
                  const current = snapshot.sort;
                  const idx = current.findIndex(
                    (entry) => entry.columnId === column.id,
                  );
                  let next: PretableSortEntry[];
                  if (idx === -1) {
                    next = [
                      ...current,
                      { columnId: column.id, direction: "desc" },
                    ];
                  } else if (current[idx].direction === "desc") {
                    next = current.map((entry, i) =>
                      i === idx
                        ? { ...entry, direction: "asc" as const }
                        : entry,
                    );
                  } else {
                    next = current.filter((_, i) => i !== idx);
                  }
                  grid.replaceSort(next);
                } else {
                  const nextDirection = getNextSortDirection(sortDirection);
                  grid.setSort(column.id, nextDirection);
                }
                onSortChange?.(grid.getSnapshot().sort);
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

                      // The scrollport is measured on every move rather than
                      // read from state: scrollLeft changes without a React
                      // render (wheel, trackpad, scrollbar), and a stale offset
                      // would put the drop index a scroll-distance away from
                      // the cursor.
                      const scrollport = viewportRef.current;
                      const target = computeColumnDropTarget({
                        layout: columnLayout.columns,
                        draggedIndex: grid.options.columns.findIndex(
                          (c) => c.id === column.id,
                        ),
                        cursorX: event.clientX,
                        viewportLeft:
                          scrollport?.getBoundingClientRect().left ?? 0,
                        viewportWidth: scrollport?.clientWidth ?? 0,
                        scrollLeft: scrollport?.scrollLeft ?? 0,
                      });

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
                          dropIndex: target.dropIndex,
                          indicatorLeft: target.indicatorLeft,
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
                              dropIndex: target.dropIndex,
                              indicatorLeft: target.indicatorLeft,
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
              // Flex/center, matching `[data-pretable-header-cell]` in
              // @pretable/ui. These are inline styles, so they beat the skin no
              // matter how it is layered — a `grid` + `align-items: start`
              // default here quietly overrode it, and stacked any multi-node
              // `renderHeaderCell` into rows that overflow the header strip.
              style={{
                alignItems: "center",
                border: 0,
                borderRight: "1px solid rgba(255, 255, 255, 0.06)",
                color: "inherit",
                display: "flex",
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
                sortPriority={sortPriority}
                isSorted={sortDirection !== null}
                width={effWidth}
                isSortable={column.sortable !== false}
                pinned={plannedCol.pinned ?? null}
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
                        pinned: "left" | "right" | null;
                      }) => ReactNode)
                    | undefined) ?? null
                }
                headerRenderInput={
                  {
                    column,
                    label,
                    sortDirection,
                    isSorted: sortDirection !== null,
                    pinned: plannedCol.pinned ?? null,
                  } as unknown as PretableHeaderRenderInput<PretableRow>
                }
              />
            </button>,
            showResizeHandle || showFilterFunnel ? (
              // Header overlays — the resize strip and the filter funnel — are
              // NOT nested in the header <button> (interactive controls inside
              // a button is invalid HTML). They live in a zero-width anchor
              // parked on the column's trailing edge, so both are placed by
              // counting back from that edge and both hold their place at every
              // scroll offset, scrollLeft 0 included.
              <div
                key={`${column.id}::header-overlays`}
                data-pretable-header-overlays=""
                data-pretable-column-id={column.id}
                style={overlayAnchorStyle}
              >
                {showResizeHandle ? (
                  <div
                    data-pretable-resize-handle=""
                    data-pretable-column-id={column.id}
                    data-pretable-dragging={isDragging ? "true" : "false"}
                    style={{
                      position: "absolute",
                      top: 0,
                      height: "100%",
                      width: 4,
                      // The 4px strip hugs the trailing edge from the inside.
                      left: -4,
                      cursor: "col-resize",
                      touchAction: "none",
                      userSelect: "none",
                    }}
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      event.stopPropagation();
                      // Start from the PLANNED width — the engine's committed
                      // width, which is what this column is currently rendering
                      // (`effWidth`). The `columns` prop is not a source of
                      // truth for width: the engine owns it after the first
                      // resize / autosize / controlled `state.columnWidths`
                      // apply, and `mergeColumnsFromProps` gives engine state
                      // precedence, so `column.widthPx` still reads as the
                      // ORIGINAL declared width forever. Anchoring to it made
                      // every drag after the first recompute from that stale
                      // origin instead of accumulating (drag +80 then +40
                      // landed on 140, not 220).
                      const startWidth = plannedCol.width;
                      resizeStateRef.current = {
                        columnId: column.id,
                        startX: event.clientX,
                        startWidth,
                        pointerId: event.pointerId,
                        widthSign: plannedCol.pinned === "right" ? -1 : 1,
                      };
                      wasResizingRef.current = false;
                      try {
                        event.currentTarget.setPointerCapture(event.pointerId);
                      } catch {
                        // jsdom — no-op
                      }
                      setDragLiveWidth({
                        columnId: column.id,
                        width: startWidth,
                      });
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
                          drag.startWidth +
                            drag.widthSign * (event.clientX - drag.startX),
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
                      const finalWidth =
                        dragLiveWidth?.width ?? drag.startWidth;
                      try {
                        event.currentTarget.releasePointerCapture(
                          drag.pointerId,
                        );
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
                ) : null}
                {showFilterFunnel ? (
                  <div
                    data-pretable-filter-funnel-slot=""
                    style={{
                      position: "absolute",
                      top: 0,
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      // The 18px funnel sits immediately left of the 4px resize
                      // strip: 22px back from the trailing edge.
                      left: -22,
                    }}
                  >
                    <FunnelButton
                      columnId={column.id}
                      label={label}
                      active={Boolean(snapshot.filters[column.id])}
                      open={filterOpenState?.columnId === column.id}
                      onToggle={(id, anchor) => toggleFilter(id, anchor)}
                    />
                  </div>
                ) : null}
              </div>
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
              onClick={(event) => {
                // rowProps is spread above, so this would shadow a consumer's
                // onClick — call it explicitly rather than dropping it.
                rowProps.onClick?.(event);
                if (!onRowActivate) return;
                // Modifier clicks build cell ranges; so does the click that
                // ends a drag. Neither means "open this row".
                if (
                  event.shiftKey ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.altKey
                ) {
                  return;
                }
                if (dragExtendedRef.current) {
                  dragExtendedRef.current = false;
                  return;
                }
                // A click inside a cell being edited belongs to the editor.
                if (
                  event.target instanceof Element &&
                  event.target.closest("[data-pretable-edit-status]")
                ) {
                  return;
                }
                onRowActivate({ row, rowId: id, rowIndex });
              }}
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
                const cellEdit =
                  snapshot.editing &&
                  snapshot.editing.rowId === id &&
                  snapshot.editing.columnId === column.id
                    ? snapshot.editing
                    : null;
                const formattedValue = column.format
                  ? column.format({ value, row, column })
                  : formatCellValue(value);
                const bodyInput = {
                  column,
                  formattedValue,
                  isFocused: cellIsFocused,
                  isSelected: cellIsSelected,
                  pinned: plannedCol.pinned ?? null,
                  row,
                  rowId: id,
                  rowIndex,
                  value,
                } satisfies PretableSurfaceBodyCellRenderInput<TRow>;
                const bodyProps = getBodyCellProps?.(bodyInput) ?? {};
                const cellEffWidth =
                  dragLiveWidth?.columnId === column.id
                    ? dragLiveWidth.width
                    : plannedCol.width;
                const pinnedRightEdge =
                  plannedCol.pinned === "right" &&
                  plannedCol.right !== undefined
                    ? getPinnedRightEdge(viewportWidth, plannedCol.right)
                    : undefined;
                const positionStyle =
                  plannedCol.pinned === "left"
                    ? {
                        ...getCellStyle(plannedCol.left, cellEffWidth),
                        ...getPinnedCellStyle(plannedCol.left),
                      }
                    : pinnedRightEdge !== undefined
                      ? {
                          ...getCellStyle(plannedCol.left, cellEffWidth),
                          ...getPinnedRightCellStyle(
                            pinnedRightEdge,
                            cellEffWidth,
                          ),
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
                    data-pretable-pinned={plannedCol.pinned}
                    data-pretable-cell=""
                    data-pretable-wrap={column.wrap ? "true" : undefined}
                    data-pretable-row-select-cell={
                      isRowSelectCell ? "true" : undefined
                    }
                    data-pretable-selected={cellIsSelected ? "true" : "false"}
                    data-pretable-edit-status={cellEdit?.status}
                    key={`${id}:${column.id}`}
                    onClick={(event) => {
                      if (column.id === ROW_SELECT_COLUMN_ID) return;
                      handleCellClick({
                        cmd: event.metaKey || event.ctrlKey,
                        columnId: column.id,
                        columns: columnsInVisualOrder,
                        grid,
                        onFocusChange,
                        onSelectedRowIdChange,
                        onSelectionChange,
                        rowId: id,
                        shift: event.shiftKey,
                      });
                    }}
                    onDoubleClick={() => {
                      if (column.id === ROW_SELECT_COLUMN_ID) return;
                      // Boolean cells never popover-edit; the control's own
                      // click toggles (a hidden begin() here would strand an
                      // active edit with no editor rendered).
                      if (column.type === "boolean") return;
                      if (column.editable) {
                        setSeededFromTyping(false);
                        void editController.begin({
                          rowId: id,
                          columnId: column.id,
                        });
                      }
                    }}
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      if (column.id === ROW_SELECT_COLUMN_ID) return;
                      const cmd = event.metaKey || event.ctrlKey;
                      if (event.shiftKey || cmd) return;

                      dragStartSelectionRef.current =
                        grid.getSnapshot().selection;
                      dragExtendedRef.current = false;
                      dragAnchorRef.current = {
                        rowId: id,
                        columnId: column.id,
                      };
                      handleCellClick({
                        cmd: false,
                        columnId: column.id,
                        columns: columnsInVisualOrder,
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
                      dragExtendedRef.current = true;
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
                          columnsInVisualOrder.filter(
                            (c) => c.id !== ROW_SELECT_COLUMN_ID,
                          ),
                        );
                        const afterFullRow = singleFullRowSelection(
                          after.selection,
                          columnsInVisualOrder.filter(
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
                    {column.type === "boolean" && !isRowSelectCell ? (
                      // Boolean cells render the toggle control instead of
                      // cell content AND instead of the CellEditor popover —
                      // an active boolean edit shows as the busy control. A
                      // failed commit (validate reject / onCellEdit throw)
                      // renders the same error element CellEditor uses, since
                      // this branch always wins over the popover branch.
                      <>
                        <BooleanCellControl
                          checked={toBooleanCell(value)}
                          editable={Boolean(column.editable)}
                          status={cellEdit ? cellEdit.status : null}
                          errorId={
                            cellEdit?.error
                              ? `pretable-edit-error-${id}-${column.id}`
                              : undefined
                          }
                          label={column.header ?? column.id}
                          onToggle={() => void toggleBooleanCell(id, column)}
                        />
                        {cellEdit?.error ? (
                          <div
                            id={`pretable-edit-error-${id}-${column.id}`}
                            data-pretable-edit-error
                            role="alert"
                          >
                            {cellEdit.error}
                          </div>
                        ) : null}
                      </>
                    ) : cellEdit ? (
                      <CellEditor
                        input={
                          {
                            rowId: id,
                            columnId: column.id,
                            row,
                            column,
                            value,
                            status: cellEdit.status,
                            error: cellEdit.error,
                            draft: cellEdit.draft,
                            setDraft: (v: unknown) => grid.setEditDraft(v),
                            commit: (dir?: PretableFocusDirection) =>
                              void editController.commit(dir),
                            cancel: () => editController.cancel(),
                            seededFromTyping,
                          } as unknown as PretableEditorInput
                        }
                      />
                    ) : isRowSelectCell ? (
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
                        pinned={bodyInput.pinned}
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
          {/* The ghost is `position: fixed` at cursor (viewport) coordinates.
              The scroll viewport's `contain: content` would make it the
              containing block AND clip the ghost, so it must be portaled to
              document.body. The drop indicator below is `position: absolute`
              in content coordinates and must stay inside the viewport. */}
          <OverlayPortal>
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
          </OverlayPortal>
          <div
            data-pretable-reorder-drop-indicator=""
            style={{
              left: reorderDrag.indicatorLeft,
              height: reorderDrag.ghostHeight + bodyViewportHeight,
            }}
          />
        </>
      ) : null}
      {filterOpenState
        ? (() => {
            const col = effectiveColumns.find(
              (c) => c.id === filterOpenState.columnId,
            );
            if (!col) return null;
            const options = resolveColumnOptions(col, () =>
              grid.distinctColumnValues(filterOpenState.columnId),
            );
            return (
              <FilterMenu
                key={filterOpenState.columnId}
                columnId={filterOpenState.columnId}
                label={col.header ?? filterOpenState.columnId}
                type={col.type ?? "text"}
                options={options}
                initialFilter={
                  snapshot.filters[filterOpenState.columnId] ?? null
                }
                style={popoverStyle(filterOpenState.rect)}
                onChange={(id, filter) => {
                  grid.setColumnFilter(id, filter);
                  onFiltersChange?.(grid.getSnapshot().filters);
                }}
                onClose={closeFilter}
              />
            );
          })()
        : null}
    </div>
  );
}

/**
 * Whether the surface may move DOM focus away from `active`.
 *
 * Two things count as ours:
 *
 * - **Nothing is focused.** `null` and `<body>` both mean the document has no
 *   focus owner. This is not an edge case — it is the *normal* state at the
 *   moment a distant focus move completes, because scrolling to the target
 *   unmounts the cell that had focus and the browser drops focus to `<body>`
 *   when a focused element is removed. Refusing it would break exactly the
 *   case this exists for. It is safe because a move is only ever pending
 *   immediately after the engine's focus address changed; a user who parked
 *   focus on `<body>` by clicking the page background is never disturbed,
 *   since there is no pending move to apply.
 * - **Focus is already inside the scroll viewport**, i.e. on another cell or
 *   on the viewport itself.
 *
 * Everything else is someone else's: a filter popover or a typed-editor
 * overlay (both portaled to `document.body` by `OverlayPortal`, so they are
 * deliberately *not* inside the viewport subtree), or any part of the host
 * page that has nothing to do with the grid.
 *
 * Note the cell editor's input is NOT covered here — it lives inside the cell,
 * so it is inside the viewport. The `snapshot.editing` bail-out guards it.
 */
function isFocusOursToMove(
  viewport: HTMLElement | null,
  active: Element | null,
): boolean {
  if (active === null || active === document.body) {
    return true;
  }

  return viewport !== null && viewport.contains(active);
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

/**
 * Where a clipboard block should land: the top-left of the active selection,
 * or the focused cell when nothing is selected.
 *
 * Multi-range selections are not replayed (Excel refuses multi-area paste and
 * ag-grid's replay is documented as lossy) — the range holding the focused
 * cell wins, falling back to the first range. Row-select bounds resolve to the
 * full data-column span, which is how a full-row selection encodes itself.
 * Returns null when there is nothing to anchor on.
 */
function resolvePasteAnchor<TRow extends PretableRow>(
  ranges: readonly PretableCellRange[],
  focus: PretableFocusState,
  visibleRows: readonly PretableVisibleRow<TRow>[],
  /** Columns in DRAWN order — paste geometry counts across them. */
  columns: readonly PretableColumn<TRow>[],
): {
  anchor: PretableCellAddress;
  selectionSize: { rows: number; columns: number };
} | null {
  const dataColumns = columns.filter((c) => c.id !== ROW_SELECT_COLUMN_ID);
  if (dataColumns.length === 0 || visibleRows.length === 0) return null;

  if (ranges.length === 0) {
    return focus.rowId && focus.columnId
      ? {
          anchor: { rowId: focus.rowId, columnId: focus.columnId },
          selectionSize: { rows: 1, columns: 1 },
        }
      : null;
  }

  const rowOrder = new Map<string, number>();
  for (let i = 0; i < visibleRows.length; i += 1) {
    const row = visibleRows[i];
    if (row) rowOrder.set(row.id, i);
  }
  const colOrder = new Map<string, number>();
  for (let i = 0; i < dataColumns.length; i += 1) {
    colOrder.set(dataColumns[i]!.id, i);
  }

  const resolve = (
    range: PretableCellRange,
  ): {
    rowLo: number;
    rowHi: number;
    colLo: number;
    colHi: number;
  } | null => {
    const r1 = rowOrder.get(range.startRowId);
    const r2 = rowOrder.get(range.endRowId);
    if (r1 === undefined || r2 === undefined) return null;
    const startSynth = range.startColumnId === ROW_SELECT_COLUMN_ID;
    const endSynth = range.endColumnId === ROW_SELECT_COLUMN_ID;
    let colLo: number;
    let colHi: number;
    if (startSynth && endSynth) {
      colLo = 0;
      colHi = dataColumns.length - 1;
    } else if (startSynth || endSynth) {
      const other = colOrder.get(
        startSynth ? range.endColumnId : range.startColumnId,
      );
      if (other === undefined) return null;
      colLo = 0;
      colHi = other;
    } else {
      const c1 = colOrder.get(range.startColumnId);
      const c2 = colOrder.get(range.endColumnId);
      if (c1 === undefined || c2 === undefined) return null;
      colLo = Math.min(c1, c2);
      colHi = Math.max(c1, c2);
    }
    return { rowLo: Math.min(r1, r2), rowHi: Math.max(r1, r2), colLo, colHi };
  };

  const focusRow = focus.rowId === null ? undefined : rowOrder.get(focus.rowId);
  const focusCol =
    focus.columnId === null ? undefined : colOrder.get(focus.columnId);

  let chosen: ReturnType<typeof resolve> = null;
  for (const range of ranges) {
    const box = resolve(range);
    if (!box) continue;
    if (!chosen) chosen = box;
    if (
      focusRow !== undefined &&
      focusCol !== undefined &&
      focusRow >= box.rowLo &&
      focusRow <= box.rowHi &&
      focusCol >= box.colLo &&
      focusCol <= box.colHi
    ) {
      chosen = box;
      break;
    }
  }
  if (!chosen) return null;

  return {
    anchor: {
      rowId: visibleRows[chosen.rowLo]!.id,
      columnId: dataColumns[chosen.colLo]!.id,
    },
    selectionSize: {
      rows: chosen.rowHi - chosen.rowLo + 1,
      columns: chosen.colHi - chosen.colLo + 1,
    },
  };
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
  /**
   * Columns in DRAWN order. A range's bounds are column ids with everything
   * between them implied, so the span — and therefore the count announced —
   * only means what the user sees if this is the order on screen.
   */
  columns: readonly PretableColumn<TRow>[],
): { rowCount: number; columnCount: number; isAll: boolean } {
  const visibleRows = snapshot.visibleRows;
  const dataColumns = columns.filter((c) => c.id !== ROW_SELECT_COLUMN_ID);

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
  for (let i = 0; i < columns.length; i += 1) {
    const c = columns[i];
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
        const col = columns[i];
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
  onRowActivate?: (input: PretableRowActivateInput<TRow>) => void;
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
    onRowActivate,
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
      if (onRowActivate) {
        const index = visibleRows.findIndex((r) => r.id === focusedRowId);
        const activated = visibleRows[index];
        if (activated) {
          onRowActivate({
            row: activated.row,
            rowId: focusedRowId,
            rowIndex: index,
          });
        }
      }
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
): Record<string, "left" | "right" | null> {
  const result: Record<string, "left" | "right" | null> = {};
  for (const col of grid.options.columns) {
    if (col.id === ROW_SELECT_COLUMN_ID) continue;
    result[col.id] = col.pinned ?? null;
  }
  return result;
}

function pinnedMapsEqual(
  a: Record<string, "left" | "right" | null>,
  b: Record<string, "left" | "right" | null>,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}
