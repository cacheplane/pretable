import {
  scrollTopToReveal,
  type RowMetricsReader,
} from "@pretable-internal/layout-core";
import type {
  PretableRowId,
  PretableRowModelSnapshot,
  PretableVisibleRow,
  PretableVisibleRowRef,
} from "@pretable-internal/row-model";

import { evictionRetentionWindow, provenDeletedRow } from "./indexed-selection";
import type {
  PretableIndexedEvictionContext,
  PretableIndexedFocusMovement,
  PretableIndexedFocusState,
} from "./types";

function refOf<TRow extends object, TRowId extends PretableRowId, TColumns>(
  row: PretableVisibleRow<TRow, TRowId, TColumns>,
): PretableVisibleRowRef<TRowId> {
  return row.kind === "data"
    ? { kind: "data", rowId: row.rowId }
    : { kind: "group", groupId: row.groupId };
}

function emptyFocus<TRowId extends PretableRowId, TColumnId extends string>() {
  return Object.freeze({
    ref: null,
    columnId: null,
  }) as PretableIndexedFocusState<TRowId, TColumnId>;
}

function focusAt<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
  TColumnId extends string,
>(
  snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
  index: number,
  columnId: TColumnId,
): PretableIndexedFocusState<TRowId, TColumnId> | undefined {
  const row = snapshot.rowAt(index);
  return row === undefined
    ? undefined
    : Object.freeze({ ref: refOf(row), columnId });
}

/**
 * Where the cursor sits once `snapshot` has replaced the one it was placed
 * against.
 *
 * An absent focused row is TWO different situations, and the window is what
 * tells them apart — the same discriminator `reconcileIndexedSelection` uses,
 * reached through the same `provenDeletedRow`:
 *
 * - **Evicted** (absent, outside the loaded window): the row is coming back,
 *   so the cursor is RETAINED. Re-seating here is what made a scroll away and
 *   back move the user's cursor silently; Excel and AG Grid both keep it where
 *   it was left and scroll it back into view. The spec's §5 rule — "re-seat to
 *   the nearest surviving row" — was written before this distinction existed,
 *   when an absent row could only mean a deleted one.
 * - **Deleted, hidden or unprovable-under-no-window** (absent from a span that
 *   IS loaded): re-seat to the nearest survivor, exactly as before.
 *
 * With no window — local mode — this is byte-for-byte the pre-eviction
 * function: `retentionWindow` is null, so every absent row re-seats.
 */
export function reconcileIndexedFocus<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
  TColumnId extends string,
>(
  focus: PretableIndexedFocusState<TRowId, TColumnId>,
  snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
  eviction?: PretableIndexedEvictionContext<TRow, TRowId, TColumns>,
): PretableIndexedFocusState<TRowId, TColumnId> {
  if (focus.ref === null || focus.columnId === null) return emptyFocus();
  if (snapshot.indexOf(focus.ref) >= 0) return focus;
  const retentionWindow = evictionRetentionWindow(eviction);
  if (
    retentionWindow !== null &&
    // Group refs are not dataset rows: they have no data-only rank to convert
    // into a dataset position, so eviction can never be proven or disproven
    // for one. A collapsed or regrouped header re-seats to its ancestor as it
    // always did.
    focus.ref.kind === "data" &&
    !provenDeletedRow(focus.ref.rowId, retentionWindow, eviction?.previous)
  ) {
    return focus;
  }
  const nearest = snapshot.nearestVisibleRef(focus.ref);
  if (nearest === undefined || snapshot.indexOf(nearest) < 0)
    return emptyFocus();
  return Object.freeze({ ref: nearest, columnId: focus.columnId });
}

export function moveIndexedFocus<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
  TColumnId extends string,
