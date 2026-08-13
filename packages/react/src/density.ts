import { useCallback, useRef, useSyncExternalStore } from "react";

import type {
  RenderAdvances,
  RowBoxMetrics,
} from "@pretable-internal/renderer-dom";
import { type DensityHeights, getDensityHeights } from "@pretable/ui";

import { DEFAULT_ROW_HEIGHT } from "./rendering";
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
  if (cell === null || typeof getComputedStyle !== "function") return fallback;
  const styles = getComputedStyle(findTextLayoutElement(cell));
  if (typeof styles?.lineHeight !== "string") return fallback;
  const match = styles.lineHeight.trim().match(/^([\d.]+)px$/);
  return match ? parseFloat(match[1]) : fallback;
}

/**
 * The cell to read line height off.
 *
 * A wrapped cell is preferred because wrapped text is the only content this
 * metric is ever applied to — the same preference, and the same selector,
 * `resolveGridTextStyle` uses for the font.
 *
 * The row-select cell is excluded from the fallback, and that exclusion is
 * load-bearing rather than tidiness. It is synthetic and left-pinned, so it is
 * the FIRST `[data-pretable-cell]` in the document: a bare
 * `querySelector("[data-pretable-cell]")` lands on it. It reports the same 21px
 * as any other cell, which is why that went unnoticed — but its only child is
 * the 11px checkbox button, so once line height is resolved from the element
 * laying out the text (which is the point of this change) sampling it would
 * report 11px for the whole grid. Verified in Chromium against the hero.
 *
 * Null when nothing readable has rendered. Callers keep the fallback, or their
 * last good box, rather than resolving half a box off nothing.
 */
function findSampleCell(): Element | null {
  if (typeof document === "undefined") return null;
  return (
    document.querySelector('[data-pretable-cell][data-pretable-wrap="true"]') ??
    document.querySelector(
      "[data-pretable-cell]:not([data-pretable-row-select-cell])",
    )
  );
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
    if (b.get(columnId) !== advance) return false;
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
  advances: Map<string, number>;
  settled: Set<string>;
  wrappedColumnIds: Set<string>;
} {
  const advances = new Map<string, number>();
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
    const advance = measureRenderAdvance(layoutElement);
    if (advance > 0) advances.set(columnId, advance);
  }
  return { advances, settled, wrappedColumnIds };
}

/**
 * How much horizontal space each wrapped column's `render` draws beside its
 * text, or `null` when nothing has been measured yet.
 *
 * Null and an absent column both mean "estimate this exactly as it was
 * estimated before this existed". Nothing here ever guesses: see
 * {@link measureRenderAdvance} for what is measured and what is declined.
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
