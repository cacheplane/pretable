import type { ColumnPlan, PlanColumnsInput, PlannedColumn } from "./types";

export function planColumns(input: PlanColumnsInput): ColumnPlan {
  const pinnedLeft: PlannedColumn[] = [];
  const pinnedRight: PlannedColumn[] = [];
  const scrollable: {
    index: number;
    id: string;
    width: number;
    left: number;
  }[] = [];
  let pinnedLeftWidth = 0;
  let pinnedRightWidth = 0;
  let scrollableLeft = 0;

  for (let i = 0; i < input.columns.length; i++) {
    const col = input.columns[i];

    if (col.pinned === "left") {
      pinnedLeft.push({
        index: i,
        id: col.id,
        left: pinnedLeftWidth,
        width: col.width,
        pinned: "left",
      });
      pinnedLeftWidth += col.width;
    } else if (col.pinned === "right") {
      // `right` depends on the columns that come after this one, so it is
      // filled in by a second pass below.
      pinnedRight.push({
        index: i,
        id: col.id,
        left: 0,
        width: col.width,
        pinned: "right",
        right: 0,
      });
      pinnedRightWidth += col.width;
    } else {
      scrollable.push({
        index: i,
        id: col.id,
        width: col.width,
        left: scrollableLeft,
      });
      scrollableLeft += col.width;
    }
  }

  // Second pass, from the end: each right-pinned column is offset from the
  // viewport's right edge by the total width of the right-pinned columns
  // after it, so the last one sits flush at `right: 0`.
  let rightOffset = 0;

  for (let i = pinnedRight.length - 1; i >= 0; i--) {
    const col = pinnedRight[i];
    col.right = rightOffset;
    rightOffset += col.width;
  }

  const totalWidth = pinnedLeftWidth + scrollableLeft + pinnedRightWidth;

  if (scrollable.length === 0) {
    return {
      columns: [...pinnedLeft, ...pinnedRight],
      totalWidth,
      pinnedLeftWidth,
      pinnedRightWidth,
    };
  }

  // Binary search for the first scrollable column visible at scrollLeft
  let low = 0;
  let high = scrollable.length - 1;
  let visibleStart = scrollable.length;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const colRight =
      scrollable[mid].left + scrollable[mid].width + pinnedLeftWidth;

    if (colRight <= input.scrollLeft) {
      low = mid + 1;
    } else {
      visibleStart = mid;
      high = mid - 1;
    }
  }

  // Walk forward to find the end of the visible range.
  //
  // Scrollable offsets are shifted by `pinnedLeftWidth` (they start where the
  // left-pinned group ends), so the left-pinned width is already subtracted
  // from the usable window. The right-pinned group overlays the viewport's
  // trailing edge, so the window has to end before it as well: the effective
  // scrollable width is `viewportWidth - pinnedLeftWidth - pinnedRightWidth`,
  // clamped at zero so pinned widths larger than the viewport can never
  // produce a negative window.
  let visibleEnd = visibleStart;
  const scrollRight =
    input.scrollLeft + Math.max(0, input.viewportWidth - pinnedRightWidth);

  while (visibleEnd < scrollable.length) {
    const colLeft = scrollable[visibleEnd].left + pinnedLeftWidth;

    if (colLeft >= scrollRight) {
      break;
    }

    visibleEnd++;
  }

  // Apply overscan
  const overscanStart = Math.max(0, visibleStart - input.overscan);
  const overscanEnd = Math.min(scrollable.length, visibleEnd + input.overscan);

  const visibleScrollable: PlannedColumn[] = [];

  for (let i = overscanStart; i < overscanEnd; i++) {
    const col = scrollable[i];
    visibleScrollable.push({
      index: col.index,
      id: col.id,
      left: col.left + pinnedLeftWidth,
      width: col.width,
    });
  }

  return {
    columns: [...pinnedLeft, ...visibleScrollable, ...pinnedRight],
    totalWidth,
    pinnedLeftWidth,
    pinnedRightWidth,
  };
}
