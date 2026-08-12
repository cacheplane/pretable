import { DEFAULT_ROW_HEIGHT } from "./rendering";

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
    parsePxLength(style.borderTopWidth) +
    parsePxLength(style.borderBottomWidth);

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
 * `minRowHeight` is the active theme's `--pretable-row-height` for the current
 * density tier, resolved by the caller — the surface reads it once per render
 * through the same store that drives density, rather than every row doing its
 * own `getComputedStyle` on the document element.
 *
 * It defaults to {@link DEFAULT_ROW_HEIGHT} for the no-theme case only. Passing
 * a constant here is what made three of the nine shipped density tiers
 * unreachable: Excel's rows are 20/24/32px and both other themes are 40 at
 * compact, so a 44 floor simply won.
 *
 * @internal
 */
export function measureRenderedRowHeight(
  row: HTMLElement,
  minRowHeight: number = DEFAULT_ROW_HEIGHT,
) {
  const style = getComputedStyle(row);
  const verticalPadding =
    parsePxLength(style.paddingTop) + parsePxLength(style.paddingBottom);
  const borderHeight = parsePxLength(style.borderBottomWidth);
  // Every cell, unconditionally. This used to measure only
  // `[data-pretable-wrap="true"]` cells whenever the row had any, falling back
  // to all cells only when it had none. That was an optimisation and it was
  // wrong: any TALLER non-wrap cell in a row that also carried a wrap column
  // was excluded from the max and silently clipped — a two-line presentation
  // (a signed delta over its percentage, say) rendered at single-line height.
  // jsdom has no layout engine, so the clipping was invisible to unit tests and
  // only ever showed in a browser. `Math.max` over every cell is the correct
  // definition of a row's content height, and the cells are already being
  // walked, so the narrower query bought nothing.
  const measuredCells = [
    ...row.querySelectorAll<HTMLElement>("[data-pretable-cell]"),
  ];
  const contentHeight = Math.max(
    0,
    ...measuredCells
      .map((cell) => measureCellContentHeight(cell))
      .filter(Number.isFinite),
  );

  return Math.max(
    minRowHeight,
    Math.ceil(contentHeight + verticalPadding + borderHeight),
  );
}
