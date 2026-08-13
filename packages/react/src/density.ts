import { useCallback, useRef, useSyncExternalStore } from "react";

import type { RowBoxMetrics } from "@pretable-internal/renderer-dom";
import { type DensityHeights, getDensityHeights } from "@pretable/ui";

import { DEFAULT_ROW_HEIGHT } from "./rendering";

const FALLBACK_ROW_HEIGHT = 32;
const FALLBACK_HEADER_HEIGHT = 36;

export type { DensityHeights };

function subscribe(callback: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-density", "data-theme", "class", "style"],
  });
  return () => observer.disconnect();
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
 * Line height is the one term with no token behind it.
 *
 * `--pretable-cell-padding-x/-y` and `--pretable-rule-width` are all in the
 * token contract (`packages/ui/src/__tests__/contract.test.ts`); line height is
 * not, and no theme sets `line-height` on a cell at all — cells take
 * `font-size: var(--pretable-font-size-cell)` and inherit `normal`. The used
 * value therefore exists only on a rendered element, where the computed font
 * shorthand resolves it (`14px / 21px …` in the hero).
 *
 * So: read it off a cell, and fall back only when there is no cell to read or
 * the browser reports a non-pixel value (`normal`, a unitless ratio, jsdom's
 * empty string). Never parse to `NaN`.
 */
function readLineHeightPx(cell: Element | null, fallback: number): number {
  if (cell === null || typeof getComputedStyle !== "function") return fallback;
  const styles = getComputedStyle(cell);
  if (typeof styles?.lineHeight !== "string") return fallback;
  const match = styles.lineHeight.trim().match(/^([\d.]+)px$/);
  return match ? parseFloat(match[1]) : fallback;
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
  const cell =
    sampleCell === undefined
      ? typeof document === "undefined"
        ? null
        : document.querySelector("[data-pretable-cell]")
      : sampleCell;

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
 * Staleness, stated rather than left to be discovered: once read, a later theme
 * or density swap is NOT re-read, so a grid that changes theme mid-session
 * keeps estimating against the old box. Same class and same trade as
 * `getGridAverageCharWidth`'s — the alternative is a DOM read per estimate —
 * and measured rows correct themselves on the next commit regardless.
 *
 * @internal
 */
export function getGridRowBoxMetrics(): RowBoxMetrics | null {
  if (gridRowBox !== null) return gridRowBox;
  if (typeof document === "undefined") return null;
  const cell = document.querySelector("[data-pretable-cell]");
  // No cell means no line height to read, and the padding tokens alone would
  // be a half-resolved box. Wait for one.
  if (cell === null) return null;
  gridRowBox = getThemeBoxMetrics(cell);
  return gridRowBox;
}

/** @internal */
export function resetRowBoxMetricsCacheForTesting(): void {
  gridRowBox = null;
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
