import type {
  ColumnIdOf,
  ColumnValueOf,
  PretableRowId,
  PretableRowModel,
  PretableRowModelSnapshot,
} from "@pretable-internal/row-model";

import { moveIndexedFocus, reconcileIndexedFocus } from "./indexed-focus";
import {
  adoptIndexedCellRangeSpans,
  createEmptyIndexedSelection,
  createIndexedRowSelection,
  getIndexedCellSelectionSummary,
  getIndexedSelectionSummary,
  isIndexedRowSelected,
  preserveIndexedRowSelectionProgram,
  projectIndexedSelection,
  reconcileIndexedSelection,
  releaseIndexedRowSelectionProgram,
  sameIndexedRowSelectionProgram,
  sameIndexedRowSelectionValue,
  selectAllVisibleRows,
  selectIndexedRowRange,
  toImmutableIndexedSet,
  toggleIndexedRowSelection,
} from "./indexed-selection";
import type {
  PretableGridUiColumn,
  PretableGridUiColumnLayout,
  PretableGridUiCore,
  PretableGridUiState,
  PretableIndexedCellRange,
  PretableIndexedDatasetRowSpan,
  PretableIndexedEditingState,
  PretableIndexedFocusMovement,
  PretableIndexedFocusRef,
  PretableIndexedFocusState,
  PretableIndexedRowRangeIndex,
  PretableIndexedSelectionState,
  PretableIndexedSelectionWindow,
  PretableViewportState,
} from "./types";

export class PretableGridUiError extends Error {
  readonly code:
    "disposed-grid-ui" | "invalid-ui-state" | "row-model-observation-failed";
  override readonly cause?: unknown;

  constructor(
    code: PretableGridUiError["code"],
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "PretableGridUiError";
    this.code = code;
    this.cause = cause;
  }
}

/**
 * Options accepted by the UI-only grid facade.
 *
 * See {@link PretableGridUiState} for why the schema column tuple
 * (`TColumns`) and the drawn column-id vocabulary (`TColumnId`) are separate
 * parameters: `columns` below is the DRAWN set, which a presentation layer is
 * entitled to extend beyond the schema.
 *
 * @public
 */
export interface CreateGridUiCoreOptions<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
  TColumnId extends string = ColumnIdOf<TColumns>,
> {
  readonly rowModel: PretableRowModel<TRow, TRowId, TColumns>;
  readonly columns: readonly PretableGridUiColumn<TColumnId>[];
  readonly viewport?: PretableViewportState;
  /**
   * @internal Late-bound getter for the loaded span (dataset-index terms)
   * behind the same honesty gate as `aria-rowindex` and the scroll-extent
   * spacers — see `WindowSpacers`/`getWindowSpacers` in `@pretable/react`'s
   * `pretable-model.ts`, which this mirrors and is fed by. Read fresh on
   * every row-model revision (never cached) so `reconcileIndexedSelection`
   * can tell an evicted row from a deleted one — see
   * {@link PretableIndexedSelectionWindow}. Undefined, or a getter that
   * returns null, reproduces pre-eviction behavior exactly: every absent
   * row is treated as deleted.
   */
  readonly getSelectionWindow?: () => PretableIndexedSelectionWindow | null;
}

const EMPTY_VIEWPORT: Readonly<PretableViewportState> = Object.freeze({
  scrollTop: 0,
  scrollLeft: 0,
  height: 0,
  width: 0,
});
const DEFAULT_COLUMN_WIDTH_PX = 160;

function sameValueZero(left: string | number, right: string | number): boolean {
  return left === right || (left !== left && right !== right);
}

function sameRef<TRowId extends PretableRowId>(
  left: PretableIndexedFocusRef<TRowId> | null,
  right: PretableIndexedFocusRef<TRowId> | null,
): boolean {
  if (left === right) return true;
  if (left === null || right === null || left.kind !== right.kind) return false;
  // Two header refs are the same address: the kind IS the whole address, since
  // the column lives on the focus state beside the ref. The compiler could not
  // have caught this one — the chain below is a boolean expression, not an
  // exhaustive switch, so a widened union just makes it silently return
  // `false` for every header/header pair. That would publish a "changed" focus
  // on every no-op `setFocus`, and re-render the surface on every arrow key
  // that did not actually move.
  if (left.kind === "header" && right.kind === "header") return true;
  return left.kind === "data" && right.kind === "data"
    ? sameValueZero(left.rowId, right.rowId)
    : left.kind === "group" &&
        right.kind === "group" &&
        left.groupId === right.groupId;
}

