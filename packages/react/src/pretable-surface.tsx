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
  useInsertionEffect,
} from "react";
import { GROUP_COLUMN_ID } from "@pretable/core";
import type {
  AutosizeOptions,
  ColumnIdOf,
  ColumnValueOf,
  ColumnFilter,
  PretableCellAddress,
  PretableCellRange,
  PretableExpansionDefault,
  PretableFocusState,
  PretableGroupColumnOptions,
  PretableRow,
  PretableSelectionState,
  PretableSortEntry,
  PretableGroupId,
  PretableRowId,
  PretableRowModel,
  PretableRowModelSnapshot,
  PretableRowSelectionState,
  PretableDistinctValueQuery,
  PretableQueryFor,
  PretableProcessingOptions,
  PretableResultMeta,
  PretableVisibleRowRef,
  PretableViewportState,
  PretableIndexedDatasetRowSpan,
  PretableIndexedFocusRef,
  PretableIndexedSelectionState,
} from "@pretable/core";
import type {
  PretableCellRenderInput,
  PretableColumn,
  PretableEditInput,
  PretableColumnValue,
  PretableEditorInput,
  PretableHeaderRenderInput,
  PretableRowIdRequirement,
  PretableRowChange as PretableTypedRowChange,
} from "./types";
import {
  getIndexedCellSelectionSummary,
  HEADER_FOCUS_REF,
  indexedRangeContainsCell,
} from "@pretable-internal/grid-core";
import type {
  PretableIndexedFocusMovement,
  PretableIndexedSelectionWindow,
} from "@pretable-internal/grid-core";
import {
  scrollLeftToReveal,
  scrollTopToReveal,
} from "@pretable-internal/renderer-dom";

type PretableFocusDirection = "up" | "down" | "left" | "right";

import { planColumnLayout } from "@pretable-internal/renderer-dom";
import { resolveColumnAlign } from "./column-align";
import { computeColumnDropTarget } from "./column-drag-geometry";
import { cellAddressFromElement } from "./marquee-drag";
import { measureRenderedRowHeight } from "./row-height";
import {
  mergeModelPresentationColumnsForTesting,
  type ModelSchemaColumn,
  type PretableModel,
  usePretable,
} from "./use-pretable";
import type {
  PretableSelectionFor,
  PretableSurfaceFocusState,
  PretableSurfaceColumnId,
  PretableSurfaceInteractionColumnId,
  PretableSurfaceState,
  PretableTelemetry,
} from "./surface-types";
import type { PretableReactGrid, WindowSpacers } from "./pretable-model";
import {
  getThemeRowHeight,
  useResolvedHeights,
  useResolvedPx,
} from "./density";
import {
  DEFAULT_ROW_HEIGHT,
  formatCellValue,
  getNextSortDirection,
  resolveCellValue,
} from "./rendering";
import {
  getBodyStateOverlayStyle,
  getDataStateWrapperStyle,
  getGroupPanelWrapperStyle,
  getHeaderCellStyle,
  getHeaderOverlayAnchorStyle,
  getHeaderRowStyle,
  getPinnedCellStyle,
  getPinnedRightCellStyle,
  getPinnedRightEdge,
  getPositionedCellStyle,
  getRowStyle,
  getScrollContentStyle,
  getViewportStyle,
} from "./styles";
import { findParentGroupRow } from "./group-model";
import { GroupRow } from "./group-row";
import { GroupPanel } from "./group-panel/GroupPanel";
import { hitTestGroupPanel } from "./group-panel/group-panel-hit-test";
import {
  insertGroupLevel,
  removeGroupLevel,
} from "./group-panel/group-panel-model";

export { ROW_SELECT_COLUMN_ID } from "./constants";
import { GROUP_PANEL_HEIGHT, ROW_SELECT_COLUMN_ID } from "./constants";
import { useCellEditController } from "./use-cell-edit-controller";
import { CellEditor } from "./cell-editor";
import { BooleanCellControl } from "./editors/BooleanCellControl";
import { toBooleanCell } from "./editors/boolean-utils";
import { ColumnMenu } from "./column-menu/ColumnMenu";
import { MenuButton } from "./column-menu/MenuButton";
import { FilterMenu, FunnelButton } from "./filter-menu";
import { resolveColumnOptions } from "./filter-menu/filter-operators";
import { OverlayPortal } from "./overlay/OverlayPortal";
import { popoverStyle } from "./overlay/popover-position";
import { useHeaderPopover } from "./overlay/useHeaderPopover";
import { useHydrated } from "./use-hydrated";
import {
  type CopyPayload,
  type SerializeRangesArgs,
  serializeRangesWithNumberFormatters,
} from "./copy";
import {
  type PretableCsvFile,
  type PretableCsvOmission,
  type PretableCsvOptions,
  type PretableExportScope,
  type SerializeCsvArgs,
  serializeCsv,
} from "./csv";
import { defaultSaveFile } from "./save-file";

type GroupingFocusIntent = {
  target: "chip" | "header";
  columnId: string;
};

type PendingGroupingFocusRequest = {
  intent: GroupingFocusIntent;
  expectedRowGroups: readonly string[];
};

function groupingListsEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((columnId, index) => columnId === right[index])
  );
}

function sameRowIdList<TRowId extends PretableRowId>(
  left: readonly TRowId[] | undefined,
  right: readonly TRowId[] | undefined,
): boolean {
  if (left === right) return true;
  const leftIds = left ?? [];
  const rightIds = right ?? [];
  return (
    leftIds.length === rightIds.length &&
    // SameValueZero, so a NaN row id compares equal to itself the way it does
    // everywhere else the engine matches row ids.
    leftIds.every((rowId, index) => {
      const other = rightIds[index];
      return rowId === other || (rowId !== rowId && other !== other);
    })
  );
}

/**
 * Has the caller's `state.rowSelection` changed since the surface last wrote
 * it? Compares the REQUEST, not the resulting engine slice: two requests can
 * describe the same ticked rows through different (and differently priced)
 * programs — `{ kind: "all" }` and an explicit list of every id both tick
 * everything, and only one of them stays symbolic as rows arrive.
 *
 * Order-sensitive on purpose. Re-ordering the same ids re-applies, which the
 * engine then absorbs as a no-op; sorting both sides to avoid that would cost
 * more than the write it saves.
 */
function sameRowSelectionRequest<TRowId extends PretableRowId>(
  left: PretableRowSelectionState<TRowId>,
  right: PretableRowSelectionState<TRowId>,
): boolean {
  if (left === right) return true;
  if (left.kind !== right.kind) return false;
  if (!sameRowIdList(left.excludedRowIds, right.excludedRowIds)) return false;
  if (left.kind !== "explicit" || right.kind !== "explicit") return true;
  const leftRanges = left.ranges ?? [];
  const rightRanges = right.ranges ?? [];
  return (
    sameRowIdList(left.rowIds, right.rowIds) &&
    leftRanges.length === rightRanges.length &&
    leftRanges.every((range, index) => {
      const other = rightRanges[index];
      return (
        other !== undefined &&
        sameRowIdList(
          [range.startRowId, range.endRowId],
          [other.startRowId, other.endRowId],
        )
      );
    })
  );
}

/**
 * The public, flat cell-range shape (`startRowId`/`endRowId`/…) from the
 * engine's nested one.
 *
 * `datasetRowSpan` rides along. Without it the public shape has no field for
 * a range's dataset positions at all, so every controlled `state.selection`
 * round-trip would drop them by construction — and while the rows are
 * evicted those positions are the only thing that still says how many rows
 * the selection covers. See `PretableIndexedDatasetRowSpan`.
 */
function flattenIndexedRange(range: {
  readonly start: { readonly rowId: PretableRowId; readonly columnId: string };
  readonly end: { readonly rowId: PretableRowId; readonly columnId: string };
  readonly datasetRowSpan?: PretableIndexedDatasetRowSpan;
}) {
  return {
    startRowId: range.start.rowId,
    endRowId: range.end.rowId,
    startColumnId: range.start.columnId,
    endColumnId: range.end.columnId,
    ...(range.datasetRowSpan === undefined
      ? {}
      : { datasetRowSpan: range.datasetRowSpan }),
  };
}

/**
 * The engine's nested cell-range shape from the public flat one — the exact
 * inverse of {@link flattenIndexedRange}, including the span.
 */
function inflateIndexedRange(range: {
  readonly startRowId: PretableRowId;
  readonly endRowId: PretableRowId;
  readonly startColumnId: string;
  readonly endColumnId: string;
  readonly datasetRowSpan?: PretableIndexedDatasetRowSpan;
}) {
  return {
    start: { rowId: range.startRowId, columnId: range.startColumnId },
    end: { rowId: range.endRowId, columnId: range.endColumnId },
    ...(range.datasetRowSpan === undefined
      ? {}
      : { datasetRowSpan: range.datasetRowSpan }),
  };
}

/** The public flat shape or the engine's nested one, as a range's dataset span. */
type RangeWithSpan = {
  readonly start: { readonly rowId: PretableRowId; readonly columnId: string };
  readonly end: { readonly rowId: PretableRowId; readonly columnId: string };
  readonly datasetRowSpan?: PretableIndexedDatasetRowSpan;
};

/**
 * `@pretable-internal/grid-core` resolves `PretableRowModelSnapshot` through
 * `@pretable-internal/row-model`'s own declarations; everything on the react
 * side resolves the identical shape through the copy `@pretable/core` bundles.
 * The two are structurally the same and nominally distinct — the `groupId`
 * brand differs — so the snapshot crosses that boundary through a cast, the
 * same adaptation `usePretableModelInternal` already makes to hand its row
 * model to `createGridUiCore`.
 *
 * Confined to these two wrappers so no call site repeats it, and so the casts
 * stay on the two arguments that carry that brand — the snapshot and the row
 * ref. Ranges, column ids and the window all cross as themselves and stay
 * checked.
 */
function rangeContainsCell<
  TRow extends PretableRow,
  TRowId extends PretableRowId,
  TColumns,
>(
  range: RangeWithSpan,
  ref: PretableVisibleRowRef<TRowId>,
  columnId: string,
  snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
  columns: readonly string[],
  loadedWindow: PretableIndexedSelectionWindow | null,
): boolean {
  return indexedRangeContainsCell(
    range,
    ref as never,
    columnId,
    snapshot as never,
    columns,
    loadedWindow,
  );
}

/** See {@link rangeContainsCell} for why the snapshot is cast. */
function cellSelectionRowCount<
  TRow extends PretableRow,
  TRowId extends PretableRowId,
  TColumns,
>(
  ranges: readonly RangeWithSpan[],
  snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
  loadedWindow: PretableIndexedSelectionWindow | null,
): number {
  return getIndexedCellSelectionSummary(
    // Only `ranges` is read. The checkbox program is a separate slice with a
    // separate summary (`getSelectionSummary`), and the call sites that
    // announce it read it from there.
    {
      rows: { kind: "explicit", rowIds: new Set<PretableRowId>() },
      ranges,
      anchor: null,
    },
    snapshot as never,
    loadedWindow,
  ).rowCount;
}

function projectIndexedSelection(
  selection: PretableIndexedSelectionState<PretableRowId, string>,
): PretableSelectionState {
  return {
    ranges: selection.ranges.map(
      flattenIndexedRange,
    ) as unknown as PretableCellRange[],
    anchor:
      selection.anchor === null
        ? null
        : (selection.anchor as unknown as PretableCellAddress),
  };
}
import {
  mapPasteToTargets,
  type PastedCell,
  type PastePayload,
  parseTsv,
  type RejectedPasteCell,
} from "./paste";
import { parseDraftForType } from "./editors/type-parsing";
import { deriveRowChange } from "./row-change";
import { CheckIcon, MinusIcon, SortAscIcon, SortDescIcon } from "./icons";
import {
  compileNumberFormatters,
  formatDataCellValue,
} from "./value-formatting";
import {
  resolveAriaRowCount,
  resolveDataScope,
  warnOnEngineSortOverPartialWindow,
  warnOnMissingDatasetKeyForWindow,
} from "./data-scope";
import {
  resolveBodyStateKind,
  type PretableBodyStateKind,
  type PretableDataState,
} from "./data-state";

/** Local interaction facade used while the surface maps UI commands onto the
 * indexed grid and row model. Row data, queries, grouping, and expansion
 * remain model-owned. */
interface SurfaceFacade<TRow extends PretableRow> {
  readonly options: { readonly columns: readonly PretableColumn<TRow>[] };
  getSnapshot(): {
    readonly viewport: PretableViewportState;
    readonly sort: readonly PretableSortEntry[];
    readonly filters: Readonly<Record<string, ColumnFilter>>;
    readonly selection: PretableSelectionState;
    readonly focus: PretableFocusState & {
      readonly ref: PretableIndexedFocusRef<PretableRowId> | null;
    };
    readonly editing: {
      readonly rowId: PretableRowId;
      readonly columnId: string;
      readonly draft: unknown;
      readonly status: string;
      readonly error?: string;
    } | null;
    readonly rowGroups: readonly string[];
    readonly totalRowCount: number;
  };
  getColumns(): readonly PretableColumn<TRow>[];
  setViewport(viewport: PretableViewportState): void;
  setFocus(addr: PretableCellAddress | null): void;
  setFocusRef(
    ref: PretableIndexedFocusRef<PretableRowId>,
    columnId: string,
  ): void;
  moveFocus(
    direction: PretableFocusDirection,
    options?: { extend?: boolean; jumpToEdge?: boolean; byPage?: boolean },
  ): void;
  setSelection(selection: PretableSelectionState): void;
  addRange(range: PretableCellRange): void;
  extendRangeFromAnchor(addr: PretableCellAddress): void;
  clearSelection(): void;
  toggleRowSelection(rowId: PretableRowId): void;
  setSelectAllVisible(checked: boolean): void;
  selectAll(): void;
  setSort(columnId: string, direction: "asc" | "desc" | null): void;
  replaceSort(sort: readonly PretableSortEntry[]): void;
  setColumnFilter(columnId: string, filter: ColumnFilter | null): void;
  setRowGroups(columnIds: readonly string[]): void;
  // Group ids are the row model's branded ids, not free strings: they are
  // minted by the model and only ever read back off a group row's ref. Keeping
  // the brand here is what lets the calls through to `rowModel` typecheck.
  setGroupExpanded(groupId: PretableGroupId, expanded: boolean): void;
  toggleGroup(groupId: PretableGroupId): void;
  setColumnWidth(columnId: string, width: number): void;
  setColumnPinned(columnId: string, pinned: "left" | "right" | null): void;
  moveColumn(columnId: string, toIndex: number): void;
  beginEdit(
    addr: PretableCellAddress,
    edit?: { draft?: unknown; status?: "checking" | "editing" },
  ): void;
  setEditDraft(value: unknown): void;
  markEditing(): void;
  markEditValidating(): void;
  markEditSaving(): void;
  markEditInvalid(message: string): void;
  markEditError(message: string): void;
  commitEditSucceeded(): void;
  cancelEdit(): void;
  autosizeColumn(): void;
}

async function defaultCopyToClipboard(payload: CopyPayload): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.clipboard) return;
  if (
    payload.html &&
    typeof globalThis.ClipboardItem !== "undefined" &&
    typeof navigator.clipboard.write === "function"
  ) {
    try {
      await navigator.clipboard.write([
        new globalThis.ClipboardItem({
          "text/plain": new Blob([payload.text], { type: "text/plain" }),
          "text/html": new Blob([payload.html], { type: "text/html" }),
        }),
      ]);
      return;
    } catch {
      // Feature detection only proves ClipboardItem and write() exist, not
      // that the write succeeds — a polyfilled ClipboardItem, a restricted
      // embedding context, or an extension page can all reject here. Landing
      // the TSV alone beats leaving the clipboard empty, so fall through
      // rather than surfacing a failure the single-flavor path would not have
      // had. If writeText rejects too, that rejection is the real one.
    }
  }
  await navigator.clipboard.writeText(payload.text);
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
  selectAllLabel?: (args: { scope: "all" | "loaded" }) => string;
  selectAllAnnouncement?: (args: {
    rowCount: number;
    columnCount: number;
    isAll: boolean;
    scope: "all" | "loaded";
    loadedCount: number;
    total?: number;
  }) => string;
  copyAnnouncement?: (args: {
    rowCount: number;
    columnCount: number;
    scope: "all" | "loaded";
  }) => string;
  copyFailedAnnouncement?: () => string;
  /**
   * Announced once a CSV export has been delivered — i.e. after `saveFile`
   * resolves, never before it, because the consumer may own the delivery.
   *
   * **An override MUST say something when `complete` is false.** A partial file
   * is the failure mode {@link serializeCsv} exists to refuse silently
   * committing, and a download is otherwise indistinguishable from a whole one
   * — the row count looks plausible either way, and a screen-reader user never
   * sees the `-PARTIAL` filename the browser writes to disk.
   *
   * `omissions` is {@link PretableCsvFile.omissions} verbatim, so a localizer
   * can name the reason rather than only report that there was one; `complete`
   * is `omissions.length === 0`, derived and passed for ergonomics exactly as
   * {@link PretableCsvFile.complete} is.
   *
   * `columnCount` is the columns the export ASKED for, after the row-select
   * column is dropped and any `columnIds` subset is applied. That is the count
   * actually written in every case but one: an {@link
   * PretableSurfaceSharedProps.onExport} that returns a hand-built file can
   * disagree, because `PretableCsvFile` carries no column count to read back.
   * `rowCount`, `scope`, `complete` and `omissions` all come from the file
   * itself and are exact.
   */
  exportAnnouncement?: (args: {
    rowCount: number;
    columnCount: number;
    scope: "all" | "loaded";
    complete: boolean;
    omissions: readonly PretableCsvOmission[];
  }) => string;
  /**
   * Announced when the file never reached the user — `saveFile` threw or
   * rejected. Separate from {@link PretableSurfaceMessages.exportAnnouncement}
   * for the same reason `copyFailedAnnouncement` is separate from
   * `copyAnnouncement`: nothing was delivered, so there are no counts to report.
   */
  exportFailedAnnouncement?: () => string;
  /**
   * Announced once a paste has been applied — i.e. after `onPaste` resolves,
   * never before it, because the consumer owns the write.
   *
   * One function rather than one per outcome: a clean paste, a partial paste
   * and a wholly rejected paste are the same sentence at different counts, and
   * clipping is orthogonal to all three (any of them can also have been
   * trimmed). Splitting them would force an overriding localizer to repeat the
   * same pluralization across the cross-product of cases.
   *
   * `cellCount` is cells actually written, `rejectedCount` cells refused by
   * `editable`/`validate`. `cellCount === 0` with a non-zero `rejectedCount` is
   * the case worth wording distinctly: to a screen-reader user it is otherwise
   * indistinguishable from nothing having happened. `clipped` is
   * `PastePayload.clipped` verbatim — rows/columns of the target area that fell
   * off the end of the grid.
   *
   * Per-cell `rejected[].message` text is deliberately not passed: a live
   * region is the wrong place for a list. Render those from `onPaste`.
   */
  pasteAnnouncement?: (args: {
    cellCount: number;
    rejectedCount: number;
    clipped: { rows: number; columns: number };
  }) => string;
  /**
   * Announced when the paste never completed — the gate threw, or `onPaste`
   * itself threw or rejected. Separate from {@link
   * PretableSurfaceMessages.pasteAnnouncement} for the same reason
   * `copyFailedAnnouncement` is separate from `copyAnnouncement`: nothing was
   * applied, so there are no counts to report.
   */
  pasteFailedAnnouncement?: () => string;
  groupChildCountLabel?: (args: {
    childCount: number;
    scope: "all" | "loaded";
  }) => string;
  emptyStateMessage?: () => string;
  loadingStateMessage?: () => string;
  dataErrorAnnouncement?: (args: { message?: string }) => string;
}

