import type { PlannedColumn } from "@pretable-internal/renderer-dom";

/**
 * Where a column-reorder drag would drop, and where to draw the indicator.
 *
 * Three coordinate spaces meet in the reorder gesture and mixing them is what
 * made the drop index drift once the grid scrolled sideways:
 *
 * - **client** — what a pointer event reports (`event.clientX`).
 * - **viewport** — client x rebased on the scrollport's left edge. This is the
 *   space columns are *seen* in, and the only space where sticky (pinned) and
 *   scrolling columns can be compared against each other.
 * - **content** — the column plan's own space (`PlannedColumn.left`), which the
 *   absolutely positioned drop indicator lives in because it scrolls with the
 *   content.
 *
 * Hit-testing happens in viewport space; the indicator position is converted
 * back to content space on the way out.
 */
export interface ColumnDropTargetInput {
  /**
   * Every column, in content order, with content offsets — not just the
   * virtualization window. Off-window columns are legitimate drop targets
   * once the grid scrolls.
   */
  layout: readonly PlannedColumn[];
  /** Engine index of the column being dragged. */
  draggedIndex: number;
  /** Pointer x in client coordinates. */
  cursorX: number;
  /** The scrollport's left edge in client coordinates. */
  viewportLeft: number;
  /** The scrollport's `clientWidth`; `0` when it has not been measured yet. */
  viewportWidth: number;
  /** The scrollport's `scrollLeft`. */
  scrollLeft: number;
}

export interface ColumnDropTarget {
  /** Index to hand `grid.moveColumn`. */
  dropIndex: number;
  /** Indicator offset in content coordinates. */
  indicatorLeft: number;
}

/**
 * A column's left edge in viewport space — where it is actually seen.
 *
 * Scrollable columns slide by `scrollLeft`. Pinned columns are sticky and do
 * not: a left pin sits at its offset within the left-pinned group (which is
 * also its content offset), and a right pin sits at `right` px from the
 * scrollport's trailing edge. An unmeasured scrollport (SSR, pre-layout) has no
 * trailing edge to resolve against, so right pins fall back to their content
 * offset — the same fallback the renderer makes.
 */
function viewportLeftOf(
  column: PlannedColumn,
  scrollLeft: number,
  viewportWidth: number,
): number {
  if (column.pinned === "left") {
    return column.left;
  }
  if (
    column.pinned === "right" &&
    column.right !== undefined &&
    viewportWidth > 0
  ) {
    return viewportWidth - column.right - column.width;
  }
  return column.left - scrollLeft;
}

/**
 * Resolve a reorder drag's pointer position to a drop index and an indicator
 * position.
 *
 * The cursor lands on the boundary before the first column whose visual
 * midpoint it has not passed; past every midpoint it lands after the last
 * column. Pinned columns are hit-tested first: they are sticky, so they paint
 * over whatever has scrolled beneath them, and a boundary hidden behind a
 * pinned strip is not one the user can aim at.
 */
export function computeColumnDropTarget(
  input: ColumnDropTargetInput,
): ColumnDropTarget {
  const {
    layout,
    draggedIndex,
    cursorX,
    viewportLeft,
    viewportWidth,
    scrollLeft,
  } = input;
  const x = cursorX - viewportLeft;
  const leftOf = (column: PlannedColumn) =>
    viewportLeftOf(column, scrollLeft, viewportWidth);

  // Drop *after* the last column: `moveColumn` removes the dragged column
  // before re-inserting it, so appending to the shortened array is
  // `length - 1`.
  const dropAtEnd = (): ColumnDropTarget => {
    const last = layout[layout.length - 1];
    if (!last) return { dropIndex: 0, indicatorLeft: 0 };
    return {
      dropIndex: layout.length - 1,
      indicatorLeft: leftOf(last) + last.width + scrollLeft,
    };
  };

  // Drop *before* the column at content position `pos`. The same removal
  // makes every later column shift down one, so a rightward drag has to aim
  // one slot lower than the target's own index — otherwise the column lands
  // past the boundary the indicator drew.
  const dropBefore = (pos: number): ColumnDropTarget => {
    const column = layout[pos];
    if (!column) return dropAtEnd();
    return {
      dropIndex: column.index > draggedIndex ? column.index - 1 : column.index,
      indicatorLeft: leftOf(column) + scrollLeft,
    };
  };

  for (let i = 0; i < layout.length; i += 1) {
    const column = layout[i]!;
    if (!column.pinned) continue;
    const left = leftOf(column);
    if (x >= left && x < left + column.width) {
      return x < left + column.width / 2 ? dropBefore(i) : dropBefore(i + 1);
    }
  }

  for (let i = 0; i < layout.length; i += 1) {
    const column = layout[i]!;
    if (x < leftOf(column) + column.width / 2) {
      return dropBefore(i);
    }
  }

  return dropAtEnd();
}
