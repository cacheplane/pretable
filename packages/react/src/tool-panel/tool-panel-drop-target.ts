/**
 * Pure insertion-index math for the columns section's row-reorder drag.
 *
 * Extracted from the pointer handlers for the same reason the header drag
 * keeps `computeColumnDropTarget` in its own module: jsdom cannot express
 * real pointer geometry (every rect is 0×0 there), so the only way to unit
 * test "where would this drop land" is to hand the function measured rects
 * and assert on the answer — the vacuous-scroll-test precedent. The pointer
 * handlers measure the DOM and consume this verbatim; Playwright proves the
 * measured half.
 */

/** One rendered row's vertical extent, in any consistent coordinate space. */
export interface ToolRowRect {
  /** The column id the row represents — carried through for the caller. */
  readonly id: string;
  readonly top: number;
  readonly height: number;
  /** Index into the caller's rendered-groups list. */
  readonly groupIndex: number;
}

/** A rendered subgroup's pin value — the drop's re-pin target. */
export interface ToolDropGroup {
  readonly pinned: "left" | "right" | null;
}

export interface ToolDropTarget {
  /**
   * Flat row index the drop inserts BEFORE; `rowRects.length` appends after
   * the last row.
   */
  readonly beforeRow: number;
  /**
   * The subgroup the dropped row would join. At a group boundary the same
   * `beforeRow` exists twice — once as "end of the group above", once as
   * "start of the group below" — and this field is what tells them apart:
   * the insertion slot is identical, the pin value is not.
   */
  readonly groupIndex: number;
  /** Where the indicator line sits, in the input's coordinate space. */
  readonly indicatorY: number;
}

/**
 * Resolve a drag's pointer height to an insertion slot and target subgroup.
 *
 * Within a group the rule is the header drag's, turned vertical: the drop
 * lands before the first row whose midpoint the pointer has not passed (a
 * pointer exactly ON the midpoint has passed it); past every midpoint it
 * appends after the last row. Between two groups there is one extra choice
 * that no horizontal analogue has: the same slot is both "last of the group
 * above" and "first of the group below", with different pin values. The gap
 * between the two rows (where the subgroup label sits) is split at its
 * middle — the upper half keeps the row in the group above, the lower half
 * re-pins it into the group below.
 *
 * `rowRects` must be in rendered order (top ascending), `groupIndex`
 * non-decreasing — which is how the section renders them. Hidden columns are
 * ordinary rows here and occupy slots like any other.
 */
export function dropTargetForPointer(
  y: number,
  rowRects: readonly ToolRowRect[],
  groups: readonly ToolDropGroup[],
): ToolDropTarget | null {
  if (rowRects.length === 0 || groups.length === 0) return null;

  // First row whose midpoint the pointer has NOT passed.
  let before = rowRects.length;
  for (let i = 0; i < rowRects.length; i += 1) {
    const rect = rowRects[i]!;
    if (y < rect.top + rect.height / 2) {
      before = i;
      break;
    }
  }

  if (before === rowRects.length) {
    const last = rowRects[rowRects.length - 1]!;
    return {
      beforeRow: rowRects.length,
      groupIndex: last.groupIndex,
      indicatorY: last.top + last.height,
    };
  }

  const target = rowRects[before]!;
  const previous = before > 0 ? rowRects[before - 1]! : null;

  // A slot between two groups: split the gap the label occupies.
  if (previous !== null && previous.groupIndex !== target.groupIndex) {
    const previousBottom = previous.top + previous.height;
    const split = (previousBottom + target.top) / 2;
    if (y < split) {
      return {
        beforeRow: before,
        groupIndex: previous.groupIndex,
        indicatorY: previousBottom,
      };
    }
  }

  return {
    beforeRow: before,
    groupIndex: target.groupIndex,
    indicatorY: target.top,
  };
}
