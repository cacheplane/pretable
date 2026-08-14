import type {
  ColumnIdOf,
  ColumnValueOf,
  PretableRowId,
  PretableRowModel,
  PretableRowModelSnapshot,
  PretableVisibleRowRef,
} from "@pretable-internal/row-model";

import { moveIndexedFocus, reconcileIndexedFocus } from "./indexed-focus";
import {
  createEmptyIndexedSelection,
  createIndexedRowSelection,
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
  PretableIndexedEditingState,
  PretableIndexedFocusMovement,
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

/** Options accepted by the UI-only grid facade. @public */
export interface CreateGridUiCoreOptions<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly rowModel: PretableRowModel<TRow, TRowId, TColumns>;
  readonly columns: readonly PretableGridUiColumn<ColumnIdOf<TColumns>>[];
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
  left: PretableVisibleRowRef<TRowId> | null,
  right: PretableVisibleRowRef<TRowId> | null,
): boolean {
  if (left === right) return true;
  if (left === null || right === null || left.kind !== right.kind) return false;
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

function copySelection<TRowId extends PretableRowId, TColumnId extends string>(
  selection: PretableIndexedSelectionState<TRowId, TColumnId>,
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
      selection.ranges.map((range) =>
        Object.freeze({
          start: Object.freeze({ ...range.start }),
          end: Object.freeze({ ...range.end }),
        }),
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
      leftRange.end.columnId !== rightRange.end.columnId
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
>(
  options: CreateGridUiCoreOptions<TRow, TRowId, TColumns>,
): PretableGridUiCore<TRow, TRowId, TColumns> {
  const listeners = new Set<() => void>();
  const queuedActions: Array<{
    readonly action: () => void;
    readonly projectionToken?: object;
  }> = [];
  const columnLayout = normalizeColumns(options.columns);
  const initialColumnIds = Object.freeze(
    columnLayout.map((column) => column.id),
  ) as readonly ColumnIdOf<TColumns>[];
  let cachedNavigationLayout = columnLayout;
  let cachedNavigationColumnIds = initialColumnIds;
  let disposed = false;
  let notifying = false;
  let draining = false;
  let projecting = false;
  let activeProjectionToken: object | undefined;
  let observedSnapshot:
    PretableRowModelSnapshot<TRow, TRowId, TColumns> | undefined;
  // The window active for `observedSnapshot`, tracked alongside it so a
  // later reconciliation can convert that snapshot's data-only ranks into
  // absolute dataset positions — see `provenDeletedRow` in
  // `indexed-selection.ts`. Reset in lockstep with `observedSnapshot`
  // everywhere that field is.
  let observedWindow: PretableIndexedSelectionWindow | null = null;
  let state: PretableGridUiState<TRowId, TColumns> = Object.freeze({
    viewport: options.viewport
      ? normalizeViewport(options.viewport)
      : EMPTY_VIEWPORT,
    focus: Object.freeze({ ref: null, columnId: null }),
    selection: createEmptyIndexedSelection<TRowId, ColumnIdOf<TColumns>>(),
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

  const publish = (next: PretableGridUiState<TRowId, TColumns>): void => {
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
      return observedSnapshot ?? options.rowModel.getState().snapshot;
    } catch (cause) {
      throw new PretableGridUiError(
        "row-model-observation-failed",
        "The row-model snapshot could not be read for a UI interaction.",
        cause,
      );
    }
  };

  const navigationColumnIds = (): readonly ColumnIdOf<TColumns>[] => {
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
    observedSnapshot = undefined;
    observedWindow = null;
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

  const grid: PretableGridUiCore<TRow, TRowId, TColumns> = {
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
          next = moveIndexedFocus({
            snapshot: snapshotForInteraction(),
            columns: navigationColumnIds(),
            focus: state.focus,
            movement,
            pageRows: moveOptions?.pageRows,
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
      let next: PretableIndexedSelectionState<TRowId, ColumnIdOf<TColumns>>;
      try {
        next = copySelection(selection);
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
        let nextRows: PretableIndexedSelectionState<
          TRowId,
          ColumnIdOf<TColumns>
        >["rows"];
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
        const next = createEmptyIndexedSelection<
          TRowId,
          ColumnIdOf<TColumns>
        >();
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
    beginEdit<TColumnId extends ColumnIdOf<TColumns>>(input: {
      readonly rowId: TRowId;
      readonly columnId: TColumnId;
      readonly value: ColumnValueOf<TColumns, TColumnId>;
    }) {
      const editing = Object.freeze({
        rowId: input.rowId,
        columnId: input.columnId,
        value: input.value,
        status: "editing" as const,
      }) as PretableIndexedEditingState<TRowId, TColumns>;
      command(() => {
        const snapshot = observedSnapshot;
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
        if (
          !visible ||
          !state.columnLayout.some((column) => column.id === input.columnId)
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
        const ids = new Set(nextLayout.map((column) => column.id));
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
          const focus = reconcileIndexedFocus(state.focus, snapshot);
          // Captured before either mutable field is reassigned below, so
          // reconciliation sees exactly the snapshot/window pairing that was
          // current as of the LAST successful commit — the only pairing a
          // data-only rank recorded against `observedSnapshot` is valid for.
          const priorSnapshot = observedSnapshot;
          const priorWindow = observedWindow;
          const selectionWindow = options.getSelectionWindow?.() ?? null;
          const selection = reconcileIndexedSelection(
            observedSnapshot === undefined
              ? state.selection
              : projectIndexedSelection(
                  state.selection,
                  observedSnapshot,
                  snapshot,
                  options.rowModel.changesSince(observedSnapshot.revision),
                ),
            snapshot,
            selectionWindow,
            priorSnapshot,
            priorWindow,
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

          observedSnapshot = snapshot;
          observedWindow = selectionWindow;
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
