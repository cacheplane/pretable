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
  reconcileIndexedSelection,
  selectAllVisibleRows,
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
  PretableIndexedSelectionState,
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

export interface CreateGridUiCoreOptions<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly rowModel: PretableRowModel<TRow, TRowId, TColumns>;
  readonly columns: readonly PretableGridUiColumn<ColumnIdOf<TColumns>>[];
  readonly viewport?: PretableViewportState;
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
  return Object.freeze(
    columns.map((column) => {
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
    }),
  );
}

function copySelection<TRowId extends PretableRowId, TColumnId extends string>(
  selection: PretableIndexedSelectionState<TRowId, TColumnId>,
): PretableIndexedSelectionState<TRowId, TColumnId> {
  const rows =
    selection.rows.kind === "explicit"
      ? Object.freeze({
          kind: "explicit" as const,
          rowIds: toImmutableIndexedSet(selection.rows.rowIds),
        })
      : Object.freeze({
          kind: "all" as const,
          excludedRowIds: toImmutableIndexedSet(selection.rows.excludedRowIds),
        });
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

function sameSelection<TRowId extends PretableRowId, TColumnId extends string>(
  left: PretableIndexedSelectionState<TRowId, TColumnId>,
  right: PretableIndexedSelectionState<TRowId, TColumnId>,
): boolean {
  if (left.rows.kind !== right.rows.kind) return false;
  const sameRows =
    left.rows.kind === "explicit" && right.rows.kind === "explicit"
      ? sameSet(left.rows.rowIds, right.rows.rowIds)
      : left.rows.kind === "all" && right.rows.kind === "all"
        ? sameSet(left.rows.excludedRowIds, right.rows.excludedRowIds)
        : false;
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
  const queuedActions: Array<() => void> = [];
  const columnLayout = normalizeColumns(options.columns);
  const initialColumnIds = Object.freeze(
    columnLayout.map((column) => column.id),
  ) as readonly ColumnIdOf<TColumns>[];
  let cachedNavigationLayout = columnLayout;
  let cachedNavigationColumnIds = initialColumnIds;
  let disposed = false;
  let notifying = false;
  let draining = false;
  let observedSnapshot:
    PretableRowModelSnapshot<TRow, TRowId, TColumns> | undefined;
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
    if (notifying || draining || disposed) return;
    draining = true;
    try {
      while (queuedActions.length > 0 && !disposed) {
        try {
          queuedActions.shift()!();
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
    if (notifying || draining) {
      queuedActions.push(action);
      return;
    }
    action();
  };

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
        const next = moveIndexedFocus({
          snapshot: snapshotForInteraction(),
          columns: navigationColumnIds(),
          focus: state.focus,
          movement,
          pageRows: moveOptions?.pageRows,
        });
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
    toggleRowSelection(rowId) {
      command(() => {
        const next = toggleIndexedRowSelection(
          state.selection,
          rowId,
          snapshotForInteraction(),
        );
        if (next === state.selection) return;
        publish({ ...state, selection: next });
      });
    },
    selectAllVisibleRows() {
      command(() => {
        const next = selectAllVisibleRows(
          state.selection,
          snapshotForInteraction(),
        );
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
        if (
          snapshot === undefined ||
          !state.columnLayout.some((column) => column.id === input.columnId) ||
          snapshot.indexOf({ kind: "data", rowId: input.rowId }) < 0
        ) {
          throw new PretableGridUiError(
            "invalid-ui-state",
            "Editing requires a visible data row and visual column from the observed layout.",
          );
        }
        publish({ ...state, editing });
      });
    },
    cancelEdit() {
      command(() => {
        if (state.editing === null) return;
        publish({ ...state, editing: null });
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
        publish({ ...state, columnLayout: Object.freeze(next) });
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
        publish({ ...state, columnLayout: Object.freeze(next) });
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
        if (next.every((column, index) => column === state.columnLayout[index]))
          return;
        publish({ ...state, columnLayout: Object.freeze(next) });
      });
    },
    observeRowModelRevision(revision) {
      command(() => {
        let snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>;
        try {
          snapshot = options.rowModel.getState().snapshot;
        } catch (cause) {
          throw new PretableGridUiError(
            "row-model-observation-failed",
            "The row-model snapshot could not be observed atomically.",
            cause,
          );
        }
        if (
          snapshot.revision !== revision ||
          state.observedRowModelRevision === revision
        ) {
          return;
        }
        let focus: typeof state.focus;
        let selection: typeof state.selection;
        let editing = state.editing;
        try {
          focus = reconcileIndexedFocus(state.focus, snapshot);
          selection = reconcileIndexedSelection(state.selection, snapshot);
          if (
            editing !== null &&
            snapshot.indexOf({ kind: "data", rowId: editing.rowId }) < 0
          ) {
            editing = null;
          }
        } catch (cause) {
          throw new PretableGridUiError(
            "row-model-observation-failed",
            "The row-model revision could not be reconciled atomically.",
            cause,
          );
        }
        observedSnapshot = snapshot;
        publish({
          ...state,
          focus,
          selection,
          editing,
          observedRowModelRevision: revision,
        });
      });
    },
    dispose() {
      if (disposed) return;
      if (notifying || draining) {
        queuedActions.push(performDispose);
        return;
      }
      performDispose();
    },
  };

  return grid;
}