const defaultMessages: Required<PretableSurfaceMessages> = {
  selectAllLabel: ({ scope }) =>
    scope === "loaded" ? "Select all loaded rows" : "Select all rows",
  selectAllAnnouncement: ({
    rowCount,
    columnCount,
    isAll,
    scope,
    loadedCount,
  }) =>
    isAll
      ? scope === "loaded"
        ? `${rowCount} of ${loadedCount} loaded rows selected`
        : "All rows selected"
      : `${rowCount} rows × ${columnCount} columns selected`,
  copyAnnouncement: ({ rowCount, columnCount, scope }) =>
    scope === "loaded"
      ? `${rowCount} loaded rows × ${columnCount} columns copied`
      : `${rowCount} rows × ${columnCount} columns copied`,
  copyFailedAnnouncement: () => "Copy failed",
  exportAnnouncement: ({ rowCount, columnCount, scope, complete }) => {
    const base =
      scope === "loaded"
        ? `${rowCount} loaded rows × ${columnCount} columns exported`
        : `${rowCount} rows × ${columnCount} columns exported`;
    // Said out loud, not left to the filename. The `-PARTIAL` marker travels
    // with the file on disk; it is not announced anywhere a screen-reader user
    // hears it, and this live region is the only place they learn the download
    // they just triggered is short.
    return complete ? base : `${base}, partial file`;
  },
  exportFailedAnnouncement: () => "Export failed",
  pasteAnnouncement: ({ cellCount, rejectedCount, clipped }) => {
    const base =
      cellCount === 0
        ? `No cells pasted, ${rejectedCount} rejected`
        : `${cellCount} cell${cellCount === 1 ? "" : "s"} pasted` +
          (rejectedCount > 0 ? `, ${rejectedCount} rejected` : "");
    return clipped.rows > 0 || clipped.columns > 0
      ? `${base}, clipped to fit`
      : base;
  },
  pasteFailedAnnouncement: () => "Paste failed",
  groupChildCountLabel: ({ childCount, scope }) =>
    scope === "loaded" ? `(${childCount} loaded)` : `(${childCount})`,
  emptyStateMessage: () => "No results",
  loadingStateMessage: () => "Loading…",
  dataErrorAnnouncement: ({ message }) =>
    message ? `Could not load results. ${message}` : "Could not load results",
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
 * The surface's half of the windowed-scroll coordinate seam.
 *
 * `renderSnapshot.rowMetrics` is built over the LOADED rows only, so every
 * offset it takes or returns is measured from the first loaded row. Everything
 * else the surface touches — `el.scrollTop`, `grid.setViewport`'s `scrollTop`,
 * each `renderSnapshot.rows[].top` — is GLOBAL, measured from the top of the
 * dataset. `renderSnapshot.leadingHeight` is the distance between them, and is
 * `0` on every non-windowed grid, which is why mixing the two went unnoticed
 * until a window sat at a nonzero offset.
 *
 * Both directions live here so a call site names the crossing instead of
 * open-coding `± leadingHeight`.
 */
function toLocalRowOffset(
  globalScrollTop: number,
  leadingHeight: number,
): number {
  return Math.max(0, globalScrollTop - leadingHeight);
}

function toGlobalScrollTop(localOffset: number, leadingHeight: number): number {
  return Math.max(0, localOffset + leadingHeight);
}

/**
 * The marquee cell-range drag listens on `window` in the CAPTURE phase, not the
 * bubble phase.
 *
 * WebKit fires `selectstart` on a drag across cell text and begins its own
 * native text selection; Chromium does not. That native gesture stops the
 * subsequent `pointermove` events from reaching a bubble-phase `window`
 * listener, so the range never grew past the anchor cell — on Linux WebKit
 * only, which is why three earlier fixes that all listened in the bubble phase
 * passed locally and on Chromium while failing in CI.
 *
 * Diagnostic evidence (CI, Linux WebKit): a capture-phase probe received all
 * 19 `pointermove` events with correctly advancing targets
 * (`r1/name → r2/name → r3/name → r3/qty`) during the same drag in which the
 * production bubble-phase listener extended nothing. The event counts were
 * otherwise identical to Chromium's; `selectstart` was the single difference.
 *
 * Capture phase runs before anything downstream can interfere, and
 * {@link suppressNativeSelection} additionally stops the native selection from
 * starting at all.
 */
const DRAG_LISTENER_OPTIONS = { capture: true } as const;

/**
 * Cancels the browser's native text-selection gesture for the duration of a
 * marquee drag. Cell text is copied through the grid's own range copy
 * (Cmd/Ctrl+C), never an OS text selection, so nothing intended is lost.
 */
const suppressNativeSelection = (event: Event) => {
  event.preventDefault();
};
/**
 * How many pasted cells are gated (`editable`/`validate`) at a time. Both hooks
 * may be async and may call a server, so a spreadsheet-sized block is worked
 * through in batches instead of putting every cell in flight at once. Purely an
 * execution detail — the payload is the same whatever the batch size.
 */
const PASTE_GATE_BATCH_SIZE = 256;

/** Reserved presentation-only columns that can appear in surface callbacks. @public */
export type PretableSurfaceSyntheticColumnId =
  "__pretable_group__" | "__pretable_row_select__";

/** A schema column or a presentation-only surface column. @public */
export type PretableSurfaceColumn<
  TRow extends PretableRow,
  TColumns extends readonly { readonly id: string }[],
> =
  | TColumns[number]
  | (Omit<PretableColumn<TRow>, "id"> & {
      readonly id: PretableSurfaceSyntheticColumnId;
    });

/** Input passed to {@link PretableSurfaceSharedProps.renderHeaderCell}. @public */
export interface PretableSurfaceHeaderCellRenderInput<
  TRow extends PretableRow = PretableRow,
  TColumns extends readonly { readonly id: string }[] =
    readonly PretableColumn<TRow>[],
> {
  columnId:
    PretableSurfaceColumnId<TColumns> | PretableSurfaceSyntheticColumnId;
  column: PretableSurfaceColumn<TRow, TColumns>;
  label: string;
  sortDirection: "asc" | "desc" | null;
  /**
   * Authoritative pin side, from the engine's column plan rather than the
   * `columns` prop. Normalized to `null` when unpinned.
   */
  pinned: "left" | "right" | null;
}

/** One body-cell callback input correlated to a specific column. @public */
export type PretableSurfaceBodyCellInputForColumn<
  TRow extends PretableRow,
  TRowId extends PretableRowId,
  TColumn,
> = TColumn extends { readonly id: string }
  ? PretableCellRenderInput<
      TRow,
      TRowId,
      [PretableColumnValue<TColumn>] extends [never]
        ? unknown
        : PretableColumnValue<TColumn>,
      TColumn
    > & { readonly columnId: TColumn["id"] }
  : never;

/**
 * Input passed to body-cell render, class-name, and attribute callbacks.
 *
 * @public
 */
export type PretableSurfaceBodyCellInput<
  TRow extends PretableRow = PretableRow,
  TRowId extends PretableRowId = string,
  TColumns extends readonly { readonly id: string }[] =
    readonly PretableColumn<TRow>[],
> =
  | {
      [TColumnId in PretableSurfaceColumnId<TColumns>]: PretableCellRenderInput<
        TRow,
        TRowId,
        ColumnValueOf<TColumns, TColumnId & ColumnIdOf<TColumns>>,
        Extract<TColumns[number], { readonly id: TColumnId }>
      > & { readonly columnId: TColumnId };
    }[PretableSurfaceColumnId<TColumns>]
  | PretableSurfaceBodyCellInputForColumn<
      TRow,
      TRowId,
      Omit<PretableColumn<TRow>, "id"> & {
        readonly id: PretableSurfaceSyntheticColumnId;
      }
    >;

/**
 * Input passed to {@link PretableSurfaceProps.onRowActivate}.
 *
 * @public
 */
export interface PretableRowActivateInput<
  TRow extends PretableRow = PretableRow,
  TRowId extends PretableRowId = TRow extends {
    readonly id: infer TId extends PretableRowId;
  }
    ? TId
    : PretableRowId,
> {
  row: TRow;
  rowId: TRowId;
  /** Index within the currently visible (sorted, filtered) rows. */
  rowIndex: number;
}

/** Input passed to row class-name and attribute callbacks. @public */
export interface PretableSurfaceRowInput<
  TRow extends PretableRow = PretableRow,
  TRowId extends PretableRowId = PretableRowId,
> {
  isFocused: boolean;
  isSelected: boolean;
  row: TRow;
  rowId: TRowId;
  rowIndex: number;
}

/** Input passed to header-cell class-name and attribute callbacks. @public */
export interface PretableSurfaceHeaderCellInput<
  TRow extends PretableRow = PretableRow,
  TColumns extends readonly { readonly id: string }[] =
    readonly PretableColumn<TRow>[],
> {
  columnId:
    PretableSurfaceColumnId<TColumns> | PretableSurfaceSyntheticColumnId;
  column: PretableSurfaceColumn<TRow, TColumns>;
  sortDirection: "asc" | "desc" | null;
  /**
   * Authoritative pin side, from the engine's column plan rather than the
   * `columns` prop. Normalized to `null` when unpinned.
   */
  pinned: "left" | "right" | null;
}

/** Query-capable fallback columns used by {@link PretableSurfaceProps}. @public */
export type PretableSurfaceQueryColumns<TRow> = readonly {
  readonly id: string;
  readonly accessor: (row: TRow) => string | number;
  readonly type: "text" | "number" | "date" | "boolean" | "enum";
}[];

/** One proposed row edit emitted by {@link PretableSurface}. @public */
export type PretableSurfaceRowChange<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns = readonly { readonly id: string }[],
> = PretableTypedRowChange<TRow, TRowId, TColumns>;

/**
 * Props for {@link PretableSurface}.
 *
 * @public
 */
/** Props shared by both {@link PretableSurface} ownership modes. @public */
export interface PretableSurfaceSharedProps<
  TRow extends PretableRow = PretableRow,
  TRowId extends PretableRowId = TRow extends {
    readonly id: infer TId extends PretableRowId;
  }
    ? TId
    : PretableRowId,
  TColumns extends readonly { readonly id: string }[] =
    readonly PretableColumn<TRow>[],
> {
  ariaLabel: string;
  ariaDescribedBy?: string;
  /** Locale used by native number formatting. */
  locale?: Intl.LocalesArgument;
  /** Processing authority metadata. Query ownership remains with the row model. */
  processing?: PretableProcessingOptions;
  /** Metadata describing the full result represented by the loaded rows. */
  resultMeta?: PretableResultMeta;
  /** Consumer-owned presentation lifecycle for loaded data. */
  dataState?: PretableDataState;
  renderBodyState?: (input: {
    kind: PretableBodyStateKind;
    phase: PretableDataState["phase"];
    loadedRowCount: number;
  }) => ReactNode;
  autosize?: boolean | AutosizeOptions;
  groupColumn?: PretableGroupColumnOptions;
  getBodyCellClassName?: (
    input: PretableSurfaceBodyCellInput<TRow, TRowId, TColumns>,
  ) => string | undefined;
  getBodyCellProps?: (
    input: PretableSurfaceBodyCellInput<TRow, TRowId, TColumns>,
  ) => HTMLAttributes<HTMLDivElement> | undefined;
  getHeaderCellClassName?: (
    input: PretableSurfaceHeaderCellInput<TRow, TColumns>,
  ) => string | undefined;
  getHeaderCellProps?: (
    input: PretableSurfaceHeaderCellInput<TRow, TColumns>,
  ) => HTMLAttributes<HTMLButtonElement> | undefined;
  getRowClassName?: (
    input: PretableSurfaceRowInput<TRow, TRowId>,
  ) => string | undefined;
  hideGroupedColumns?: boolean;
  getRowProps?: (
    input: PretableSurfaceRowInput<TRow, TRowId>,
  ) => HTMLAttributes<HTMLDivElement> | undefined;
  /**
   * @experimental
   *
   * Inject deterministic sort/filter/selection/focus state. Used internally
   * by the bench harness for plan replay; exposed for advanced consumers
   * who need to drive the grid from external state. Shape may change
   * across minor releases.
   *
   * Each slice (`selection`, `rowSelection`, `focus`, and column layout)
   * follows the same controlled/uncontrolled pattern: when a slice is provided
   * (non-undefined) the engine state is forced to it; when a slice is undefined
   * the engine owns it (uncontrolled).
   *
   * `rowSelection` is forced when its VALUE changes rather than on every
   * render — see {@link PretableSurfaceState.rowSelection} for why its
   * callback's timing makes that the difference between settling and
   * oscillating.
   */
  state?: PretableSurfaceState<TRowId, TColumns> | null;
  overscan?: number;
  /**
   * Called when the user activates a row — a plain click on it, or Enter/Space
   * on the focused cell. This is "open the record this row stands for", which
   * is a different intent from selecting cells: a modifier-click and a
   * drag-select are range selection and do not activate.
   */
  onRowActivate?: (input: PretableRowActivateInput<TRow, TRowId>) => void;
  /**
   * Called with the rows whose every cell is selected — the set the
   * `rowSelectionColumn` checkboxes tick — in rendered order, whenever that set
   * changes. This is what bulk actions ("approve the rows I ticked") need;
   * {@link PretableSurfaceProps.onSelectionChange} reports raw cell ranges,
   * which cannot be expanded without the grid's own row ordering.
   */
  onRowSelectionChange?: (rowIds: TRowId[]) => void;
  onSelectedRowIdChange?: (rowId: TRowId | null) => void;
  /**
   * Called with the cell-range selection — `ranges` plus `anchor` — whenever a
   * cell gesture changes it: click, shift-click, Cmd/Ctrl-click, marquee drag,
   * keyboard extension, Select All.
   *
   * It does **not** fire when a `rowSelectionColumn` checkbox is ticked. The
   * checkbox column drives a separate engine slice — a sparse row-selection
   * program that can hold "all rows" without materializing them — and that
   * slice is not part of {@link PretableSelectionFor}, so there is nothing
   * here to report. Use
   * {@link PretableSurfaceProps.onRowSelectionChange} for the checked set.
   *
   * The header select-all checkbox is the one crossing case: checking it
   * clears any cell ranges, and that clearing is reported here.
   */
  onSelectionChange?: (next: PretableSelectionFor<TColumns, TRowId>) => void;
  onFocusChange?: (next: PretableSurfaceFocusState<TRowId, TColumns>) => void;
  onColumnWidthsChange?: (
    next: Partial<Record<PretableSurfaceInteractionColumnId<TColumns>, number>>,
  ) => void;
  onColumnOrderChange?: (
    next: readonly PretableSurfaceInteractionColumnId<TColumns>[],
  ) => void;
  onColumnPinnedChange?: (
    next: Partial<
      Record<
        PretableSurfaceInteractionColumnId<TColumns>,
        "left" | "right" | null
      >
    >,
  ) => void;
  onTelemetryChange?: (telemetry: PretableTelemetry<TRowId>) => void;
  /**
   * Show the drag-to-group panel above the header — a strip listing the active
   * grouping levels as chips, which columns are dropped onto to group by them.
   *
   * An enabled panel is always visible, including when nothing is grouped:
   * that is exactly when its `emptyMessage` matters. It consumes from
   * {@link PretableSurfaceProps.viewportHeight} rather than adding to it, so
   * enabling it never reflows the surrounding layout.
   */
  groupPanel?: { enabled: boolean; emptyMessage?: string };
  onGridReady?: (grid: PretableSurfaceGrid<TRow, TRowId, TColumns>) => void;
  renderBodyCell?: (
    input: PretableSurfaceBodyCellInput<TRow, TRowId, TColumns>,
  ) => ReactNode;
  renderHeaderCell?: (
    input: PretableSurfaceHeaderCellRenderInput<TRow, TColumns>,
  ) => ReactNode;
  rowSelectionColumn?: RowSelectionColumnConfig;
  selectFocusedRowOnArrowKey?: boolean;
  /**
   * Tab key behavior.
   *
   * Default `"exit"` is the strict ARIA grid pattern: Tab and Shift+Tab fall
   * through to the browser's own focus traversal, so one press moves focus out
   * of the grid and on through the page. The grid is one stop in the page's tab
   * order, and the arrow keys navigate inside it.
   *
   * This used to default to `"wrap-rows"`, and that default was a WCAG 2.1.2
   * keyboard trap: wrap-rows consumed Tab and Shift+Tab unconditionally and
   * clamped at the corners, so focus could never leave. Measured before the
   * change: 120 consecutive Tab presses in Chromium and in WebKit never left
   * the grid, and neither did Shift+Tab or Escape.
   *
   * `"wrap-rows"` is still available for spreadsheet-style entry (Tab moves
   * right and wraps to the next row at row end; Shift+Tab is the reverse), and
   * it no longer traps: it *releases* at the two corners, so Tab at the last
   * cell and Shift+Tab at the first fall through to the browser. Note that
   * reaching a release corner can take up to rows × columns presses, so prefer
   * the default on anything but a small, form-like grid.
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
   * passed to {@link serializeRanges}; returning `null` cancels the copy.
   */
  onCopy?: (
    args: SerializeRangesArgs<TRow, TRowId, TColumns>,
  ) => CopyPayload | null;
  /**
   * Override the clipboard write step. Defaults to writing
   * `payload.text` (and `payload.html` if present) via `navigator.clipboard`.
   */
  copyToClipboard?: (payload: CopyPayload) => void | Promise<void>;
  /**
   * Defaults for every export from this surface. Per-call options passed to
   * {@link PretableSurfaceGrid.exportCsv} are merged **over** these, so a
   * surface-level `delimiter: ";"` survives a call that only asks for
   * `includeHeaders: false`.
   */
  csvOptions?: PretableCsvOptions<TRowId>;
  /**
   * Override the CSV serialization step. Receives the args that would be passed
   * to {@link serializeCsv}; returning `null` cancels the export and nothing is
   * saved — the same contract as {@link PretableSurfaceSharedProps.onCopy}.
   */
  onExport?: (
    args: SerializeCsvArgs<TRow, TRowId, TColumns>,
  ) => PretableCsvFile | null;
  /**
   * Override the delivery step. Defaults to {@link defaultSaveFile}, which
   * downloads the file with a sanitized, timestamped, `-PARTIAL`-marked name.
   *
   * Use this to name the file (`defaultSaveFile(file, { name: "invoices" })`),
   * to upload it instead of downloading it, or to hand the bytes to a worker.
   */
  saveFile?: (file: PretableCsvFile) => void | Promise<void>;
  /**
   * Localized message factories for ARIA live announcements (select-all,
   * copy success, copy failure, export success, export failure). Each entry is
   * optional; missing entries fall back to English defaults.
   */
  messages?: PretableSurfaceMessages;
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
   * that have since vanished — the same contract as {@link onRowChange}.
   */
  onPaste?: (payload: PastePayload<TRow, TRowId>) => void | Promise<void>;
}

/** Rows-owned {@link PretableSurface} props. @public */
export type PretableSurfaceRowsProps<
  TRow extends PretableRow,
  TRowId extends PretableRowId,
  TColumns extends readonly { readonly id: string }[],
> = PretableSurfaceSharedProps<TRow, TRowId, TColumns> &
  PretableRowIdRequirement<TRow, TRowId> & {
    readonly rows: readonly TRow[];
    readonly columns: TColumns;
    /**
     * Stable row identity. Optional when `TRow` has a conventional
     * `id: string | number` — the engine reads `row.id` — and required by
     * {@link PretableRowIdRequirement} for every other row shape.
     */
    readonly getRowId?: (row: TRow) => TRowId;
    readonly model?: never;
    readonly aggregateFilteredRows?: boolean;
    readonly initialExpansion?: PretableExpansionDefault;
    readonly onRowChange?: (
      change: PretableSurfaceRowChange<TRow, TRowId, TColumns>,
    ) => void | Promise<void>;
    readonly beforeRowChange?: never;
  } & (
    | {
        readonly query: PretableQueryFor<
          TColumns[number] extends {
            readonly accessor: (...args: never[]) => unknown;
            readonly type: string;
          }
            ? TColumns
            : PretableSurfaceQueryColumns<TRow>
        >;
        readonly onQueryChange: (
          query: PretableQueryFor<
            TColumns[number] extends {
              readonly accessor: (...args: never[]) => unknown;
              readonly type: string;
            }
              ? TColumns
              : PretableSurfaceQueryColumns<TRow>
          >,
        ) => void;
      }
    | {
        readonly query?: never;
        readonly onQueryChange?: (
          query: PretableQueryFor<
            TColumns[number] extends {
              readonly accessor: (...args: never[]) => unknown;
              readonly type: string;
            }
              ? TColumns
              : PretableSurfaceQueryColumns<TRow>
          >,
        ) => void;
      }
  );

/** Explicit-model-owned {@link PretableSurface} props. @public */
export type PretableSurfaceModelProps<
  TRow extends PretableRow,
  TRowId extends PretableRowId,
  TColumns extends readonly { readonly id: string }[],
> = PretableSurfaceSharedProps<TRow, TRowId, TColumns> & {
  readonly model: PretableRowModel<TRow, TRowId, TColumns>;
  readonly rows?: never;
  readonly getRowId?: never;
  readonly columns?: TColumns;
  readonly query?: never;
  readonly onQueryChange?: never;
  readonly aggregateFilteredRows?: never;
  readonly initialExpansion?: never;
  readonly onRowChange?: never;
  readonly beforeRowChange?: (
    changes: readonly PretableSurfaceRowChange<TRow, TRowId, TColumns>[],
  ) => void | Promise<void>;
};

/** Props for {@link PretableSurface}. Exactly one row-ownership mode is required. @public */
export type PretableSurfaceProps<
  TRow extends PretableRow = PretableRow,
  TRowId extends PretableRowId = TRow extends {
    readonly id: infer TId extends PretableRowId;
  }
    ? TId
    : PretableRowId,
  TColumns extends readonly { readonly id: string }[] =
    readonly PretableColumn<TRow>[],
> =
  | PretableSurfaceRowsProps<TRow, TRowId, TColumns>
  | PretableSurfaceModelProps<TRow, TRowId, TColumns>;

/** Indexed grid actions plus surface-owned scrolling and export. @public */
export type PretableSurfaceGrid<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> = PretableReactGrid<TRow, TRowId, TColumns> & {
  readonly scrollToRow: (rowId: TRowId) => void;
  /**
   * Serialize the grid to CSV and hand it to
   * {@link PretableSurfaceSharedProps.saveFile} (default: download it).
   *
   * Imperative rather than a built-in toolbar button, because the surface ships
   * no toolbar: the trigger is the consumer's own control, wired to this.
   *
   * Options are merged **over** {@link PretableSurfaceSharedProps.csvOptions}.
   * `onlySelected` restricts the file to the checked rows; **an empty selection
   * exports everything**, because a button that silently produces a zero-row
   * file is indistinguishable from one that is broken.
   *
   * Columns come from the DRAWN order, so a reordered or pinned grid exports
   * what is on screen. Scope comes from `resolveDataScope`, so a file written
   * over a partial window is labelled `-PARTIAL` and announced as such.
   *
   * @throws `TypeError` if `onlySelected` is combined with a `rowIds` — from
   * these options or from {@link PretableSurfaceSharedProps.csvOptions}.
   * @throws `RangeError` if `columnIds` names a column the grid does not draw.
   *
   * A failure to SAVE is not thrown: it is warned and announced through
   * {@link PretableSurfaceMessages.exportFailedAnnouncement}, because by then
   * the user has already pressed a button and needs to be told, not to have an
   * exception raised behind them.
   */
  readonly exportCsv: (
    options?: PretableCsvOptions<TRowId> & { onlySelected?: boolean },
  ) => void;
};

/**
 * The late-bound half of the export path.
 *
 * `exportCsv` hangs off the grid handle, which is assembled well above
 * `dataScope`, `columnsInVisualOrder` and `selectedRowIds` in the component
 * body. Reading them through a ref written in a `useInsertionEffect` is the
 * same late-binding `surfaceContextRef` uses; it is a SECOND ref rather than
 * extra fields on that one because the two are written by effects with
 * different dependency lists, and a commit that fired only one of them would
 * drop whichever fields the other owned.
 */
interface SurfaceExportContext<
  TRow extends PretableRow,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly columns: readonly PretableColumn<TRow>[];
  readonly scope: PretableExportScope;
  readonly selectedRowIds: readonly TRowId[];
  readonly locale: Intl.LocalesArgument | undefined;
  readonly csvOptions: PretableCsvOptions<TRowId> | undefined;
  readonly onExport:
    | ((
        args: SerializeCsvArgs<TRow, TRowId, TColumns>,
      ) => PretableCsvFile | null)
    | undefined;
  readonly saveFile:
    ((file: PretableCsvFile) => void | Promise<void>) | undefined;
  readonly messages: Required<PretableSurfaceMessages>;
}

interface MemoizedCellContentProps {
  rowId: PretableRowId;
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
        columnId: string;
        column: PretableColumn<PretableRow>;
        label: string;
        sortDirection: "asc" | "desc" | null;
        pinned: "left" | "right" | null;
      }) => ReactNode)
    | null;
  headerRenderInput: PretableHeaderRenderInput<PretableRow>;
}

