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

/** A flex column's floor and ceiling are its contract, whatever width it is
 *  offered — this is the one place both are applied. */
function clampToContract(column: FlexColumnInput, width: number): number {
  return Math.max(
    column.minWidthPx ?? FLEX_FLOOR_PX,
    Math.min(column.maxWidthPx ?? Number.POSITIVE_INFINITY, width),
  );
}

/**
 * Width overrides for the columns that declare `flex`, so a row ends exactly at
 * the viewport edge instead of leaving dead space or overflowing.
 *
 * Returns only the flex columns; an empty object means nothing flexes. When
 * the viewport is unmeasured (the SSR paint) or the fixed columns have already
 * consumed it, each flex column keeps its own width — clamped to its
 * `minWidthPx`/`maxWidthPx`, so the floor holds before measurement and does
 * not jump on hydration.
 *
 * @internal
 */
export function distributeFlexWidths(
  input: DistributeFlexWidthsInput,
): Record<string, number> {
  const flexible = input.columns.filter(
    (column) => column.flex !== undefined && column.flex > 0,
  );
  if (flexible.length === 0) {
    return {};
  }

  const fixedWidth = input.columns
    .filter((column) => column.flex === undefined || column.flex <= 0)
    .reduce((total, column) => total + column.width, 0);
  const leftover = input.viewportWidth - fixedWidth;
  if (!Number.isFinite(input.viewportWidth) || leftover <= 0) {
    // Nothing to share, or nothing measured yet. Keep each column's own width
    // rather than collapsing it to the floor — the grid scrolls horizontally,
    // which beats unreadable. The floor and ceiling still apply: they are the
    // column's contract regardless of whether there is anything to share, so
    // a column declared `{ flex: 1, minWidthPx: 320 }` never draws narrower
    // than 320, on the server or once the fixed columns overflow.
    return Object.fromEntries(
      flexible.map((column) => [
        column.id,
        clampToContract(column, column.width),
      ]),
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

    const clamped = clampToContract(column, share);
    result[column.id] = clamped;
    // Count what was really taken. Because each later share is
    // `cumulativeTarget - actualConsumed`, the columns after a clamped one DO
    // absorb its surplus or shortfall, and the row still ends on the edge
    // (viewport 300, fixed 100, b{flex:1,min:150}, c{flex:1} → b 150, c 50).
    // Only a clamp on the last flex column has nobody left to absorb it, and
    // that is the one case where the row overruns or underfills the viewport.
    actualConsumed += clamped;
  }

  return result;
}
