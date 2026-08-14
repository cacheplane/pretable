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
 * Synchronous snapshot of the resolved density-related CSS variables, read
 * from `element` — or from `document.documentElement` when none is given.
 *
 * Returns `{ rowHeight, headerHeight }` parsed from `--pretable-row-height`
 * and `--pretable-header-height`. Falls back to 32 / 36 when a variable is
 * unset, empty, or not parseable as a `<number>px` value.
 *
 * ## Which element to pass
 *
 * These are CSS custom properties, so they INHERIT. Passing an element resolves
 * the value that element actually paints under, which is what a `data-density`
 * scoped to a wrapper (`<div data-density="compact">…`) sets — the root's own
 * computed style never sees it. Passing nothing reads the root, which is right
 * only when the density attribute lives on `<html>`.
 *
 * Pass the element whose geometry you are computing — the grid's own DOM node,
 * or any descendant of the scoping wrapper. `@pretable/react` passes the grid's
 * scroll viewport, so a wrapper-scoped grid measures at the density it paints
 * at.
 *
 * A detached element resolves nothing in most browsers; read it after mount.
 *
 * SSR-safe: returns the fallback values when `document` is undefined, and when
 * `element` is `null` or `undefined` and there is no document to fall back to.
 *
 * For non-React consumers, tests, custom virtualizers, and power users. This
 * is the only public way to read density into JavaScript: `@pretable/react`'s
 * reactive equivalent is internal, so a React caller that needs the values to
 * follow a theme or density swap wraps this in its own `useSyncExternalStore`
 * — the docs at `/docs/grid/density-helpers` carry the recipe.
 *
 * @public
 */
export function getDensityHeights(element?: Element | null): DensityHeights {
  const target =
    element ??
    (typeof document === "undefined" ? null : document.documentElement);
  if (target === null || typeof getComputedStyle !== "function") {
    return {
      rowHeight: FALLBACK_ROW_HEIGHT,
      headerHeight: FALLBACK_HEADER_HEIGHT,
    };
  }
  const styles = getComputedStyle(target);
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
