/**
 * The one geometric question both drag paths ask: is the pointer over the group
 * panel, and if so, between which two grouping levels?
 *
 * It is a module of its own because it is the ONLY part of dragging that jsdom
 * cannot exercise — `getBoundingClientRect` returns zeros there, so a unit test
 * of the surface can mock this and verify everything around it, while the rects
 * themselves are proven in a real browser. Keep it free of React and of any
 * knowledge of what a drop means.
 *
 * @internal
 */

export interface GroupPanelHit {
  /**
   * The grouping level a drop here would land at: the number of chips whose
   * horizontal midpoint the pointer has passed. `0` is "before every chip",
   * `rowGroups.length` is "after the last one" — both are legitimate drop
   * positions, which is why `insertGroupLevel` clamps rather than rejects.
   */
  insertIndex: number;
}

/**
 * Where a pointer at `(clientX, clientY)` would drop into `panel`, or `null` if
 * it is not over the panel at all.
 *
 * A missing, hidden or zero-size panel is **excluded from hit-testing**, not
 * merely invisible. It has to be: a collapsed panel still occupies a point in
 * the document, and treating it as a live target would silently swallow drops
 * aimed at the header underneath it.
 */
export function hitTestGroupPanel(
  panel: HTMLElement | null,
  clientX: number,
  clientY: number,
): GroupPanelHit | null {
  if (!panel) return null;

  const rect = panel.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  if (clientX < rect.left || clientX > rect.right) return null;
  if (clientY < rect.top || clientY > rect.bottom) return null;

  return { insertIndex: insertIndexAt(panel, clientX) };
}

function insertIndexAt(panel: HTMLElement, clientX: number): number {
  const chips = panel.querySelectorAll<HTMLElement>(
    "[data-pretable-group-chip]",
  );

  let index = 0;
  for (const chip of chips) {
    const rect = chip.getBoundingClientRect();
    // Midpoint rather than leading edge, so the second half of a chip means
    // "after it" — the same rule `computeColumnDropTarget` uses for headers, so
    // the two drop zones do not feel like different gestures.
    if (clientX >= rect.left + rect.width / 2) index += 1;
  }

  return index;
}
