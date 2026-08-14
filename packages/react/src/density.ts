import { useCallback, useRef, useSyncExternalStore } from "react";

import type {
  RenderAdvance,
  RenderAdvances,
  RowBoxMetrics,
} from "@pretable-internal/renderer-dom";
import { type DensityHeights, getDensityHeights } from "@pretable/ui";

import { DEFAULT_ROW_HEIGHT } from "./rendering";
import { findSampleCell } from "./sample-cell";
import { invalidateGridTextMetrics } from "./text-metrics";

const FALLBACK_ROW_HEIGHT = 32;
const FALLBACK_HEADER_HEIGHT = 36;

export type { DensityHeights };

/**
 * The theme store: one `MutationObserver` on `<html>`, shared by every hook and
 * cache in this package that depends on the active theme.
 *
 * It was one observer per `useSyncExternalStore` subscriber before. Sharing it
 * is not the point though — the point is that a theme or density swap now has a
 * single place that learns about it, so the hooks that re-render and the
 * estimator caches that must be re-read cannot drift apart.
 *
 * Created lazily on the first subscription, so nothing touches `document` at
 * module scope and a server render never builds one.
 */
const themeSubscribers = new Set<() => void>();
let themeObserver: MutationObserver | null = null;

function handleThemeMutation(): void {
  // Mark, don't clear. Both caches re-read on their next call and keep their
  // last good value until then; a clear would put a null on the estimator's
  // path for every estimate between the swap and the next paint.
  markRowBoxMetricsStale();
  markRenderAdvancesStale();
  invalidateGridTextMetrics();
  for (const callback of themeSubscribers) callback();
}

function subscribe(callback: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  themeSubscribers.add(callback);
  if (themeObserver === null) {
    themeObserver = new MutationObserver(handleThemeMutation);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-density", "data-theme", "class", "style"],
    });
  }
  return () => {
    themeSubscribers.delete(callback);
    if (themeSubscribers.size === 0) {
      themeObserver?.disconnect();
      themeObserver = null;
    }
  };
}

/**
 * React hook returning the current density heights derived from the
 * active CSS theme. Internal — `<Pretable>` and `<PretableSurface>` use
 * this; external consumers should reach for `getDensityHeights` from
 * `@pretable/ui`.
 *
 * @internal
 */
