import {
  createRowMetricsIndex,
  planColumns,
  planViewport,
} from "@pretable-internal/layout-core";
import type { GridCoreColumn, GridCoreRow } from "@pretable-internal/grid-core";
import { layoutPreparedText, prepareText } from "@pretable-internal/text-core";

import type { DomRenderInput, DomRenderSnapshot } from "./types";

const DEFAULT_ROW_HEIGHT = 44;
const WRAPPED_COLUMN_WIDTH = 220;
const FIXED_COLUMN_WIDTH = 140;
const ROW_LINE_HEIGHT = 22;
const ROW_CHROME_HEIGHT = 42;
const ESTIMATED_CHARACTER_WIDTH = 7;
const ESTIMATE_FONT_KEY = "Pretable Estimate 14";
const estimatedRowHeightCache = new WeakMap<
  object,
  {
    height: number;
    signature: string;
    columnsRef: unknown;
  }
>();

export function createDomRenderSnapshot<TRow extends GridCoreRow>(
  input: DomRenderInput<TRow>,
): DomRenderSnapshot<TRow> {
  const rowHeights = input.snapshot.visibleRows.map((entry) => {
    const measuredHeight = input.measuredHeights?.[entry.id];

    return measuredHeight ?? estimateRowHeight(entry.row, input.columns);
  });
  const rowMetrics = createRowMetricsIndex(rowHeights);
  const viewportPlan = planViewport({
    scrollTop: input.scrollTop,
    viewportHeight: input.viewportHeight,
    overscan: input.overscan,
    rowMetrics,
    pinnedLeft: input.columns
      .filter((column) => column.pinned === "left")
      .map((column) => ({
        columnId: column.id,
        width: getColumnWidth(column),
      })),
  });
  const rows = viewportPlan.rows.flatMap((plannedRow) => {
    const entry = input.snapshot.visibleRows[plannedRow.index];

    if (!entry) {
      return [];
    }

    return [
      {
        id: entry.id,
        row: entry.row,
        rowIndex: plannedRow.index,
        top: plannedRow.top,
        height: plannedRow.height,
      },
    ];
  });

  const WRAPPED_COLUMN_WIDTH_FOR_PLAN = 220;
  const FIXED_COLUMN_WIDTH_FOR_PLAN = 140;

  const columnInputs = input.columns.map((col) => ({
    id: col.id,
    width: col.widthPx ?? (col.wrap ? WRAPPED_COLUMN_WIDTH_FOR_PLAN : FIXED_COLUMN_WIDTH_FOR_PLAN),
    pinned: col.pinned,
  }));

  const columnPlan =
    input.viewportWidth !== undefined
      ? planColumns({
          columns: columnInputs,
          scrollLeft: input.scrollLeft ?? 0,
          viewportWidth: input.viewportWidth,
          overscan: input.overscan,
        })
      : {
          columns: columnInputs.map((col, index) => {
            let left = 0;
            for (let i = 0; i < index; i++) {
              left += columnInputs[i].width;
            }
            return { index, id: col.id, left, width: col.width, pinned: col.pinned };
          }),
          totalWidth: columnInputs.reduce((sum, col) => sum + col.width, 0),
          pinnedLeftWidth: columnInputs
            .filter((col) => col.pinned === "left")
            .reduce((sum, col) => sum + col.width, 0),
        };

  return {
    frame: {
      snapshot: input.snapshot,
    },
    rows,
    columns: columnPlan.columns,
    nodeCount: rows.length * columnPlan.columns.length,
    totalHeight: viewportPlan.totalHeight,
    totalWidth: columnPlan.totalWidth,
  };
}

function estimateRowHeight<TRow extends GridCoreRow>(
  row: TRow,
  columns: GridCoreColumn<TRow>[],
): number {
  const cached = estimatedRowHeightCache.get(row);

  if (cached && cached.columnsRef === columns) {
    return cached.height;
  }

  const signature = getEstimatedRowHeightSignature(row, columns);

  if (cached?.signature === signature) {
    cached.columnsRef = columns;
    return cached.height;
  }

  let estimatedHeight = DEFAULT_ROW_HEIGHT;

  for (const column of columns) {
    if (!column.wrap) {
      continue;
    }

    const prepared = prepareText({
      text: String(readCellValue(row, column)),
      fontKey: ESTIMATE_FONT_KEY,
      averageCharWidth: ESTIMATED_CHARACTER_WIDTH,
    });
    const layout = layoutPreparedText(prepared, getColumnWidth(column), {
      lineHeightPx: ROW_LINE_HEIGHT,
      wrapMode: "wrap",
    });

    estimatedHeight = Math.max(
      estimatedHeight,
      layout.height + ROW_CHROME_HEIGHT,
    );
  }

  estimatedRowHeightCache.set(row, {
    signature,
    height: estimatedHeight,
    columnsRef: columns,
  });

  return estimatedHeight;
}

function getEstimatedRowHeightSignature<TRow extends GridCoreRow>(
  row: TRow,
  columns: GridCoreColumn<TRow>[],
) {
  return columns
    .filter((column) => column.wrap)
    .map((column) => {
      const value = String(readCellValue(row, column) ?? "");

      return `${column.id}:${getColumnWidth(column)}:${value}`;
    })
    .join("|");
}

function readCellValue<TRow extends GridCoreRow>(
  row: TRow,
  column: GridCoreColumn<TRow>,
): unknown {
  return column.getValue ? column.getValue(row) : row[column.id];
}

function getColumnWidth<TRow extends GridCoreRow>(
  column: GridCoreColumn<TRow>,
): number {
  return (
    column.widthPx ?? (column.wrap ? WRAPPED_COLUMN_WIDTH : FIXED_COLUMN_WIDTH)
  );
}
