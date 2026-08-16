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
  PretableHeaderRowRef,
  PretableIndexedEvictionContext,
  PretableIndexedFocusMovement,
  PretableIndexedFocusRef,
  PretableIndexedFocusState,
} from "./types";

/**
 * The one header address there is.
 *
 * Frozen and shared so identity comparison short-circuits — `sameRef` in
 * `create-grid-ui-core` still compares structurally, because a consumer may
 * hand in its own `{kind: "header"}` literal through `setFocus`.
 *
 * @internal Re-exported by `@pretable/core` as `ɵHEADER_FOCUS_REF`.
 */
export const HEADER_FOCUS_REF: PretableHeaderRowRef = Object.freeze({
  kind: "header",
});

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
  // The header strip is not a row. The row model cannot evict it, delete it or
  // re-seat it, so a header cursor survives every snapshot byte-identical.
  // Falling through would be actively wrong rather than merely wasteful:
  // `indexOf` would report -1 for an address that is perfectly valid, and the
  // re-seat below would silently move the cursor onto a data row on the first
  // streaming patch.
  if (focus.ref.kind === "header") return focus;
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
  const headerColumnId =
    input.focus.ref !== null &&
    input.focus.ref.kind === "header" &&
    input.focus.columnId !== null
      ? input.focus.columnId
      : null;
  if (columns.length === 0) return emptyFocus();
  // A grid with no rows still has a header, and a cursor already parked on it
  // stays there. Only the row-addressed cursors collapse.
  if (snapshot.visibleRowCount === 0 && headerColumnId === null)
    return emptyFocus();
  const lastColumnIndex = columns.length - 1;

  if (headerColumnId !== null) {
    const columnIndex = Math.max(0, columns.indexOf(headerColumnId));
    const onHeader = (
      index: number,
    ): PretableIndexedFocusState<TRowId, TColumnId> =>
      Object.freeze({
        ref: HEADER_FOCUS_REF,
        columnId: columns[Math.max(0, Math.min(lastColumnIndex, index))]!,
      });
    const intoBody = (): PretableIndexedFocusState<TRowId, TColumnId> =>
      focusAt(snapshot, 0, headerColumnId) ?? onHeader(columnIndex);

    // Exhaustive on purpose, with no `default:`. Every movement in
    // `PretableIndexedFocusMovement` states what it does on a header cell here,
    // so adding a movement later is a compile error rather than a silent
    // fall-through onto a row-addressed code path that would call `indexOf`
    // with a header ref.
    switch (movement) {
      case "left":
        return onHeader(columnIndex - 1);
      case "right":
        return onHeader(columnIndex + 1);
      // The header is one row, so a vertical edge jump has nowhere to go and
      // the only edge it can mean is a column edge. `home` / `end` and the
      // explicitly horizontal pair therefore coincide here, and only here.
      case "home":
      case "first-column":
        return onHeader(0);
      case "end":
      case "last-column":
        return onHeader(lastColumnIndex);
      // The header is the top. `up` and `page-up` have nowhere further to go,
      // and consuming them is what stops an ArrowUp streak from popping focus
      // out of the grid entirely.
      case "up":
      case "page-up":
        return onHeader(columnIndex);
      // A header cell has no parent group — `parentGroupOf` would need a row.
      case "parent":
        return onHeader(columnIndex);
      case "down":
      case "page-down":
        return intoBody();
      // The header reads as the row above row 0 for a wrap walk: forward off
      // the last header column lands on the first body cell. Backward off the
      // first column returns unchanged, which is the same top-left corner
      // `shift-tab` already reports for row 0 — the surface releases there
      // rather than clamping, so this cannot become a keyboard trap.
      case "tab":
        return columnIndex === lastColumnIndex
          ? (focusAt(snapshot, 0, columns[0]!) ?? onHeader(columnIndex))
          : onHeader(columnIndex + 1);
      case "shift-tab":
        return onHeader(columnIndex - 1);
    }
  }

  if (input.focus.ref === null || input.focus.columnId === null) {
    const reverseRow =
      movement === "up" || movement === "end" || movement === "shift-tab";
    const reverseColumn =
      movement === "left" ||
      movement === "shift-tab" ||
      movement === "last-column";
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
  // Unreachable in practice — the header block above returned for every header
  // cursor, and `reconcileIndexedFocus` cannot manufacture one. It is written
  // as a real branch rather than a cast so that the compiler narrows `ref` to a
  // ROW ref for the whole rest of this function: everything below indexes into
  // the row model, and an address the row model has never heard of must not be
  // able to reach it even if a future edit reorders these blocks.
  if (current.ref.kind === "header") return current;
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
  // The horizontal edges. Same row, opposite ends of it — the counterpart of
  // `home` / `end` below, which move along the other axis.
  if (movement === "first-column" || movement === "last-column") {
    const nextColumn =
      columns[movement === "first-column" ? 0 : lastColumnIndex]!;
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
  // Up off the first row lands on that column's HEADER cell, which is the only
  // way into the header now that its controls are out of the tab order. Before
  // this, ArrowUp on row 0 was a silent no-op.
  //
  // Deliberately `up` only. `page-up` still clamps at row 0: a page step is a
  // scroll-sized jump through rows, and having it fall off the top into a
  // single header cell would make "page up twice" mean two different things.
  if (movement === "up" && rowIndex === 0) {
    return Object.freeze({
      ref: HEADER_FOCUS_REF,
      columnId: current.columnId,
    });
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
  readonly ref: PretableIndexedFocusRef<TRowId>;
  readonly rowMetrics: RowMetricsReader;
  readonly scrollTop: number;
  readonly viewportHeight: number;
}): number | null | undefined {
  // The header is sticky: it is on screen at every scroll offset, so there is
  // nothing to reveal. `null` is this function's existing "already resolved,
  // do not write a scrollTop" answer — the same one an in-view row gets — and
  // is what stops a move onto the header from yanking the body to row 0.
  if (input.ref.kind === "header") return null;
  const targetIndex = input.snapshot.indexOf(input.ref);
  if (targetIndex < 0) return null;
  return scrollTopToReveal({
    rowMetrics: input.rowMetrics,
    targetIndex,
    scrollTop: input.scrollTop,
    viewportHeight: input.viewportHeight,
  });
}
