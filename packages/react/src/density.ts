import { useCallback, useRef, useSyncExternalStore } from "react";

import { type DensityHeights, getDensityHeights } from "@pretable/ui";

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
    const css = getDensityHeights();
    const rowHeight = rowHeightProp ?? css.rowHeight;
    const headerHeight = headerHeightProp ?? css.headerHeight;
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

  return useSyncExternalStore(
    enabled ? subscribe : noopSubscribe,
    getSnapshot,
    getSnapshot,
  );
}
