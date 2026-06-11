const MIN_ROW_HEIGHT = 44;

function parsePxLength(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Intrinsic content height of a single cell — the height the cell needs to show
 * its content without clipping, independent of the cell's currently applied box
 * height.
 *
 * Cells flex-stretch to the row height (`height: 100%`), so `cell.scrollHeight`
 * reports the *applied* row height rather than the content's natural height.
 * Feeding that back into the row-height calc creates a measurement loop: under
 * frequent re-renders (e.g. streaming updates) the row height never settles and
 * visibly drifts. Worse, a flex container does not grow `scrollHeight` to cover
 * an overflowing flex item, so wrapped multi-line content is also under-measured
 * and clipped.
 *
 * A DOM `Range` over the cell's contents measures the rendered content extent
 * (text nodes and elements alike) regardless of the stretched box, which makes
 * the measurement idempotent. We add the cell's own vertical padding/border to
 * recover the padding-box height that `scrollHeight` used to (correctly) include.
 *
 * jsdom has no layout engine, so `getBoundingClientRect()` returns zero there;
 * we fall back to `scrollHeight` so non-DOM unit tests keep their behavior.
 */
function measureCellContentHeight(cell: HTMLElement): number {
  // jsdom has no layout engine — every element reports a zero-size box. There we
  // keep the original scrollHeight-based measurement so the non-DOM unit tests
  // hold. (A real browser always gives the cell a non-zero width.)
  const cellRect = cell.getBoundingClientRect();
  if (cellRect.width <= 0 && cellRect.height <= 0) {
    return cell.scrollHeight;
  }

  const style = getComputedStyle(cell);
  const padding =
    parsePxLength(style.paddingTop) + parsePxLength(style.paddingBottom);
  const border =
    parsePxLength(style.borderTopWidth) + parsePxLength(style.borderBottomWidth);

  // Measure the intrinsic content extent with a Range — independent of the
  // cell's flex-stretched box height, so the result is idempotent. We must NOT
  // read `scrollHeight` here: a cell stretches to the row height (height:100%),
  // so its scrollHeight reports the applied row height back and feeds into a
  // measurement loop that, under frequent re-renders, never settles. An empty
  // cell legitimately measures 0; the row-level MIN clamp covers that.
  let content = 0;
  try {
    const range = cell.ownerDocument.createRange();
    range.selectNodeContents(cell);
    const rect = range.getBoundingClientRect();
    content = rect ? rect.height : 0;
  } catch {
    content = 0;
  }
  if (!Number.isFinite(content) || content < 0) {
    content = 0;
  }

  return content + padding + border;
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
    ...measuredCells
      .map((cell) => measureCellContentHeight(cell))
      .filter(Number.isFinite),
  );

  return Math.max(
    MIN_ROW_HEIGHT,
    Math.ceil(contentHeight + verticalPadding + borderHeight),
  );
}
