const MIN_ROW_HEIGHT = 44;

export function measureRenderedRowHeight(row: HTMLElement) {
  const style = getComputedStyle(row);
  const verticalPadding =
    parseFloat(style.paddingTop || "0") + parseFloat(style.paddingBottom || "0");
  const borderHeight = parseFloat(style.borderBottomWidth || "0");
  const contentHeight = Math.max(
    0,
    ...[...row.querySelectorAll<HTMLElement>("[data-pretable-cell]")]
      .map((cell) => cell.scrollHeight)
      .filter(Number.isFinite),
  );

  return Math.max(
    MIN_ROW_HEIGHT,
    Math.ceil(contentHeight + verticalPadding + borderHeight),
  );
}
