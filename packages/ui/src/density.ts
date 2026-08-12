const FALLBACK_ROW_HEIGHT = 32;
const FALLBACK_HEADER_HEIGHT = 36;

/**
 * Density-related heights (in CSS pixels) read from the active theme.
 *
 * @public
 */
export interface DensityHeights {
  rowHeight: number;
  headerHeight: number;
}

function parsePx(value: string): number | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^([\d.]+)px$/);
  return match ? parseFloat(match[1]) : null;
}

/**
 * Synchronous snapshot of the resolved density-related CSS variables on
 * `document.documentElement`.
 *
 * Returns `{ rowHeight, headerHeight }` parsed from `--pretable-row-height`
 * and `--pretable-header-height`. Falls back to 32 / 36 when a variable is
 * unset, empty, or not parseable as a `<number>px` value.
 *
 * SSR-safe: returns the fallback values when `document` is undefined.
 *
 * For non-React consumers, tests, custom virtualizers, and power users. This
 * is the only public way to read density into JavaScript: `@pretable/react`'s
 * reactive equivalent is internal, so a React caller that needs the values to
 * follow a theme or density swap wraps this in its own `useSyncExternalStore`
 * — the docs at `/docs/grid/density-helpers` carry the recipe.
 *
 * @public
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