>(input: {
  readonly snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>;
  readonly columns: readonly TColumnId[];
  readonly focus: PretableIndexedFocusState<TRowId, TColumnId>;
  readonly movement: PretableIndexedFocusMovement;
  readonly pageRows?: number;
}): PretableIndexedFocusState<TRowId, TColumnId> {
  const { snapshot, columns, movement } = input;
  if (columns.length === 0 || snapshot.visibleRowCount === 0)
    return emptyFocus();
  const lastColumnIndex = columns.length - 1;
  if (input.focus.ref === null || input.focus.columnId === null) {
    const reverseRow =
      movement === "up" || movement === "end" || movement === "shift-tab";
    const reverseColumn = movement === "left" || movement === "shift-tab";
    return (
      focusAt(
        snapshot,
        reverseRow ? snapshot.visibleRowCount - 1 : 0,
        columns[reverseColumn ? lastColumnIndex : 0]!,
      ) ?? emptyFocus()
    );
  }
  const current = reconcileIndexedFocus(input.focus, snapshot);
  if (current.ref === null || current.columnId === null) return current;
  const rowIndex = snapshot.indexOf(current.ref);
  if (rowIndex < 0) return emptyFocus();
  let columnIndex = columns.indexOf(current.columnId);
  if (columnIndex < 0) columnIndex = 0;

  if (movement === "parent") {
    const parent = snapshot.parentGroupOf(current.ref);
    return parent === undefined
      ? current
      : Object.freeze({
          ref: { kind: "group" as const, groupId: parent.groupId },
          columnId: current.columnId,
        });
  }
  if (movement === "left" || movement === "right") {
    const delta = movement === "left" ? -1 : 1;
    const nextColumn =
      columns[Math.max(0, Math.min(lastColumnIndex, columnIndex + delta))]!;
    return nextColumn === current.columnId
      ? current
      : Object.freeze({ ref: current.ref, columnId: nextColumn });
  }
  if (movement === "tab" || movement === "shift-tab") {
    const delta = movement === "tab" ? 1 : -1;
    if (
      (delta > 0 &&
        rowIndex === snapshot.visibleRowCount - 1 &&
        columnIndex === lastColumnIndex) ||
      (delta < 0 && rowIndex === 0 && columnIndex === 0)
    ) {
      return current;
    }
    let nextRow = rowIndex;
    let nextColumn = columnIndex + delta;
    if (nextColumn > lastColumnIndex) {
      nextColumn = 0;
      nextRow += 1;
    } else if (nextColumn < 0) {
      nextColumn = lastColumnIndex;
      nextRow -= 1;
    }
    nextRow = Math.max(0, Math.min(snapshot.visibleRowCount - 1, nextRow));
    return focusAt(snapshot, nextRow, columns[nextColumn]!) ?? current;
  }
  const pageRows =
    Number.isSafeInteger(input.pageRows) && (input.pageRows ?? 0) > 0
      ? input.pageRows!
      : 10;
  const nextRow =
    movement === "home"
      ? 0
      : movement === "end"
        ? snapshot.visibleRowCount - 1
        : Math.max(
            0,
            Math.min(
              snapshot.visibleRowCount - 1,
              rowIndex +
                (movement === "up"
                  ? -1
                  : movement === "down"
                    ? 1
                    : movement === "page-up"
                      ? -pageRows
                      : pageRows),
            ),
          );
  return nextRow === rowIndex
    ? current
    : (focusAt(snapshot, nextRow, current.columnId) ?? current);
}

export function getScrollTopForIndexedFocus<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(input: {
  readonly snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>;
  readonly ref: PretableVisibleRowRef<TRowId>;
  readonly rowMetrics: RowMetricsReader;
  readonly scrollTop: number;
  readonly viewportHeight: number;
}): number | null | undefined {
  const targetIndex = input.snapshot.indexOf(input.ref);
  if (targetIndex < 0) return null;
  return scrollTopToReveal({
    rowMetrics: input.rowMetrics,
    targetIndex,
    scrollTop: input.scrollTop,
    viewportHeight: input.viewportHeight,
  });
}
