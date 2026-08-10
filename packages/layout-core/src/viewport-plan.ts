import type {
  PinnedColumnInput,
  PlannedPinnedColumn,
  PlannedRow,
  PlanViewportInput,
  ViewportPlan,
} from "./types";

export function planViewport(input: PlanViewportInput): ViewportPlan {
  const rowMetrics = input.rowMetrics;
  const totalHeight = rowMetrics.getTotalHeight();
  const rowCount = rowMetrics.rowCount;

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
  const visibleStart = Math.min(
    rowCount - 1,
    rowMetrics.getIndexForOffset(clampedScrollTop),
  );
  const visibleEndExclusive = Math.min(
    rowCount,
    Math.max(
      visibleStart + 1,
      rowMetrics.getIndexForOffset(
        clampedScrollTop + Math.max(0, input.viewportHeight),
      ) + 1,
    ),
  );
  const start = Math.max(0, visibleStart - Math.max(0, input.overscan));
  const end = Math.min(
    rowCount,
    visibleEndExclusive + Math.max(0, input.overscan),
  );
  const rows: PlannedRow[] = [];
  let top = rowMetrics.getOffsetForIndex(start);

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
