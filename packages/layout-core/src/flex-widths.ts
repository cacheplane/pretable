/** @internal */
export interface FlexColumnInput {
  id: string;
  /** The width the column would take without flexing. */
  width: number;
  /** Share of the leftover width. Absent means the column does not flex. */
  flex?: number;
  minWidthPx?: number;
  maxWidthPx?: number;
}

/** @internal */
export interface DistributeFlexWidthsInput {
  columns: readonly FlexColumnInput[];
  /** `Number.POSITIVE_INFINITY` when the viewport has not been measured. */
  viewportWidth: number;
}

/** Below this a column is a sliver with no room for content. */
const FLEX_FLOOR_PX = 24;

/**
 * Width overrides for the columns that declare `flex`, so a row ends exactly at
 * the viewport edge instead of leaving dead space or overflowing.
 *
 * Returns only the columns it changes — an empty object means "use the widths
 * you already had", which is the answer whenever nothing flexes, the viewport
 * is unmeasured, or the fixed columns have already consumed it.
 *
 * @internal
 */
export function distributeFlexWidths(
  input: DistributeFlexWidthsInput,
): Record<string, number> {
  const flexible = input.columns.filter(
    (column) => column.flex !== undefined && column.flex > 0,
  );
  if (flexible.length === 0 || !Number.isFinite(input.viewportWidth)) {
    return {};
  }

  const fixedWidth = input.columns
    .filter((column) => column.flex === undefined || column.flex <= 0)
    .reduce((total, column) => total + column.width, 0);
  const leftover = input.viewportWidth - fixedWidth;
  if (leftover <= 0) {
    // Nothing to share. Keep each column's own width rather than collapsing it
    // to the floor — the grid scrolls horizontally, which beats unreadable.
    return Object.fromEntries(
      flexible.map((column) => [column.id, column.width]),
    );
  }

  const totalFlex = flexible.reduce(
    (total, column) => total + (column.flex ?? 0),
    0,
  );
  const result: Record<string, number> = {};
  // Track the ideal (unrounded) running total and subtract what has actually
  // been handed out, so rounding error cannot accumulate across columns and
  // leave a one-pixel gap at the right edge.
  let idealConsumed = 0;
  let actualConsumed = 0;

  for (let index = 0; index < flexible.length; index += 1) {
    const column = flexible[index]!;
    const isLast = index === flexible.length - 1;
    idealConsumed += (leftover * (column.flex ?? 0)) / totalFlex;
    const target = isLast ? leftover : Math.round(idealConsumed);
    const share = target - actualConsumed;

    const clamped = Math.max(
      column.minWidthPx ?? FLEX_FLOOR_PX,
      Math.min(column.maxWidthPx ?? Number.POSITIVE_INFINITY, share),
    );
    result[column.id] = clamped;
    // Count what was really taken: a clamped column must not make the columns
    // after it absorb its shortfall or surplus.
    actualConsumed += clamped;
  }

  return result;
}
