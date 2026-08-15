/**
 * APG roving-tabindex arithmetic, shared by the two MDX tab strips (`Tabs`
 * and `CodeGroup`).
 *
 * `ExampleShell` implements the same pattern over its own two tablists and
 * carries its own copy of this arithmetic; it is deliberately left alone here
 * because its tab order is pinned by `e2e/example-tab-order.spec.ts` and this
 * change had no reason to disturb it. Folding all three onto this module is a
 * worthwhile follow-up, not part of an accessibility fix.
 *
 * The pattern itself: exactly one tab in a strip carries `tabindex="0"` and
 * the rest carry `-1`, so Tab enters and leaves the whole strip once, and the
 * arrow keys move within it. Writing `tabindex` out explicitly is also what
 * makes the selected tab reachable in Safari at all — see `tabbable.ts`.
 */

/**
 * Keys the APG tab pattern asks a tablist to handle. Home/End are part of it,
 * not an extra: a reader who lands on tab 4 of 5 has no other way to reach the
 * first one in a single press.
 */
const NAV_KEYS = ["ArrowRight", "ArrowLeft", "Home", "End"] as const;

export type NavKey = (typeof NAV_KEYS)[number];

export function isNavKey(key: string): key is NavKey {
  return (NAV_KEYS as readonly string[]).includes(key);
}

/** Left/Right wrap around; Home/End jump to the ends. */
export function nextTabIndex(
  current: number,
  count: number,
  key: NavKey,
): number {
  switch (key) {
    case "ArrowRight":
      return (current + 1) % count;
    case "ArrowLeft":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
  }
}