function sameViewport(
  left: Readonly<PretableViewportState>,
  right: Readonly<PretableViewportState>,
): boolean {
  return (
    left.scrollTop === right.scrollTop &&
    left.scrollLeft === right.scrollLeft &&
    left.height === right.height &&
    left.width === right.width
  );
}

function normalizeViewport(viewport: PretableViewportState) {
  if (
    !Number.isFinite(viewport.scrollTop) ||
    !Number.isFinite(viewport.scrollLeft) ||
    !Number.isFinite(viewport.height) ||
    !Number.isFinite(viewport.width) ||
    viewport.height < 0 ||
    viewport.width < 0
  ) {
    throw new PretableGridUiError(
      "invalid-ui-state",
      "Grid UI viewport values must be finite with non-negative dimensions.",
    );
  }
  return Object.freeze({ ...viewport });
}

function normalizeColumns<TColumnId extends string>(
  columns: readonly PretableGridUiColumn<TColumnId>[],
): readonly Readonly<PretableGridUiColumnLayout<TColumnId>>[] {
  const ids = new Set<TColumnId>();
  const normalized = columns.map((column) => {
    if (ids.has(column.id)) {
      throw new PretableGridUiError(
        "invalid-ui-state",
        `Duplicate visual column id: ${column.id}`,
      );
    }
    const widthPx = column.widthPx ?? DEFAULT_COLUMN_WIDTH_PX;
    if (!Number.isFinite(widthPx) || widthPx <= 0) {
      throw new PretableGridUiError(
        "invalid-ui-state",
        `Visual column width must be positive for: ${column.id}`,
      );
    }
    ids.add(column.id);
    return Object.freeze({
      id: column.id,
      widthPx,
      ...(column.pinned === undefined ? {} : { pinned: column.pinned }),
    });
  });
  return Object.freeze(orderPinnedColumns(normalized));
}

function orderPinnedColumns<T extends { readonly pinned?: "left" | "right" }>(
  columns: readonly T[],
): T[] {
  return [
    ...columns.filter((column) => column.pinned === "left"),
    ...columns.filter((column) => column.pinned === undefined),
    ...columns.filter((column) => column.pinned === "right"),
  ];
}

function copySelection<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
  TColumnId extends string,
>(
  selection: PretableIndexedSelectionState<TRowId, TColumnId>,
  /**
   * What this write replaces, plus the coordinates to express the result in.
   * A gesture hands over ranges built from row ids alone, so this is where
   * their dataset spans come from — see `adoptIndexedCellRangeSpans`. Absent
   * `loadedWindow` (local mode, the honesty gate not passing, or simply no
   * revision observed yet) is the pre-eviction path: no span is derived, and
   * one already present is carried through untouched rather than dropped,
   * because it is inert without a window and the window is legitimately
   * absent on the render that restores a persisted selection.
   */
  context: {
    readonly replaced: readonly PretableIndexedCellRange<TRowId, TColumnId>[];
    readonly snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>;
    readonly loadedWindow: PretableIndexedSelectionWindow | null;
  },
): PretableIndexedSelectionState<TRowId, TColumnId> {
  const rows =
    selection.rows.kind === "explicit"
      ? Object.freeze({
          kind: "explicit" as const,
          rowIds: toImmutableIndexedSet(selection.rows.rowIds),
          ...(selection.rows.ranges === undefined
            ? {}
            : { ranges: selection.rows.ranges }),
          ...(selection.rows.excludedRanges === undefined
            ? {}
            : { excludedRanges: selection.rows.excludedRanges }),
        })
      : Object.freeze({
          kind: "all" as const,
          ...(selection.rows.excludedRanges === undefined
            ? {}
            : { excludedRanges: selection.rows.excludedRanges }),
        });
  preserveIndexedRowSelectionProgram(selection.rows, rows);
  return Object.freeze({
    rows,
    ranges: Object.freeze(
      adoptIndexedCellRangeSpans(
        selection.ranges.map((range) =>
          Object.freeze({
            start: Object.freeze({ ...range.start }),
            end: Object.freeze({ ...range.end }),
            // Copied, not rebuilt from ids: this is the only public write
            // path, so dropping the span here un-counts every retained range
            // in the selection — including the ones the gesture never
            // touched.
            ...(range.datasetRowSpan === undefined
              ? {}
              : { datasetRowSpan: Object.freeze({ ...range.datasetRowSpan }) }),
          }),
        ),
        context.replaced,
        context.snapshot,
        context.loadedWindow,
      ),
    ),
    anchor:
      selection.anchor === null ? null : Object.freeze({ ...selection.anchor }),
  });
}