export function useResolvedHeights(
  rowHeightProp?: number,
  headerHeightProp?: number,
): DensityHeights {
  const cachedClient = useRef<DensityHeights | null>(null);
  const cachedServer = useRef<DensityHeights | null>(null);

  const getSnapshot = useCallback(() => {
    const css = getDensityHeights();
    const rowHeight = rowHeightProp ?? css.rowHeight;
    const headerHeight = headerHeightProp ?? css.headerHeight;
    const prev = cachedClient.current;
    if (
      prev !== null &&
      prev.rowHeight === rowHeight &&
      prev.headerHeight === headerHeight
    ) {
      return prev;
    }
    const next = { rowHeight, headerHeight };
    cachedClient.current = next;
    return next;
  }, [rowHeightProp, headerHeightProp]);

  const getServerSnapshot = useCallback(() => {
    const rowHeight = rowHeightProp ?? FALLBACK_ROW_HEIGHT;
    const headerHeight = headerHeightProp ?? FALLBACK_HEADER_HEIGHT;
    const prev = cachedServer.current;
    if (
      prev !== null &&
      prev.rowHeight === rowHeight &&
      prev.headerHeight === headerHeight
    ) {
      return prev;
    }
    const next = { rowHeight, headerHeight };
    cachedServer.current = next;
    return next;
  }, [rowHeightProp, headerHeightProp]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function readPx(name: string, fallback: number): number {
  if (typeof document === "undefined") return fallback;
  const styles = getComputedStyle(document.documentElement);
  // Defensive, matching `getDensityHeights`: some test environments mock
  // getComputedStyle with plain objects that don't implement
  // getPropertyValue. Treat that as "unset" rather than throwing.
  if (typeof styles?.getPropertyValue !== "function") return fallback;
  const match = styles
    .getPropertyValue(name)
    .trim()
    .match(/^([\d.]+)px$/);
  return match ? parseFloat(match[1]) : fallback;
}

function noopSubscribe(): () => void {
  return () => {};
}

/**
 * One-shot read of the active theme's row height, for the places that need it
 * before there is a component to hook from — the row-layout controller is
 * constructed once per row model and takes its estimate default up front.
 *
 * Falls back to {@link DEFAULT_ROW_HEIGHT}, matching the surface's measured
 * floor, so the estimate for an unmeasured row and the floor for a measured
 * one agree in every case including no-theme. They disagreed by construction
 * before: both were 44, so a themed grid estimated its scroll extent at one
 * height and measured rows at another.
 *
 * @internal
 */
export function getThemeRowHeight(): number {
  return readPx("--pretable-row-height", DEFAULT_ROW_HEIGHT);
}

/**
 * The row box, as CSS states it.
 *
 * Declared by `@pretable-internal/renderer-dom`, which is the consumer — the
 * estimator lives there — and re-exported here because this module is where it
 * is read. See that declaration for why these were being inferred and why the
 * inference was harmful.
 *
 * @internal
 */
export type { RowBoxMetrics };

// Every fallback below is today's *effective* value, not a nicer number, so an
// unthemed grid's estimates do not move when the estimator starts reading this.
//
// `ROW_LINE_HEIGHT` and `ROW_CHROME_HEIGHT` in
// `@pretable-internal/renderer-dom`'s `create-renderer.ts` are the constants
// being replaced; they are private to that module, so the values are restated
// here and pinned by test.
const FALLBACK_LINE_HEIGHT_PX = 24;
// grid.css writes `var(--pretable-rule-width, 1px)` for the cell's borders, so
// 1px is the no-theme border, not a guess.
const FALLBACK_BORDER_PX = 1;
// The estimator's `ROW_CHROME_HEIGHT`. Chrome is `2 × paddingY + border`, so
// the padding fallback is derived from the chrome it has to reproduce rather
// than written out as `20.5` — the identity is the point, and a literal would
// silently stop matching if either of its two terms changed.
const FALLBACK_CHROME_PX = 42;
const FALLBACK_PADDING_Y_PX = (FALLBACK_CHROME_PX - FALLBACK_BORDER_PX) / 2;
// Zero, because today's estimator wraps at the full column width. A no-theme
// grid must keep wrapping exactly where it did; only a theme that states its
// padding moves the text box in.
const FALLBACK_PADDING_X_PX = 0;

/**
 * The element that actually forms the cell's line boxes.
 *
 * A cell is not always the element laying out its own text. The homepage hero
 * renders its wrapped column as `<cell><span class="analyst">text<badge/>…`,
 * the cell is `display: flex`, and the span establishes its own inline
 * formatting context — so the span's `line-height` (1.45 → **20.3px** at 14px)
 * governs the line boxes, not the 21px the cell reports. Reading the cell
 * over-charged every wrapped line by 0.7px.
 *
 * The rule, stated so it can be re-derived: **descend into the single element
 * child while the current element delegates all of its text**, and stop at the
 * first element that either
 *
 *   - holds non-whitespace text directly (it is forming the line boxes), or
 *   - has other than exactly one element child (nothing to descend to, or
 *     several candidates and no way to say which one governs).
 *
 * Both stop conditions land on the ancestor, which is what was read before this
 * existed — so anything the rule declines to resolve keeps today's answer rather
 * than guessing. In the hero it stops on `span.analyst`: one element child (the
 * badge), but text of its own.
 *
 * Cheap by construction — it walks single-child links only, so its depth is the
 * cell's own nesting depth, and it runs once per theme change alongside the
 * `getComputedStyle` it feeds, never per estimate.
 */
function findTextLayoutElement(cell: Element): Element {
  let current = cell;
  for (;;) {
    for (const node of current.childNodes) {
      if (
        node.nodeType === 3 /* Node.TEXT_NODE */ &&
        (node.textContent ?? "").trim() !== ""
      ) {
        return current;
      }
    }
    const only =
      current.children.length === 1 ? current.children[0] : undefined;
    if (only === undefined) return current;
    current = only;
  }
}

/**
 * Line height is the one term with no token behind it.
 *
 * `--pretable-cell-padding-x/-y` and `--pretable-rule-width` are all in the
 * token contract (`packages/ui/src/__tests__/contract.test.ts`); line height is
 * not, and no theme sets `line-height` on a cell at all — cells take
 * `font-size: var(--pretable-font-size-cell)` and inherit `normal`. The used
 * value therefore exists only on a rendered element, where the computed font
 * shorthand resolves it (`14px / 21px …` in the hero).
 *
 * So: read it off the element that lays the text out (see
 * {@link findTextLayoutElement}), and fall back only when there is no cell to
 * read or the browser reports a non-pixel value (`normal`, a unitless ratio,
 * jsdom's empty string). Never parse to `NaN`.
 */
function readLineHeightPx(cell: Element | null, fallback: number): number {
  if (cell === null) return fallback;
  return resolveLineHeightPx(findTextLayoutElement(cell)) ?? fallback;
}

/**
 * The used `line-height` of one element in px, or `null` when the browser does
 * not report one (`normal`, a unitless ratio, jsdom's empty string, no
 * `getComputedStyle` at all).
 *
 * Split out of {@link readLineHeightPx} because the render-advance resolution
 * needs the same number for an element it has already found, and must be able
 * to tell "unreadable" from "the fallback" — its arithmetic is meaningless
 * without the real one, so it declines where the box metrics substitute.
 */
function resolveLineHeightPx(element: Element): number | null {
  if (typeof getComputedStyle !== "function") return null;
  const styles = getComputedStyle(element);
  if (typeof styles?.lineHeight !== "string") return null;
  const match = styles.lineHeight.trim().match(/^([\d.]+)px$/);
  return match ? parseFloat(match[1]) : null;
}

/**
 * One-shot read of the active theme's row box, for the estimator — which runs
 * before layout and so cannot measure the row it is predicting.
 *
 * Pass the cell to read line height from. Passing nothing looks one up in the
 * document; passing `null` says explicitly that there is none yet, which is the
 * state on the first render and during SSR.
 *
 * @internal
 */
export function getThemeBoxMetrics(sampleCell?: Element | null): RowBoxMetrics {
  const cell = sampleCell === undefined ? findSampleCell() : sampleCell;

  return {
    lineHeightPx: readLineHeightPx(cell, FALLBACK_LINE_HEIGHT_PX),
    paddingXPx: readPx("--pretable-cell-padding-x", FALLBACK_PADDING_X_PX),
    paddingYPx: readPx("--pretable-cell-padding-y", FALLBACK_PADDING_Y_PX),
    borderPx: readPx("--pretable-rule-width", FALLBACK_BORDER_PX),
  };
}

// The grid's own box, once something has rendered to read it off. Held here
// rather than derived per call; see the two reasons inside the function.
let gridRowBox: RowBoxMetrics | null = null;
// Set by the theme store when `<html>` changes. Marks the box for a re-read on
// the next call; it is not cleared, so the last good box stays available in the
// meantime.
let gridRowBoxStale = false;

function markRowBoxMetricsStale(): void {
  gridRowBoxStale = true;
}

function sameBox(a: RowBoxMetrics, b: RowBoxMetrics): boolean {
  return (
    a.lineHeightPx === b.lineHeightPx &&
    a.paddingXPx === b.paddingXPx &&
    a.paddingYPx === b.paddingYPx &&
    a.borderPx === b.borderPx
  );
}

/**
 * The row box of the grid actually on screen, or `null` when nothing has
 * rendered yet.
 *
 * Null before the first paint is the correct answer rather than a failure: the
 * estimator then keeps the constants it used before the box existed, and the
 * next call — after cells exist — reads for real. Nothing is cached on the null
 * path, so the pre-render miss does not become permanent.
 *
 * The cache is load-bearing twice over, not micro-optimisation.
 *
 * 1. The controller asks for this on EVERY row estimate, deliberately, because
 *    line height is only readable once a cell has rendered. An uncached getter
 *    costs a `querySelector` plus a `getComputedStyle` per estimate — the shape
 *    that measured at 679ms of a 1 187ms bench-app test under jsdom.
 * 2. The estimate memo compares the box by IDENTITY. A getter that rebuilt an
 *    equal-but-distinct object per call would miss the memo on every row and
 *    re-run text layout for all of them.
 *
 * A theme or density swap changes every term of this box — Excel states 6/8/12px
 * of horizontal padding across its density tiers where Material states 16 — so
 * the theme store above marks it stale and the next call re-reads. That is one
 * bounded resolution per swap — {@link findSampleCell}'s two selectors and one
 * `getComputedStyle` on the element {@link findTextLayoutElement} picks out; the
 * per-estimate path is still a flag test and a return.
 *
 * A stale re-read that resolves to the same numbers returns the SAME object, so
 * the estimate memo's identity comparison still holds and an unrelated `class`
 * or `style` write on `<html>` cannot force a re-layout of every row.
 *
 * @internal
 */
export function getGridRowBoxMetrics(): RowBoxMetrics | null {
  if (gridRowBox !== null && !gridRowBoxStale) return gridRowBox;
  if (typeof document === "undefined") return gridRowBox;
  const cell = findSampleCell();
  // No cell means no line height to read, and the padding tokens alone would
  // be a half-resolved box. Wait for one — keeping the previous box, and the
  // stale mark, until there is something to read the new one off.
  if (cell === null) return gridRowBox;
  const next = getThemeBoxMetrics(cell);
  gridRowBoxStale = false;
  if (gridRowBox !== null && sameBox(gridRowBox, next)) return gridRowBox;
  gridRowBox = next;
  return next;
}

/** @internal */
export function resetRowBoxMetricsCacheForTesting(): void {
  gridRowBox = null;
  gridRowBoxStale = false;
}

/**
 * What the estimator cannot see: content a `render` draws BESIDE the text.
 *
 * The estimator wraps `readCellValue(row, column)` — the raw string. The
 * homepage hero's analyst column renders that string followed by a stance badge
 * (`hold` / `watch` / `trim`), and the badge is invisible to the raw value while
 * still consuming width, which pushes text onto a line box the estimate never
 * counts. Twelve of 48 measured hero rows, 236px, 55 per cent of the
 * estimator's remaining systematic under-estimate.
 *
 * This function is the WIDTH half of that. The badge also makes the line box it
 * sits on taller than a line of text, which is {@link measureLastLineBox}; the
 * two are resolved together off the same element in the same pass, and this
 * one's declines gate both.
 *
 * ## What "non-text content" means here, precisely
 *
 * For one rendered cell of a wrapped column, let the *layout element* be the
 * one {@link findTextLayoutElement} picks — the element forming the line boxes.
 * The advance is the summed outer width (border box plus horizontal margins) of
 * that element's ELEMENT children.
 *
 * **It covers** the shape where the wrapped text is a direct text node of the
 * layout element and everything else beside it is an element: `text` +
 * trailing chip, leading icon + `text`, both at once. That is the hero, and it
 * is the common case, because a renderer that wants its ornament to sit on the
 * text's line has to make it a sibling inline of that text.
 *
 * **It declines**, yielding `0` — today's behaviour, byte for byte — when:
 *
 *   - the layout element holds no non-whitespace text of its own, so nothing
 *     in it can be identified as the string the estimator is wrapping. A render
 *     that boxes its text (`<b>text</b><chip/>`) lands here: which child is the
 *     prose and which is the ornament is not decidable from the DOM, and
 *     guessing is what this series has spent seven PRs unwinding.
 *   - any element child does not occupy exactly one client rect. Zero rects
 *     means it is not laid out (`display: none`); two or more mean it wrapped,
 *     so it is flow content participating in the wrap rather than a fixed
 *     advance beside it. Either way its footprint is not one number.
 *
 * **How a reader tells which case they are in:** look at the deepest element
 * holding the cell's text directly. If the text sits there as a text node and
 * the extras are single-line element siblings, the advance is measured. If the
 * text is itself inside an element, or an extra wraps, nothing is charged and
 * the column estimates exactly as it did before this existed.
 *
 * A cell with no text content AT ALL is neither — it is uninformative, not a
 * decline, and it is why this retries; see {@link resolveRenderAdvances}.
 */
function measureRenderAdvance(layoutElement: Element): number {
  let total = 0;
  for (const child of layoutElement.children) {
    // A host that cannot report geometry cannot report an advance — jsdom lays
    // nothing out, so it lands on the empty rect list below. Zero is the honest
    // answer there, and it is also the pre-existing behaviour.
    if (typeof child.getClientRects !== "function") return 0;
    const rects = child.getClientRects();
    if (rects.length !== 1) return 0;
    const rect = rects[0];
    if (rect === undefined) return 0;
    const styles =
      typeof getComputedStyle === "function" ? getComputedStyle(child) : null;
    const width =
      rect.width +
      readMarginPx(styles?.marginLeft) +
      readMarginPx(styles?.marginRight);
    if (!Number.isFinite(width) || width <= 0) continue;
    total += width;
  }
  return total;
}

/**
 * The height of the line box the render's output sits on, or `null` when it
 * cannot be measured.
 *
 * ## Why this is not the drawn element's height
 *
 * The plan for this term said "model the last line box as
 * `max(lineHeight, tallestInlineHeight)` — or whatever the browser actually
 * does; probe it". The browser does not do that, and the probe is the only
 * reason we know. Against the running hero in Chromium, measuring the hero's
 * own badge in its own cell (clones appended to the live cell, so the inherited
 * font and line-height are identical), with a zero-size inline-block appended
 * to read the baseline's y:
 *
 *   line-height (computed)            20.3px      (laid out at 20.296875px)
 *   badge border box                  21.25px
 *   strut       ascent / descent      14.99375 / 5.296875
 *   badge       ascent / descent      13.625   / 7.625
 *   last line box, measured           22.61875px
 *   max(lineHeight, badge height)     21.25px      ← the model that was assumed
 *   max(ascents) + max(descents)      22.61875px   ← what the browser does
 *
 * The badge is `vertical-align: baseline`, so its box is split at ITS baseline
 * and each half is maxed against the strut's corresponding half. It is SHORTER
 * than the strut above the baseline and TALLER below it, so the line box
 * exceeds both boxes. Forcing `vertical-align: top` on the same badge collapses
 * the line box to 21.24375px — the `max` model — which is how we know the
 * baseline split is the cause and not an accident of these numbers.
 *
 * Control, same probe: deleting the badge from the clone gives a last line box
 * of 20.290625px, i.e. the line height. Nothing else in that cell is tall.
 *
 * ## So it is measured, not modelled
 *
 * Reproducing `max(ascent) + max(descent)` in this package would need the
 * inline's baseline offset, which is not exposed — the probe read it by
 * INSERTING an element, which production code must not do. The line box the
 * browser actually built is available without any of that:
 *
 *     lastLineBox = layoutHeight − insets − (lineBoxes − 1) × lineHeight
 *
 * A block's border-box height is its insets plus its line boxes, and every line
 * but the last is a plain line of text at `lineHeight`. So the last one is what
 * is left over. `lineHeight` here is read from the same element, so the number
 * handed to the estimator is exactly the complement of the `(L − 1) ×
 * lineHeight` the estimator will charge — the two reconstruct the browser's
 * height even though the browser's own per-line advance is quantised to 1/64px.
 *
 * ## What it declines, and why the bound is not decoration
 *
 * `null` — the estimator then charges a plain line, byte for byte as before —
 * when there is no readable line height, no laid-out box (jsdom reports zero
 * for everything), no countable line box, or when the arithmetic lands outside
 * `(0, lineHeight + tallest child's outer height]`.
 *
 * That upper bound is the whole safety property of an inferred number: a line
 * box can only exceed the strut by what an inline on it contributes, so an
 * element whose height is NOT the sum of its own line boxes — a grid, a
 * float, an absolutely positioned child, an unreadable inset — produces a
 * leftover this rejects instead of charging every row for it. The hero's
 * 22.61875 against a bound of 20.3 + 21.25 = 41.55 sits well inside.
 */
function measureLastLineBox(
  layoutElement: Element,
  lineHeightPx: number,
): number | null {
  if (typeof layoutElement.getBoundingClientRect !== "function") return null;
  const box = layoutElement.getBoundingClientRect();
  if (!(box.height > 0)) return null;
  const styles =
    typeof getComputedStyle === "function"
      ? getComputedStyle(layoutElement)
      : null;
  if (styles === null) return null;
  const insets =
    readMarginPx(styles.paddingTop) +
    readMarginPx(styles.paddingBottom) +
    readMarginPx(styles.borderTopWidth) +
    readMarginPx(styles.borderBottomWidth);
  const lineBoxes = countLineBoxes(layoutElement);
  if (lineBoxes < 1) return null;
  const lastLineBoxPx = box.height - insets - (lineBoxes - 1) * lineHeightPx;
  if (!Number.isFinite(lastLineBoxPx) || lastLineBoxPx <= 0) return null;
  if (lastLineBoxPx > lineHeightPx + tallestChildOuterHeightPx(layoutElement)) {
    return null;
  }
  return lastLineBoxPx;
}

/**
 * How many line boxes an element laid its content out into.
 *
 * Every rect the content occupies is collected — one per line box for each
 * direct text node, via a `Range`, plus each element child's — and then grouped
 * into vertically disjoint runs. Line boxes do not overlap one another and
 * everything on a line overlaps the line, so the run count IS the line count.
 *
 * This is why the badge does not have to be on the same line as the text for
 * the arithmetic above to hold: a badge pushed onto a line of its own is simply
 * one more run. Both shapes occur in the hero and both were checked against the
 * cells' real heights.
 *
 * Zero — which is what a host without layout reports, jsdom included — is not a
 * line count, and the caller declines on it.
 */
function countLineBoxes(element: Element): number {
  const rects: { top: number; bottom: number }[] = [];
  const document_ = element.ownerDocument;
  for (const node of element.childNodes) {
    if (node.nodeType !== 3 /* Node.TEXT_NODE */) continue;
    if ((node.textContent ?? "").trim() === "") continue;
    if (typeof document_?.createRange !== "function") return 0;
    try {
      const range = document_.createRange();
      range.selectNodeContents(node);
      if (typeof range.getClientRects !== "function") return 0;
      for (const rect of range.getClientRects()) {
        rects.push({ top: rect.top, bottom: rect.bottom });
      }
    } catch {
      return 0;
    }
  }
  for (const child of element.children) {
    if (typeof child.getClientRects !== "function") return 0;
    for (const rect of child.getClientRects()) {
      rects.push({ top: rect.top, bottom: rect.bottom });
    }
  }
  const usable = rects.filter(
    (rect) => Number.isFinite(rect.top) && rect.bottom > rect.top,
  );
  if (usable.length === 0) return 0;
  usable.sort((first, second) => first.top - second.top);
  let lines = 0;
  let runBottom = Number.NEGATIVE_INFINITY;
  for (const rect of usable) {
    if (rect.top >= runBottom) lines += 1;
    runBottom = Math.max(runBottom, rect.bottom);
  }
  return lines;
}

/**
 * The tallest outer (margin box) height among an element's element children, or
 * `0` when it has none that report a box. The bound on what a line box may
 * exceed the strut by; see {@link measureLastLineBox}.
 */
function tallestChildOuterHeightPx(element: Element): number {
  let tallest = 0;
  for (const child of element.children) {
    if (typeof child.getBoundingClientRect !== "function") continue;
    const rect = child.getBoundingClientRect();
    const styles =
      typeof getComputedStyle === "function" ? getComputedStyle(child) : null;
    const outer =
      rect.height +
      readMarginPx(styles?.marginTop) +
      readMarginPx(styles?.marginBottom);
    if (Number.isFinite(outer) && outer > tallest) tallest = outer;
  }
  return tallest;
}

/**
 * A margin in px. Anything that is not a px length — `auto`, a percentage,
 * jsdom's empty string — charges nothing, which is what was charged before any
 * of this was read.
 */
function readMarginPx(value: string | undefined): number {
  if (typeof value !== "string") return 0;
  const match = /^(-?\d*\.?\d+)px$/.exec(value.trim());
  if (match === null) return 0;
  const parsed = Number.parseFloat(match[1] ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Whether the layout element holds non-whitespace text of its OWN — the
 * condition that makes a sample decidable at all. See
 * {@link measureRenderAdvance}.
 */
function hasDirectText(element: Element): boolean {
  for (const node of element.childNodes) {
    if (
      node.nodeType === 3 /* Node.TEXT_NODE */ &&
      (node.textContent ?? "").trim() !== ""
    ) {
      return true;
    }
  }
  return false;
}

// The advance per wrapped column, once cells have rendered to measure it off.
let gridRenderAdvances: RenderAdvances | null = null;
let gridRenderAdvancesStale = false;
// Every wrapped column rendered at the last attempt settled. The steady state,
// and the one that stops the DOM being read at all. A wrapped column that
// appears LATER is not noticed until the theme changes — the alternative is a
// selector query on the estimate path forever, which is the cost this whole
// design exists to avoid.
let advancesComplete = false;
let lastAdvanceAttemptMs = Number.NEGATIVE_INFINITY;

/**
 * How often an unsettled resolution may look at the DOM again.
 *
 * There has to be a retry at all, and the hero is why: its rows start with
 * `analyst: ""`, so at first paint the wrapped column's cells are empty and
 * carry no badge. Resolving once and caching that would record "no advance" for
 * the very column this exists for, and the fix would be inert in production
 * while the fixture-fed instrument reported it working.
 *
 * There has to be a BOUND on the retry too, and CI is why: an earlier change in
 * this series broke the bench app by reading the DOM once per estimate — 679ms
 * of a 1 187ms test. This read is worse than that one, because
 * `getClientRects` forces layout, not just style.
 *
 * A rate limit gives both. Once every rendered wrapped column has settled the
 * DOM is never touched again until the theme changes; until then the cost is
 * bounded at four reads a second no matter how many estimates run, and a grid
 * whose wrapped column is empty forever pays that and nothing more. A
 * fixed attempt COUNT was rejected: a scenario's estimates would burn any
 * sane count in one frame, long before streamed content arrives.
 */
const ADVANCE_RETRY_INTERVAL_MS = 250;

function markRenderAdvancesStale(): void {
  gridRenderAdvancesStale = true;
  advancesComplete = false;
}

function sameAdvances(a: RenderAdvances, b: RenderAdvances): boolean {
  if (a.size !== b.size) return false;
  for (const [columnId, advance] of a) {
    const other = b.get(columnId);
    if (other === undefined) return false;
    // BOTH terms, because both reach the estimator. Comparing the width alone
    // would return the previous map — and the estimate memo keys on the map's
    // identity, so every row's height would stay frozen at the one computed
    // before the line box was measured.
    if (other.widthPx !== advance.widthPx) return false;
    if (other.lastLineBoxPx !== advance.lastLineBoxPx) return false;
  }
  return true;
}

/**
 * One DOM pass over the rendered wrapped cells, grouping by column.
 *
 * Every wrapped cell currently in the document is visited, not just the first:
 * a column's rows are not interchangeable for this purpose, because an empty
 * one says nothing at all. The first cell of a column that HAS text decides
 * that column, and a column all of whose cells are empty stays unsettled so the
 * next attempt can try again.
 */
function resolveRenderAdvances(): {
  advances: Map<string, RenderAdvance>;
  settled: Set<string>;
  wrappedColumnIds: Set<string>;
} {
  const advances = new Map<string, RenderAdvance>();
  const settled = new Set<string>();
  const wrappedColumnIds = new Set<string>();
  const cells = document.querySelectorAll(
    '[data-pretable-cell][data-pretable-wrap="true"]',
  );
  for (const cell of cells) {
    const columnId = cell.getAttribute("data-pretable-column-id");
    if (columnId === null) continue;
    wrappedColumnIds.add(columnId);
    if (settled.has(columnId)) continue;
    const layoutElement = findTextLayoutElement(cell);
    // No text anywhere in the cell: an unwritten row, not a renderer that
    // draws nothing. Leave the column unsettled and look again later.
    if ((layoutElement.textContent ?? "").trim() === "") continue;
    settled.add(columnId);
    if (!hasDirectText(layoutElement)) continue;
    const widthPx = measureRenderAdvance(layoutElement);
    // One gate for both terms, deliberately: a shape this declines to give a
    // width for is a shape whose drawn content could not be identified, and
    // charging it a taller line box on the strength of the same DOM would be
    // the guess the width rules exist to refuse.
    if (!(widthPx > 0)) continue;
    const lineHeightPx = resolveLineHeightPx(layoutElement);
    advances.set(columnId, {
      widthPx,
      lastLineBoxPx:
        lineHeightPx === null
          ? null
          : measureLastLineBox(layoutElement, lineHeightPx),
    });
  }
  return { advances, settled, wrappedColumnIds };
}

/**
 * What each wrapped column's `render` draws beside its text — the width it
 * consumes and the line box it makes — or `null` when nothing has been measured
 * yet.
 *
 * Null, an absent column, and an unmeasured term of a present one all mean
 * "estimate this exactly as it was estimated before that term existed". Nothing
 * here ever guesses: see {@link measureRenderAdvance} for the width's rules and
 * {@link measureLastLineBox} for the line box's.
 *
 * The returned map's IDENTITY is part of the estimate memo key, so a resolution
 * that lands on the same numbers returns the SAME object — otherwise the rate
 * limited retries below would throw away every memoized estimate four times a
 * second.
 *
 * @internal
 */
export function getGridRenderAdvances(): RenderAdvances | null {
  if (typeof document === "undefined") return gridRenderAdvances;
  if (gridRenderAdvances !== null && !gridRenderAdvancesStale) {
    // Every rendered wrapped column has settled: the DOM is never touched
    // again until the theme changes. This is the steady state, reached on the
    // first attempt by any grid whose wrapped cells have text in them, and it
    // is what keeps the estimate path free of DOM reads.
    if (advancesComplete) return gridRenderAdvances;
    // Something is still unsettled — an empty wrapped column, which is the
    // hero at first paint. Look again, rate limited; see
    // ADVANCE_RETRY_INTERVAL_MS for why there is a retry and why it is bounded.
    if (Date.now() - lastAdvanceAttemptMs < ADVANCE_RETRY_INTERVAL_MS) {
      return gridRenderAdvances;
    }
  }
  lastAdvanceAttemptMs = Date.now();
  const { advances, settled, wrappedColumnIds } = resolveRenderAdvances();
  // At least one wrapped cell has to have been SEEN for "all of them settled"
  // to mean anything. Without that clause an attempt made before the first
  // paint — no cells at all — would declare itself complete and never look
  // again, freezing every grid on "no advance" for the session. The cost of
  // the clause is that a grid with no wrapped column at all keeps re-attempting
  // at the rate limit; the attempt is one `querySelectorAll` that matches
  // nothing, and it only runs while estimates are running.
  advancesComplete =
    wrappedColumnIds.size > 0 && settled.size === wrappedColumnIds.size;
  gridRenderAdvancesStale = false;
  if (gridRenderAdvances !== null && sameAdvances(gridRenderAdvances, advances))
    return gridRenderAdvances;
  gridRenderAdvances = advances;
  return advances;
}

/** @internal */
export function resetRenderAdvancesCacheForTesting(): void {
  gridRenderAdvances = null;
  gridRenderAdvancesStale = false;
  advancesComplete = false;
  lastAdvanceAttemptMs = Number.NEGATIVE_INFINITY;
}

/**
 * Reactive resolved pixel value of one `--pretable-*` CSS variable on
 * `document.documentElement`, falling back when it is unset or is not a
 * `<number>px` value.
 *
 * The same store as {@link useResolvedHeights}, so a theme or density swap
 * re-renders through it. Returns a primitive, so no snapshot cache is needed.
 *
 * `enabled: false` short-circuits to the fallback and drops the subscription.
 * `useSyncExternalStore` calls `getSnapshot` on every render, so a feature
 * that is switched off must not leave a `getComputedStyle` — a potential style
 * recalc — on the render path of every grid that never asked for it.
 *
 * @internal
 */
export function useResolvedPx(
  name: string,
  fallback: number,
  enabled = true,
): number {
  const getSnapshot = useCallback(
    () => (enabled ? readPx(name, fallback) : fallback),
    [enabled, name, fallback],
  );
  const getServerSnapshot = useCallback(() => fallback, [fallback]);

  return useSyncExternalStore(
    enabled ? subscribe : noopSubscribe,
    getSnapshot,
    getServerSnapshot,
  );
}
