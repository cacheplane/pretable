import type {
  PinnedColumnInput,
  PlannedPinnedColumn,
  PlannedRow,
  PlanViewportInput,
  ViewportPlan,
} from "./types";

export function planViewport(input: PlanViewportInput): ViewportPlan {
  const rowMetrics = input.rowMetrics;
  // Unloaded regions are pure geometry: no rows are materialized for them, so
  // they consume no aria-rowindex and need no focus/selection/copy exemptions.
  // That is what lets the extent span more than the loaded window without
  // violating the no-placeholder-rows rule.
  const leading = Math.max(0, input.leadingHeight ?? 0);
  const trailing = Math.max(0, input.trailingHeight ?? 0);
  const totalHeight = leading + rowMetrics.getTotalHeight() + trailing;
  const rowCount = rowMetrics.rowCount;
  const overscan =
    Number.isFinite(input.overscan) && input.overscan > 0
      ? Math.floor(input.overscan)
      : 0;

  if (rowCount === 0) {
    return {
      range: { start: 0, end: 0 },
      rows: [],
      totalHeight,
      pinned: {
        left: planPinnedColumns(input.pinnedLeft ?? [], "left"),
        right: planPinnedColumns(input.pinnedRight ?? [], "right"),
      },
    };
  }

  const clampedScrollTop = Math.max(
    0,
    Math.min(input.scrollTop, Math.max(0, totalHeight - 1)),
  );
  // Offsets inside the loaded window are measured from the window's own top.
  const windowScrollTop = Math.max(0, clampedScrollTop - leading);
  const visibleStart = Math.min(
    rowCount - 1,
    rowMetrics.getIndexForOffset(windowScrollTop),
  );
  const visibleEndExclusive = Math.min(
    rowCount,
    Math.max(
      visibleStart + 1,
      rowMetrics.getIndexForOffset(
        windowScrollTop + Math.max(0, input.viewportHeight),
      ) + 1,
    ),
  );
  const start = Math.max(0, visibleStart - overscan);
  const end = Math.min(rowCount, visibleEndExclusive + overscan);
  const rows: PlannedRow[] = [];
  let top = leading + rowMetrics.getOffsetForIndex(start);

  for (let index = start; index < end; index += 1) {
    const height = rowMetrics.getHeight(index);
    rows.push({
      index,
      top,
      height,
    });
    top += height;
  }

  return {
    range: { start, end },
    rows,
    totalHeight,
    pinned: {
      left: planPinnedColumns(input.pinnedLeft ?? [], "left"),
      right: planPinnedColumns(input.pinnedRight ?? [], "right"),
    },
  };
}

function planPinnedColumns(
  columns: readonly PinnedColumnInput[],
  side: "left" | "right",
): PlannedPinnedColumn[] {
  let offset = 0;

  return columns.map((column) => {
    const planned = {
      ...column,
      side,
      start: offset,
      end: offset + column.width,
    };

    offset = planned.end;
    return planned;
  });
}
