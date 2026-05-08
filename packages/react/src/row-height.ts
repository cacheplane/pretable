const MIN_ROW_HEIGHT = 44;

function parsePxLength(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * DOM measurement helper used internally by the surface's row-height accounting. Not part of the user-facing API.
 *
 * @internal
 */
export function measureRenderedRowHeight(row: HTMLElement) {
  const style = getComputedStyle(row);
  const verticalPadding =
    parsePxLength(style.paddingTop) + parsePxLength(style.paddingBottom);
  const borderHeight = parsePxLength(style.borderBottomWidth);
  const wrappedCells = [
    ...row.querySelectorAll<HTMLElement>(
      '[data-pretable-cell][data-pretable-wrap="true"]',
    ),
  ];
  const measuredCells =
    wrappedCells.length > 0
      ? wrappedCells
      : [...row.querySelectorAll<HTMLElement>("[data-pretable-cell]")];
  const contentHeight = Math.max(
    0,
    ...measuredCells.map((cell) => cell.scrollHeight).filter(Number.isFinite),
  );

  return Math.max(
    MIN_ROW_HEIGHT,
    Math.ceil(contentHeight + verticalPadding + borderHeight),
  );
}
