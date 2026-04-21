import type { ColumnPlan, PlanColumnsInput, PlannedColumn } from "./types";

export function planColumns(input: PlanColumnsInput): ColumnPlan {
  const pinned: PlannedColumn[] = [];
  const scrollable: {
    index: number;
    id: string;
    width: number;
    left: number;
  }[] = [];
  let pinnedLeftWidth = 0;
  let scrollableLeft = 0;

  for (let i = 0; i < input.columns.length; i++) {
    const col = input.columns[i];

    if (col.pinned === "left") {
      pinned.push({
        index: i,
        id: col.id,
        left: pinnedLeftWidth,
        width: col.width,
        pinned: "left",
      });
      pinnedLeftWidth += col.width;
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

  const totalWidth = pinnedLeftWidth + scrollableLeft;

  if (scrollable.length === 0) {
    return { columns: pinned, totalWidth, pinnedLeftWidth };
  }

  // Binary search for the first scrollable column visible at scrollLeft
  let low = 0;
  let high = scrollable.length - 1;
  let visibleStart = 0;

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

  // Walk forward to find the end of the visible range
  let visibleEnd = visibleStart;
  const scrollRight = input.scrollLeft + input.viewportWidth;

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
    columns: [...pinned, ...visibleScrollable],
    totalWidth,
    pinnedLeftWidth,
  };
}