function HeaderContentImpl({
  columnId,
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
          columnId,
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
            {sortDirection === "asc" ? <SortAscIcon /> : <SortDescIcon />}
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

/** Stable empty result so an unselected grid never hands out a fresh array. */
const EMPTY_ROW_IDS: never[] = [];

/**
 * The checked rows, in rendered order.
 *
 * Empty for a SYMBOLIC selection, and that is not a shortfall: `kind: "all"`
 * means "every row" without holding a list, and expanding it here would put the
 * million ids back that the engine's representation exists to avoid. Callers
 * that need to tell "everything" from "nothing" read `kind`, not `length`.
 */
function orderedSelectedRowIds(
  rows: {
    readonly kind: "explicit" | "all";
    readonly rowIds?: ReadonlySet<PretableRowId>;
  },
  indexOf: (rowId: PretableRowId) => number,
): PretableRowId[] {
  const rowIds = rows.kind === "explicit" ? rows.rowIds : undefined;
  if (rowIds === undefined || rowIds.size === 0) return EMPTY_ROW_IDS;
  return Array.from(rowIds)
    .map((rowId) => ({ rowId, index: indexOf(rowId) }))
    .filter((entry) => entry.index >= 0)
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.rowId);
}

function selectedRowIdsKey(
  kind: string,
  rowIds: readonly PretableRowId[],
): string {
  return [
    kind,
    ...rowIds.map((rowId) =>
      typeof rowId === "number"
        ? `number:${rowId}`
        : `string:${rowId.length}:${rowId}`,
    ),
  ].join("\u0000");
}

const EMPTY_COLUMNS: never[] = [];
const EMPTY_ROWS: never[] = [];

/**
 * Controlled grid surface. The primary React component. Pass `state` to control any subset of sort/filter/selection/focus/column-layout from the outside; omit slices you want the grid to own.
 *
 * @public
 */

export function PretableSurface<
  TRow extends PretableRow = PretableRow,
  TRowId extends PretableRowId = TRow extends {
    readonly id: infer TId extends PretableRowId;
  }
    ? TId
    : PretableRowId,
  const TColumns extends readonly { readonly id: string }[] =
    readonly PretableColumn<TRow>[],
>(props: PretableSurfaceModelProps<TRow, TRowId, TColumns>): ReactNode;
/** @public */
export function PretableSurface<
  TRow extends PretableRow = PretableRow,
  TRowId extends PretableRowId = TRow extends {
    readonly id: infer TId extends PretableRowId;
  }
    ? TId
    : PretableRowId,
  const TColumns extends readonly { readonly id: string }[] =
    readonly PretableColumn<TRow>[],
>(props: PretableSurfaceRowsProps<TRow, TRowId, TColumns>): ReactNode;
export function PretableSurface<
  TRow extends PretableRow = PretableRow,
  TRowId extends PretableRowId = TRow extends {
    readonly id: infer TId extends PretableRowId;
  }
    ? TId
    : PretableRowId,
  const TColumns extends readonly { readonly id: string }[] =
    readonly PretableColumn<TRow>[],
>({
  aggregateFilteredRows,
  ariaLabel,
  ariaDescribedBy,
  locale,
  processing,
  resultMeta,
  dataState,
  renderBodyState,
  autosize,
  columns: inputColumns,
  model,
  beforeRowChange,
  onRowChange,
  query,
  onQueryChange,
  initialExpansion,
  groupColumn,
  getBodyCellClassName,
  getBodyCellProps,
  getHeaderCellClassName,
  getHeaderCellProps,
  getRowClassName,
  getRowId,
  hideGroupedColumns,
  getRowProps,
  state,
  overscan = 6,
  onGridReady,
  onRowActivate,
  onRowSelectionChange,
  onSelectedRowIdChange,
  onSelectionChange,
  onFocusChange,
  onColumnWidthsChange,
  onColumnOrderChange,
  onColumnPinnedChange,
  onTelemetryChange,
  groupPanel,
  renderBodyCell,
  renderHeaderCell,
  rows = EMPTY_ROWS,
  rowSelectionColumn,
  selectFocusedRowOnArrowKey = false,
  tabBehavior = "exit",
  viewportStyle,
  viewportHeight,
  copyWithHeaders,
  onCopy,
  copyToClipboard,
  csvOptions,
  onExport,
  saveFile,
  messages,
  onPaste,
}: PretableSurfaceProps<TRow, TRowId, TColumns>) {
  const emitFocusChange = (
    ref: PretableIndexedFocusRef<PretableRowId> | null,
    columnId: string | null,
  ) => {
    onFocusChange?.({
      // A HEADER ref reaches consumers unchanged. The cast that used to sit
      // here narrowed to `PretableVisibleRowRef`, which would have laundered
      // `{kind: "header"}` into a type that cannot describe it — the callback
      // would have reported a header cursor as if it were a row.
      ref: ref as PretableIndexedFocusRef<TRowId> | null,
      columnId: columnId as PretableSurfaceInteractionColumnId<TColumns> | null,
    });
  };
  const emitSelectionChange = (next: PretableSelectionState) => {
    onSelectionChange?.(
      next as unknown as PretableSelectionFor<TColumns, TRowId>,
    );
  };
  const columns = (inputColumns ??
    EMPTY_COLUMNS) as unknown as readonly PretableColumn<TRow>[];
  // Server-rendered grids paint their full chrome — header buttons, funnels,
  // checkboxes, resize handles — before React has attached a single listener,
  // so every one of those controls is visible and clickable while still inert.
  // Publishing that state as `data-pretable-hydrated` on the root lets a
  // consumer (or a test) gate on "live", not merely "painted".
  const hydrated = useHydrated();
  const [dataStateWrapperEnabled, setDataStateWrapperEnabled] = useState(
    dataState !== undefined,
  );
  useEffect(() => {
    if (dataState === undefined || dataStateWrapperEnabled) return;
    let active = true;
    queueMicrotask(() => {
      if (active) setDataStateWrapperEnabled(true);
    });
    return () => {
      active = false;
    };
  }, [dataState, dataStateWrapperEnabled]);
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
  const groupPanelRef = useRef<HTMLDivElement>(null);
  const [reorderDrag, setReorderDrag] = useState<{
    columnId: string;
    cursorX: number;
    cursorY: number;
    dropIndex: number;
    /**
     * The grouping level this drag would drop into, or `null` when the pointer
     * is not over the panel. This is the whole of the two-drop-zone model: the
     * pointer is over the panel's rectangle or it is not, and there is no
     * modifier key or intent heuristic anywhere.
     *
     * It is recomputed on every move but **committed by nobody until
     * pointerup** — see the drop handler.
     */
    groupInsertIndex: number | null;
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
      selectAllLabel:
        messages?.selectAllLabel ?? defaultMessages.selectAllLabel,
      selectAllAnnouncement:
        messages?.selectAllAnnouncement ??
        defaultMessages.selectAllAnnouncement,
      copyAnnouncement:
        messages?.copyAnnouncement ?? defaultMessages.copyAnnouncement,
      copyFailedAnnouncement:
        messages?.copyFailedAnnouncement ??
        defaultMessages.copyFailedAnnouncement,
      exportAnnouncement:
        messages?.exportAnnouncement ?? defaultMessages.exportAnnouncement,
      exportFailedAnnouncement:
        messages?.exportFailedAnnouncement ??
        defaultMessages.exportFailedAnnouncement,
      pasteAnnouncement:
        messages?.pasteAnnouncement ?? defaultMessages.pasteAnnouncement,
      pasteFailedAnnouncement:
        messages?.pasteFailedAnnouncement ??
        defaultMessages.pasteFailedAnnouncement,
      groupChildCountLabel:
        messages?.groupChildCountLabel ?? defaultMessages.groupChildCountLabel,
      emptyStateMessage:
        messages?.emptyStateMessage ?? defaultMessages.emptyStateMessage,
      loadingStateMessage:
        messages?.loadingStateMessage ?? defaultMessages.loadingStateMessage,
      dataErrorAnnouncement:
        messages?.dataErrorAnnouncement ??
        defaultMessages.dataErrorAnnouncement,
    }),
    [messages],
  );
  const measuredRowKeysRef = useRef<Record<string, string>>({});
  const rowNodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const cellNodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const columnMenuButtonNodesRef = useRef<Map<string, HTMLButtonElement>>(
    new Map(),
  );
  const viewportRef = useRef<HTMLDivElement>(null);
  // The focus-follow bookkeeping. Declared up here with the node maps rather
  // than beside the effect that reads them, because `registerCell` — a cell
  // ref callback, which runs during the commit that unmounts a row — has to
  // re-arm a pending move when the cursor's cell is torn out from under it.
  const focusFollowAddressRef = useRef<string | null>(null);
  const pendingFocusFollowRef = useRef<string | null>(null);
  /** Set by `registerCell` when the cursor's own cell is torn out under it. */
  const focusLostToUnmountRef = useRef(false);
  /**
   * Column-header `<button>` nodes, by column id — the header's equivalent of
   * `cellNodesRef`, and what the focus-follow effect focuses when the cursor
   * sits on `{kind: "header"}`. Keyed by column id alone because there is only
   * ever one header row.
   */
  const headerCellNodesRef = useRef<Map<string, HTMLButtonElement>>(new Map());
  const registerHeaderCell = useCallback(
    (columnId: string, node: HTMLButtonElement | null) => {
      if (node === null) {
        headerCellNodesRef.current.delete(columnId);
      } else {
        headerCellNodesRef.current.set(columnId, node);
      }
    },
    [],
  );
  const pendingGroupingFocusRef = useRef<PendingGroupingFocusRequest | null>(
    null,
  );
  const dragAnchorRef = useRef<PretableCellAddress | null>(null);
  // Set when a pointer-drag extended the selection past its origin cell. The
  // click that ends such a drag is a range selection, not a row activation.
  const dragExtendedRef = useRef(false);
  const dragStartSelectionRef = useRef<PretableSelectionState | null>(null);
  // The anchor cell's onPointerDown (below) does NOT call
  // setPointerCapture — see ./marquee-drag.ts for why. Instead it attaches
  // pointermove/pointerup/pointercancel listeners to `window` for the
  // duration of the drag, so hovered-cell resolution reads the real,
  // normally-hit-tested `event.target` via `cellAddressFromElement` (no
  // capture retargeting to work around, no `document.elementFromPoint`
  // needed). dragFrameRef/dragPointerTargetRef/dragLastHoverKeyRef throttle
  // that resolution to once per animation frame (the same "stash the latest
  // input, run at most one pending frame" idiom `createGroupPanelAutoscroll`
  // uses in group-panel-scroll.ts) and dedupe consecutive resolutions to the
  // same cell. dragRemoveListenersRef holds the teardown for the window
  // listeners the in-flight drag installed, so every place a drag can end —
  // pointerup, pointercancel, the Esc-cancel handler below, and unmount — can
  // detach them the same way.
  const dragFrameRef = useRef<number | null>(null);
  const dragPointerTargetRef = useRef<Element | null>(null);
  const dragLastHoverKeyRef = useRef<string | null>(null);
  const dragRemoveListenersRef = useRef<(() => void) | null>(null);
  // A drag that is still in flight when the surface unmounts (e.g. the
  // consuming app navigates away mid-gesture) would otherwise leak the
  // pending frame and the window listeners — pointerup/pointercancel never
  // arrive to clean them up.
  useEffect(() => {
    return () => {
      if (dragFrameRef.current !== null) {
        cancelAnimationFrame(dragFrameRef.current);
      }
      dragRemoveListenersRef.current?.();
      dragRemoveListenersRef.current = null;
    };
  }, []);
  const lastCheckedRowAnchorRef = useRef<PretableRowId | null>(null);
  // Every density read below resolves against `viewportRef` — the grid's own
  // element — not `<html>`. The tokens are CSS custom properties and inherit,
  // so this is the value the rows are actually PAINTED with, whether the
  // consumer put `data-density` on the root or on a wrapper around this grid.
  // Reading the root instead meant a wrapper-scoped grid painted at one density
  // and virtualized at another.
  const { headerHeight } = useResolvedHeights(
    undefined,
    undefined,
    viewportRef,
  );
  // The floor every measured row is clamped to, and the height an unmeasured
  // one is drawn at. Read through the same store as the header height, so a
  // density or theme flip on the grid's element or any of its ancestors
  // re-renders and re-measures.
  //
  // The fallback is DEFAULT_ROW_HEIGHT rather than `useResolvedHeights`'s 32,
  // deliberately: this is the no-theme path, and 44 is what an unthemed grid
  // has always rendered. `getDensityHeights`'s documented 32 is a different
  // question (what a caller reading density into their own layout should
  // assume) and is left alone here.
  const rowHeightFloor = useResolvedPx(
    "--pretable-row-height",
    DEFAULT_ROW_HEIGHT,
    true,
    viewportRef,
  );
  // The panel eats into `viewportHeight` instead of extending past it, so the
  // surface occupies the same box whether or not it is enabled. Zero when
  // disabled, which keeps every height below bit-for-bit what it was.
  const groupPanelEnabled = groupPanel?.enabled ?? false;
  const resolvedGroupPanelHeight = useResolvedPx(
    "--pretable-group-panel-height",
    GROUP_PANEL_HEIGHT,
    groupPanelEnabled,
    viewportRef,
  );
  const groupPanelHeight = groupPanelEnabled ? resolvedGroupPanelHeight : 0;
  const scrollViewportHeight = Math.max(viewportHeight - groupPanelHeight, 0);
  const bodyViewportHeight = Math.max(
    viewportHeight - headerHeight - groupPanelHeight,
    0,
  );
  // Depend on the primitive fields, not the rowSelectionColumn object: callers
  // typically pass it inline (`rowSelectionColumn={{ enabled: true }}`), so a new
  // object every render would churn effectiveColumns — and recreate the grid,
  // discarding selection/focus — on every streamed row update.
  const rowSelectEnabled = rowSelectionColumn?.enabled ?? false;
  const rowSelectWidth = rowSelectionColumn?.width;
  const rowSelectPinned = rowSelectionColumn?.pinned;
  const authoritativeColumns = useMemo<PretableColumn<TRow>[]>(() => {
    if (model !== undefined) {
      // A model's columns are SCHEMA columns (they carry `accessor`/`value`),
      // not React presentation columns. Naming them as such is what lets the
      // merge below typecheck: reading them as `PretableColumn` first threw
      // away the very fields the merge reads back out.
      const schema =
        model.getColumns() as unknown as readonly ModelSchemaColumn<TRow>[];
      return columns.length === 0
        ? (schema as unknown as PretableColumn<TRow>[])
        : (mergeModelPresentationColumnsForTesting(
            schema,
            columns,
          ) as unknown as PretableColumn<TRow>[]);
    }
    return columns.map((source) => {
      const current = source as PretableColumn<TRow> & {
        readonly accessor?: (row: TRow) => unknown;
        readonly accessorKey?: string;
        readonly value?: (row: TRow) => unknown;
      };
      if (current.accessor !== undefined) return current;
      const accessor =
        current.value ??
        ((row: TRow) => (row as Record<string, unknown>)[current.id]);
      return {
        ...current,
        type:
          current.type ??
          (current.aggregate === "sum" || current.aggregate === "avg"
            ? "number"
            : "text"),
        accessorKey: current.value === undefined ? current.id : undefined,
        accessor,
        value: accessor,
      } as PretableColumn<TRow>;
    });
  }, [columns, model]);
  const numberFormatters = useMemo(
    () => compileNumberFormatters(authoritativeColumns, locale),
    [authoritativeColumns, locale],
  );
  const resolveEffectiveColumns = useCallback(
    (currentQuery: { readonly rowGroups: readonly { columnId: string }[] }) => {
      const requestedRowGroups = currentQuery.rowGroups.map(
        (entry) => entry.columnId,
      );
      const groupedIds = new Set(requestedRowGroups);
      const visibleAuthoritative =
        requestedRowGroups.length === 0 || hideGroupedColumns === false
          ? authoritativeColumns
          : authoritativeColumns.filter((column) => !groupedIds.has(column.id));
      const base =
        requestedRowGroups.length === 0
          ? visibleAuthoritative
          : [
              {
                id: GROUP_COLUMN_ID,
                header: groupColumn?.header ?? "Group",
                value: () => "",
                widthPx: groupColumn?.widthPx ?? 220,
                ...(groupColumn?.pinned === undefined
                  ? {}
                  : { pinned: groupColumn.pinned }),
                sortable: false,
                filterable: false,
              } satisfies PretableColumn<TRow>,
              ...visibleAuthoritative,
            ];
      if (!rowSelectEnabled) return base;
      const synth: PretableColumn<TRow> = {
        id: ROW_SELECT_COLUMN_ID,
        header: "",
        type: "text",
        value: () => "",
        widthPx: rowSelectWidth ?? 36,
        sortable: false,
        filterable: false,
        ...((rowSelectPinned ?? true) ? { pinned: "left" } : {}),
      };
      return [synth, ...base];
    },
    [
      authoritativeColumns,
      groupColumn,
      hideGroupedColumns,
      rowSelectEnabled,
      rowSelectWidth,
      rowSelectPinned,
    ],
  );
  // WHY `as never` STAYS (1 of 5 surviving in this file):
  //
  // Two things defeat an honest annotation here. The argument is a UNION (rows
  // mode | model mode, chosen at runtime), and overload resolution cannot pick
  // an overload for a union; and `ɵvisualColumns` — the internal hook that
  // lets the surface draw the synthetic group/row-select columns — is declared
  // only on `usePretable`'s IMPLEMENTATION signature, on no public overload.
  // So there is no public overload this call can be written against.
  //
  // The fix is an `@internal` entry point on `usePretable` taking exactly this
  // union. Deliberately NOT done by widening a public overload: a public
  // overload loose enough to accept these value-erased options would also
  // start accepting consumer calls the strict overloads currently reject,
  // trading a cast here for lost checking at every call site.
  const indexed = usePretable(
    (model === undefined
      ? {
          rows,
          columns: authoritativeColumns,
          getRowId,
          aggregateFilteredRows,
          ...(query === undefined ? {} : { query }),
          ...(initialExpansion === undefined ? {} : { initialExpansion }),
          viewportHeight: bodyViewportHeight,
          viewportWidth: viewportWidth || undefined,
          overscan,
          ...(onQueryChange === undefined ? {} : { onQueryChange }),
          ɵvisualColumns: resolveEffectiveColumns,
        }
      : {
          model,
          columns: columns.length === 0 ? undefined : columns,
          viewportHeight: bodyViewportHeight,
          viewportWidth: viewportWidth || undefined,
          overscan,
          ɵvisualColumns: resolveEffectiveColumns,
        }) as never,
  ) as unknown as PretableModel<
    TRow,
    PretableRowId,
    readonly PretableColumn<TRow>[]
  > & {
    /** @internal See {@link WindowSpacers} in `pretable-model.ts`. */
    readonly setWindowSpacers: (spacers: WindowSpacers | null) => void;
  };
  const { renderSnapshot, rowModelSnapshot } = indexed;
  const presentationQuery =
    renderSnapshot.modelSnapshot?.query ?? rowModelSnapshot.query;
  const effectiveColumns = useMemo(
    () => resolveEffectiveColumns(presentationQuery),
    [presentationQuery, resolveEffectiveColumns],
  );
  const indexedGrid = indexed.grid;
  // The cell-edit controller owns a token for its UI lifecycle, but explicit
  // model writes happen inside its awaited commit callback — before the
  // controller gets a chance to check that token. Keep a surface-side token at
  // the transaction boundary as well. Every edit session transition, model
  // replacement and unmount invalidates work that was awaiting the write gate.
  const editOperationTokenRef = useRef(0);
  const editModelIdentityRef = useRef(indexed.rowModel);
  useLayoutEffect(() => {
    editModelIdentityRef.current = indexed.rowModel;
    editOperationTokenRef.current += 1;
    return () => {
      editOperationTokenRef.current += 1;
    };
  }, [indexed.rowModel]);
  useEffect(() => {
    if (autosize) indexedGrid.autosizeColumns();
  }, [autosize, indexedGrid]);
  const indexedSnapshot = indexed.gridSnapshot;
  // What `state.rowSelection` last WROTE, and what it wrote it against. See
  // {@link PretableSurfaceState.rowSelection}: re-asserting an unchanged
  // request on every render would fight `onRowSelectionChange`, which fires
  // from an effect and so is always one render behind the gesture.
  const appliedRowSelectionRef = useRef<{
    readonly requested: PretableRowSelectionState<TRowId>;
    readonly snapshot: object;
  } | null>(null);
  useLayoutEffect(() => {
    if (state === null || state === undefined) return;
    if (state.focus !== undefined) {
      const ref = state.focus.ref;
      if (ref === null || state.focus.columnId === null) {
        indexedGrid.setFocus({ ref: null, columnId: null });
      } else if (ref.kind === "header") {
        // A controlled header address is accepted as-is. The validation below
        // asks the row model whether the row still exists, and the header is
        // not a row — `indexOf` would answer -1 for a perfectly valid address
        // and this write-back would clear the consumer's own focus on the
        // first render.
        indexedGrid.setFocus({ ref, columnId: state.focus.columnId });
      } else {
        const visibleRef = rowModelSnapshot.indexOf(ref) >= 0 ? ref : null;
        indexedGrid.setFocus({
          ref: visibleRef,
          columnId: visibleRef === null ? null : state.focus.columnId,
        });
      }
    }
    if (state.selection !== undefined) {
      indexedGrid.setSelection({
        rows: indexedGrid.getState().selection.rows,
        ranges: state.selection.ranges.map(inflateIndexedRange),
        anchor:
          state.selection.anchor === null
            ? null
            : {
                rowId: state.selection.anchor.rowId,
                columnId: state.selection.anchor.columnId,
              },
      });
    }
    if (state.rowSelection !== undefined) {
      const applied = appliedRowSelectionRef.current;
      if (
        applied === null ||
        applied.snapshot !== rowModelSnapshot ||
        !sameRowSelectionRequest(applied.requested, state.rowSelection)
      ) {
        appliedRowSelectionRef.current = {
          requested: state.rowSelection,
          snapshot: rowModelSnapshot,
        };
        indexedGrid.setRowSelection(state.rowSelection);
      }
    }
    const layout = indexedGrid.getState().columnLayout;
    if (state.columnOrder !== undefined) {
      const currentIds = new Set(layout.map((column) => column.id as string));
      if (
        state.columnOrder.length === layout.length &&
        state.columnOrder.every((columnId) => currentIds.has(columnId))
      ) {
        indexedGrid.setColumnOrder(state.columnOrder);
      }
    }
    for (const [columnId, width] of Object.entries(state.columnWidths ?? {})) {
      if (typeof width === "number") {
        indexedGrid.setColumnWidth(columnId, width);
      }
    }
    for (const [columnId, pinned] of Object.entries(state.columnPinned ?? {})) {
      if (pinned === "left" || pinned === "right" || pinned === null) {
        indexedGrid.setColumnPinned(columnId, pinned);
      }
    }
  }, [indexedGrid, query, rowModelSnapshot, state]);
  const loadDistinctValues = useCallback(
    (columnId: string) =>
      // `PretableDistinctColumnIdOf<TColumns>` admits only columns whose value
      // type is statically a primitive/Date. The surface's columns are
      // runtime-supplied and value-erased, so it resolves to `never` — and
      // `as never` is the only cast that satisfies a `never` parameter. Fixing
      // this means a value-erased entry point on the row model, in
      // `packages/row-model`.
      indexed.rowModel.distinctValues(columnId as never, {
        population: "all",
        limit: 1_000,
      }) as unknown as PretableDistinctValueQuery<string>,
    [indexed.rowModel],
  );
  const snapshot = useMemo(() => {
    const filters: Record<string, ColumnFilter> = {};
    for (const entry of rowModelSnapshot.query.filters as readonly {
      readonly columnId: string;
      readonly operator: ColumnFilter["operator"];
      readonly value?: ColumnFilter["value"];
    }[]) {
      filters[entry.columnId] = {
        operator: entry.operator,
        ...(entry.value === undefined ? {} : { value: entry.value }),
      };
    }
    const ranges = indexedSnapshot.selection.ranges.map(flattenIndexedRange);
    const ref = indexedSnapshot.focus.ref;
    return {
      viewport: indexedSnapshot.viewport,
      sort: rowModelSnapshot.query.sort.map((entry) => ({
        columnId: entry.columnId as string,
        direction: entry.direction,
      })),
      filters,
      rowGroups: (
        rowModelSnapshot.query.rowGroups as readonly {
          readonly columnId: string;
        }[]
      ).map((entry) => entry.columnId as string),
      focus: {
        ref,
        // See the matching derivation on the facade snapshot: a header cursor
        // has no flat row address, and `null` is what makes every downstream
        // `focus.rowId !== null` guard decline to treat it as a row.
        rowId:
          ref === null || ref.kind === "header"
            ? null
            : ref.kind === "data"
              ? ref.rowId
              : ref.groupId,
        columnId: indexedSnapshot.focus.columnId as string | null,
      },
      selection: {
        rows: indexedSnapshot.selection.rows,
        ranges,
        anchor:
          indexedSnapshot.selection.anchor === null
            ? null
            : {
                rowId: indexedSnapshot.selection.anchor.rowId,
                columnId: indexedSnapshot.selection.anchor.columnId as string,
              },
      },
      editing:
        indexedSnapshot.editing === null
          ? null
          : {
              rowId: indexedSnapshot.editing.rowId,
              columnId: indexedSnapshot.editing.columnId as string,
              draft: indexedSnapshot.editing.value,
              status: indexedSnapshot.editing.status,
              ...(indexedSnapshot.editing.error === undefined
                ? {}
                : { error: indexedSnapshot.editing.error }),
            },
      totalRowCount: rowModelSnapshot.sourceRowCount,
    };
  }, [indexedSnapshot, rowModelSnapshot]);

  const surfaceContextRef = useRef({
    snapshot,
    rowModelSnapshot,
    columns: effectiveColumns,
    renderSnapshot,
  });
  useInsertionEffect(() => {
    surfaceContextRef.current = {
      snapshot,
      rowModelSnapshot,
      columns: effectiveColumns,
      renderSnapshot,
    };
  }, [effectiveColumns, renderSnapshot, rowModelSnapshot, snapshot]);

  // See SurfaceExportContext. Written by a no-dep insertion effect further
  // down, once every value it names exists; `null` only in the window before
  // the first commit, which no caller can reach — `onGridReady` hands the
  // handle out from a layout effect, and layout effects run after insertion
  // effects on the same commit.
  const exportContextRef = useRef<SurfaceExportContext<
    TRow,
    TRowId,
    TColumns
  > | null>(null);
  const exportCsv = useCallback(
    (options?: PretableCsvOptions<TRowId> & { onlySelected?: boolean }) => {
      const context = exportContextRef.current;
      /* c8 ignore next -- unreachable: see exportContextRef */
      if (context === null) return;
      const { onlySelected, ...callOptions } = options ?? {};

      // Two ways to name a row set is one too many. Merging `rowIds` last made
      // `onlySelected` win and the caller's explicit set vanish with nothing
      // said — the same silent-narrowing this module refuses for an unknown
      // `columnIds`. Refuse it here too rather than pick a winner.
      //
      // Read the MERGED value, not the call's. A `rowIds` on `csvOptions` is
      // the same declaration made in a different place; guarding only the call
      // site left the surface-level one to be overwritten silently, which is
      // the very thing this throw exists to prevent.
      const declaredRowIds = callOptions.rowIds ?? context.csvOptions?.rowIds;
      if (onlySelected === true && declaredRowIds !== undefined) {
        throw new TypeError(
          "exportCsv: pass `onlySelected` or `rowIds`, not both — they are two " +
            "ways to choose the same thing, and silently preferring one would " +
            "drop rows the caller asked for.",
        );
      }

      // An empty selection exports EVERYTHING. `rowIds: new Set()` would
      // serialize a header and no rows, and a button that silently downloads an
      // empty file reads as broken rather than as "you selected nothing".
      //
      // This is also, deliberately, what a SYMBOLIC all-selection lands on.
      // `selectedRowIds` only materializes `kind: "explicit"`, so a header
      // checkbox or Cmd+A leaves it empty and the export covers every row —
      // which is the right answer, but it arrives here by way of this branch
      // rather than by a rule of its own. Stated so that a later change to
      // either side is a decision instead of a regression.
      const rowIds =
        onlySelected === true && context.selectedRowIds.length > 0
          ? new Set<PretableRowId>(context.selectedRowIds)
          : undefined;
      const merged: PretableCsvOptions<PretableRowId> = {
        ...context.csvOptions,
        ...callOptions,
        ...(rowIds === undefined ? {} : { rowIds }),
      };
      const args: SerializeCsvArgs<
        TRow,
        PretableRowId,
        readonly PretableColumn<TRow>[]
      > = {
        rowModelSnapshot: surfaceContextRef.current.rowModelSnapshot,
        // Drawn order, not the prop's: a reorder or a pin moves columns here
        // and leaves the `columns` prop in declaration order, so a file built
        // from the prop disagrees with the screen the user exported.
        columns: context.columns,
        locale: context.locale,
        // Required by SerializeCsvArgs precisely so it cannot be skipped: a
        // window exported as if it were the population is the silent-partial
        // bug the whole module exists to refuse.
        scope: context.scope,
        options: merged,
      };
      const file = context.onExport
        ? context.onExport(
            args as unknown as SerializeCsvArgs<TRow, TRowId, TColumns>,
          )
        : serializeCsv(args);
      // `null` cancels — either the consumer declined, or there was nothing to
      // write. Nothing is saved and nothing is announced.
      if (file === null) return;
      const columnCount =
        merged.columnIds?.length ??
        context.columns.filter((column) => column.id !== ROW_SELECT_COLUMN_ID)
          .length;
      const announceFailure = (err: unknown) => {
        console.warn("[pretable] csv export failed", err);
        scheduleAnnouncement(context.messages.exportFailedAnnouncement());
      };
      // `saveFile` is typed `=> void | Promise<void>` and the SYNCHRONOUS form
      // is the common one — `defaultSaveFile` is entirely sync DOM work. A bare
      // `Promise.resolve(saveFile(file))` evaluates the call before wrapping
      // it, so a sync throw escaped past the failure branch: nothing warned,
      // nothing announced, and the rest of the event handler dead.
      //
      // Caught around the call rather than moved inside a `.then`, which would
      // have fixed it by deferring delivery a microtask. Delivery stays in the
      // click's own task on purpose — this path is deliberately built on
      // `<a download>` BECAUSE it survives an await, and quietly relying on
      // that would waste the one property the design was chosen for.
      let delivery: void | Promise<void>;
      try {
        delivery = (context.saveFile ?? defaultSaveFile)(file);
      } catch (err) {
        announceFailure(err);
        return;
      }
      // Two arguments to `then` rather than a trailing `catch`, so the failure
      // branch cannot also catch a throw from the SUCCESS branch — a message
      // factory that throws would otherwise announce "Export failed" over a
      // file that is already on disk.
      //
      // Which leaves the success branch to handle its own throw, or it becomes
      // an unhandled rejection. A consumer's broken `exportAnnouncement` is
      // their bug and it is named as theirs; what it must not do is rewrite a
      // delivered file into a failed one.
      Promise.resolve(delivery).then(() => {
        try {
          scheduleAnnouncement(
            context.messages.exportAnnouncement({
              rowCount: file.rowCount,
              columnCount,
              scope: file.scope,
              complete: file.complete,
              omissions: file.omissions,
            }),
          );
        } catch (err) {
          console.warn(
            "[pretable] csv export announcement failed; the file was saved",
            err,
          );
        }
      }, announceFailure);
    },
    [scheduleAnnouncement],
  );

  const pendingQueryRef = useRef<typeof rowModelSnapshot.query | null>(null);
  const grid = useMemo(() => {
    const currentQuery = () => {
      const current = surfaceContextRef.current.rowModelSnapshot.query;
      if (
        pendingQueryRef.current !== null &&
        JSON.stringify(pendingQueryRef.current) === JSON.stringify(current)
      ) {
        pendingQueryRef.current = null;
      }
      return pendingQueryRef.current ?? current;
    };
    const queryWith = (parts: {
      filters?: readonly unknown[];
      sort?: readonly unknown[];
      rowGroups?: readonly unknown[];
    }) => {
      const current = currentQuery();
      // Same `never` collapse as `distinctValues` above, one level up:
      // `PretableFilterFor`/`SortFor`/`RowGroupFor<TColumns>` each require the
      // column tuple to carry a static `accessor` return type and a literal
      // `type`. `queryWith` is fed by the filter menu and the sort/group UI,
      // which work from DRAWN column ids and runtime operand values, so all
      // three resolve to `never` here. Removing these needs either a loose
      // `setQuery` on the engine or the surface reconstructing the
      // discriminated filter union from runtime data — both outside this file.
      const next = {
        filters: (parts.filters ?? current.filters) as never,
        sort: (parts.sort ?? current.sort) as never,
        rowGroups: (parts.rowGroups ?? current.rowGroups) as never,
      };
      const transition = indexedGrid.setQuery(next);
      pendingQueryRef.current = transition === undefined ? null : next;
    };
    const resolveRef = (rowId: PretableRowId) => {
      const current = surfaceContextRef.current;
      const dataRef = { kind: "data" as const, rowId };
      if (current.rowModelSnapshot.indexOf(dataRef) >= 0) return dataRef;
      return (
        current.renderSnapshot.rows.find(
          (row) => row.ref.kind === "group" && row.ref.groupId === rowId,
        )?.ref ?? null
      );
    };
    const currentSelection = () => indexedGrid.getState().selection;
    const facade = {
      options: { columns: effectiveColumns },
      rowModel: indexed.rowModel,
      getSnapshot: () => {
        const indexedState = indexedGrid.getState();
        const current = {
          ...surfaceContextRef.current.snapshot,
          selection: projectIndexedSelection(indexedState.selection),
          focus: {
            ref: indexedState.focus.ref,
            // The flat legacy address. A HEADER cursor has none — it is not a
            // row — and reporting `null` here is load-bearing rather than a
            // fallback: every `focus.rowId !== null` guard in this file (row
            // selection on Enter/Space, the editing-entry block, the PageUp
            // selection anchor) then declines to treat the header as a row,
            // which is the correct answer in all three.
            rowId:
              indexedState.focus.ref === null ||
              indexedState.focus.ref.kind === "header"
                ? null
                : indexedState.focus.ref.kind === "data"
                  ? indexedState.focus.ref.rowId
                  : indexedState.focus.ref.groupId,
            columnId: indexedState.focus.columnId,
          },
        };
        const projectedQuery = currentQuery();
        if (projectedQuery === surfaceContextRef.current.rowModelSnapshot.query)
          return current;
        const projectedFilters: Record<string, ColumnFilter> = {};
        for (const entry of projectedQuery.filters as readonly {
          readonly columnId: string;
          readonly operator: ColumnFilter["operator"];
          readonly value?: ColumnFilter["value"];
        }[]) {
          projectedFilters[entry.columnId] = {
            operator: entry.operator,
            ...(entry.value === undefined ? {} : { value: entry.value }),
          };
        }
        return {
          ...current,
          filters: projectedFilters,
          sort: projectedQuery.sort as readonly PretableSortEntry[],
          rowGroups: (
            projectedQuery.rowGroups as readonly {
              readonly columnId: string;
            }[]
          ).map((entry) => entry.columnId),
        };
      },
      getColumns: () => {
        const current = surfaceContextRef.current;
        const byId = new Map(
          current.columns.map((column) => [column.id, column]),
        );
        return indexedGrid.getState().columnLayout.flatMap((layout) => {
          const column = byId.get(layout.id as string);
          if (column === undefined) return [];
          return [
            {
              ...column,
              widthPx: layout.widthPx,
              pinned: layout.pinned,
            },
          ];
        });
      },
      setViewport: indexedGrid.setViewport,
      setFocus(addr: { rowId: PretableRowId; columnId: string } | null) {
        if (addr === null) {
          indexedGrid.setFocus({ ref: null, columnId: null });
          return;
        }
        const ref = resolveRef(addr.rowId);
        if (ref === null) return;
        indexedGrid.setFocus({ ref, columnId: addr.columnId });
      },
      setFocusRef(
        ref: PretableIndexedFocusRef<PretableRowId>,
        columnId: string,
      ) {
        indexedGrid.setFocus({ ref, columnId: columnId });
      },
      moveFocus(
        direction: PretableFocusDirection,
        options?: { extend?: boolean; jumpToEdge?: boolean; byPage?: boolean },
      ) {
        // `Cmd/Ctrl + Arrow` jumps to the grid edge in the ARROW's direction,
        // which means the arrow chooses the axis as well as the end of it.
        // Both horizontal arrows used to collapse onto `home` / `end` — the
        // VERTICAL edges — so `Cmd + Left` on a data cell went to the first
        // ROW and `Cmd + Right` to the last. It looked right on the header
        // only because a one-row strip has no vertical edge to get wrong.
        const movement: PretableIndexedFocusMovement = options?.byPage
          ? direction === "up"
            ? "page-up"
            : "page-down"
          : options?.jumpToEdge
            ? direction === "up"
              ? "home"
              : direction === "down"
                ? "end"
                : direction === "left"
                  ? "first-column"
                  : "last-column"
            : direction;
        const before = indexedGrid.getState().focus;
        // `usePretable`'s handle spells the movement union out inline instead
        // of importing `PretableIndexedFocusMovement` (pretable-model.ts), so
        // its copy is two members behind and rejects the column edges. The
        // object underneath IS the grid-core engine and handles them; only the
        // declaration is stale. Narrowed to this one call rather than widened
        // across the handle, and typed to the real union so a future movement
        // still has to be spelled correctly here.
        (
          indexedGrid.moveFocus as (
            movement: PretableIndexedFocusMovement,
          ) => void
        )(movement);
        if (options?.extend) {
          const after = indexedGrid.getState().focus;
          if (after.ref?.kind === "data" && after.columnId !== null) {
            const selection = currentSelection();
            const anchor =
              selection.anchor ??
              (before.ref?.kind === "data" && before.columnId !== null
                ? { rowId: before.ref.rowId, columnId: before.columnId }
                : null);
            if (anchor !== null) {
              indexedGrid.setSelection({
                ...selection,
                anchor,
                ranges: [
                  {
                    start: anchor,
                    end: {
                      rowId: after.ref.rowId,
                      columnId: after.columnId,
                    },
                  },
                ],
              });
            }
          }
        }
      },
      setSelection(next: PretableSelectionState) {
        indexedGrid.setSelection({
          rows: currentSelection().rows,
          ranges: next.ranges.map(inflateIndexedRange),
          anchor:
            next.anchor === null
              ? null
              : {
                  rowId: next.anchor.rowId,
                  columnId: next.anchor.columnId,
                },
        });
      },
      addRange(range: PretableCellRange) {
        const selection = currentSelection();
        indexedGrid.setSelection({
          ...selection,
          ranges: [...selection.ranges, inflateIndexedRange(range)],
          anchor: {
            rowId: range.startRowId,
            columnId: range.startColumnId,
          },
        });
      },
      extendRangeFromAnchor(addr: PretableCellAddress) {
        const selection = currentSelection();
        if (selection.anchor === null) return;
        indexedGrid.setSelection({
          ...selection,
          ranges: [
            {
              start: selection.anchor,
              end: { rowId: addr.rowId, columnId: addr.columnId },
            },
          ],
        });
      },
      clearSelection: indexedGrid.clearSelection,
      toggleRowSelection(rowId: PretableRowId) {
        indexedGrid.toggleRowSelection(rowId);
      },
      setSelectAllVisible(checked: boolean) {
        if (checked) indexedGrid.selectAllVisibleRows();
        else indexedGrid.clearSelection();
      },
      selectAll() {
        indexedGrid.selectAllVisibleRows();
        const current = surfaceContextRef.current;
        const columns = facade
          .getColumns()
          .filter((column) => column.id !== ROW_SELECT_COLUMN_ID);
        const firstRow = current.rowModelSnapshot.dataRowAt(0);
        const lastRow = current.rowModelSnapshot.dataRowAt(
          current.rowModelSnapshot.visibleDataRowCount - 1,
        );
        if (
          firstRow === undefined ||
          lastRow === undefined ||
          columns[0] === undefined ||
          columns.at(-1) === undefined
        ) {
          return;
        }
        const selection = currentSelection();
        const anchor = {
          rowId: firstRow.rowId,
          columnId: columns[0].id,
        };
        indexedGrid.setSelection({
          ...selection,
          ranges: [
            {
              start: anchor,
              end: {
                rowId: lastRow.rowId,
                columnId: columns.at(-1)!.id,
              },
            },
          ],
          anchor,
        });
      },
      setSort(columnId: string, direction: "asc" | "desc" | null) {
        queryWith({
          sort: direction === null ? [] : [{ columnId, direction }],
        });
      },
      replaceSort(sort: readonly PretableSortEntry[]) {
        queryWith({ sort });
      },
      setColumnFilter(columnId: string, filter: ColumnFilter | null) {
        const current = currentQuery();
        const filters = (
          current.filters as readonly {
            readonly columnId: string;
          }[]
        ).filter((entry) => entry.columnId !== columnId);
        queryWith({
          filters:
            filter === null ? filters : [...filters, { columnId, ...filter }],
        });
      },
      setRowGroups(columnIds: readonly string[]) {
        queryWith({
          rowGroups: columnIds.map((columnId) => ({ columnId })),
        });
      },
      setGroupExpanded(groupId: PretableGroupId, expanded: boolean) {
        indexed.rowModel.setGroupExpanded(groupId, expanded);
      },
      toggleGroup(groupId: PretableGroupId) {
        const current = surfaceContextRef.current.rowModelSnapshot;
        indexed.rowModel.setGroupExpanded(
          groupId,
          !current.isGroupExpanded(groupId),
        );
      },
      setColumnWidth: indexedGrid.setColumnWidth,
      setColumnPinned: indexedGrid.setColumnPinned,
      moveColumn(columnId: string, toIndex: number) {
        const currentLayout = indexedGrid.getState().columnLayout;
        const ids = currentLayout.map((entry) => entry.id);
        const from = ids.indexOf(columnId);
        if (from < 0) return;
        const next = ids.slice();
        const [moved] = next.splice(from, 1);
        if (moved === undefined) return;
        const destination = Math.max(0, Math.min(toIndex, next.length));
        const remaining = currentLayout.filter((entry) => entry.id !== moved);
        const leftCount = remaining.filter(
          (entry) => entry.pinned === "left",
        ).length;
        const rightCount = remaining.filter(
          (entry) => entry.pinned === "right",
        ).length;
        const current = currentLayout[from]!;
        const nextPinned =
          destination < leftCount
            ? "left"
            : rightCount > 0 && destination > remaining.length - rightCount
              ? "right"
              : current.pinned === "right" &&
                  rightCount === 0 &&
                  destination === remaining.length
                ? "right"
                : null;
        if ((current.pinned ?? null) !== nextPinned) {
          indexedGrid.setColumnPinned(moved, nextPinned);
        }
        next.splice(destination, 0, moved);
        indexedGrid.setColumnOrder(next);
      },
      beginEdit(
        addr: PretableCellAddress,
        edit?: { draft?: unknown; status?: "checking" | "editing" },
      ) {
        const ref = resolveRef(addr.rowId);
        if (ref?.kind !== "data") return;
        editOperationTokenRef.current += 1;
        indexedGrid.beginEdit({
          rowId: ref.rowId,
          columnId: addr.columnId,
          // `ColumnValueOf<TColumns, TColumnId>` is `never` for a value-erased
          // tuple. A draft is genuinely `unknown` at this point (it comes from
          // an editor's DOM value), so there is no narrower honest target.
          value: edit?.draft as never,
        });
      },
      setEditDraft: indexedGrid.setEditDraft,
      markEditing() {
        indexedGrid.setEditStatus("editing");
      },
      markEditValidating() {
        indexedGrid.setEditStatus("validating");
      },
      markEditSaving() {
        indexedGrid.setEditStatus("saving");
      },
      markEditInvalid(message: string) {
        indexedGrid.setEditStatus("editing", message);
      },
      markEditError(message: string) {
        indexedGrid.setEditStatus("error", message);
      },
      commitEditSucceeded() {
        editOperationTokenRef.current += 1;
        indexedGrid.cancelEdit();
      },
      cancelEdit() {
        editOperationTokenRef.current += 1;
        indexedGrid.cancelEdit();
      },
      autosizeColumn() {},
      scrollToRow(rowId: TRowId) {
        const index = surfaceContextRef.current.rowModelSnapshot.indexOf({
          kind: "data",
          rowId,
        });
        if (index < 0) return;
        const viewport = surfaceContextRef.current.snapshot.viewport;
        // `getOffsetForIndex` answers in the loaded window's LOCAL space; the
        // scroller and the grid's own viewport state are both GLOBAL. On a
        // windowed grid at a nonzero offset the two differ by the whole leading
        // spacer, so writing the local number straight to `el.scrollTop` sends
        // the grid to the top of the dataset instead of to the row.
        const scrollTop = toGlobalScrollTop(
          surfaceContextRef.current.renderSnapshot.rowMetrics.getOffsetForIndex(
            index,
          ),
          surfaceContextRef.current.renderSnapshot.leadingHeight,
        );
        if (viewportRef.current !== null) {
          viewportRef.current.scrollTop = scrollTop;
        }
        indexedGrid.setViewport({
          ...viewport,
          scrollTop,
        });
      },
    };
    return facade;
  }, [effectiveColumns, indexed.rowModel, indexedGrid]);
  const surfaceGrid = useMemo(
    () =>
      Object.assign(Object.create(indexedGrid) as object, {
        beginEdit: (input: Parameters<typeof indexedGrid.beginEdit>[0]) => {
          editOperationTokenRef.current += 1;
          indexedGrid.beginEdit(input);
        },
        cancelEdit: grid.cancelEdit,
        scrollToRow: grid.scrollToRow,
        exportCsv,
      }) as unknown as PretableSurfaceGrid<TRow, TRowId, TColumns>,
    [exportCsv, grid.cancelEdit, grid.scrollToRow, indexedGrid],
  );

  const baseTelemetry = useMemo<
    Omit<PretableTelemetry<TRowId>, "windowGap">
  >(() => {
    const viewportBottom =
      snapshot.viewport.scrollTop +
      Math.max(snapshot.viewport.height, bodyViewportHeight);
    const viewportRows = renderSnapshot.rows.filter(
      (row) =>
        row.top < viewportBottom &&
        row.top + row.height > snapshot.viewport.scrollTop,
    );
    return {
      // Telemetry. A header cursor reports `null` rather than inventing a row
      // id: this field feeds consumer dashboards that count focused ROWS, and
      // a sentinel string would show up there as a row nobody has.
      focusedRowId:
        snapshot.focus.ref === null || snapshot.focus.ref.kind === "header"
          ? null
          : snapshot.focus.ref.kind === "data"
            ? (snapshot.focus.ref.rowId as TRowId)
            : snapshot.focus.ref.groupId,
      loadedRowCount: rowModelSnapshot.sourceRowCount,
      rowModelRowCount: rowModelSnapshot.visibleRowCount,
      renderedRowCount: renderSnapshot.rows.length,
      selectedRowId:
        snapshot.selection.ranges[0] === undefined
          ? null
          : (snapshot.selection.ranges[0].startRowId as TRowId),
      totalRowCount: rowModelSnapshot.sourceRowCount,
      totalHeight: renderSnapshot.totalHeight,
      visibleRowCount: viewportRows.length,
      visibleRowRange:
        viewportRows.length === 0
          ? { start: 0, end: 0 }
          : {
              start: viewportRows[0]!.rowIndex,
              end: viewportRows[viewportRows.length - 1]!.rowIndex + 1,
            },
    };
  }, [bodyViewportHeight, renderSnapshot, rowModelSnapshot, snapshot]);
  const focusedRowId = snapshot.focus.rowId;
  const focusedColumnId = snapshot.focus.columnId;
  const isGrouped = snapshot.rowGroups.length > 0;
  // How many records this grid holds, read from the SAME commit as the total it
  // is checked against.
  //
  // In rows mode the consumer just handed us `rows`, while the row model only
  // ingests them in a layout effect — after this render. Reading the model's
  // `sourceRowCount` here would compare a query's new total against the
  // previous query's row count for exactly one render, which is a
  // contradiction the consumer never committed: every narrowing query tripped
  // the contiguous-window check, and `warnOnce` then latched, disarming the
  // check for the rest of the session.
  //
  // Explicit-model mode has no such prop — `rows` is `EMPTY_ROWS` there, not
  // `undefined`, so its length is a hard zero — and no skew either, because the
  // consumer mutates the model directly. Keyed off `model`, the same
  // discriminator the surface uses everywhere else, never off `rows.length`.
  const loadedRowCount =
    model === undefined ? rows.length : rowModelSnapshot.sourceRowCount;
  // Memoized so its identity is stable whenever `resultMeta?.total` and
  // `loadedRowCount` are — otherwise the fallback object literal below would
  // be a fresh reference every render, and the `windowSpacers` memo further
  // down (which depends on this value) would never actually memoize.
  //
  // The fallback says "the population is exactly what you handed me", so it
  // must count the same records `loadedRowCount` does; sourcing it from the
  // model instead would re-create the very skew above, in the other direction.
  const matchingTotal = useMemo(
    () =>
      resultMeta?.total ?? {
        kind: "exact" as const,
        count: loadedRowCount,
      },
    [resultMeta?.total, loadedRowCount],
  );
  const windowStart = resultMeta?.window?.start;
  const datasetKey = resultMeta?.datasetKey;
  const dataHonesty = {
    visibleRowCount: rowModelSnapshot.visibleRowCount,
    isGrouped,
    loadedRowCount,
    matchingTotal,
    windowStart,
  };
  const dataScope = resolveDataScope(dataHonesty, processing);
  const ariaRowCount = resolveAriaRowCount(dataHonesty, processing);
  // Engine sort over a window the server chose reorders a SAMPLE and labels it
  // with an ordinary `aria-sort`. Legal for a consumer that loaded the whole
  // result — and this only fires when an exact total proves the window is
  // partial — but silent until now, because nothing rendered the rule.
  //
  // Sits ABOVE the `windowSpacers` memo, not beside the other honesty warning
  // below it: passing `dataHonesty` to anything after that memo makes the React
  // Compiler treat the object as possibly mutated later, and it then refuses to
  // preserve the memo.
  //
  // Not a style preference and not something to rediscover by measurement —
  // `react-hooks/preserve-manual-memoization` is an ERROR in eslint.config.js,
  // so moving this call below the memo fails the required `lint` job with
  // "Compilation Skipped: Existing memoization could not be preserved",
  // pointing at the memo's `ariaRowCount` dependency. That lint gate is the
  // guard here; nothing about it shows up in a runtime benchmark, because
  // tsup compiles this package without babel-plugin-react-compiler.
  warnOnEngineSortOverPartialWindow(dataHonesty, processing);
  // Trustworthy for BOTH per-row dataset position (aria-rowindex) and the
  // scroll-extent spacers under exactly the same conditions — whether
  // resolveAriaRowCount actually published the population count rather than
  // downgrading. Every condition that forces a downgrade there (non-external
  // authority, grouping, a non-exact or out-of-range total) means local model
  // index no longer maps to dataset position, so an offset OR a spacer would
  // be just as dishonest as the rowcount they'd contradict. One boolean,
  // reused for both derivations below, so the two can never disagree.
  const windowSpacers = useMemo<WindowSpacers | null>(
    () =>
      windowStart !== undefined &&
      matchingTotal.kind === "exact" &&
      ariaRowCount === matchingTotal.count + 1
        ? {
            leadingRows: windowStart,
            // Rides the gate with the counts: a selection span is only
            // readable while the population it was measured in is still the
            // one on screen (see `PretableIndexedDatasetRowSpan.datasetKey`).
            ...(datasetKey === undefined ? {} : { datasetKey }),
            // Rows the population claims exist past this window's end. Never
            // negative: a window whose end already meets or exceeds the
            // claimed total — the ordinary un-windowed case, or a window's
            // last page — trails by zero, not by a negative count.
            trailingRows: Math.max(
              0,
              matchingTotal.count -
                (windowStart + rowModelSnapshot.sourceRowCount),
            ),
          }
        : null,
    // Every input the honesty gate above reads, plus `sourceRowCount` for the
    // trailing-count arithmetic — matches the comment above this memo.
    [
      ariaRowCount,
      datasetKey,
      matchingTotal,
      rowModelSnapshot.sourceRowCount,
      windowStart,
    ],
  );
  // The window passed the gate but carries no population identity, so
  // selection spans are refused rather than read. Said out loud once, because
  // the loss is otherwise invisible: the selection simply shrinks to the
  // loaded window and nothing explains why.
  warnOnMissingDatasetKeyForWindow(windowSpacers !== null, datasetKey);
  // Dataset index of the first loaded row; 0 — the classic prefix case —
  // whenever the window above is not trustworthy.
  const rowIndexOffset = windowSpacers?.leadingRows ?? 0;
  // The same honesty-gated window `pretable-model.ts` hands the engine through
  // `getSelectionWindow`, re-derived here because painting and counting happen
  // during render and the engine's copy is private to its reconciliation.
  //
  // Derived from `windowSpacers` rather than from `resultMeta.window` directly,
  // so it can never disagree with `rowIndexOffset` — the offset this same
  // render publishes as `aria-rowindex`. That pairing is the point: on the one
  // render where a pager swap has moved the window but `setRows` has not yet
  // settled, every rendered row is announced at `rowIndexOffset + rank`, and a
  // selection painted from the same number agrees with what the grid is saying
  // about those rows. Reading a different window here would let the paint and
  // the announced position contradict each other for a frame.
  const selectionWindow = useMemo<PretableIndexedSelectionWindow | null>(
    () =>
      windowSpacers === null || windowSpacers.leadingRows === undefined
        ? null
        : {
            start: windowSpacers.leadingRows,
            length: rowModelSnapshot.sourceRowCount,
            ...(windowSpacers.datasetKey === undefined
              ? {}
              : { datasetKey: windowSpacers.datasetKey }),
          },
    [rowModelSnapshot.sourceRowCount, windowSpacers],
  );
  // Pushed to the row layout controller, which is built once per row model
  // and has no other path to a value that changes on the window's own
  // timescale — see `WindowSpacers` in pretable-model.ts. `useInsertionEffect`
  // rather than a render-phase assignment so a discarded concurrent render
  // cannot publish its values; no dependency list because this only has to be
  // current before the controller's own layout effect next reads it, which
  // runs on every commit regardless.
  useInsertionEffect(() => {
    indexed.setWindowSpacers(windowSpacers);
  });
  // Same honesty gate as the offset and the spacers above (`windowSpacers`
  // null means the window cannot be trusted, so there is nothing honest to
  // report here either — a gap computed off an untrustworthy window would be
  // just as dishonest as the rowcount/offset/spacer it would contradict).
  //
  // Geometry, not row counts: the leading/trailing spacer PIXEL heights are
  // estimated with the exact same `defaultRowHeight` the row layout
  // controller uses to size those spacers (see `leadingHeight`/
  // `trailingHeight` in `row-layout-controller.ts`), so "past the window" is
  // judged in the same coordinate space the viewport's own scrollTop lives
  // in.
  //
  // Known constraint: `renderSnapshot.totalHeight`, read below to place the
  // window's pixel boundary, comes from the row layout controller, which
  // only replans on a scroll, viewport, column, or row-model change — not
  // merely because `indexed.setWindowSpacers` above wrote a new ref value.
  // `windowSpacers` itself (leading/trailing ROW counts) is always fresh —
  // it is derived straight from `resultMeta`, read fresh every render — so a
  // consumer that grows `resultMeta.total` without touching `rows` or the
  // viewport still gets a correct `windowGap` immediately in practice: a
  // bigger claimed total only pushes the stale boundary further away, which
  // keeps an already-past-the-window viewport reading as past it.
  //
  // But mixing that fresh row count against a STALE total height is not
  // sound in general, and a total that SHRINKS exposes it: the boundary
  // computed as `totalHeight(stale) - trailingRows(fresh) * rowHeightPx` no
  // longer approximates "end of the loaded window" once the stale and fresh
  // trailing counts diverge, and `windowGap` can go silently absent for a
  // viewport that is still genuinely past the window. See the
  // "windowGap telemetry does not refresh from a resultMeta-only update"
  // test, which pins this exact false-negative and confirms the next
  // replan-triggering event (any scroll) corrects it. Fixing it outright
  // means changing when the row layout controller replans — a
  // `pretable-model.ts` concern that is deliberately kept ignorant of
  // `resultMeta` (see `WindowSpacers` there) — not anything about how
  // `windowGap` itself is computed, so it is left as a documented constraint
  // rather than patched here.
  const windowGap = useMemo<PretableTelemetry<TRowId>["windowGap"]>(() => {
    if (windowSpacers === null) return undefined;
    const rowHeightPx = getThemeRowHeight();
    const viewportTop = snapshot.viewport.scrollTop;
    const viewportBottom =
      viewportTop + Math.max(snapshot.viewport.height, bodyViewportHeight);
    const leadingRows = windowSpacers.leadingRows ?? 0;
    if (leadingRows > 0 && viewportTop < leadingRows * rowHeightPx) {
      return { direction: "before", rowCount: leadingRows };
    }
    const trailingRows = windowSpacers.trailingRows ?? 0;
    const hasMore = resultMeta?.window?.hasMore === true;
    const lastLoadedRowBottom =
      renderSnapshot.totalHeight - trailingRows * rowHeightPx;
    if (hasMore && trailingRows > 0 && viewportBottom > lastLoadedRowBottom) {
      return { direction: "after", rowCount: trailingRows };
    }
    return undefined;
  }, [
    bodyViewportHeight,
    renderSnapshot.totalHeight,
    resultMeta,
    snapshot.viewport.height,
    snapshot.viewport.scrollTop,
    windowSpacers,
  ]);
  const telemetry = useMemo<PretableTelemetry<TRowId>>(
    () => ({ ...baseTelemetry, windowGap }),
    [baseTelemetry, windowGap],
  );
  const bodyStateKind =
    dataState === undefined
      ? null
      : resolveBodyStateKind(
          dataState.phase,
          rowModelSnapshot.visibleDataRowCount,
        );
  // Every UI-driven grouping change emits one complete next query, then reports
  // the same de-duplicated schema-valid list to controlled consumers.
  const applyRowGroups = useCallback(
    (next: readonly string[], focusIntent?: GroupingFocusIntent) => {
      const schemaIds = new Set(
        indexed.rowModel.getColumns().map((column) => column.id),
      );
      const rowGroups = Array.from(new Set(next))
        .filter((columnId) => schemaIds.has(columnId))
        .map((columnId) => ({ columnId }));
      const expectedRowGroups = rowGroups.map((entry) => entry.columnId);
      pendingGroupingFocusRef.current = focusIntent
        ? { intent: focusIntent, expectedRowGroups }
        : null;
      const current = rowModelSnapshot.query;
      indexedGrid.setQuery({
        filters: current.filters,
        sort: current.sort,
        // `PretableRowGroupFor<TColumns>` — `never` for the same reason as the
        // `queryWith` casts above.
        rowGroups: rowGroups as never,
      });
      if (groupingListsEqual(snapshot.rowGroups, expectedRowGroups)) {
        pendingGroupingFocusRef.current = null;
      }
    },
    [indexed.rowModel, indexedGrid, rowModelSnapshot.query, snapshot.rowGroups],
  );
  const labelForColumn = useCallback(
    (columnId: string) =>
      authoritativeColumns.find((column) => column.id === columnId)?.header ??
      columnId,
    [authoritativeColumns],
  );
  // Shared by the data-row and group-row cell refs: the focus-follow effect
  // looks a cell up by `rowId::columnId`, and a group cell that never
  // registered would leave DOM focus stranded on an unmounted data cell.
  const registerCell = useCallback(
    (key: string, node: HTMLDivElement | null) => {
      if (node) {
        cellNodesRef.current.set(key, node);
        return;
      }
      const removed = cellNodesRef.current.get(key);
      cellNodesRef.current.delete(key);
      if (removed === undefined) return;
      // A cell being unmounted WHILE IT HOLDS DOM FOCUS. React detaches refs
      // before it removes the host node, so this runs while the browser still
      // reports the cell as `document.activeElement` — the one moment where
      // the loss can be OBSERVED rather than inferred afterwards from focus
      // sitting on `<body>`, which is indistinguishable from a user who
      // clicked the page background.
      //
      // Recorded, not acted on. This is React's mutation phase: calling
      // `focus()` here makes React's own focus/selection restoration write the
      // scroll offsets of the focused element's ancestors back onto them
      // (`restoreSelection` in react-dom), which shows up as a spurious
      // `scrollTop` write on the viewport. The layout effect below does the
      // actual move, a few microseconds later and still before paint.
      if (removed.ownerDocument.activeElement !== removed) return;
      focusLostToUnmountRef.current = true;
    },
    [],
  );
  const registerColumnMenuButton = useCallback(
    (columnId: string, node: HTMLButtonElement | null) => {
      if (node) {
        columnMenuButtonNodesRef.current.set(columnId, node);
      } else {
        columnMenuButtonNodesRef.current.delete(columnId);
      }
    },
    [],
  );

  // The columns in the order they are DRAWN, which is the engine's order —
  // drag-to-reorder moves columns there and leaves the `columns` prop in
  // declaration order. Anything that walks columns left to right (clipboard
  // copy's serialization, paste's geometry) has to read this rather than the
  // prop, or a reordered grid serializes and lands cells in an order the user
  // never sees. Definitions still come from the props, looked up by id — the
  // same split the header row uses for pin state.
  //
  // Read from indexed layout, not `options.columns`: while grouped the DRAWN
  // list leads with the derived group column and drops the grouped ones, and a
  // keyboard model or a copy range bounded by columns that are not on screen is
  // bounded by the wrong thing. Ungrouped the two are the same array.
  const drawnColumns = useMemo(() => {
    const byId = new Map(effectiveColumns.map((column) => [column.id, column]));
    return indexedSnapshot.columnLayout.flatMap<PretableColumn<TRow>>(
      (layout) => {
        const column = byId.get(layout.id as string);
        return column === undefined
          ? []
          : [
              {
                ...column,
                widthPx: layout.widthPx,
                pinned: layout.pinned,
              },
            ];
      },
    );
  }, [effectiveColumns, indexedSnapshot.columnLayout]);
  const columnsInVisualOrder = useMemo(() => {
    const byId = new Map(effectiveColumns.map((column) => [column.id, column]));
    return drawnColumns.flatMap<PretableColumn<TRow>>((engineColumn) => {
      // The group column exists only in the derived list, so it is its own
      // definition; every other column's definition comes from the props.
      if (engineColumn.id === GROUP_COLUMN_ID) return [engineColumn];
      const definition = byId.get(engineColumn.id);
      return definition ? [definition] : [];
    });
  }, [drawnColumns, effectiveColumns]);

  // Cell editing. `useCellEditController` memoizes on `grid` only, so the
  // closures it captures would otherwise go stale across renders. Keep refs to
  // the latest columns/rows/change callbacks and read them through stable wrappers so
  // the (memoized) controller always sees current data. Refs are synced in a
  // layout effect (every render, no deps) — they only need to be current before
  // event handlers / async resolutions read them, which happen post-commit.
  const editColumnsRef = useRef(effectiveColumns);
  const visualOrderColumnsRef = useRef(columnsInVisualOrder);
  const editRowModelSnapshotRef = useRef(rowModelSnapshot);
  const onRowChangeRef = useRef(onRowChange);
  const beforeRowChangeRef = useRef(beforeRowChange);
  const onPasteRef = useRef(onPaste);
  // Read through a ref for the same reason `onPaste` is: the paste listener is
  // memoized on `grid` alone, and `messages` is typically passed inline
  // (`messages={{ … }}`), so depending on it directly would rebuild the
  // handler — and detach/reattach the listener — on every render.
  const effectiveMessagesRef = useRef(effectiveMessages);
  useLayoutEffect(() => {
    editColumnsRef.current = effectiveColumns;
    visualOrderColumnsRef.current = columnsInVisualOrder;
    editRowModelSnapshotRef.current = rowModelSnapshot;
    onRowChangeRef.current = onRowChange;
    beforeRowChangeRef.current = beforeRowChange;
    onPasteRef.current = onPaste;
    effectiveMessagesRef.current = effectiveMessages;
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
  const pendingRowsEditRef = useRef<{
    readonly rowId: PretableRowId;
    readonly changes: Partial<TRow>;
  } | null>(null);
  const editController = useCellEditController<TRow, PretableRowId>({
    grid,
    getColumns: useCallback(() => editColumnsRef.current, []),
    getRowById: useCallback((id: PretableRowId) => {
      const current = editRowModelSnapshotRef.current;
      const index = current.indexOf({ kind: "data", rowId: id });
      const entry = index < 0 ? undefined : current.rowAt(index);
      return entry?.kind === "data" ? entry.row : null;
    }, []),
    onCommit: useCallback(
      async (payload: {
        rowId: PretableRowId;
        columnId: string;
        value: unknown;
        row: TRow;
      }) => {
        const column = editColumnsRef.current.find(
          (candidate) => candidate.id === payload.columnId,
        );
        if (column === undefined) return;
        const change = deriveRowChange({
          rowId: payload.rowId,
          row: payload.row,
          column: column as unknown as {
            readonly id: string;
            readonly accessorKey?: Extract<keyof TRow, string>;
            readonly setValue?: (input: {
              readonly row: TRow;
              readonly value: unknown;
            }) => Partial<TRow>;
          },
          value: payload.value,
        });
        if (model === undefined) {
          const callback = onRowChangeRef.current;
          if (callback === undefined) return;
          pendingRowsEditRef.current = {
            rowId: change.rowId,
            changes: change.changes,
          };
          try {
            await callback(
              change as unknown as PretableSurfaceRowChange<
                TRow,
                TRowId,
                TColumns
              >,
            );
          } catch (error) {
            pendingRowsEditRef.current = null;
            throw error;
          }
          return "keep-open";
        }
        const operationToken = editOperationTokenRef.current;
        const operationModel = indexed.rowModel;
        try {
          await beforeRowChangeRef.current?.([
            change as unknown as PretableSurfaceRowChange<
              TRow,
              TRowId,
              TColumns
            >,
          ]);
        } catch (error) {
          if (
            operationToken !== editOperationTokenRef.current ||
            operationModel !== editModelIdentityRef.current
          ) {
            return "keep-open";
          }
          throw error;
        }
        if (
          operationToken !== editOperationTokenRef.current ||
          operationModel !== editModelIdentityRef.current
        ) {
          return "keep-open";
        }
        operationModel.applyTransaction({
          update: [{ id: change.rowId, changes: change.changes }],
        });
      },
      [indexed.rowModel, model],
    ),
  });

  useLayoutEffect(() => {
    const pending = pendingRowsEditRef.current;
    if (pending === null) return;
    const index = rowModelSnapshot.indexOf({
      kind: "data",
      rowId: pending.rowId,
    });
    const entry = index < 0 ? undefined : rowModelSnapshot.rowAt(index);
    if (entry?.kind !== "data") return;
    for (const key of Object.keys(pending.changes) as (keyof TRow)[]) {
      if (!Object.is(entry.row[key], pending.changes[key])) return;
    }
    pendingRowsEditRef.current = null;
    indexedGrid.cancelEdit();
  }, [indexedGrid, rowModelSnapshot]);

  // Boolean cells toggle-and-commit directly through the edit lifecycle (no
  // popover): begin seeds the negated value as the draft, commit runs the
  // usual parse/validate/row-change path (async `editable` gates and staleness
  // tokens all apply).
  const toggleBooleanCell = async (
    rowId: PretableRowId,
    column: PretableColumn<TRow>,
  ) => {
    if (!column.editable) return;
    const editing = grid.getSnapshot().editing;
    if (editing) {
      // A FAILED edit on this same cell (validate reject leaves status
      // "editing" with error set; commit failure leaves status "error") is
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
    const currentSnapshot = editRowModelSnapshotRef.current;
    const rowIndex = currentSnapshot.indexOf({ kind: "data", rowId });
    const entry = rowIndex < 0 ? undefined : currentSnapshot.rowAt(rowIndex);
    if (entry?.kind !== "data") return;
    const row = entry.row;
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
  // a streaming grid replaces indexed snapshot roots constantly, and the payload is
  // addressed by row id — the consumer applies it against its own current
  // state, exactly as it does for row changes.
  const pasteTokenRef = useRef(0);
  const pasteModelIdentityRef = useRef(indexed.rowModel);
  useLayoutEffect(() => {
    pasteModelIdentityRef.current = indexed.rowModel;
    pasteTokenRef.current += 1;
    return () => {
      pasteTokenRef.current += 1;
    };
  }, [indexed.rowModel]);

  const handlePaste = useCallback(
    (event: ClipboardEvent) => {
      const onPasteFn = onPasteRef.current;
      const ownsExplicitWrites = model !== undefined;
      if (!onPasteFn && !ownsExplicitWrites) return;
      const pasteSnapshot = editRowModelSnapshotRef.current;
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

      const currentGridSnapshot = indexedGrid.getState();
      // Paste geometry walks columns left to right, so it walks the DRAWN
      // order: anchored on a column the user dragged rightward, the prop order
      // would run the block off its end (cells silently clipped) or land them
      // in columns to the left of where the user aimed.
      const columns = visualOrderColumnsRef.current;
      const anchored = resolvePasteAnchor(
        currentGridSnapshot.selection.ranges,
        currentGridSnapshot.focus,
        pasteSnapshot,
        columns,
      );
      if (!anchored) return; // nothing selected or focused: not ours to handle

      const targets = mapPasteToTargets<
        TRow,
        PretableRowId,
        readonly PretableColumn<TRow>[]
      >({
        matrix,
        anchor: anchored.anchor,
        selectionSize: anchored.selectionSize,
        rowModelSnapshot: pasteSnapshot,
        columns,
      });

      // From here the grid owns this paste; the browser must not also insert it.
      event.preventDefault();

      let sourceColumns = 0;
      for (const row of matrix) {
        sourceColumns = Math.max(sourceColumns, row.length);
      }

      const myToken = (pasteTokenRef.current += 1);
      const operationModel = indexed.rowModel;
      const pasteIsStale = () =>
        myToken !== pasteTokenRef.current ||
        operationModel !== pasteModelIdentityRef.current;
      const columnById = new Map(columns.map((c) => [c.id, c]));
      // One slot per target, so outcomes keep the block's row-major order.
      const outcomes = new Array<
        | PastedCell<TRow, PretableRowId>
        | RejectedPasteCell<PretableRowId>
        | null
      >(targets.cells.length).fill(null);
      const candidates: {
        index: number;
        target: (typeof targets.cells)[number];
        input: PretableEditInput<TRow>;
      }[] = [];

      targets.cells.forEach((target, index) => {
        const column = columnById.get(target.columnId);
        const rowIndex = pasteSnapshot.indexOf({
          kind: "data",
          rowId: target.rowId as unknown as string,
        });
        const candidateRow =
          rowIndex < 0 ? undefined : pasteSnapshot.rowAt(rowIndex);
        const row =
          candidateRow?.kind === "data" ? candidateRow.row : undefined;
        if (!column || !row) return;
        const input: PretableEditInput<TRow> = {
          rowId: target.rowId as unknown as string,
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
          PastedCell<TRow, PretableRowId> | RejectedPasteCell<PretableRowId>
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
          if (pasteIsStale()) return;
          batch.forEach((candidate, j) => {
            outcomes[candidate.index] = resolved[j]!;
          });
        }

        const cells: PastedCell<TRow, PretableRowId>[] = [];
        const rejected: RejectedPasteCell<PretableRowId>[] = [];
        for (const outcome of outcomes) {
          if (!outcome) continue;
          if ("reason" in outcome) rejected.push(outcome);
          else cells.push(outcome);
        }
        const pastePayload: PastePayload<TRow, PretableRowId> = {
          cells,
          rejected,
          source: { rows: matrix.length, columns: sourceColumns },
          clipped: targets.clipped,
        };
        if (ownsExplicitWrites) {
          const changes = cells.map((cell) => {
            const column = columnById.get(cell.columnId);
            if (column === undefined) {
              throw new Error(`Unknown paste column ${cell.columnId}`);
            }
            return deriveRowChange({
              rowId: cell.rowId,
              row: cell.row,
              column: column as unknown as {
                readonly id: string;
                readonly accessorKey?: Extract<keyof TRow, string>;
                readonly setValue?: (input: {
                  readonly row: TRow;
                  readonly value: unknown;
                }) => Partial<TRow>;
              },
              value: cell.value,
            });
          });
          await beforeRowChangeRef.current?.(
            changes as unknown as readonly PretableSurfaceRowChange<
              TRow,
              TRowId,
              TColumns
            >[],
          );
          if (pasteIsStale()) return;
          await (
            onPasteFn as
              | ((payload: PastePayload<TRow, TRowId>) => void | Promise<void>)
              | undefined
          )?.(pastePayload as PastePayload<TRow, TRowId>);
          if (pasteIsStale()) return;
          operationModel.applyTransaction({
            update: changes.map((change) => ({
              id: change.rowId,
              changes: change.changes,
            })),
          });
        } else if (onPasteFn !== undefined) {
          await (
            onPasteFn as unknown as (
              payload: PastePayload<TRow, PretableRowId>,
            ) => void | Promise<void>
          )(pastePayload);
        }

        // Announced only once `onPaste` has RESOLVED. The consumer owns the
        // write, and it may be async and may reject, so anything said before
        // then is a claim about state the app has not reached — "12 cells
        // pasted" followed by a throw would be a lie told to the one user who
        // cannot see that nothing changed. The cost is a delay the length of
        // the consumer's own update; the live region is polite and debounced
        // anyway, so it is not a perceptible one.
        if (pasteIsStale()) return;
        // Nothing landed and nothing was refused: an inert paste, with the same
        // nothing to say that an empty-selection Cmd+C has.
        if (cells.length === 0 && rejected.length === 0) return;
        scheduleAnnouncement(
          effectiveMessagesRef.current.pasteAnnouncement({
            cellCount: cells.length,
            rejectedCount: rejected.length,
            clipped: targets.clipped,
          }),
        );
      };

      void gate().catch((err) => {
        console.warn("[pretable] paste failed", err);
        // The hole `copyFailedAnnouncement` fills for copy: without this a
        // failed paste is indistinguishable from an ignored keystroke to
        // anyone not watching the grid. Suppressed when superseded, so a stale
        // failure cannot talk over a newer paste (or fire after unmount).
        if (pasteIsStale()) return;
        scheduleAnnouncement(
          effectiveMessagesRef.current.pasteFailedAnnouncement(),
        );
      });
    },
    [indexed.rowModel, indexedGrid, model, scheduleAnnouncement],
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

  // Header popovers: one open-state for the whole surface, shared by the
  // funnel's filter dialog and the ⋮ column menu, so opening either closes the
  // other. See useHeaderPopover for why they cannot be independent.
  const {
    openState: headerPopover,
    toggle: togglePopover,
    close: closePopover,
  } = useHeaderPopover();
  const filterOpenState =
    headerPopover?.kind === "filter" ? headerPopover : null;
  const menuOpenState = headerPopover?.kind === "menu" ? headerPopover : null;
  const selectColumnMenuAction = useCallback(
    (action: "group" | "ungroup") => {
      if (!menuOpenState) return;
      const level = snapshot.rowGroups.indexOf(menuOpenState.columnId);
      applyRowGroups(
        action === "group"
          ? insertGroupLevel(
              snapshot.rowGroups,
              menuOpenState.columnId,
              snapshot.rowGroups.length,
            )
          : removeGroupLevel(snapshot.rowGroups, level),
        action === "group"
          ? { target: "chip", columnId: menuOpenState.columnId }
          : undefined,
      );
    },
    [applyRowGroups, menuOpenState, snapshot.rowGroups],
  );

  /**
   * Open a header popover from the KEYBOARD, on the column the focus cursor
   * is on.
   *
   * The anchor is the funnel / `⋮` button itself, not the header cell: the
   * popover positions off `anchor.getBoundingClientRect()`, so anchoring to
   * the whole header would park a 240px filter panel under the middle of a
   * wide column instead of under the control it belongs to. The buttons are
   * `tabIndex={-1}` now, which changes nothing about where they are.
   *
   * Returns false when the column renders no such control — `filterable:
   * false`, or a grid with no group panel — so the key falls through instead
   * of being swallowed into a popover that never opens.
   */
  const openHeaderPopover = useCallback(
    (kind: "filter" | "menu", columnId: string): boolean => {
      const anchor =
        kind === "menu"
          ? (columnMenuButtonNodesRef.current.get(columnId) ?? null)
          : // The funnel has no node registry of its own; it is found by the
            // same attributes the e2e specs select it with. `CSS.escape` is
            // not optional — a column id is consumer-supplied and may contain
            // a quote or a bracket.
            (viewportRef.current?.querySelector<HTMLElement>(
              `[data-pretable-filter-funnel][data-pretable-column-id="${CSS.escape(columnId)}"]`,
            ) ?? null);
      if (anchor === null) return false;
      togglePopover(kind, columnId, anchor);
      return true;
    },
    [togglePopover],
  );

  // Focus restoration when a header popover closes.
  //
  // `useHeaderPopover` closes on Escape from a document-level listener and does
  // not restore focus, and FilterMenu focuses its own `<select>` on open — so
  // Escape from a keyboard-opened filter left `document.activeElement` on a
  // node that had just been unmounted, i.e. on `<body>`. The user was outside
  // the grid with no way back except Tab. (ColumnMenu restores to its anchor
  // itself; this then agrees with it rather than fighting it.)
  //
  // Only fires when the engine's cursor is still on the header, and only when
  // nothing else has claimed focus — the same "is this ours to take" rule the
  // focus-follow effect uses.
  const headerPopoverWasOpenRef = useRef(false);
  useEffect(() => {
    const wasOpen = headerPopoverWasOpenRef.current;
    headerPopoverWasOpenRef.current = headerPopover !== null;
    if (!wasOpen || headerPopover !== null) return;
    const focusRef = snapshot.focus.ref;
    const columnId = snapshot.focus.columnId;
    if (focusRef?.kind !== "header" || columnId === null) return;
    const node = headerCellNodesRef.current.get(columnId);
    if (node === undefined || !node.isConnected) return;
    const active = node.ownerDocument.activeElement;
    if (
      active !== null &&
      active !== node.ownerDocument.body &&
      !node.parentElement?.contains(active) &&
      active !== viewportRef.current
    ) {
      return;
    }
    node.focus({ preventScroll: true });
  }, [headerPopover, snapshot.focus.columnId, snapshot.focus.ref]);

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
    // The derived group column has no prop definition to look up — it is
    // engine state — and both the header and every body row resolve their
    // columns through this map, so without it a grouped grid draws no group
    // column at all.
    const groupColumn = drawnColumns.find((col) => col.id === GROUP_COLUMN_ID);
    if (groupColumn) {
      map.set(groupColumn.id, groupColumn);
    }
    return map;
  }, [drawnColumns, effectiveColumns]);

  // One plan over the whole engine column set, shared by the two features that
  // need to reason about columns `renderSnapshot.columns` does not carry:
  // reorder hit-testing (a scrolled-out column is still a legitimate drop
  // target) and scroll-into-view (an off-window column is the only reason it
  // runs). Both want identical geometry, so they read the same object rather
  // than each deriving one — see `planColumnLayout` for why that matters.
  // Content order, and each entry's `index` is its engine index — what
  // grid.moveColumn takes.
  // Planned from the DRAWN columns, because both consumers compare it against
  // rendered pixels: a plan built from `options.columns` while grouped would
  // miss the group column entirely and put every other column's `left` a
  // group-column width away from where it is painted.
  const columnLayout = useMemo(
    () => planColumnLayout([...drawnColumns]),
    [drawnColumns],
  );

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
    // The order `indexedRangeContainsCell` resolves a range's column bounds
    // against. The synthetic row-select column is prepended unconditionally
    // rather than filtered out, because it is how a FULL-ROW range encodes
    // itself: one bound is `ROW_SELECT_COLUMN_ID`, and the columns it implies
    // are "from the far left to the other bound". Placing it at index 0 —
    // which is where it is drawn whenever it is drawn at all — makes ordinary
    // containment reproduce that meaning with no special case, and keeps it
    // meaningful even when the checkbox column is not currently rendered.
    const rangeColumnIds = [
      ROW_SELECT_COLUMN_ID,
      ...dataColumns.map((column) => column.id),
    ];
    return { dataColumns, idxById, rangeColumnIds };
  }, [columnsInVisualOrder]);

  const { fullySelectedRowIds, indeterminateRowIds } = useMemo<{
    fullySelectedRowIds: Set<PretableRowId>;
    indeterminateRowIds: Set<PretableRowId>;
  }>(() => {
    const fullyRows = new Set<PretableRowId>();
    const indeterminateRows = new Set<PretableRowId>();
    const selectionRows = indexedSnapshot.selection.rows;
    // Membership is queried through the grid so the core keeps ownership of
    // its indexed snapshot. Reading this immutable slice makes row-selection
    // publications invalidate the rendered-row memo.
    void selectionRows;
    const lastDataColumnIndex = dataColumnIndex.dataColumns.length - 1;
    for (const rendered of renderSnapshot.rows) {
      if (rendered.ref.kind !== "data") continue;
      const checked = indexedGrid.isRowSelected(rendered.ref.rowId);
      if (checked) {
        fullyRows.add(rendered.ref.rowId);
        continue;
      }
      let intersects = false;
      for (const range of indexedSnapshot.selection.ranges) {
        // Row containment on DATASET position, so a row's own aria-selected
        // agrees with the cells inside it once the range's endpoints have
        // been evicted. Probing with the range's OWN start column makes the
        // column half of this test trivially true, leaving a pure row
        // question; the column span is judged on its own terms just below.
        if (
          !rangeContainsCell(
            range,
            rendered.ref,
            range.start.columnId,
            rowModelSnapshot,
            dataColumnIndex.rangeColumnIds,
            selectionWindow,
          )
        ) {
          continue;
        }
        intersects = true;
        const startColumn = dataColumnIndex.idxById.get(range.start.columnId);
        const endColumn = dataColumnIndex.idxById.get(range.end.columnId);
        if (
          startColumn !== undefined &&
          endColumn !== undefined &&
          Math.min(startColumn, endColumn) === 0 &&
          Math.max(startColumn, endColumn) === lastDataColumnIndex
        ) {
          fullyRows.add(rendered.ref.rowId);
          intersects = false;
          break;
        }
      }
      if (intersects) indeterminateRows.add(rendered.ref.rowId);
    }
    return {
      fullySelectedRowIds: fullyRows,
      indeterminateRowIds: indeterminateRows,
    };
  }, [
    dataColumnIndex,
    indexedSnapshot.selection.ranges,
    indexedSnapshot.selection.rows,
    indexedGrid,
    renderSnapshot.rows,
    rowModelSnapshot,
    selectionWindow,
  ]);

  // The checked set, in rendered order, for consumers driving bulk actions.
  // `fullySelectedRowIds` above is a Set keyed for lookup; a caller cannot
  // recover the order from it, and cannot expand the underlying cell ranges
  // either — those are (startRowId, endRowId) spans that only mean something
  // against the visible order the grid owns once sorting is applied.
  const selectedRowIds = useMemo(
    () =>
      orderedSelectedRowIds(indexedSnapshot.selection.rows, (rowId) =>
        rowModelSnapshot.indexOf({ kind: "data", rowId }),
      ) as TRowId[],
    [indexedSnapshot.selection.rows, rowModelSnapshot],
  );

  // The late-bound half of `exportCsv`, declared above the values it reads.
  // No dependency list on purpose: `csvOptions`/`onExport`/`saveFile` are
  // typically passed inline, so any list built from them would rebuild every
  // render anyway, and this only has to be current before an event handler
  // reads it. `useInsertionEffect` rather than a render-phase assignment so a
  // discarded concurrent render cannot publish its values.
  useInsertionEffect(() => {
    exportContextRef.current = {
      columns: columnsInVisualOrder,
      scope: dataScope,
      selectedRowIds,
      locale,
      csvOptions,
      onExport,
      saveFile,
      messages: effectiveMessages,
    };
  });

  // Fire only when the set actually changes. Selection is recomputed on every
  // render (and on every poll that hands down new rows), so a plain effect
  // dependency would call the consumer back constantly.
  const lastSelectedKeyRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    // Read the ENGINE, not the render-phase memo above. A controlled
    // `state.rowSelection` is written by an earlier effect of this same commit,
    // so the memo is a render behind it — priming this ref from the memo would
    // report a freshly mounted controlled selection straight back at the
    // consumer as though a user had ticked it.
    const rows = indexedGrid.getState().selection.rows;
    const rowIds = orderedSelectedRowIds(rows, (rowId) =>
      rowModelSnapshot.indexOf({ kind: "data", rowId }),
    ) as TRowId[];
    const key = selectedRowIdsKey(rows.kind, rowIds);
    const previous = lastSelectedKeyRef.current;
    lastSelectedKeyRef.current = key;
    // Skip the first pass: nothing has changed yet, and a consumer that
    // injected a selection through `state` already knows what it set.
    if (previous === null || previous === key) return;
    // A symbolic "all" is silent, as the header checkbox has always been:
    // select-all records "every row" rather than a list, so `rowIds` is empty
    // and firing would announce "nothing is selected" about a grid where
    // everything is. The `kind` in the key is what makes that a SKIP rather
    // than a miss — without it, ticking a row and then selecting all reads as
    // a change from `["b"]` to `[]`.
    if (rows.kind === "all") return;
    onRowSelectionChange?.(rowIds);
  }, [
    indexedGrid,
    indexedSnapshot.selection.rows,
    onRowSelectionChange,
    rowModelSnapshot,
  ]);

  // Per-cell selection check. Materializing a 27k-key Set on Cmd+A was the
  // bottleneck — instead, scan the (typically ≤3) ranges per visible cell,
  // and only the ~18 actually-rendered cells call this.
  const isCellSelected = useCallback(
    (rowId: PretableRowId, columnId: string): boolean => {
      const ranges = snapshot.selection.ranges;
      // The SEPARATE sparse row-selection program the checkbox column drives.
      // It never depended on a range's endpoints resolving and is untouched by
      // eviction; it stays exactly where it was, ahead of everything below.
      if (indexedGrid.isRowSelected(rowId)) return true;
      if (ranges.length === 0) return false;
      // The synthetic row-select cell is never painted as part of a cell
      // range, only as a checkbox — the guard the old `idxById` lookup did.
      if (dataColumnIndex.idxById.get(columnId) === undefined) return false;
      const ref = { kind: "data", rowId } as const;
      for (const range of ranges) {
        // Containment on DATASET position, not on `indexOf`. Resolving both
        // endpoints in the snapshot used to be a precondition, so a range
        // whose endpoints had been evicted painted nothing at all — including
        // for the loaded rows in the middle of its span.
        if (
          rangeContainsCell(
            inflateIndexedRange(range),
            ref,
            columnId,
            rowModelSnapshot,
            dataColumnIndex.rangeColumnIds,
            selectionWindow,
          )
        ) {
          return true;
        }
      }
      return false;
    },
    [
      dataColumnIndex,
      indexedGrid,
      rowModelSnapshot,
      selectionWindow,
      snapshot.selection.ranges,
    ],
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
    onGridReady?.(surfaceGrid);
  }, [onGridReady, surfaceGrid]);

  useLayoutEffect(() => {
    const request = pendingGroupingFocusRef.current;
    if (request === null) return;
    if (!groupingListsEqual(snapshot.rowGroups, request.expectedRowGroups)) {
      return;
    }

    const requestedNode =
      request.intent.target === "chip"
        ? Array.from(
            groupPanelRef.current?.querySelectorAll<HTMLElement>(
              "[data-pretable-group-chip]",
            ) ?? [],
          ).find(
            (node) =>
              node.getAttribute("data-pretable-column-id") ===
              request.intent.columnId,
          )
        : columnMenuButtonNodesRef.current.get(request.intent.columnId);

    if (!requestedNode?.isConnected) return;
    pendingGroupingFocusRef.current = null;
    requestedNode.focus(
      request.intent.target === "chip" ? { preventScroll: true } : undefined,
    );
  });

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
  useLayoutEffect(() => {
    // The cursor's cell was torn out of the DOM in the commit this effect is
    // running for — an evicted row, or an ordinary scroll past the
    // virtualization window. The browser has already dropped focus to
    // `<body>`; park it on the scroll viewport instead, which is focusable,
    // owns the keydown handler and keeps a screen reader inside the grid's
    // `role="grid"` container. Done before the null-focus bail-out below,
    // because "the row was deleted, so the engine cleared the cursor" is
    // exactly a case where focus must still not be left on `<body>`.
    const lostToUnmount = focusLostToUnmountRef.current;
    focusLostToUnmountRef.current = false;
    if (lostToUnmount) {
      const viewport = viewportRef.current;
      const active = viewport?.ownerDocument.activeElement ?? null;
      if (
        viewport !== null &&
        viewport.isConnected &&
        // Nothing has claimed focus in between — if something has, it is
        // theirs and taking it would be the theft this whole effect avoids.
        (active === null || active === viewport.ownerDocument.body)
      ) {
        viewport.focus({ preventScroll: true });
      }
    }

    const focusedRef = snapshot.focus.ref;
    if (focusedRef === null || focusedColumnId === null) {
      focusFollowAddressRef.current = null;
      pendingFocusFollowRef.current = null;
      return;
    }

    const address = `${visibleRowRefKey(focusedRef)}::${focusedColumnId}`;

    if (focusFollowAddressRef.current !== address) {
      focusFollowAddressRef.current = address;
      pendingFocusFollowRef.current = address;
    } else if (lostToUnmount) {
      // Same address, but the node that was holding it is gone: re-arm, so the
      // cursor takes its cell back the moment the row is rendered again. This
      // is what makes a retained focus ref (see `reconcileIndexedFocus`) show
      // up as real DOM focus when the rows return, rather than as an attribute
      // nobody acts on.
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

    // A header cursor's node is the column-header `<button>`, which is not in
    // `renderSnapshot.rows` and never will be — the header is not a row.
    // Looking it up in its own registry is what makes ArrowUp off the first row
    // move REAL focus onto the header, rather than moving only the roving
    // `tabIndex` and the ring while `document.activeElement` stayed behind on
    // the data cell.
    const rendered =
      focusedRef.kind === "header"
        ? undefined
        : renderSnapshot.rows.find((row) =>
            visibleRowRefsEqual(row.ref, focusedRef),
          );
    const cellNode =
      focusedRef.kind === "header"
        ? headerCellNodesRef.current.get(focusedColumnId)
        : rendered === undefined
          ? undefined
          : cellNodesRef.current.get(`${rendered.id}::${focusedColumnId}`);

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
    snapshot.focus.ref,
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
    /**
     * `visibleRowRefKey(focus.ref)`, not the flat `rowId`.
     *
     * A header cursor HAS no `rowId` — see the facade snapshot's derivation —
     * so keying this on one would take the `null` bail below and skip the
     * HORIZONTAL reveal, which the header needs just as much as the body:
     * arrowing right along the header must bring the column into view.
     */
    refKey: string;
    columnId: string;
    /** `scrollTop` writes made for this address; see MAX_SCROLL_REVEAL_WRITES. */
    writes: number;
    /** Vertically resolved — nothing this effect can usefully do any more. */
    settled: boolean;
  } | null>(null);
  const scrollRevealColumnIdRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    const el = viewportRef.current;
    const revealRef = snapshot.focus.ref;

    if (!el || revealRef === null || focusedColumnId === null) {
      scrollRevealRef.current = null;
      scrollRevealColumnIdRef.current = null;
      return;
    }
    const revealRefKey = visibleRowRefKey(revealRef);

    // Runs on focus changes AND on every subsequent layout pass for the same
    // address, which is what lets a distant target be re-asserted once its
    // real height is measured. Everything below hinges on `pending` carrying
    // over across those passes: once an address is satisfied it is marked
    // settled and never scrolls again, so a user who scrolls the focused cell
    // out of view is not yanked back on the next measurement or row update.
    const previous = scrollRevealRef.current;
    const pending =
      previous !== null &&
      previous.refKey === revealRefKey &&
      previous.columnId === focusedColumnId
        ? previous
        : {
            refKey: revealRefKey,
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

    // Vertical reveal only. The HORIZONTAL block above already ran, and must
    // have: arrowing right along the header scrolls the column into view
    // exactly as it does in the body.
    //
    // Vertically there is nothing to do — the header is sticky, so it is on
    // screen at every offset. Settling says so. Falling through to `indexOf`
    // would answer -1, which the branch below reads as "the row has not
    // streamed in yet" and deliberately does NOT settle, so a header cursor
    // would re-run this whole effect on every layout pass for as long as it
    // sat there.
    if (revealRef.kind === "header") {
      pending.settled = true;
      return;
    }
    const targetIndex = rowModelSnapshot.indexOf(revealRef);

    if (targetIndex < 0) {
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
      // `rowMetrics` is LOCAL to the loaded window while `el.scrollTop` is
      // GLOBAL, and `scrollTopToReveal` compares the two directly (and clamps
      // against `rowMetrics.getTotalHeight()`). Cross into its space on the way
      // in and back out on the way down — see `leadingHeight` on the render
      // snapshot. On a non-windowed grid this term is 0 and both lines are
      // identities.
      scrollTop: toLocalRowOffset(el.scrollTop, renderSnapshot.leadingHeight),
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
    el.scrollTop = toGlobalScrollTop(
      nextScrollTop,
      renderSnapshot.leadingHeight,
    );
  }, [
    bodyViewportHeight,
    columnLayout,
    focusedColumnId,
    focusedRowId,
    snapshot.focus.ref,
    // `renderSnapshot` is rebuilt whenever `measuredHeights` changes, which is
    // the signal the convergence re-assert waits for.
    renderSnapshot,
    viewportWidth,
    rowModelSnapshot,
  ]);

  useLayoutEffect(() => {
    const injectedSelectedRowId =
      state?.selection?.ranges[0]?.startRowId ?? null;

    if (injectedSelectedRowId === null) {
      return;
    }

    const currentSelectedRowId =
      snapshot.selection.ranges[0]?.startRowId ?? null;

    if (currentSelectedRowId !== injectedSelectedRowId) {
      onSelectedRowIdChange?.(injectedSelectedRowId as TRowId);
    }
  }, [state, onSelectedRowIdChange, snapshot.selection.ranges]);

  useLayoutEffect(() => {
    let nextKeys = measuredRowKeysRef.current;

    for (const [renderId, node] of rowNodesRef.current) {
      const rendered = renderSnapshot.rows.find((row) => row.id === renderId);
      if (rendered === undefined) continue;
      const plannedHeight = Number(
        node.getAttribute("data-pretable-row-height"),
      );
      const currentRowKey = getRowMeasurementKey(node, rowHeightFloor);
      const cachedRowKey = nextKeys[renderId];

      if (Number.isFinite(plannedHeight) && cachedRowKey === currentRowKey) {
        continue;
      }

      const measuredHeight = measureRenderedRowHeight(node, rowHeightFloor);
      indexedGrid.measureRow(rendered.ref, measuredHeight);
      nextKeys = { ...nextKeys, [renderId]: currentRowKey };
    }

    measuredRowKeysRef.current = nextKeys;
    // Runs after every render: row heights depend on the full rendered output
    // (row/cell classes from getRowClassName, cell content, etc.), not just the
    // grid snapshot — and a render-prop change can alter height without changing
    // any row data. The per-row key+height check above skips unchanged rows, and
    // measureRenderedRowHeight is idempotent (it measures intrinsic content, not
    // the stretched box), so controller publication converges even under
    // high-churn streaming with wrap:true rows.
  });

  // ---------------------------------------------------------------------
  // Keyboard ENTRY: the roving tab stop when the engine has no focus address.
  //
  // The roving-tabindex pattern gives `tabIndex={0}` to the focused cell and
  // `-1` to every other one. That is correct once focus exists — but the engine
  // starts at `{ref: null, columnId: null}` and nothing seeds it without a
  // pointer event, so before this existed EVERY cell resolved to `-1`. Measured
  // cold, on the keyboard docs page: `tabindexZeroCount: 0` against
  // `gridcellCount: 96`, with the viewport itself at `tabIndex={-1}`. Tabbing
  // in from before the grid walked the 16 header buttons and straight out the
  // other side in Chromium, and skipped the grid entirely in WebKit. There was
  // no keyboard route to a data cell at all — not "until first interaction",
  // since no keyboard interaction could produce the first interaction.
  //
  // The fix is deliberately about being TABBABLE, not about having focus: the
  // first rendered cell gets the 0 while the engine's focus state stays null.
  // Seeding engine focus on mount instead would fire `onFocusChange` and run
  // scroll-into-view on page load, for a grid nobody has touched yet.
  //
  // Same treatment when a focus address exists but its cell is not rendered —
  // the user scrolled it out of the virtualization window — since otherwise the
  // grid silently loses its tab stop again for as long as it is off-screen.
  //
  // The row-select column is skipped for the same reason arrow keys snap off
  // it (see `handleSurfaceKeyDown`): it is a synthetic UI column, not a cell
  // the keyboard model treats as an address.
  const keyboardEntryTabStop = useMemo(() => {
    const focusedRef = snapshot.focus.ref;
    const focusedColumn = snapshot.focus.columnId;
    const focusIsRendered =
      focusedRef !== null &&
      focusedColumn !== null &&
      renderSnapshot.columns.some((col) => col.id === focusedColumn) &&
      // A HEADER address is rendered whenever its column is: the header row is
      // never virtualized away. Without this clause the header cursor would
      // fail the rows-contain-the-ref test below — no `renderSnapshot.rows`
      // entry can ever match it — and the fallback would hand a SECOND
      // `tabIndex={0}` to the first data cell while the header held one too.
      // That is the ten-tab-stops bug in miniature: two stops, not one.
      (focusedRef.kind === "header" ||
        renderSnapshot.rows.some((row) =>
          visibleRowRefsEqual(row.ref, focusedRef),
        ));
    if (focusIsRendered) return null;

    const firstRow = renderSnapshot.rows[0];
    const firstColumn = renderSnapshot.columns.find(
      (col) => col.id !== ROW_SELECT_COLUMN_ID,
    );
    if (firstRow === undefined || firstColumn === undefined) return null;
    return { renderId: firstRow.id, columnId: firstColumn.id };
  }, [
    renderSnapshot.columns,
    renderSnapshot.rows,
    snapshot.focus.columnId,
    snapshot.focus.ref,
  ]);

  // A pointer press moves DOM focus as its own default action, and the cell's
  // `onPointerDown` / `onClick` already own the engine's focus address for that
  // gesture (including the shift- and cmd-click range paths, which deliberately
  // route through `onClick`). The entry handler below must not race them, so it
  // stands down for the duration of a press. Cleared on a macrotask rather than
  // on `click` because a pointerdown does not always produce one.
  const pointerFocusRef = useRef(false);

  const scrollViewport = (
    <div
      aria-colcount={drawnColumns.length}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      aria-multiselectable="true"
      aria-rowcount={ariaRowCount}
      data-pretable-data-phase={dataState?.phase}
      data-pretable-hydrated={hydrated ? "true" : "false"}
      data-pretable-scroll-viewport=""
      ref={viewportRef}
      // A grouped grid IS a tree, and the role is what makes Left/Right
      // expand/collapse discoverable to a screen-reader user rather than an
      // undocumented convention. It reverts the moment grouping clears.
      role={isGrouped ? "treegrid" : "grid"}
      tabIndex={-1}
      onPointerDown={() => {
        pointerFocusRef.current = true;
        setTimeout(() => {
          pointerFocusRef.current = false;
        }, 0);
      }}
      onFocus={(event) => {
        // Keyboard ENTRY. `keyboardEntryTabStop` made a cell tabbable without
        // claiming the engine's focus address; this is the moment the user
        // actually arrives on it, and the address has to catch up or the first
        // arrow key would move relative to nothing.
        //
        // Guarded to keyboard arrivals only. React's `onFocus` is delegated
        // from `focusin`, so it fires for pointer presses too — and a pointer
        // press fires `focus` BEFORE the `click` that shift-extends a range,
        // which would let this seed a plain focus address underneath a gesture
        // that was mid-way through meaning something else.
        if (pointerFocusRef.current) return;
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const cell = target.closest<HTMLElement>("[data-pretable-cell]");
        // Header sort/filter buttons live inside the viewport for layout, and
        // are not cells. Focusing one is not entering the body grid.
        if (cell === null) return;
        const columnId = cell.getAttribute("data-pretable-column-id");
        if (columnId === null || columnId === ROW_SELECT_COLUMN_ID) return;
        // Resolve the node back to a row REF rather than parsing an id out of
        // the DOM: a group row's address is a `groupId`, not a `rowId`, and
        // only the render snapshot knows which kind this row is.
        const entryRow = renderSnapshot.rows.find(
          (row) => cellNodesRef.current.get(`${row.id}::${columnId}`) === cell,
        );
        if (entryRow === undefined) return;
        const current = grid.getSnapshot().focus as PretableFocusState & {
          readonly ref: PretableIndexedFocusRef<PretableRowId> | null;
        };
        if (
          current.ref !== null &&
          current.columnId === columnId &&
          visibleRowRefsEqual(current.ref, entryRow.ref)
        ) {
          return;
        }
        setSurfaceFocusRef(
          grid as unknown as SurfaceFacade<TRow>,
          entryRow.ref,
          columnId,
        );
        emitFocusChange(entryRow.ref, columnId);
      }}
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
          dragPointerTargetRef.current = null;
          dragLastHoverKeyRef.current = null;
          if (dragFrameRef.current !== null) {
            cancelAnimationFrame(dragFrameRef.current);
            dragFrameRef.current = null;
          }
          dragRemoveListenersRef.current?.();
          dragRemoveListenersRef.current = null;
          const after = grid.getSnapshot();
          if (
            JSON.stringify(before.selection) !== JSON.stringify(after.selection)
          ) {
            emitSelectionChange(
              after.selection as unknown as PretableSelectionState,
            );
          }
          event.preventDefault();
          return;
        }

        // What belongs to the grid's navigation model and what belongs to a
        // control's own native behavior.
        //
        // A body cell always belongs to the grid. The HEADER now does too —
        // but only while the engine's cursor is actually on it. That condition
        // is doing real work in two directions:
        //
        //  - With the cursor on the header, keys reaching the header <button>
        //    (or a funnel/menu button that a popover just restored focus to)
        //    drive the grid: arrows move the cursor, Enter sorts, Escape
        //    behaves. Without it, ArrowDown off the header would fall through
        //    to the browser and do nothing at all.
        //  - With the cursor NOT on the header — a pointer user who clicked a
        //    funnel, say — the popover's own keyboard handling is left alone,
        //    which is what it was before the header joined the model.
        const targetIsCell =
          event.target instanceof Element &&
          event.target.closest("[data-pretable-cell]") !== null;
        const targetIsHeader =
          event.target instanceof Element &&
          event.target.closest("[data-pretable-header-row]") !== null;
        if (
          event.target !== event.currentTarget &&
          !targetIsCell &&
          !(targetIsHeader && snapshot.focus.ref?.kind === "header")
        ) {
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
          const currentSelection = indexedGrid.getState().selection;
          const copyColumns = columnsInVisualOrder.filter(
            (column) => column.id !== ROW_SELECT_COLUMN_ID,
          );
          const selectedRowRanges = (rowIds: readonly PretableRowId[]) =>
            rowIds
              .map((rowId) => ({
                rowId,
                index: rowModelSnapshot.indexOf({ kind: "data", rowId }),
              }))
              .filter((entry) => entry.index >= 0)
              .sort((left, right) => left.index - right.index)
              .map(({ rowId }) => ({
                start: {
                  rowId,
                  columnId: copyColumns[0]!.id,
                },
                end: {
                  rowId,
                  columnId: copyColumns.at(-1)!.id,
                },
              }));
          const copyRanges =
            currentSelection.ranges.length > 0
              ? currentSelection.ranges
              : currentSelection.rows.kind === "all" &&
                  copyColumns[0] !== undefined &&
                  copyColumns.at(-1) !== undefined
                ? selectedRowRanges(
                    Array.from(
                      { length: rowModelSnapshot.visibleDataRowCount },
                      (_, index) => rowModelSnapshot.dataRowAt(index)?.rowId,
                    ).filter(
                      (rowId): rowId is PretableRowId => rowId !== undefined,
                    ),
                  )
                : currentSelection.rows.kind === "explicit" &&
                    copyColumns[0] !== undefined &&
                    copyColumns.at(-1) !== undefined
                  ? selectedRowRanges([...currentSelection.rows.rowIds])
                  : [];
          if (copyRanges.length === 0) {
            return;
          }
          const args: SerializeRangesArgs<
            TRow,
            PretableRowId,
            readonly PretableColumn<TRow>[]
          > = {
            ranges: copyRanges,
            rowModelSnapshot,
            // Drawn order, not the prop's: a range is bounded by the columns
            // the user highlighted, and resolving those bounds against the
            // declaration order after a reorder both reorders the TSV and
            // changes which columns fall inside the range.
            columns: columnsInVisualOrder,
            copyWithHeaders: copyWithHeaders ?? false,
            locale,
            scope: dataScope,
          };
          const payload = onCopy
            ? onCopy(
                args as unknown as SerializeRangesArgs<TRow, TRowId, TColumns>,
              )
            : serializeRangesWithNumberFormatters(args, numberFormatters);
          if (payload) {
            const extent = computeSelectionExtent(
              copyRanges,
              rowModelSnapshot,
              columnsInVisualOrder,
              selectionWindow,
            );
            // Same two fixes as `exportCsv`, and see its comment for why. The
            // synchronous call matters more here than there: `writeText` IS
            // transient-activation gated, so deferring it even one microtask
            // would put the clipboard write outside the keystroke that earned
            // the permission.
            const announceCopyFailure = (err: unknown) => {
              console.warn("[pretable] clipboard copy failed", err);
              scheduleAnnouncement(effectiveMessages.copyFailedAnnouncement());
            };
            let write: void | Promise<void>;
            try {
              write = (copyToClipboard ?? defaultCopyToClipboard)(payload);
            } catch (err) {
              announceCopyFailure(err);
              return;
            }
            Promise.resolve(write).then(() => {
              try {
                scheduleAnnouncement(
                  effectiveMessages.copyAnnouncement({
                    rowCount: extent.rowCount,
                    columnCount: extent.columnCount,
                    scope: dataScope,
                  }),
                );
              } catch (err) {
                console.warn(
                  "[pretable] clipboard announcement failed; the copy succeeded",
                  err,
                );
              }
            }, announceCopyFailure);
          }
          return;
        }

        // Begin-edit triggers (Enter / F2 / type-to-replace). Only when no edit
        // is active and the focused cell's column is editable; otherwise fall
        // through so Enter/Space keep their row-selection behavior. When an edit
        // IS active the editor input owns keystrokes (Enter/Tab/Escape are
        // stop-propagated inside CellEditor), so this handler is not reached.
        if (!snapshot.editing) {
          // Editing entry (Enter / F2 / type-to-replace). A HEADER cursor is
          // `-1` — there is no cell under it to edit — so `focusAddr` stays
          // null and every begin-edit trigger below declines. That is what
          // stops a printable key on the header from opening an editor on
          // whatever row the type test would otherwise have resolved.
          const focusedEntryIndex =
            snapshot.focus.ref === null || snapshot.focus.ref.kind === "header"
              ? -1
              : rowModelSnapshot.indexOf(snapshot.focus.ref);
          const focusedEntry =
            focusedEntryIndex < 0
              ? undefined
              : rowModelSnapshot.rowAt(focusedEntryIndex);
          const focusAddr: PretableCellAddress | null =
            snapshot.focus.rowId !== null &&
            snapshot.focus.columnId !== null &&
            focusedEntry &&
            focusedEntry.kind === "data"
              ? {
                  rowId: focusedEntry.rowId as unknown as string,
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
          grid: grid as unknown as SurfaceFacade<TRow>,
          rowModelSnapshot,
          onRowActivate: onRowActivate as
            ((input: PretableRowActivateInput<TRow>) => void) | undefined,
          onSelectedRowIdChange: onSelectedRowIdChange as
            ((rowId: string | null) => void) | undefined,
          openHeaderPopover,
          selectFocusedRowOnArrowKey,
          tabBehavior,
        });

        if (handled) {
          event.preventDefault();
          const after = grid.getSnapshot();
          if (isSelectAll) {
            const indexedSelection = indexedGrid.getState().selection;
            const rowSummary = indexedGrid.getSelectionSummary();
            const extent =
              indexedSelection.rows.kind === "all"
                ? {
                    rowCount: rowSummary.selectedCount,
                    columnCount: columnsInVisualOrder.length,
                    isAll: rowSummary.state === "all",
                  }
                : computeSelectionExtent(
                    indexedSelection.ranges,
                    rowModelSnapshot,
                    columnsInVisualOrder,
                    selectionWindow,
                  );
            scheduleAnnouncement(
              effectiveMessages.selectAllAnnouncement({
                rowCount: extent.rowCount,
                columnCount: extent.columnCount,
                isAll: extent.isAll,
                scope: dataScope,
                loadedCount: rowModelSnapshot.sourceRowCount,
                ...(matchingTotal.kind === "exact"
                  ? { total: matchingTotal.count }
                  : {}),
              }),
            );
          }
          if (surfaceFocusChanged(before.focus, after.focus)) {
            const afterFocus = after.focus as PretableFocusState & {
              readonly ref: PretableIndexedFocusRef<PretableRowId> | null;
            };
            emitFocusChange(afterFocus.ref, afterFocus.columnId);
          }
          if (
            JSON.stringify(before.selection) !== JSON.stringify(after.selection)
          ) {
            emitSelectionChange(
              after.selection as unknown as PretableSelectionState,
            );
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
        ...getViewportStyle(scrollViewportHeight),
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
            const selectionSummary = indexedGrid.getSelectionSummary();
            const dataRowCount = selectionSummary.visibleCount;
            const fullyCount = selectionSummary.selectedCount;
            const anySelected = fullyCount > 0;
            const allFullySelected =
              dataRowCount > 0 && fullyCount === dataRowCount;
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
                    aria-label={effectiveMessages.selectAllLabel({
                      scope: dataScope,
                    })}
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
                        emitSelectionChange(
                          after.selection as unknown as PretableSelectionState,
                        );
                      }
                      if (setting) {
                        const indexedSelection =
                          indexedGrid.getState().selection;
                        const rowSummary = indexedGrid.getSelectionSummary();
                        const extent =
                          indexedSelection.rows.kind === "all"
                            ? {
                                rowCount: rowSummary.selectedCount,
                                columnCount: columnsInVisualOrder.length,
                                isAll: rowSummary.state === "all",
                              }
                            : computeSelectionExtent(
                                indexedSelection.ranges,
                                rowModelSnapshot,
                                columnsInVisualOrder,
                                selectionWindow,
                              );
                        scheduleAnnouncement(
                          effectiveMessages.selectAllAnnouncement({
                            rowCount: extent.rowCount,
                            columnCount: extent.columnCount,
                            isAll: extent.isAll,
                            scope: dataScope,
                            loadedCount: rowModelSnapshot.sourceRowCount,
                            ...(matchingTotal.kind === "exact"
                              ? { total: matchingTotal.count }
                              : {}),
                          }),
                        );
                      }
                    }}
                    role="checkbox"
                    type="button"
                  >
                    {headerCheckState === "true" ? (
                      <CheckIcon />
                    ) : headerCheckState === "mixed" ? (
                      <MinusIcon />
                    ) : null}
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
              // The drawn order is resolved by the ENGINE at runtime, so a
              // drawn id is a bare `string` here. Re-tag it as what it is —
              // a schema id or one of the two synthetic ids — rather than
              // `as never`, which would keep compiling if this callback's
              // parameter changed to something unrelated.
              columnId:
                column.id as PretableSurfaceInteractionColumnId<TColumns>,
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
          // The menu's only items are grouping ones, so it is offered exactly
          // where grouping is: with the panel enabled, on a real data column.
          // The derived group column is excluded (grouping the tree column by
          // itself is meaningless) and so is the row-select checkbox column.
          const showColumnMenu =
            groupPanelEnabled &&
            column.id !== GROUP_COLUMN_ID &&
            column.id !== ROW_SELECT_COLUMN_ID;
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

          // The header's half of the roving tabindex. Every header cell is
          // `-1` unless the engine's cursor is on THIS one — the same rule the
          // body cells follow, and the reason a five-column grid is one tab
          // stop rather than ten.
          //
          // There is deliberately no entry fallback here (the body has one,
          // `keyboardEntryTabStop`). Exactly one of the two regions may hold
          // the fallback or the grid is two stops again, and the body is the
          // right one to hold it: an untouched grid should hand a Tab press a
          // data cell, not a sort button.
          const headerIsFocused =
            snapshot.focus.ref?.kind === "header" &&
            snapshot.focus.columnId === column.id;

          return [
            <button
              {...headerProps}
              aria-colindex={plannedCol.index + 1}
              aria-label={`Sort ${label}`}
              aria-sort={ariaSort}
              className={getHeaderCellClassName?.({
                columnId:
                  column.id as PretableSurfaceInteractionColumnId<TColumns>,
                column,
                sortDirection,
                pinned: plannedCol.pinned ?? null,
              })}
              data-pretable-header-cell=""
              data-pretable-column-id={column.id}
              data-pretable-column-type={column.type}
              data-pretable-column-align={resolveColumnAlign(column)}
              data-pretable-focused={headerIsFocused ? "true" : "false"}
              data-pretable-pinned={plannedCol.pinned}
              key={column.id}
              ref={(node) => registerHeaderCell(column.id, node)}
              role="columnheader"
              tabIndex={headerIsFocused ? 0 : -1}
              onFocus={() => {
                // Seeds the engine when DOM focus arrives here without the
                // engine having sent it — a pointer press on the header, or a
                // popover restoring focus to its anchor. Without this, clicking
                // a header and then pressing ArrowDown would move relative to
                // wherever the cursor happened to be last, which is not where
                // the user is looking.
                //
                // A no-op when the engine already holds this address, which is
                // the common case: the focus-follow effect calls `.focus()`
                // here precisely because the cursor moved to it.
                const current = grid.getSnapshot().focus;
                if (
                  current.ref?.kind === "header" &&
                  current.columnId === column.id
                ) {
                  return;
                }
                setSurfaceFocusRef(
                  grid as unknown as SurfaceFacade<TRow>,
                  HEADER_FOCUS_REF,
                  column.id,
                );
                emitFocusChange(HEADER_FOCUS_REF, column.id);
              }}
              onClick={(event) => {
                if (wasReorderingRef.current) {
                  event.preventDefault();
                  wasReorderingRef.current = false;
                  return;
                }
                if (column.sortable === false) {
                  return;
                }
                let nextSort: PretableSortEntry[];
                const current = grid.getSnapshot().sort;
                if (event.shiftKey) {
                  // Shift-click mirrors the plain-click cycle per column:
                  // absent → append desc; desc → flip to asc in place;
                  // asc → remove just this entry (others keep positions).
                  const idx = current.findIndex(
                    (entry) => entry.columnId === column.id,
                  );
                  if (idx === -1) {
                    nextSort = [
                      ...current,
                      { columnId: column.id, direction: "desc" },
                    ];
                  } else if (current[idx].direction === "desc") {
                    nextSort = current.map((entry, i) =>
                      i === idx
                        ? { ...entry, direction: "asc" as const }
                        : entry,
                    );
                  } else {
                    nextSort = current.filter((_, i) => i !== idx);
                  }
                  grid.replaceSort(nextSort);
                } else {
                  const currentDirection =
                    current.find((entry) => entry.columnId === column.id)
                      ?.direction ?? null;
                  const nextDirection = getNextSortDirection(currentDirection);
                  nextSort =
                    nextDirection === null
                      ? []
                      : [{ columnId: column.id, direction: nextDirection }];
                  grid.setSort(column.id, nextDirection);
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

                      // The scrollport is measured on every move rather than
                      // read from state: scrollLeft changes without a React
                      // render (wheel, trackpad, scrollbar), and a stale offset
                      // would put the drop index a scroll-distance away from
                      // the cursor.
                      const scrollport = viewportRef.current;
                      const target = computeColumnDropTarget({
                        layout: columnLayout.columns,
                        // Indices in DRAWN space, matching `columnLayout`.
                        // `onPointerUp` translates the drop index back to an
                        // `options.columns` index for `moveColumn`.
                        draggedIndex: drawnColumns.findIndex(
                          (c) => c.id === column.id,
                        ),
                        cursorX: event.clientX,
                        viewportLeft:
                          scrollport?.getBoundingClientRect().left ?? 0,
                        viewportWidth: scrollport?.clientWidth ?? 0,
                        scrollLeft: scrollport?.scrollLeft ?? 0,
                      });

                      // The second drop zone. `groupPanelRef` is null unless a
                      // panel is rendered, and the hit test rejects a hidden or
                      // zero-size one, so a collapsed panel cannot swallow a
                      // drop meant for the header underneath it.
                      const panelHit =
                        column.id === GROUP_COLUMN_ID
                          ? null
                          : hitTestGroupPanel(
                              groupPanelRef.current,
                              event.clientX,
                              event.clientY,
                            );
                      const groupInsertIndex = panelHit?.insertIndex ?? null;

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
                          groupInsertIndex,
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
                              groupInsertIndex,
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
                        // The trailing click must not sort either way — this
                        // gesture was a drag, whichever zone it ended in.
                        wasReorderingRef.current = true;
                      }
                      if (
                        drag.dragging &&
                        current &&
                        current.groupInsertIndex !== null
                      ) {
                        // Dropped on the panel: group, and do NOT also move the
                        // column. This is the only place in the drag that
                        // mutates grouping — nothing ran on drag-enter or
                        // drag-leave, so Escape had something to cancel right
                        // up to this instant.
                        applyRowGroups(
                          insertGroupLevel(
                            snapshot.rowGroups,
                            column.id,
                            current.groupInsertIndex,
                          ),
                        );
                      } else if (drag.dragging && current) {
                        const beforePinned = buildPinnedMap(
                          grid as unknown as SurfaceFacade<TRow>,
                        );
                        grid.moveColumn(
                          column.id,
                          toEngineDropIndex(
                            drawnColumns,
                            grid.getColumns(),
                            column.id,
                            current.dropIndex,
                          ),
                        );
                        const afterOrder = grid
                          .getColumns()
                          .map((c) => c.id)
                          .filter((id) => id !== ROW_SELECT_COLUMN_ID);
                        onColumnOrderChange?.(
                          afterOrder as PretableSurfaceInteractionColumnId<TColumns>[],
                        );
                        const afterPinned = buildPinnedMap(
                          grid as unknown as SurfaceFacade<TRow>,
                        );
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
              //
              // Color is deliberately NOT here. It is skin, and inline would
              // beat `--pretable-text-header`; the skin resets the button's UA
              // color along with setting the token, the same way it does the
              // button border.
              style={{
                alignItems: "center",
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
                        columnId: string;
                        column: PretableColumn<PretableRow>;
                        label: string;
                        sortDirection: "asc" | "desc" | null;
                        pinned: "left" | "right" | null;
                      }) => ReactNode)
                    | undefined) ?? null
                }
                headerRenderInput={
                  {
                    columnId: column.id,
                    column,
                    label,
                    sortDirection,
                    isSorted: sortDirection !== null,
                    pinned: plannedCol.pinned ?? null,
                  } as unknown as PretableHeaderRenderInput<PretableRow>
                }
              />
            </button>,
            showResizeHandle || showFilterFunnel || showColumnMenu ? (
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
                      onColumnWidthsChange?.(
                        buildWidthsMap(grid as unknown as SurfaceFacade<TRow>),
                      );
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
                      grid.autosizeColumn();
                      onColumnWidthsChange?.(
                        buildWidthsMap(grid as unknown as SurfaceFacade<TRow>),
                      );
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
                      // 22px back from the trailing edge on a fine pointer —
                      // immediately left of the 4px resize strip — and 24px
                      // back on a coarse one, where there is no strip.
                      //
                      // A token rather than the literal because an inline style
                      // beats every stylesheet rule, `!important` and `@layer`
                      // included, so while this was `-22` no media query could
                      // re-space it. @pretable/ui declares both values (see the
                      // header overlay slot geometry in grid.css); the anchor
                      // arithmetic stays here.
                      left: "var(--pretable-header-funnel-slot)",
                    }}
                  >
                    <FunnelButton
                      columnId={column.id}
                      label={label}
                      active={Boolean(snapshot.filters[column.id])}
                      open={filterOpenState?.columnId === column.id}
                      onToggle={(id, anchor) =>
                        togglePopover("filter", id, anchor)
                      }
                    />
                  </div>
                ) : null}
                {showColumnMenu ? (
                  <div
                    data-pretable-column-menu-slot=""
                    style={{
                      position: "absolute",
                      top: 0,
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      // Counted back from the trailing edge like the funnel:
                      // the resize strip, then the 18px funnel when there is
                      // one, then this. Tokens for the same reason — see the
                      // funnel slot above.
                      //
                      // With no funnel the menu takes the funnel's OWN slot
                      // rather than a third token: it is the same position, and
                      // a duplicate token would be one more thing a theme could
                      // set inconsistently.
                      left: showFilterFunnel
                        ? "var(--pretable-header-menu-slot)"
                        : "var(--pretable-header-funnel-slot)",
                    }}
                  >
                    <MenuButton
                      columnId={column.id}
                      label={label}
                      open={menuOpenState?.columnId === column.id}
                      onNodeChange={registerColumnMenuButton}
                      onToggle={(id, anchor) =>
                        togglePopover("menu", id, anchor)
                      }
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
        style={
          {
            ...getScrollContentStyle(
              renderSnapshot.totalHeight,
              renderSnapshot.totalWidth,
            ),
            // Every data row sits at the full grouping depth, so the leaf
            // indent is one value for the whole body — set it once here and let
            // it inherit. Group cells write their own `--pretable-group-depth`
            // inline, which shadows this for that cell only.
            "--pretable-group-depth": snapshot.rowGroups.length,
          } as CSSProperties
        }
      >
        {renderSnapshot.rows.map((renderRow) => {
          if (renderRow.kind === "group") {
            const group = renderRow.group;

            return (
              <GroupRow
                columns={renderSnapshot.columns}
                columnsById={columnsById}
                expanded={group.expanded}
                focusedColumnId={snapshot.focus.columnId}
                group={group}
                height={renderRow.height}
                numberFormatters={numberFormatters}
                scope={dataScope}
                formatChildCount={effectiveMessages.groupChildCountLabel}
                isFocused={
                  snapshot.focus.ref?.kind === "group" &&
                  snapshot.focus.ref.groupId === group.groupId
                }
                key={renderRow.id}
                liveWidth={dragLiveWidth}
                onCellClick={(columnId, event) => {
                  event.preventDefault();
                  indexedGrid.setFocus({
                    ref: renderRow.ref,
                    columnId: columnId,
                  });
                  emitFocusChange(renderRow.ref, columnId);
                }}
                onToggle={() => {
                  grid.toggleGroup(group.groupId);
                }}
                registerCell={registerCell}
                renderId={renderRow.id}
                rowIndex={renderRow.rowIndex}
                top={renderRow.top}
                viewportWidth={viewportWidth}
              />
            );
          }

          if (renderRow.ref.kind !== "data") return null;
          const { height, id, row, rowIndex, top } = renderRow;
          const rowId = renderRow.ref.rowId;
          const isFocused =
            snapshot.focus.ref?.kind === "data" &&
            snapshot.focus.ref.rowId === rowId;
          const isSelected = fullySelectedRowIds.has(rowId);
          const rowProps =
            getRowProps?.({
              isFocused,
              isSelected,
              row,
              rowId: rowId as TRowId,
              rowIndex,
            }) ?? {};

          return (
            <div
              {...rowProps}
              aria-rowindex={rowIndexOffset + rowIndex + 2}
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
                onRowActivate({ row, rowId: rowId as TRowId, rowIndex });
              }}
              aria-selected={isSelected ? "true" : undefined}
              className={getRowClassName?.({
                isFocused,
                isSelected,
                row,
                rowId: rowId as TRowId,
                rowIndex,
              })}
              data-pretable-focused={isFocused ? "true" : "false"}
              data-pretable-row=""
              data-pretable-row-height={height}
              data-pretable-row-id={String(rowId)}
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
                // The roving `tabIndex={0}`. Normally the focused cell — but
                // when there is no focused cell to give it to (cold start, or
                // the focused row scrolled out of the render window) it falls
                // to the first rendered cell so the grid keeps exactly one tab
                // stop instead of none. See `keyboardEntryTabStop`.
                const cellIsTabStop =
                  cellIsFocused ||
                  (keyboardEntryTabStop !== null &&
                    keyboardEntryTabStop.renderId === id &&
                    keyboardEntryTabStop.columnId === column.id);
                const cellIsSelected = isCellSelected(rowId, column.id);
                const cellEdit =
                  snapshot.editing &&
                  snapshot.editing.rowId === rowId &&
                  snapshot.editing.columnId === column.id
                    ? snapshot.editing
                    : null;
                const formattedValue = formatDataCellValue({
                  value,
                  row,
                  column,
                  numberFormatters,
                  fallback: formatCellValue,
                });
                const bodyInput = {
                  columnId: column.id,
                  column,
                  formattedValue,
                  isFocused: cellIsFocused,
                  isSelected: cellIsSelected,
                  pinned: plannedCol.pinned ?? null,
                  row,
                  rowId,
                  rowIndex,
                  value,
                } as PretableSurfaceBodyCellInput<TRow, TRowId, TColumns>;
                const bodyProps = getBodyCellProps?.(bodyInput) ?? {};
                const cellEffWidth =
                  dragLiveWidth?.columnId === column.id
                    ? dragLiveWidth.width
                    : plannedCol.width;
                const positionStyle = getPositionedCellStyle(
                  plannedCol,
                  cellEffWidth,
                  viewportWidth,
                );

                const isRowSelectCell = column.id === ROW_SELECT_COLUMN_ID;
                const rowCheckState: "true" | "false" | "mixed" =
                  fullySelectedRowIds.has(rowId)
                    ? "true"
                    : indeterminateRowIds.has(rowId)
                      ? "mixed"
                      : "false";

                return (
                  <div
                    {...bodyProps}
                    aria-colindex={plannedCol.index + 1}
                    aria-selected={cellIsSelected ? "true" : undefined}
                    className={getBodyCellClassName?.(bodyInput)}
                    data-pretable-column-id={column.id}
                    data-pretable-column-type={column.type}
                    data-pretable-column-align={resolveColumnAlign(column)}
                    data-pretable-focused={cellIsFocused ? "true" : "false"}
                    data-pretable-pinned={plannedCol.pinned}
                    data-pretable-cell=""
                    data-pretable-wrap={column.wrap ? "true" : undefined}
                    // A data row's cell in the group column. It carries no
                    // value — it is the hook the stylesheet indents leaf
                    // content by one twisty-width so it lines up with sibling
                    // group labels instead of hanging a chevron to the left.
                    data-pretable-group-leaf={
                      column.id === GROUP_COLUMN_ID ? "" : undefined
                    }
                    data-pretable-row-select-cell={
                      isRowSelectCell ? "true" : undefined
                    }
                    data-pretable-selected={cellIsSelected ? "true" : "false"}
                    data-pretable-edit-status={cellEdit?.status}
                    key={`${id}:${column.id}`}
                    onClick={(event) => {
                      if (column.id === ROW_SELECT_COLUMN_ID) return;
                      // The click that ends a cross-cell drag must not
                      // collapse the range it just built. Whichever cell the
                      // drag physically ended over receives both the
                      // pointerup and the trailing click (there is no
                      // pointer capture retargeting either to the anchor
                      // now — see ./marquee-drag.ts) — so without this guard
                      // a plain-click reset would fire right after every
                      // marquee drag, on the cell the range was just
                      // extended to. Checked, not reset, here: the row's
                      // onClick (below) still needs to see this flag true
                      // to suppress `onRowActivate` for the very same click,
                      // and it runs after this handler in the same bubble —
                      // resetting here would blind it. The flag clears on
                      // the next pointerdown regardless of whether anything
                      // resets it in between.
                      if (dragExtendedRef.current) return;
                      handleCellClick({
                        cmd: event.metaKey || event.ctrlKey,
                        columnId: column.id,
                        columns: columnsInVisualOrder,
                        grid: grid as unknown as SurfaceFacade<TRow>,
                        onFocusChange: emitFocusChange,
                        onSelectedRowIdChange: onSelectedRowIdChange as
                          ((rowId: string | null) => void) | undefined,
                        onSelectionChange: emitSelectionChange,
                        rowId: rowId as unknown as string,
                        rowRef: renderRow.ref,
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
                          rowId: rowId as unknown as string,
                          columnId: column.id,
                        });
                      }
                    }}
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      if (column.id === ROW_SELECT_COLUMN_ID) return;
                      const cmd = event.metaKey || event.ctrlKey;
                      if (event.shiftKey || cmd) return;

                      dragStartSelectionRef.current = grid.getSnapshot()
                        .selection as unknown as PretableSelectionState;
                      dragExtendedRef.current = false;
                      dragAnchorRef.current = {
                        rowId: rowId as unknown as string,
                        columnId: column.id,
                      };
                      // Seeded to the anchor's own key so the first
                      // pointermove — which fires even for a sub-pixel jitter
                      // that never left the anchor cell — does not immediately
                      // re-run extension against the cell it is already at.
                      dragLastHoverKeyRef.current = `${rowId as unknown as string}::${column.id}`;
                      handleCellClick({
                        cmd: false,
                        columnId: column.id,
                        columns: columnsInVisualOrder,
                        grid: grid as unknown as SurfaceFacade<TRow>,
                        onFocusChange: emitFocusChange,
                        onSelectedRowIdChange: onSelectedRowIdChange as
                          ((rowId: string | null) => void) | undefined,
                        onSelectionChange: emitSelectionChange,
                        rowId: rowId as unknown as string,
                        rowRef: renderRow.ref,
                        shift: false,
                      });

                      // Deliberately NOT `event.currentTarget.setPointerCapture(...)`
                      // here — see ./marquee-drag.ts for why a multi-cell
                      // range drag cannot rely on capture retargeting
                      // behaving the same way across engines. Instead this
                      // attaches window-level listeners for the rest of the
                      // gesture: window listeners keep receiving events
                      // regardless of capture (so a release outside the
                      // grid, or even outside the document, still ends the
                      // drag), and with no capture engaged, `event.target`
                      // on those listeners is the real element under the
                      // pointer, which `cellAddressFromElement` can walk
                      // directly. `pointerId` is checked on every window
                      // event (capture used to give that scoping for free,
                      // by construction) so a second, unrelated pointer —
                      // e.g. a two-finger touch — cannot redirect or end a
                      // drag it did not start.
                      const { pointerId } = event;
                      const resolveHover = () => {
                        dragFrameRef.current = null;
                        if (!dragAnchorRef.current) return;
                        const addr = cellAddressFromElement(
                          dragPointerTargetRef.current,
                        );
                        // Nothing resolved — most commonly the pointer is
                        // over a non-cell part of the page (or the drag has
                        // run past the grid/window edge). Auto-scroll on
                        // that condition does not exist; the range simply
                        // holds at its last successfully resolved cell until
                        // the pointer comes back over a cell.
                        if (!addr) return;
                        const hoverKey = `${addr.rowId}::${addr.columnId}`;
                        if (hoverKey === dragLastHoverKeyRef.current) return;
                        dragLastHoverKeyRef.current = hoverKey;

                        dragExtendedRef.current = true;
                        if (addr.columnId === ROW_SELECT_COLUMN_ID) return;

                        const before = grid.getSnapshot();
                        grid.extendRangeFromAnchor(addr);
                        setSurfaceFocusRef(
                          grid as unknown as SurfaceFacade<TRow>,
                          {
                            kind: "data",
                            rowId: addr.rowId as unknown as PretableRowId,
                          },
                          addr.columnId,
                        );
                        const after = grid.getSnapshot();
                        if (surfaceFocusChanged(before.focus, after.focus)) {
                          const afterFocus =
                            after.focus as PretableFocusState & {
                              readonly ref: PretableIndexedFocusRef<PretableRowId> | null;
                            };
                          emitFocusChange(afterFocus.ref, afterFocus.columnId);
                        }
                        if (
                          JSON.stringify(before.selection) !==
                          JSON.stringify(after.selection)
                        ) {
                          emitSelectionChange(
                            after.selection as unknown as PretableSelectionState,
                          );
                          const beforeFullRow = singleFullRowSelection(
                            before.selection as unknown as PretableSelectionState,
                            columnsInVisualOrder.filter(
                              (c) => c.id !== ROW_SELECT_COLUMN_ID,
                            ),
                          );
                          const afterFullRow = singleFullRowSelection(
                            after.selection as unknown as PretableSelectionState,
                            columnsInVisualOrder.filter(
                              (c) => c.id !== ROW_SELECT_COLUMN_ID,
                            ),
                          );
                          if (beforeFullRow !== afterFullRow) {
                            onSelectedRowIdChange?.(
                              afterFullRow as TRowId | null,
                            );
                          }
                        }
                      };

                      const handleWindowPointerMove = (
                        moveEvent: PointerEvent,
                      ) => {
                        if (moveEvent.pointerId !== pointerId) return;
                        if (!dragAnchorRef.current) return;
                        dragPointerTargetRef.current =
                          moveEvent.target instanceof Element
                            ? moveEvent.target
                            : null;
                        if (dragFrameRef.current !== null) return;
                        dragFrameRef.current =
                          requestAnimationFrame(resolveHover);
                      };

                      // Shared teardown, also reachable from the Esc-cancel
                      // handler and the unmount effect via
                      // dragRemoveListenersRef — neither of those has a
                      // PointerEvent to check, so this half takes no
                      // argument and is not itself a listener.
                      const detachDragListeners = () => {
                        dragAnchorRef.current = null;
                        dragPointerTargetRef.current = null;
                        dragLastHoverKeyRef.current = null;
                        if (dragFrameRef.current !== null) {
                          cancelAnimationFrame(dragFrameRef.current);
                          dragFrameRef.current = null;
                        }
                        window.removeEventListener(
                          "pointermove",
                          handleWindowPointerMove,
                          DRAG_LISTENER_OPTIONS,
                        );
                        window.removeEventListener(
                          "pointerup",
                          handleWindowPointerUp,
                          DRAG_LISTENER_OPTIONS,
                        );
                        window.removeEventListener(
                          "pointercancel",
                          handleWindowPointerCancel,
                          DRAG_LISTENER_OPTIONS,
                        );
                        window.removeEventListener(
                          "selectstart",
                          suppressNativeSelection,
                          DRAG_LISTENER_OPTIONS,
                        );
                        dragRemoveListenersRef.current = null;
                      };

                      // A frame scheduled by the last `handleWindowPointerMove`
                      // may not have ticked yet when the gesture ends —
                      // CI's headless Linux WebKit was observed (via
                      // temporary window.__pretableMarqueeDebug instrumentation,
                      // PR #362) to never tick a single rAF across an entire
                      // 18-move drag, so `resolveHover` ran zero times and
                      // only the anchor cell ever got selected.
                      // `detachDragListeners` above only cancels a pending
                      // frame; it never runs it, which loses whatever
                      // position that frame would have resolved.
                      // `dragPointerTargetRef` was already updated
                      // synchronously by every move regardless of whether a
                      // frame was pending, so the correct final target is
                      // sitting there unused. `extendRangeFromAnchor`
                      // replaces the range wholesale (anchor -> given
                      // address) rather than accumulating it, so running the
                      // one outstanding frame synchronously here is enough
                      // to land the correct final rectangle even if no
                      // intermediate frame ever ran — it does not need to
                      // recover the moves in between, only the last one.
                      const flushPendingHover = () => {
                        if (dragFrameRef.current === null) return;
                        cancelAnimationFrame(dragFrameRef.current);
                        dragFrameRef.current = null;
                        resolveHover();
                      };

                      const handleWindowPointerUp = (upEvent: PointerEvent) => {
                        if (upEvent.pointerId !== pointerId) return;
                        flushPendingHover();
                        detachDragListeners();
                      };

                      const handleWindowPointerCancel = (
                        cancelEvent: PointerEvent,
                      ) => {
                        if (cancelEvent.pointerId !== pointerId) return;
                        flushPendingHover();
                        detachDragListeners();
                      };

                      window.addEventListener(
                        "pointermove",
                        handleWindowPointerMove,
                        DRAG_LISTENER_OPTIONS,
                      );
                      window.addEventListener(
                        "pointerup",
                        handleWindowPointerUp,
                        DRAG_LISTENER_OPTIONS,
                      );
                      window.addEventListener(
                        "pointercancel",
                        handleWindowPointerCancel,
                        DRAG_LISTENER_OPTIONS,
                      );
                      window.addEventListener(
                        "selectstart",
                        suppressNativeSelection,
                        DRAG_LISTENER_OPTIONS,
                      );
                      dragRemoveListenersRef.current = detachDragListeners;
                    }}
                    ref={(node) => {
                      registerCell(cellKey, node);
                    }}
                    role="gridcell"
                    style={{
                      // No `outline: none` here. It was added alongside
                      // keyboard nav to suppress the user-agent focus ring
                      // while the cell drew its own ring as an inset
                      // box-shadow. The ring is an `outline` now, and an
                      // inline declaration beats a `@layer` + `:where()` rule
                      // at any specificity — so suppressing it here erased the
                      // ring grid.css declares, in every consuming app, while
                      // leaving `outline-offset` applied so the rule still
                      // looked live. grid.css rings on
                      // data-pretable-focused="true", which is exactly the
                      // cells that hold the engine's focus address — NOT the
                      // wider set with tabIndex 0, which also includes the
                      // untouched-grid entry stop that is deliberately
                      // tabbable without being focused. A consumer without grid.css now
                      // gets the user-agent ring instead of nothing, which is
                      // the accessible default rather than a silent loss.
                      overflowWrap: column.wrap ? "anywhere" : "normal",
                      whiteSpace: column.wrap ? "pre-wrap" : "nowrap",
                      ...positionStyle,
                    }}
                    tabIndex={cellIsTabStop ? 0 : -1}
                  >
                    {column.type === "boolean" && !isRowSelectCell ? (
                      // Boolean cells render the toggle control instead of
                      // cell content AND instead of the CellEditor popover —
                      // an active boolean edit shows as the busy control. A
                      // failed commit (validation reject / change callback throw)
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
                          onToggle={() => void toggleBooleanCell(rowId, column)}
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
                            rowId,
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
                          // Both commands below write the engine's `rows`
                          // slice and nothing else — neither
                          // `toggleIndexedRowSelection` nor
                          // `selectIndexedRowRange` touches `ranges` or
                          // `anchor`, which is the whole of what
                          // `PretableSelectionFor` (and therefore
                          // `onSelectionChange`) can carry. There is
                          // deliberately no `onSelectionChange` emit here:
                          // the only value it could pass is the one the
                          // consumer already holds, and reporting an
                          // unchanged selection as a change is worse than
                          // silence. `onRowSelectionChange` is the channel
                          // for this gesture; it fires from the
                          // `selectedRowIds` effect instead.
                          if (
                            event.shiftKey &&
                            lastCheckedRowAnchorRef.current !== null
                          ) {
                            const anchorId = lastCheckedRowAnchorRef.current;
                            indexedGrid.selectRowRange(anchorId, rowId);
                          } else {
                            grid.toggleRowSelection(rowId);
                          }

                          lastCheckedRowAnchorRef.current = rowId;
                        }}
                        role="checkbox"
                        // Out of the sequential tab order, matching
                        // BooleanCellControl and the roving-tabindex pattern:
                        // controls inside a cell are reached by navigating to
                        // the cell, not by Tab. Left tabbable, one of these
                        // sits in every rendered row, so Tab out of a body cell
                        // had to walk the whole virtualization window's worth
                        // of checkboxes before it could leave the grid — and in
                        // WebKit, where a bare <button> is not in the tab order
                        // at all, it was never reachable anyway. The keyboard
                        // route to this control is Space on the focused row
                        // (see `handleSurfaceKeyDown`), which works in both
                        // engines.
                        tabIndex={-1}
                        type="button"
                      >
                        {rowCheckState === "true" ? (
                          <CheckIcon />
                        ) : rowCheckState === "mixed" ? (
                          <MinusIcon />
                        ) : null}
                      </button>
                    ) : (
                      <MemoizedCellContent
                        rowId={rowId}
                        columnId={column.id}
                        value={value}
                        formattedValue={formattedValue}
                        isFocused={cellIsFocused}
                        isSelected={cellIsSelected}
                        pinned={plannedCol.pinned ?? null}
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
          {/* Over the panel the drop would group, not reorder, so the column
              insertion line would be promising something that will not happen.
              The panel shows its own gap indicator instead. */}
          {reorderDrag.groupInsertIndex === null ? (
            <div
              data-pretable-reorder-drop-indicator=""
              style={{
                left: reorderDrag.indicatorLeft,
                height: reorderDrag.ghostHeight + bodyViewportHeight,
              }}
            />
          ) : null}
        </>
      ) : null}
      {filterOpenState
        ? (() => {
            const col = effectiveColumns.find(
              (c) => c.id === filterOpenState.columnId,
            );
            if (!col) return null;
            const options = resolveColumnOptions(col, () => [], processing);
            return (
              <FilterMenu
                key={filterOpenState.columnId}
                columnId={filterOpenState.columnId}
                label={col.header ?? filterOpenState.columnId}
                type={col.type ?? "text"}
                allowedOperators={col.filterOperators}
                options={options}
                initialFilter={
                  snapshot.filters[filterOpenState.columnId] ?? null
                }
                {...(col.type === "enum" && col.options === undefined
                  ? { loadDistinctValues }
                  : {})}
                style={popoverStyle(filterOpenState.rect)}
                onChange={(id, filter) => {
                  grid.setColumnFilter(id, filter);
                }}
                onClose={closePopover}
              />
            );
          })()
        : null}
      {menuOpenState
        ? (() => {
            const col = effectiveColumns.find(
              (c) => c.id === menuOpenState.columnId,
            );
            if (!col) return null;
            return (
              <ColumnMenu
                key={menuOpenState.columnId}
                anchor={menuOpenState.anchor}
                columnId={menuOpenState.columnId}
                grouped={snapshot.rowGroups.includes(menuOpenState.columnId)}
                label={col.header ?? menuOpenState.columnId}
                style={popoverStyle(menuOpenState.rect)}
                onClose={closePopover}
                onSelect={selectColumnMenuAction}
              />
            );
          })()
        : null}
    </div>
  );

  const bodyState =
    bodyStateKind === null || dataState === undefined ? null : (
      <div
        data-pretable-body-state={bodyStateKind}
        style={
          bodyStateKind === "error-strip"
            ? undefined
            : getBodyStateOverlayStyle(headerHeight)
        }
      >
        {renderBodyState?.({
          kind: bodyStateKind,
          phase: dataState.phase,
          loadedRowCount: rowModelSnapshot.sourceRowCount,
        }) ??
          (bodyStateKind === "loading"
            ? effectiveMessages.loadingStateMessage()
            : bodyStateKind === "empty"
              ? effectiveMessages.emptyStateMessage()
              : effectiveMessages.dataErrorAnnouncement({
                  message:
                    dataState.phase === "error" ? dataState.message : undefined,
                }))}
      </div>
    );

  const viewportWithDataState = !dataStateWrapperEnabled ? (
    scrollViewport
  ) : (
    <div
      data-pretable-data-state-wrapper=""
      data-pretable-data-phase={dataState?.phase}
      style={getDataStateWrapperStyle()}
    >
      {bodyStateKind === "error-strip" ? bodyState : null}
      {scrollViewport}
      {bodyStateKind !== "error-strip" ? bodyState : null}
    </div>
  );

  // Without the panel the surface IS the scroll viewport — no wrapper, so a
  // consumer's DOM, CSS selectors and layout are untouched by SP3 existing.
  if (!groupPanelEnabled) {
    return viewportWithDataState;
  }

  // With it, the viewport keeps every attribute it had and gains a parent. The
  // panel cannot live inside the viewport: that element carries
  // `role="grid"`/`"treegrid"` (whose children must be rows and rowgroups, so a
  // listbox of chips there is invalid ARIA) and `minWidth: totalWidth` on its
  // content, which would scroll the panel sideways with the data.
  return (
    <div
      data-pretable-group-panel-wrapper=""
      style={getGroupPanelWrapperStyle(viewportHeight)}
    >
      <GroupPanel
        containerRef={groupPanelRef}
        // Only a header drag reports in from out here; the panel's own chip
        // drag tracks its insertion index internally.
        dropIndicatorIndex={reorderDrag?.groupInsertIndex ?? null}
        emptyMessage={groupPanel?.emptyMessage}
        focusManagedExternally
        height={groupPanelHeight}
        labelForColumn={labelForColumn}
        onChange={applyRowGroups}
        rowGroups={snapshot.rowGroups}
      />
      {viewportWithDataState}
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
 * - **Focus is already inside the scroll viewport**, i.e. on the viewport
 *   itself, on a cell, or on a control *inside* a cell.
 *
 * That last clause is load-bearing and used to be missing. The test was
 * `active.hasAttribute("data-pretable-cell")` — the element itself had to be
 * the cell — but the row-select checkbox is a `<button role="checkbox">`
 * nested inside its cell, and in Chromium clicking it leaves it holding DOM
 * focus. Every subsequent arrow key then moved the engine's focus address (and
 * with it the roving `tabIndex={0}` and `data-pretable-focused="true"`) while
 * `document.activeElement` stayed pinned to that button: the visible ring and
 * the real focus marched apart, and because the follow effect is "one attempt
 * per address, applied or not", it never retried. Measured before this changed:
 * three ArrowDowns moved the ring r1 → r2 → r3 with `activeElement` still on
 * r1's checkbox. `closest()` covers the whole in-cell subtree, so any control a
 * cell renders — today's checkbox, tomorrow's link — is followed.
 *
 * Containment in the viewport is now checked explicitly rather than implied.
 * `closest()` would otherwise happily match a cell in a *different* grid on the
 * page, which the old identity test could not do.
 *
 * Everything else is someone else's: a filter popover or a typed-editor
 * overlay (both portaled to `document.body` by `OverlayPortal`, so they are
 * deliberately *not* inside the viewport subtree), a header sort/filter button
 * (inside the viewport, but not inside any cell), or any part of the host page
 * that has nothing to do with the grid.
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

  if (viewport === null) return false;
  if (active === viewport) return true;

  return (
    viewport.contains(active) &&
    // A column header is a cell of the grid's focus model, so focus sitting on
    // one is ours to move — that is what lets ArrowDown off the header put real
    // DOM focus back on a data cell. Before the header joined the model this
    // was correctly excluded: a header <button> was then page chrome that
    // happened to live inside the viewport for layout, and taking focus from it
    // would have been theft.
    (active.closest("[data-pretable-cell]") !== null ||
      active.closest("[data-pretable-header-cell]") !== null)
  );
}

