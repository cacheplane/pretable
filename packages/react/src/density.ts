import { useCallback, useRef, useSyncExternalStore } from "react";

import { HEADER_HEIGHT } from "./rendering";

const FALLBACK_ROW_HEIGHT = 32;
// Match the legacy HEADER_HEIGHT constant (52) so unmigrated apps that
// don't yet set --pretable-header-height get the same header geometry as
// the pre-bridge engine. The spec's documented v0.0.1 fallback was 36; we
// use 52 here to keep apps/website and apps/bench visually unchanged
// through PR 3 → PR 4 transition. Once apps load a theme (PR 4 / PR 5),
// the theme's --pretable-header-height takes precedence and this fallback
// is irrelevant.
const FALLBACK_HEADER_HEIGHT = HEADER_HEIGHT;

export interface DensityHeights {
  rowHeight: number;
  headerHeight: number;
}

function parsePx(value: string): number | null {
  const match = value.trim().match(/^([\d.]+)px$/);
  return match ? parseFloat(match[1]) : null;
}

/**
 * Synchronous snapshot of the resolved density-related CSS variables on
 * `document.documentElement`.
 *
 * Returns `{ rowHeight, headerHeight }` parsed from `--pretable-row-height`
 * and `--pretable-header-height`. Falls back to 32 / HEADER_HEIGHT (52) when
 * a variable is unset or unparseable. The headerHeight fallback matches the
 * legacy HEADER_HEIGHT constant so unmigrated apps see no behavior change.
 *
 * SSR-safe: returns the fallback values when `document` is undefined.
 */
export function getDensityHeights(): DensityHeights {
  if (typeof document === "undefined") {
    return {
      rowHeight: FALLBACK_ROW_HEIGHT,
      headerHeight: FALLBACK_HEADER_HEIGHT,
    };
  }
  const styles = getComputedStyle(document.documentElement);
  // Defensive: some test environments mock getComputedStyle with plain
  // objects that don't implement getPropertyValue. Treat that as "unset"
  // and fall back, instead of throwing.
  const read = (name: string): string => {
    if (typeof styles?.getPropertyValue !== "function") return "";
    return styles.getPropertyValue(name);
  };
  return {
    rowHeight: parsePx(read("--pretable-row-height")) ?? FALLBACK_ROW_HEIGHT,
    headerHeight:
      parsePx(read("--pretable-header-height")) ?? FALLBACK_HEADER_HEIGHT,
  };
}

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
 * React hook — reactive density values that update when `[data-density]`,
 * `[data-theme]`, `class`, or inline `style` change on `<html>`.
 *
 * Numeric props win when passed; otherwise CSS variables; otherwise fallbacks.
 *
 * Currently the engine only uses `headerHeight` (replaces the legacy
 * HEADER_HEIGHT constant). The `rowHeight` value is exposed for API parity
 * with the spec's documented contract and for future use; row sizing in v0.0.1
 * remains measurement-driven via `measureRenderedRowHeight()` /
 * `estimateRowHeight()`.
 *
 * SSR-safe: server snapshot returns fallback values without DOM access.
 */
export function useResolvedHeights(
  rowHeightProp?: number,
  headerHeightProp?: number,
): DensityHeights {
  // useSyncExternalStore requires snapshot getters to return stable
  // references when the underlying values haven't changed. We cache the
  // last-returned object per-hook-instance and return it as-is when the
  // resolved values would be identical, preventing infinite re-render loops.
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