function sameFocus<TRowId extends PretableRowId, TColumnId extends string>(
  left: PretableIndexedFocusState<TRowId, TColumnId>,
  right: PretableIndexedFocusState<TRowId, TColumnId>,
): boolean {
  return sameRef(left.ref, right.ref) && left.columnId === right.columnId;
}

function sameSet<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function sameRowRanges<TRowId extends PretableRowId>(
  left: PretableIndexedRowRangeIndex<TRowId> | undefined,
  right: PretableIndexedRowRangeIndex<TRowId> | undefined,
): boolean {
  if (left === right) return true;
  if (left?.size !== right?.size) return false;
  const leftIterator = left?.[Symbol.iterator]();
  const rightIterator = right?.[Symbol.iterator]();
  if (leftIterator === undefined || rightIterator === undefined) return false;
  for (;;) {
    const leftNext = leftIterator.next();
    const rightNext = rightIterator.next();
    if (leftNext.done || rightNext.done)
      return leftNext.done === rightNext.done;
    if (
      !sameValueZero(leftNext.value.startRowId, rightNext.value.startRowId) ||
      !sameValueZero(leftNext.value.endRowId, rightNext.value.endRowId)
    )
      return false;
  }
}

function sameDatasetRowSpan(
  left: PretableIndexedDatasetRowSpan | undefined,
  right: PretableIndexedDatasetRowSpan | undefined,
): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  return (
    left.start === right.start &&
    left.end === right.end &&
    left.datasetKey === right.datasetKey &&
    left.datasetTotal === right.datasetTotal
  );
}

function sameSelection<TRowId extends PretableRowId, TColumnId extends string>(
  left: PretableIndexedSelectionState<TRowId, TColumnId>,
  right: PretableIndexedSelectionState<TRowId, TColumnId>,
): boolean {
  if (left.rows.kind !== right.rows.kind) return false;
  if (!sameIndexedRowSelectionProgram(left.rows, right.rows)) return false;
  let sameRows = false;
  if (left.rows.kind === "explicit" && right.rows.kind === "explicit") {
    const leftRows = left.rows;
    const rightRows = right.rows;
    sameRows =
      sameSet(leftRows.rowIds, rightRows.rowIds) &&
      sameRowRanges(leftRows.excludedRanges, rightRows.excludedRanges) &&
      sameRowRanges(leftRows.ranges, rightRows.ranges);
  } else if (left.rows.kind === "all" && right.rows.kind === "all") {
    sameRows = sameRowRanges(
      left.rows.excludedRanges,
      right.rows.excludedRanges,
    );
  }
  if (!sameRows || left.ranges.length !== right.ranges.length) return false;
  for (let index = 0; index < left.ranges.length; index += 1) {
    const leftRange = left.ranges[index]!;
    const rightRange = right.ranges[index]!;
    if (
      !sameValueZero(leftRange.start.rowId, rightRange.start.rowId) ||
      leftRange.start.columnId !== rightRange.start.columnId ||
      !sameValueZero(leftRange.end.rowId, rightRange.end.rowId) ||
      leftRange.end.columnId !== rightRange.end.columnId ||
      // The span is part of a range's identity, not decoration on it: while
      // the rows are evicted it is the ONLY thing that says how large the
      // selection is, and two ranges over the same ids with different spans
      // select different numbers of rows. Comparing it is safe precisely
      // because `copySelection` recovers a missing span from the selection
      // being replaced — so a controlled `state` echo that drops the field
      // still compares equal, and the effect stays the no-op it has to be.
      !sameDatasetRowSpan(leftRange.datasetRowSpan, rightRange.datasetRowSpan)
    ) {
      return false;
    }
  }
  if (left.anchor === null || right.anchor === null) {
    return left.anchor === right.anchor;
  }
  return (
    sameValueZero(left.anchor.rowId, right.anchor.rowId) &&
    left.anchor.columnId === right.anchor.columnId
  );
}