function replaceSelectionWithFullRow<TRow extends PretableRow>(
  grid: SurfaceFacade<TRow>,
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
  grid: SurfaceFacade<TRow>;
  onFocusChange?: (
    ref: PretableIndexedFocusRef<PretableRowId> | null,
    columnId: string | null,
  ) => void;
  onSelectedRowIdChange?: (rowId: string | null) => void;
  onSelectionChange?: (next: PretableSelectionState) => void;
  rowId: string;
  rowRef: PretableIndexedFocusRef<PretableRowId>;
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
    rowRef,
    shift,
  } = args;

  const before = grid.getSnapshot();
  const addr: PretableCellAddress = { rowId, columnId };

  if (shift && !cmd && before.selection.anchor) {
    grid.extendRangeFromAnchor(addr);
    setSurfaceFocusRef(grid, rowRef, columnId);
  } else if (cmd) {
    grid.addRange({
      startRowId: rowId,
      endRowId: rowId,
      startColumnId: columnId,
      endColumnId: columnId,
    });
    setSurfaceFocusRef(grid, rowRef, columnId);
  } else {
    // Plain click (or shift+click with no anchor — falls back to plain click).
    setSurfaceFocusRef(grid, rowRef, columnId);
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

  const beforeFocus = before.focus as PretableFocusState & {
    readonly ref: PretableIndexedFocusRef<PretableRowId> | null;
  };
  const afterFocus = after.focus as PretableFocusState & {
    readonly ref: PretableIndexedFocusRef<PretableRowId> | null;
  };
  if (
    !nullableVisibleRowRefsEqual(beforeFocus.ref, afterFocus.ref) ||
    beforeFocus.columnId !== afterFocus.columnId
  ) {
    onFocusChange?.(afterFocus.ref, afterFocus.columnId);
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
function resolvePasteAnchor<
  TRow extends PretableRow,
  TRowId extends PretableRowId,
  TColumns,
>(
  ranges: readonly {
    readonly start: { readonly rowId: TRowId; readonly columnId: string };
    readonly end: { readonly rowId: TRowId; readonly columnId: string };
  }[],
  focus: {
    readonly ref: PretableIndexedFocusRef<TRowId> | null;
    readonly columnId: string | null;
  },
  rowModelSnapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
  /** Columns in DRAWN order — paste geometry counts across them. */
  columns: readonly PretableColumn<TRow>[],
): {
  anchor: {
    readonly ref: PretableVisibleRowRef<TRowId>;
    readonly columnId: string;
  };
  selectionSize: { rows: number; columns: number };
} | null {
  const dataColumns = columns.filter((c) => c.id !== ROW_SELECT_COLUMN_ID);
  if (dataColumns.length === 0 || rowModelSnapshot.visibleRowCount === 0) {
    return null;
  }

  if (ranges.length === 0) {
    // A HEADER cursor is not a paste target — there is no cell under it to
    // write into, and the block would have to land *somewhere*. `null` is this
    // function's existing "nothing to anchor on" answer and the caller already
    // treats it as "not ours to handle", so Cmd+V on the header is inert
    // rather than pasting into row 0 behind the user's back.
    return focus.ref !== null &&
      focus.ref.kind !== "header" &&
      focus.columnId !== null
      ? {
          anchor: { ref: focus.ref, columnId: focus.columnId },
          selectionSize: { rows: 1, columns: 1 },
        }
      : null;
  }

  const colOrder = new Map<string, number>();
  for (let i = 0; i < dataColumns.length; i += 1) {
    colOrder.set(dataColumns[i]!.id, i);
  }

  const resolve = (
    range: (typeof ranges)[number],
  ): {
    rowLo: number;
    rowHi: number;
    colLo: number;
    colHi: number;
  } | null => {
    const r1 = rowModelSnapshot.indexOf({
      kind: "data",
      rowId: range.start.rowId,
    });
    const r2 = rowModelSnapshot.indexOf({
      kind: "data",
      rowId: range.end.rowId,
    });
    if (r1 < 0 || r2 < 0) return null;
    const startSynth = range.start.columnId === ROW_SELECT_COLUMN_ID;
    const endSynth = range.end.columnId === ROW_SELECT_COLUMN_ID;
    let colLo: number;
    let colHi: number;
    if (startSynth && endSynth) {
      colLo = 0;
      colHi = dataColumns.length - 1;
    } else if (startSynth || endSynth) {
      const other = colOrder.get(
        startSynth ? range.end.columnId : range.start.columnId,
      );
      if (other === undefined) return null;
      colLo = 0;
      colHi = other;
    } else {
      const c1 = colOrder.get(range.start.columnId);
      const c2 = colOrder.get(range.end.columnId);
      if (c1 === undefined || c2 === undefined) return null;
      colLo = Math.min(c1, c2);
      colHi = Math.max(c1, c2);
    }
    return { rowLo: Math.min(r1, r2), rowHi: Math.max(r1, r2), colLo, colHi };
  };

  // Which of several ranges the paste anchors in — "the one holding the
  // focused cell" — falls back to the first range when focus is not in any of
  // them. A HEADER cursor is in none of them by construction, so `undefined`
  // is the honest answer and the fallback is the correct behaviour: paste
  // still lands in the existing selection rather than being dropped.
  const focusRow =
    focus.ref === null || focus.ref.kind === "header"
      ? undefined
      : rowModelSnapshot.indexOf(focus.ref);
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

  // Measure the selection in data rows: group rows are not paste targets, so a
  // selection spanning one covers fewer writable rows than its span suggests,
  // and `mapPasteToTargets` decides tiling against that count. A selection that
  // covers only group rows has nothing to paste into.
  let selectionRows = 0;
  const selectedRows = rowModelSnapshot.range(chosen.rowLo, chosen.rowHi + 1);
  for (const row of selectedRows) {
    if (row.kind === "data") selectionRows += 1;
  }
  if (selectionRows === 0) return null;
  const anchorRow = rowModelSnapshot.rowAt(chosen.rowLo);
  if (anchorRow === undefined) return null;

  return {
    anchor: {
      ref:
        anchorRow.kind === "data"
          ? { kind: "data", rowId: anchorRow.rowId }
          : { kind: "group", groupId: anchorRow.groupId },
      columnId: dataColumns[chosen.colLo]!.id,
    },
    selectionSize: {
      rows: selectionRows,
      columns: chosen.colHi - chosen.colLo + 1,
    },
  };
}

function getRowMeasurementKey(rowNode: HTMLDivElement, rowHeightFloor: number) {
  const rowParts = [
    // Not part of the row's markup, and that is exactly why it belongs here.
    // A density switch changes the floor without changing a single attribute
    // this key otherwise reads, so leaving it out pins every already-measured
    // row at its old height and lets only newly rendered rows adopt the new
    // density — a grid split between two densities down its scroll position.
    String(rowHeightFloor),
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

function computeSelectionExtent<
  TRow extends PretableRow,
  TRowId extends PretableRowId,
  TColumns,
>(
  ranges: readonly {
    readonly start: { readonly rowId: TRowId; readonly columnId: string };
    readonly end: { readonly rowId: TRowId; readonly columnId: string };
    readonly datasetRowSpan?: PretableIndexedDatasetRowSpan;
  }[],
  rowModelSnapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
  /**
   * Columns in DRAWN order. A range's bounds are column ids with everything
   * between them implied, so the span — and therefore the count announced —
   * only means what the user sees if this is the order on screen.
   */
  columns: readonly PretableColumn<TRow>[],
  /**
   * The honesty-gated loaded window, when there is one. Rows are counted over
   * dataset spans through it, so an announced extent keeps naming every row
   * the user selected once some of them are evicted. `null` restricts the
   * count to what the snapshot can resolve — byte-for-byte the pre-eviction
   * arithmetic, which is what local mode and grouping still get.
   */
  loadedWindow: PretableIndexedSelectionWindow | null,
): { rowCount: number; columnCount: number; isAll: boolean } {
  // The extent is announced as "N rows × M columns", so it counts data cells:
  // group headers carry none, and leaving them in would both inflate `rowCount`
  // and make `isAll` unreachable after a select-all.
  //
  // Rows come from `getIndexedCellSelectionSummary` — the same span union the
  // engine answers `getCellSelectionSummary()` with — so the count a screen
  // reader hears and the count a consumer reads can never diverge. Columns are
  // derived here instead of being folded into that summary: they are ordinals
  // on the drawn order, window-independent, and cheap.
  const dataColumns = columns.filter((c) => c.id !== ROW_SELECT_COLUMN_ID);

  const dataRowCount = rowModelSnapshot.visibleDataRowCount;
  if (ranges.length === 0 || dataRowCount === 0 || dataColumns.length === 0) {
    return { rowCount: 0, columnCount: 0, isAll: false };
  }

  const columnOrder = new Map<string, number>();
  for (let i = 0; i < columns.length; i += 1) {
    const c = columns[i];
    if (c) columnOrder.set(c.id, i);
  }

  // Ranges that cover at least one data column. A range covering only the
  // synthetic checkbox column selects no data cells, so it must not
  // contribute rows either — which is why the row count is taken over this
  // list rather than over `ranges`.
  const countableRanges: (typeof ranges)[number][] = [];
  const coveredCols = new Set<string>();

  for (const range of ranges) {
    // Resolve column span. The synthetic row-select column expands to "all
    // data columns" when it appears as a range bound (this is how full-row
    // selections encode themselves).
    const startSynth = range.start.columnId === ROW_SELECT_COLUMN_ID;
    const endSynth = range.end.columnId === ROW_SELECT_COLUMN_ID;
    let colsForRange: PretableColumn<TRow>[];

    if (startSynth && endSynth) {
      // Range spans only the synthetic column — no data cells covered.
      continue;
    }

    if (startSynth || endSynth) {
      colsForRange = dataColumns.slice();
    } else {
      const c1 = columnOrder.get(range.start.columnId);
      const c2 = columnOrder.get(range.end.columnId);
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

    countableRanges.push(range);
    for (const col of colsForRange) {
      coveredCols.add(col.id);
    }
  }

  const rowCount = cellSelectionRowCount(
    countableRanges,
    rowModelSnapshot,
    loadedWindow,
  );
  const columnCount = coveredCols.size;
  const isAll = rowCount === dataRowCount && columnCount === dataColumns.length;

  return { rowCount, columnCount, isAll };
}

const ARROW_DIRECTIONS: Record<string, PretableFocusDirection> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

function rowRefOf<TRowId extends PretableRowId>(
  row:
    | { readonly kind: "data"; readonly rowId: TRowId }
    | {
        readonly kind: "group";
        readonly groupId: Extract<
          PretableVisibleRowRef<TRowId>,
          { readonly kind: "group" }
        >["groupId"];
      },
): PretableVisibleRowRef<TRowId> {
  return row.kind === "data"
    ? { kind: "data", rowId: row.rowId }
    : { kind: "group", groupId: row.groupId };
}

/**
 * The focus-follow effect's address key. Length-prefixed so no two refs can
 * collide through their string content — and `"header"` is its own literal for
 * the same reason: it must not read as a data row whose id happens to be
 * "header".
 */
function visibleRowRefKey(ref: PretableIndexedFocusRef<PretableRowId>): string {
  if (ref.kind === "header") {
    return "header";
  }
  if (ref.kind === "group") {
    return `group:${ref.groupId.length}:${ref.groupId}`;
  }
  return typeof ref.rowId === "number"
    ? `data:number:${ref.rowId}`
    : `data:string:${ref.rowId.length}:${ref.rowId}`;
}

function visibleRowRefsEqual(
  left: PretableIndexedFocusRef<PretableRowId>,
  right: PretableIndexedFocusRef<PretableRowId>,
): boolean {
  // The header is a singleton address — the kind is the whole of it, since the
  // column travels beside the ref on the focus state. Left to the data branch
  // below, `left.rowId === right.rowId` would compare `undefined === undefined`
  // and report every ref pair as equal to every other one.
  if (left.kind === "header" || right.kind === "header") {
    return left.kind === right.kind;
  }
  return left.kind === "group"
    ? right.kind === "group" && left.groupId === right.groupId
    : right.kind === "data" && left.rowId === right.rowId;
}

function nullableVisibleRowRefsEqual(
  left: PretableIndexedFocusRef<PretableRowId> | null,
  right: PretableIndexedFocusRef<PretableRowId> | null,
): boolean {
  return left === null || right === null
    ? left === right
    : visibleRowRefsEqual(left, right);
}

function surfaceFocusChanged(
  left: {
    readonly ref: PretableIndexedFocusRef<PretableRowId> | null;
    readonly columnId: string | null;
  },
  right: {
    readonly ref: PretableIndexedFocusRef<PretableRowId> | null;
    readonly columnId: string | null;
  },
): boolean {
  return (
    !nullableVisibleRowRefsEqual(left.ref, right.ref) ||
    left.columnId !== right.columnId
  );
}

function setSurfaceFocusRef<TRow extends PretableRow>(
  grid: SurfaceFacade<TRow>,
  ref: PretableIndexedFocusRef<PretableRowId>,
  columnId: string,
): void {
  (
    grid as unknown as {
      setFocusRef(
        ref: PretableIndexedFocusRef<PretableRowId>,
        columnId: string,
      ): void;
    }
  ).setFocusRef(ref, columnId);
}

interface SurfaceKeyDownContext<TRow extends PretableRow> {
  bodyViewportHeight: number;
  columns: PretableColumn<TRow>[];
  grid: SurfaceFacade<TRow>;
  rowModelSnapshot: PretableRowModelSnapshot<
    TRow,
    PretableRowId,
    readonly PretableColumn<TRow>[]
  >;
  onRowActivate?: (input: PretableRowActivateInput<TRow>) => void;
  onSelectedRowIdChange?: (rowId: string | null) => void;
  /**
   * Open the focused column's filter popover / column menu, from the keyboard.
   * Returns false when the column has no such control rendered, so the key can
   * fall through rather than being consumed into nothing.
   */
  openHeaderPopover: (kind: "filter" | "menu", columnId: string) => boolean;
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
    rowModelSnapshot,
    onRowActivate,
    onSelectedRowIdChange,
    openHeaderPopover,
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
  const focus = snapshot.focus as PretableFocusState & {
    readonly ref: PretableIndexedFocusRef<PretableRowId> | null;
  };
  // Row targets are every visible row, group headers included — the same flat
  // list the engine's `moveFocus` walks. Home/End/Page/Tab index into this list,
  // so a group row is a landing spot for them exactly as it is for an arrow key.
  // (Selection and editing remain data-rows-only; only focus changed.)
  const firstColumn = columns[0];
  const lastColumn = columns[columns.length - 1];

  // The cursor is on a column header. Named once here because it gates three
  // separate things below: the two header-only bindings, and the two places
  // that would otherwise hand a header ref to `rowModelSnapshot.indexOf`.
  const onHeader = focus.ref?.kind === "header";

  if (onHeader && focus.columnId !== null) {
    // Alt+ArrowDown opens the FILTER popover — the binding Excel and Google
    // Sheets both use on a header cell, so it is the one a spreadsheet user
    // already has in their fingers.
    //
    // It cannot collide with anything keyboard.mdx documents. Every arrow
    // binding on that page is bare, `Shift+`, `Cmd/Ctrl+` or
    // `Cmd/Ctrl+Shift+`; `Alt` appears in no row of the table. In this file
    // `altKey` is read in exactly two places before now — as a NEGATIVE guard
    // in the copy path and in type-to-replace — so nothing loses a binding.
    // And it is scoped to the header regardless: on a data cell Alt+ArrowDown
    // still falls through to the plain arrow move it has always been.
    if (
      key === "ArrowDown" &&
      event.altKey &&
      !cmd &&
      !shift &&
      openHeaderPopover("filter", focus.columnId)
    ) {
      return true;
    }
    // Shift+F10 opens the COLUMN MENU. The platform-standard context-menu
    // chord, and the one the ARIA APG names for opening a menu on a focused
    // widget; `ContextMenu` is the same request from the dedicated key, which
    // is why both land here. F10 is untouched anywhere else in the grid — F2
    // is the edit key and is the only function key this file reads.
    if (
      ((key === "F10" && shift) || key === "ContextMenu") &&
      openHeaderPopover("menu", focus.columnId)
    ) {
      return true;
    }
    // Enter and Space are DELIBERATELY not handled here.
    //
    // The header cell is a real <button>, and the focus-follow effect puts DOM
    // focus on it whenever the cursor lands there, so both keys already fire
    // its native activation — which is the same `onClick` a mouse user gets,
    // shift-click multi-sort included. Sorting here as well would sort twice
    // per press unless `preventDefault` reliably suppressed the activation in
    // both engines, and a binding that depends on that is a binding that will
    // eventually double-fire.
    //
    // The fall-through is safe because `focus.rowId` is `null` for a header
    // (see the facade snapshot): the Enter/Space branch at the foot of this
    // function needs a row id and returns false without one, so it can neither
    // select a row nor call `preventDefault` on the activation.
  }

  // Expand/collapse, per the ARIA APG treegrid model. It comes first because
  // Left/Right/Enter/Space mean something different on a group row than they do
  // anywhere else — and only in the group column for the arrows, so a group's
  // aggregate cells stay reachable by keyboard instead of being stranded behind
  // a rule that consumed Left/Right outright.
  //
  // A header cursor resolves to no row: `-1` is what `indexOf` would mean if it
  // could take one, and it keeps the header out of the group-row branch below
  // as well as out of `rowAt`.
  const focusedRowIndex =
    focus.ref === null || focus.ref.kind === "header"
      ? -1
      : rowModelSnapshot.indexOf(focus.ref);
  const focusedRow =
    focusedRowIndex < 0 ? undefined : rowModelSnapshot.rowAt(focusedRowIndex);

  if (focusedRow && focusedRow.kind === "group") {
    const expandable = focusedRow.childCount > 0;
    const expanded = focusedRow.expanded;
    const inGroupColumn = focus.columnId === GROUP_COLUMN_ID;

    // Toggle from anywhere on the row, aggregate cells included. Consumed even
    // when there is nothing to toggle, so Enter/Space never fall through to the
    // data-row path and select a group header.
    if (key === "Enter" || key === " " || key === "Space") {
      if (expandable) {
        grid.setGroupExpanded(focusedRow.groupId, !expanded);
      }
      return true;
    }

    if (inGroupColumn && key === "ArrowRight" && expandable && !expanded) {
      grid.setGroupExpanded(focusedRow.groupId, true);
      return true;
    }

    if (inGroupColumn && key === "ArrowLeft") {
      if (expandable && expanded) {
        grid.setGroupExpanded(focusedRow.groupId, false);
        return true;
      }

      // Already collapsed: Left walks OUT one level. At the top level there is
      // nowhere to go, and the key is still consumed — moving left out of the
      // first column is not a fallback anyone asked for.
      const parent = findParentGroupRow(rowModelSnapshot, {
        kind: "group",
        groupId: focusedRow.groupId,
      });

      if (parent && focus.columnId) {
        (
          grid as unknown as {
            setFocusRef(
              ref: PretableIndexedFocusRef<PretableRowId>,
              columnId: string,
            ): void;
          }
        ).setFocusRef(
          { kind: "group", groupId: parent.groupId },
          focus.columnId,
        );
      }

      return true;
    }

    // Everything else — including Left/Right on an aggregate cell, and Right on
    // an already-expanded group — falls through to ordinary navigation below.
  }

  // Arrow keys
  const direction = ARROW_DIRECTIONS[key];
  if (direction) {
    grid.moveFocus(direction, {
      extend: shift,
      jumpToEdge: cmd,
    });

    // Snap off the synthetic row-select column if we landed there.
    const after = grid.getSnapshot();
    const afterFocus = after.focus as PretableFocusState & {
      readonly ref: PretableIndexedFocusRef<PretableRowId> | null;
    };
    if (afterFocus.columnId === ROW_SELECT_COLUMN_ID && firstColumn) {
      if (afterFocus.ref !== null) {
        setSurfaceFocusRef(grid, afterFocus.ref, firstColumn.id);
      }
    }

    if (selectFocusedRowOnArrowKey) {
      const nextFocus = grid.getSnapshot().focus as PretableFocusState & {
        readonly ref: PretableIndexedFocusRef<PretableRowId> | null;
      };
      // `selectFocusedRowOnArrowKey`. Landing on the HEADER selects nothing —
      // it is `-1` here, `landed` is undefined, and the `kind === "data"` test
      // below already declines. Arrowing up off the first row therefore leaves
      // the previous row selected instead of clearing the selection, which is
      // exactly what arrowing onto a GROUP header already does.
      const landedIndex =
        nextFocus.ref === null || nextFocus.ref.kind === "header"
          ? -1
          : rowModelSnapshot.indexOf(nextFocus.ref);
      const landed =
        landedIndex < 0 ? undefined : rowModelSnapshot.rowAt(landedIndex);
      // Focus can now land on a group header, and a group header is not a
      // selectable row — arrowing onto one leaves the previous row selected
      // rather than emitting a selection the engine would refuse to derive.
      if (landed?.kind === "data") {
        replaceSelectionWithFullRow(
          grid,
          landed.rowId as unknown as string,
          columns,
        );
        onSelectedRowIdChange?.(landed.rowId as unknown as string);
      }
    }
    return true;
  }

  // Home / End
  if (key === "Home") {
    if (!firstColumn) return false;
    if (cmd) {
      const firstRow = rowModelSnapshot.rowAt(0);
      if (!firstRow) return false;
      setSurfaceFocusRef(grid, rowRefOf(firstRow), firstColumn.id);
    } else if (focus.ref !== null) {
      setSurfaceFocusRef(grid, focus.ref, firstColumn.id);
    } else {
      const firstRow = rowModelSnapshot.rowAt(0);
      if (!firstRow) return false;
      setSurfaceFocusRef(grid, rowRefOf(firstRow), firstColumn.id);
    }
    return true;
  }

  if (key === "End") {
    if (!lastColumn) return false;
    if (cmd) {
      const lastRow = rowModelSnapshot.rowAt(
        rowModelSnapshot.visibleRowCount - 1,
      );
      if (!lastRow) return false;
      setSurfaceFocusRef(grid, rowRefOf(lastRow), lastColumn.id);
    } else if (focus.ref !== null) {
      setSurfaceFocusRef(grid, focus.ref, lastColumn.id);
    } else {
      const firstRow = rowModelSnapshot.rowAt(0);
      if (!firstRow) return false;
      setSurfaceFocusRef(grid, rowRefOf(firstRow), lastColumn.id);
    }
    return true;
  }

  // Page Up / Page Down
  if (key === "PageUp" || key === "PageDown") {
    if (rowModelSnapshot.visibleRowCount === 0 || !firstColumn) return false;
    // Steps N *rendered* rows — group headers occupy visual space, so counting
    // them is what makes a page step one screen, matching `computePageStep` in
    // the engine.
    const pageRowCount = Math.max(1, Math.floor(bodyViewportHeight / 32));
    // From the HEADER, a page step lands in the body: `-1` bases the step at
    // row 0, so PageDown enters the grid and PageUp stays at the top. The
    // header is above every row, so "one screen up from here" is row 0.
    const currentRowIdx =
      focus.ref === null || focus.ref.kind === "header"
        ? -1
        : rowModelSnapshot.indexOf(focus.ref);
    const baseRowIdx = currentRowIdx === -1 ? 0 : currentRowIdx;
    const nextRowIdx =
      key === "PageUp"
        ? Math.max(0, baseRowIdx - pageRowCount)
        : Math.min(
            rowModelSnapshot.visibleRowCount - 1,
            baseRowIdx + pageRowCount,
          );
    const nextRow = rowModelSnapshot.rowAt(nextRowIdx);
    if (!nextRow) return false;
    const columnId = focus.columnId ?? firstColumn.id;
    const nextRef = rowRefOf(nextRow);

    if (shift) {
      // Ensure anchor exists before extending
      if (
        !snapshot.selection.anchor &&
        focus.rowId !== null &&
        focus.columnId !== null
      ) {
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
      setSurfaceFocusRef(grid, nextRef, columnId);
      if (nextRef.kind === "data") {
        grid.extendRangeFromAnchor({
          rowId: nextRef.rowId as unknown as string,
          columnId,
        });
      }
    } else {
      setSurfaceFocusRef(grid, nextRef, columnId);
    }
    return true;
  }

  // Tab
  if (key === "Tab") {
    if (tabBehavior === "exit") {
      return false;
    }
    // `wrap-rows` is spreadsheet-style entry across the BODY. From the header
    // there is no cell to walk to and back from, so Tab is released to the
    // browser — the grid stays one tab stop and focus leaves in one press,
    // exactly as it does at the two body corners. Consuming it here to walk
    // header columns would be the kind of configuration-dependent trap #423
    // removed; releasing cannot trap.
    if (onHeader) {
      return false;
    }
    if (rowModelSnapshot.visibleRowCount === 0 || columns.length === 0) {
      return false;
    }
    // Narrowed by the `onHeader` release above — `focus.ref` is a ROW ref here.
    const currentRowIdx =
      focus.ref === null ? -1 : rowModelSnapshot.indexOf(focus.ref);
    const currentColIdx = focus.columnId
      ? columns.findIndex((c) => c.id === focus.columnId)
      : -1;
    const baseRowIdx = currentRowIdx === -1 ? 0 : currentRowIdx;
    const baseColIdx = currentColIdx === -1 ? 0 : currentColIdx;

    let nextRowIdx = baseRowIdx;
    let nextColIdx = baseColIdx;
    if (shift) {
      if (baseColIdx === 0) {
        if (baseRowIdx === 0) {
          // Top-left corner: RELEASE rather than clamp. Clamping here is what
          // made wrap-rows a WCAG 2.1.2 keyboard trap — Shift+Tab sat on the
          // first cell forever, consumed but doing nothing, with no key that
          // could get focus back out of the grid.
          return false;
        }
        nextColIdx = columns.length - 1;
        nextRowIdx = baseRowIdx - 1;
      } else {
        nextColIdx = baseColIdx - 1;
      }
    } else {
      if (baseColIdx === columns.length - 1) {
        if (baseRowIdx === rowModelSnapshot.visibleRowCount - 1) {
          // Bottom-right corner: the forward release, mirroring the above.
          return false;
        }
        nextColIdx = 0;
        nextRowIdx = baseRowIdx + 1;
      } else {
        nextColIdx = baseColIdx + 1;
      }
    }
    const nextRow = rowModelSnapshot.rowAt(nextRowIdx);
    const nextCol = columns[nextColIdx];
    if (!nextRow || !nextCol) return false;
    setSurfaceFocusRef(grid, rowRefOf(nextRow), nextCol.id);
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

  // Enter / Space on a DATA row — preserve Phase 1 row-selection behavior. A
  // group row never reaches here; the expand/collapse branch at the top of this
  // function consumes both keys.
  if (key === "Enter" || key === " " || key === "Space") {
    const focusedRowId = focus.rowId;
    if (focusedRowId !== null) {
      replaceSelectionWithFullRow(grid, focusedRowId, columns);
      onSelectedRowIdChange?.(focusedRowId);
      // Space additionally ticks the row's CHECKBOX — a different slice from
      // the cell range above (see selection-slice-boundary.test.tsx), reported
      // by `onRowSelectionChange`. This is the only keyboard route to it: the
      // checkbox is a control inside a cell and therefore `tabIndex={-1}`, and
      // arrow keys deliberately snap off the synthetic row-select column, so
      // without this the slice was mouse-only — and in WebKit, where a bare
      // <button> is out of the tab order, it was mouse-only already.
      // Enter is left alone: it is the row-ACTIVATION key (`onRowActivate`),
      // and overloading it with a toggle would make "open this row" also
      // change what is checked.
      if (
        (key === " " || key === "Space") &&
        allColumns.some((c) => c.id === ROW_SELECT_COLUMN_ID)
      ) {
        grid.toggleRowSelection(focusedRowId);
      }
      if (onRowActivate) {
        // `rowIndex` stays an index into the full flat list, because that is
        // the position the row is rendered at.
        // Unreachable with a header cursor — this whole branch is gated on
        // `focus.rowId !== null`, which a header never has — but written as a
        // branch rather than a cast so `onRowActivate` can never be handed a
        // row index resolved from a non-row address.
        const ref = focus.ref;
        const index =
          ref === null || ref.kind === "header"
            ? -1
            : rowModelSnapshot.indexOf(ref);
        const activated = index < 0 ? undefined : rowModelSnapshot.rowAt(index);
        if (activated?.kind === "data") {
          onRowActivate({
            row: activated.row,
            rowId: activated.rowId,
            rowIndex: index,
          } as unknown as PretableRowActivateInput<TRow>);
        }
      }
      return true;
    }
    return false;
  }

  return false;
}

/**
 * Translate a drop index from DRAWN column space into an `options.columns`
 * index, which is what `grid.moveColumn` takes.
 *
 * The two spaces are the same array while ungrouped, and this returns
 * `dropIndex` unchanged. Grouped they differ in BOTH directions: the derived
 * group column is drawn but is not an engine column, and every grouped column
 * is an engine column that is not drawn (`hideGroupedColumns` defaults on).
 *
 * Counting positions in the drawn list therefore cannot answer the question —
 * it has no slot for the columns that dropped out, so an index taken from it is
 * short by however many of them precede the drop. Measured, before this was
 * written the right way: grouping by one column and dragging a header ONTO
 * ITSELF (a drop index that should be a no-op) moved that column to engine
 * index 0, silently reordering `options.columns` while the drawn header row
 * did not visibly change and `onColumnOrderChange` reported an order the user
 * never asked for.
 *
 * So the drop is resolved by NEIGHBOUR instead of by count: the drawn order
 * says which column the dragged one now sits after, and that column's position
 * in the engine array — which does have a slot for everything — says where it
 * goes. The returned index is in post-removal space, which is what
 * `moveColumn`'s splice-out-then-splice-in takes.
 */
function toEngineDropIndex<TRow extends PretableRow>(
  drawn: readonly PretableColumn<TRow>[],
  engineColumns: readonly PretableColumn<TRow>[],
  columnId: string,
  dropIndex: number,
): number {
  const engineIds = engineColumns.map((c) => c.id);
  const known = new Set(engineIds);

  const ids = drawn.map((c) => c.id).filter((id) => id !== columnId);
  ids.splice(dropIndex, 0, columnId);
  // Drop the derived group column: it is drawn but the engine has never heard
  // of it, so it can be neither an anchor nor an offset.
  const ordered = ids.filter((id) => known.has(id));

  const position = ordered.indexOf(columnId);
  const rest = engineIds.filter((id) => id !== columnId);

  const predecessor = ordered[position - 1];
  if (predecessor !== undefined) return rest.indexOf(predecessor) + 1;

  // Nothing drawn before it. Anchor to what follows instead — the two differ
  // when hidden grouped columns sit at the head of the engine array, and
  // "before the first drawn column" must not mean "before those".
  const successor = ordered[position + 1];
  if (successor !== undefined) return rest.indexOf(successor);

  return 0;
}

function buildWidthsMap<TRow extends PretableRow>(
  grid: SurfaceFacade<TRow>,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const col of grid.getColumns()) {
    if (col.id === ROW_SELECT_COLUMN_ID) continue;
    if (typeof col.widthPx === "number") {
      result[col.id] = col.widthPx;
    }
  }
  return result;
}

function buildPinnedMap<TRow extends PretableRow>(
  grid: SurfaceFacade<TRow>,
): Record<string, "left" | "right" | null> {
  const result: Record<string, "left" | "right" | null> = {};
  for (const col of grid.getColumns()) {
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