export function createGridUiCore<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
  TColumnId extends string = ColumnIdOf<TColumns>,
>(
  options: CreateGridUiCoreOptions<TRow, TRowId, TColumns, TColumnId>,
): PretableGridUiCore<TRow, TRowId, TColumns, TColumnId> {
  const listeners = new Set<() => void>();
  const queuedActions: Array<{
    readonly action: () => void;
    readonly projectionToken?: object;
  }> = [];
  const columnLayout = normalizeColumns(options.columns);
  const initialColumnIds: readonly TColumnId[] = Object.freeze(
    columnLayout.map((column) => column.id),
  );
  let cachedNavigationLayout = columnLayout;
  let cachedNavigationColumnIds = initialColumnIds;
  let disposed = false;
  let notifying = false;
  let draining = false;
  let projecting = false;
  let activeProjectionToken: object | undefined;
  // The snapshot as of the last successful reconciliation, paired with the
  // window that was active for it — a single binding rather than two `let`s
  // updated adjacently, so the pairing a later reconciliation converts
  // data-only ranks through (see `provenDeletedRow` in
  // `indexed-selection.ts`) cannot desynchronize.
  let observed:
    | {
        readonly snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>;
        readonly window: PretableIndexedSelectionWindow | null;
      }
    | undefined;
  let state: PretableGridUiState<TRowId, TColumns, TColumnId> = Object.freeze({
    viewport: options.viewport
      ? normalizeViewport(options.viewport)
      : EMPTY_VIEWPORT,
    focus: Object.freeze({ ref: null, columnId: null }),
    selection: createEmptyIndexedSelection<TRowId, TColumnId>(),
    editing: null,
    columnLayout,
    observedRowModelRevision: null,
  });

  const assertActive = (): void => {
    if (disposed) {
      throw new PretableGridUiError(
        "disposed-grid-ui",
        "The grid UI store has been disposed.",
      );
    }
  };

  const drain = (): void => {
    if (notifying || draining || projecting || disposed) return;
    draining = true;
    try {
      while (queuedActions.length > 0 && !disposed) {
        try {
          queuedActions.shift()!.action();
        } catch {
          // Reentrant commands have no synchronous error channel after listener return.
        }
      }
    } finally {
      draining = false;
    }
  };

  const notify = (): void => {
    notifying = true;
    try {
      for (const listener of Array.from(listeners)) {
        try {
          listener();
        } catch {
          // One external-store subscriber cannot block the remaining listeners.
        }
      }
    } finally {
      notifying = false;
    }
    drain();
  };

  const publish = (
    next: PretableGridUiState<TRowId, TColumns, TColumnId>,
  ): void => {
    if (next === state) return;
    state = Object.freeze(next);
    notify();
  };

  const command = (action: () => void): void => {
    assertActive();
    if (notifying || draining || projecting) {
      queuedActions.push({
        action,
        ...(projecting && activeProjectionToken !== undefined
          ? { projectionToken: activeProjectionToken }
          : {}),
      });
      return;
    }
    action();
  };

  const discardProjectionActions = (token: object): void => {
    for (let index = queuedActions.length - 1; index >= 0; index -= 1) {
      if (queuedActions[index]!.projectionToken === token) {
        queuedActions.splice(index, 1);
      }
    }
  };

  const observationError = (
    message: string,
    cause: unknown,
  ): PretableGridUiError =>
    cause instanceof PretableGridUiError &&
    cause.code === "row-model-observation-failed"
      ? cause
      : new PretableGridUiError("row-model-observation-failed", message, cause);

  const snapshotForInteraction = () => {
    try {
      return observed?.snapshot ?? options.rowModel.getState().snapshot;
    } catch (cause) {
      throw new PretableGridUiError(
        "row-model-observation-failed",
        "The row-model snapshot could not be read for a UI interaction.",
        cause,
      );
    }
  };

  /**
   * The snapshot an interaction must express dataset positions in, paired
   * with the window those positions are offsets into.
   *
   * Both come from `observed` — the single binding `observeRowModelRevision`
   * commits atomically — and never from a fresh `getSelectionWindow()` read
   * against a snapshot from some other moment. That combination is a
   * chimera, and it is not hypothetical: the react surface publishes the
   * window from `resultMeta` in an insertion effect, while the matching rows
   * reach the row model through `setRows`, which settles across cooperative
   * slices. In between, the window says "the loaded rows start at 5" and the
   * snapshot still holds the rows that start at 0 — so every loaded row
   * resolves to a position five rows too high, and a selection written in
   * that instant records a span five rows off, permanently.
   *
   * With nothing observed yet there is no committed pairing at all, so the
   * window is reported as absent rather than guessed: no span is derived,
   * which is exactly the pre-eviction behaviour.
   */
  const interactionContext = (): {
    readonly snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>;
    readonly window: PretableIndexedSelectionWindow | null;
  } => observed ?? { snapshot: snapshotForInteraction(), window: null };

  const navigationColumnIds = (): readonly TColumnId[] => {
    if (cachedNavigationLayout !== state.columnLayout) {
      cachedNavigationLayout = state.columnLayout;
      cachedNavigationColumnIds = Object.freeze(
        state.columnLayout.map((column) => column.id),
      );
    }
    return cachedNavigationColumnIds;
  };

  const performDispose = (): void => {
    if (disposed) return;
    disposed = true;
    activeProjectionToken = undefined;
    observed = undefined;
    releaseIndexedRowSelectionProgram(state.selection.rows);
    queuedActions.length = 0;
    const captured = Array.from(listeners);
    listeners.clear();
    for (const listener of captured) {
      try {
        listener();
      } catch {
        // Disposal still detaches every listener after a hostile callback.
      }
    }
  };

  const grid: PretableGridUiCore<TRow, TRowId, TColumns, TColumnId> = {
    rowModel: options.rowModel,
    getState: () => state,
    subscribe(listener) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(listener);
      };
    },
    setViewport(viewport) {
      const next = normalizeViewport(viewport);
      command(() => {
        if (sameViewport(state.viewport, next)) return;
        publish({ ...state, viewport: next });
      });
    },
    setFocus(focus) {
      const next = Object.freeze({
        ref: focus.ref === null ? null : Object.freeze({ ...focus.ref }),
        columnId: focus.columnId,
      });
      command(() => {
        if (sameFocus(state.focus, next)) return;
        publish({ ...state, focus: next });
      });
    },
    moveFocus(movement: PretableIndexedFocusMovement, moveOptions) {
      command(() => {
        let next: typeof state.focus;
        try {
          const context = interactionContext();
          next = moveIndexedFocus({
            snapshot: context.snapshot,
            columns: navigationColumnIds(),
            focus: state.focus,
            movement,
            pageRows: moveOptions?.pageRows,
            // The same window the reconcile path judges absence against, so a
            // keystroke and a revision cannot disagree about whether the
            // cursor's row was evicted or deleted.
            //
            // No `previous`: the only committed snapshot/window pairing at
            // interaction time is this one, so nothing here could prove a
            // deletion anyway — and nothing needs to. A row deleted since the
            // last revision was already reconciled out of `state.focus` when
            // that revision was observed; what is left absent is either
            // evicted or an address a consumer handed to `setFocus`, and
            // holding the cursor is the right answer to both.
            eviction: { window: context.window },
          });
        } catch (cause) {
          throw observationError(
            "Indexed focus navigation could not be completed atomically.",
            cause,
          );
        }
        if (sameFocus(state.focus, next)) return;
        publish({ ...state, focus: next });
      });
    },
    setSelection(selection) {
      let next: PretableIndexedSelectionState<TRowId, TColumnId>;
      try {
        const context = interactionContext();
        next = copySelection(selection, {
          replaced: state.selection.ranges,
          snapshot: context.snapshot,
          loadedWindow: context.window,
        });
      } catch (cause) {
        throw new PretableGridUiError(
          "invalid-ui-state",
          "The supplied selection could not be captured atomically.",
          cause,
        );
      }
      command(() => {
        if (sameSelection(state.selection, next)) return;
        publish({ ...state, selection: next });
      });
    },
    setRowSelection(rows) {
      command(() => {
        let nextRows: PretableIndexedSelectionState<TRowId, TColumnId>["rows"];
        try {
          nextRows = createIndexedRowSelection(rows, snapshotForInteraction());
        } catch (cause) {
          throw observationError(
            "The supplied row selection could not be applied atomically.",
            cause,
          );
        }
        // Value equality, not `sameSelection`: a rebuilt slice never shares the
        // original's semantic program, so `sameSelection` would call every
        // re-application a change and a controlled caller pushing on each
        // render would publish forever.
        if (sameIndexedRowSelectionValue(state.selection.rows, nextRows))
          return;
        publish({
          ...state,
          selection: Object.freeze({ ...state.selection, rows: nextRows }),
        });
      });
    },
    toggleRowSelection(rowId) {
      command(() => {
        let next: typeof state.selection;
        try {
          next = toggleIndexedRowSelection(
            state.selection,
            rowId,
            snapshotForInteraction(),
          );
        } catch (cause) {
          throw observationError(
            "Indexed selection could not be updated atomically.",
            cause,
          );
        }
        if (next === state.selection) return;
        publish({ ...state, selection: next });
      });
    },
    selectRowRange(startRowId, endRowId) {
      command(() => {
        let next: typeof state.selection;
        try {
          next = selectIndexedRowRange(
            state.selection,
            startRowId,
            endRowId,
            snapshotForInteraction(),
          );
        } catch (cause) {
          throw observationError(
            "Indexed row range selection could not be updated atomically.",
            cause,
          );
        }
        if (next === state.selection) return;
        publish({ ...state, selection: next });
      });
    },
    isRowSelected(rowId) {
      try {
        return isIndexedRowSelected(
          state.selection,
          { kind: "data", rowId },
          snapshotForInteraction(),
        );
      } catch (cause) {
        throw observationError(
          "Indexed row selection could not be observed atomically.",
          cause,
        );
      }
    },
    getSelectionSummary() {
      try {
        return getIndexedSelectionSummary(
          state.selection,
          snapshotForInteraction(),
        );
      } catch (cause) {
        throw observationError(
          "Indexed row selection summary could not be observed atomically.",
          cause,
        );
      }
    },
    getCellSelectionSummary() {
      try {
        const context = interactionContext();
        return getIndexedCellSelectionSummary(
          state.selection,
          context.snapshot,
          context.window,
        );
      } catch (cause) {
        throw observationError(
          "Indexed cell selection summary could not be observed atomically.",
          cause,
        );
      }
    },
    selectAllVisibleRows() {
      command(() => {
        let next: typeof state.selection;
        try {
          next = selectAllVisibleRows(
            state.selection,
            snapshotForInteraction(),
          );
        } catch (cause) {
          throw observationError(
            "Indexed select-all could not be updated atomically.",
            cause,
          );
        }
        if (next === state.selection) return;
        publish({ ...state, selection: next });
      });
    },
    clearSelection() {
      command(() => {
        const next = createEmptyIndexedSelection<TRowId, TColumnId>();
        if (
          state.selection.rows.kind === "explicit" &&
          state.selection.rows.rowIds.size === 0 &&
          state.selection.ranges.length === 0 &&
          state.selection.anchor === null
        ) {
          return;
        }
        publish({ ...state, selection: next });
      });
    },
    beginEdit<TEditColumnId extends ColumnIdOf<TColumns>>(input: {
      readonly rowId: TRowId;
      readonly columnId: TEditColumnId;
      readonly value: ColumnValueOf<TColumns, TEditColumnId>;
    }) {
      const editing = Object.freeze({
        rowId: input.rowId,
        columnId: input.columnId,
        value: input.value,
        status: "editing" as const,
      }) as PretableIndexedEditingState<TRowId, TColumns>;
      command(() => {
        const snapshot = observed?.snapshot;
        let visible = false;
        try {
          visible =
            snapshot !== undefined &&
            snapshot.indexOf({ kind: "data", rowId: input.rowId }) >= 0;
        } catch (cause) {
          throw observationError(
            "The edit target could not be resolved atomically.",
            cause,
          );
        }
        // Widened to `string` by assignment (not asserted): `TEditColumnId`
        // ranges over the SCHEMA ids and `columnLayout` over the DRAWN ones,
        // and the question being asked is precisely whether this schema
        // column is among the drawn ones — which no relation between the two
        // parameters can answer, because a presentation layer is free to omit
        // a schema column. So it is answered at runtime, over the one
        // vocabulary both sides provably share.
        const editColumnId: string = input.columnId;
        if (
          !visible ||
          !state.columnLayout.some((column) => column.id === editColumnId)
        ) {
          throw new PretableGridUiError(
            "invalid-ui-state",
            "Editing requires a visible data row and visual column from the observed layout.",
          );
        }
        publish({ ...state, editing });
      });
    },
    setEditDraft(value) {
      command(() => {
        if (state.editing === null || Object.is(state.editing.value, value))
          return;
        publish({
          ...state,
          editing: Object.freeze({
            ...state.editing,
            value,
            status: "editing" as const,
            error: undefined,
          }) as PretableIndexedEditingState<TRowId, TColumns>,
        });
      });
    },
    setEditStatus(status, error) {
      command(() => {
        if (state.editing === null) return;
        if (state.editing.status === status && state.editing.error === error)
          return;
        publish({
          ...state,
          editing: Object.freeze({
            ...state.editing,
            status,
            ...(error === undefined ? { error: undefined } : { error }),
          }) as PretableIndexedEditingState<TRowId, TColumns>,
        });
      });
    },
    cancelEdit() {
      command(() => {
        if (state.editing === null) return;
        publish({ ...state, editing: null });
      });
    },
    setColumns(columns) {
      const nextLayout = normalizeColumns(columns);
      command(() => {
        const same =
          nextLayout.length === state.columnLayout.length &&
          nextLayout.every((column, index) => {
            const current = state.columnLayout[index];
            return (
              current?.id === column.id &&
              current.widthPx === column.widthPx &&
              current.pinned === column.pinned
            );
          });
        if (same) return;
        // `Set<string>`, not `Set<TColumnId>`: `editing.columnId` below is a
        // SCHEMA id, and the drawn vocabulary is a different parameter. The
        // membership question is the same one `beginEdit` asks — is this
        // column still drawn — and it is answerable only over `string`.
        const ids = new Set<string>(nextLayout.map((column) => column.id));
        const focus =
          state.focus.columnId === null || ids.has(state.focus.columnId)
            ? state.focus
            : Object.freeze({ ref: null, columnId: null });
        const ranges = state.selection.ranges.filter(
          (range) =>
            ids.has(range.start.columnId) && ids.has(range.end.columnId),
        );
        const anchor =
          state.selection.anchor !== null &&
          ids.has(state.selection.anchor.columnId)
            ? state.selection.anchor
            : null;
        const selection =
          ranges === state.selection.ranges && anchor === state.selection.anchor
            ? state.selection
            : Object.freeze({ ...state.selection, ranges, anchor });
        publish({
          ...state,
          columnLayout: nextLayout,
          focus,
          selection,
          editing:
            state.editing !== null && ids.has(state.editing.columnId)
              ? state.editing
              : null,
        });
      });
    },
    setColumnWidth(columnId, width) {
      if (!Number.isFinite(width) || width <= 0) {
        throw new PretableGridUiError(
          "invalid-ui-state",
          "Visual column width must be positive.",
        );
      }
      command(() => {
        const index = state.columnLayout.findIndex(
          (column) => column.id === columnId,
        );
        if (index < 0 || state.columnLayout[index]!.widthPx === width) return;
        const next = state.columnLayout.slice();
        next[index] = Object.freeze({ ...next[index]!, widthPx: width });
        publish({
          ...state,
          columnLayout: Object.freeze(orderPinnedColumns(next)),
        });
      });
    },
    setColumnPinned(columnId, pinned) {
      command(() => {
        const index = state.columnLayout.findIndex(
          (column) => column.id === columnId,
        );
        const current = state.columnLayout[index];
        if (current === undefined || (current.pinned ?? null) === pinned)
          return;
        const next = state.columnLayout.slice();
        next[index] = Object.freeze(
          pinned === null
            ? { id: current.id, widthPx: current.widthPx }
            : { ...current, pinned },
        );
        publish({
          ...state,
          columnLayout: Object.freeze(orderPinnedColumns(next)),
        });
      });
    },
    setColumnOrder(nextColumnIds) {
      command(() => {
        if (nextColumnIds.length !== state.columnLayout.length) {
          throw new PretableGridUiError(
            "invalid-ui-state",
            "Column order must contain every visual column exactly once.",
          );
        }
        const byId = new Map(
          state.columnLayout.map((column) => [column.id, column] as const),
        );
        const next = nextColumnIds.map((columnId) => {
          const column = byId.get(columnId);
          if (column === undefined) {
            throw new PretableGridUiError(
              "invalid-ui-state",
              `Unknown or repeated visual column id: ${columnId}`,
            );
          }
          byId.delete(columnId);
          return column;
        });
        if (byId.size > 0) {
          throw new PretableGridUiError(
            "invalid-ui-state",
            "Column order must contain every visual column exactly once.",
          );
        }
        const ordered = orderPinnedColumns(next);
        if (
          ordered.every((column, index) => column === state.columnLayout[index])
        )
          return;
        publish({ ...state, columnLayout: Object.freeze(ordered) });
      });
    },
    observeRowModelRevision(revision) {
      command(() => {
        const token = {};
        activeProjectionToken = token;
        projecting = true;
        let committed = false;
        try {
          const modelState = options.rowModel.getState();
          const snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns> =
            modelState.snapshot;
          const capturedRevision = snapshot.revision;
          if (!Number.isSafeInteger(capturedRevision) || capturedRevision < 0) {
            throw new TypeError(
              "The row-model snapshot revision must be a non-negative safe integer.",
            );
          }
          if (
            capturedRevision !== revision ||
            state.observedRowModelRevision === revision
          ) {
            return;
          }
          const selectionWindow = options.getSelectionWindow?.() ?? null;
          // `observed` is read here, before the sole reassignment below (at
          // the end of this same block, after every read), so it still
          // holds the snapshot/window pairing from the LAST successful
          // commit — the only pairing a data-only rank recorded against
          // `observed.snapshot` is valid for.
          //
          // The cursor and the selection are handed the SAME context, from
          // the same two reads: they have to reach the same verdict about a
          // row, or a grid retains a selection under a cursor that moved.
          const eviction = { window: selectionWindow, previous: observed };
          const focus = reconcileIndexedFocus(state.focus, snapshot, eviction);
          const selection = reconcileIndexedSelection(
            observed === undefined
              ? state.selection
              : projectIndexedSelection(
                  state.selection,
                  observed.snapshot,
                  snapshot,
                  options.rowModel.changesSince(observed.snapshot.revision),
                ),
            snapshot,
            eviction,
          );
          let editing = state.editing;
          if (
            editing !== null &&
            snapshot.indexOf({ kind: "data", rowId: editing.rowId }) < 0
          ) {
            editing = null;
          }

          if (disposed || activeProjectionToken !== token) return;
          const currentModelState = options.rowModel.getState();
          const currentSnapshot = currentModelState.snapshot;
          const currentRevision = currentSnapshot.revision;
          if (
            currentSnapshot !== snapshot ||
            currentRevision !== capturedRevision ||
            currentRevision !== revision
          ) {
            throw new Error(
              "The row-model snapshot changed during atomic UI reconciliation.",
            );
          }
          if (disposed || activeProjectionToken !== token) return;

          observed = { snapshot, window: selectionWindow };
          committed = true;
          publish({
            ...state,
            focus,
            selection,
            editing,
            observedRowModelRevision: revision,
          });
        } catch (cause) {
          if (disposed || activeProjectionToken !== token) return;
          throw observationError(
            "The row-model revision could not be observed atomically.",
            cause,
          );
        } finally {
          if (!committed) discardProjectionActions(token);
          if (activeProjectionToken === token) {
            activeProjectionToken = undefined;
          }
          projecting = false;
          drain();
        }
      });
    },
    dispose() {
      if (disposed) return;
      if (projecting && !notifying) {
        performDispose();
        return;
      }
      if (notifying || draining) {
        queuedActions.push({ action: performDispose });
        return;
      }
      performDispose();
    },
  };

  return grid;
}
