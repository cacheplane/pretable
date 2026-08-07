import { expect, type Page } from "@playwright/test";

/**
 * Open the hero drawer via its bottom handle, and wait for it to actually open.
 *
 * The handle is server-rendered, so it paints — and Playwright considers it
 * visible and clickable — before React has hydrated it. Its `onClick` does not
 * exist yet at that point, so the click is accepted by the browser and silently
 * dropped; the test then fails further down with an unrelated-looking symptom.
 *
 * Neither obvious signal discriminates, because both are in the SSR markup:
 * `<html data-drawer="closed">` is written by `layout.tsx` (the drawer CSS is
 * gated on the attribute, so it has to be there pre-hydration to avoid a flash
 * of the whole drawer), and `[data-pretable-scroll-viewport]` ships in the
 * prerendered HTML too. Both are already present while the click is still dead.
 *
 * `data-hydrated` is written by `DrawerHandle` from `useDrawer`'s `isUpgraded`
 * flag, which flips in a post-hydration effect — the same effect run that
 * attaches `onClick`. It is therefore the one signal that means "this control
 * is live", so wait on it rather than retrying the click until it happens to
 * land.
 */
export async function openDrawer(page: Page): Promise<void> {
  const handle = page.getByTestId("drawer-handle");
  // Generous: hydration is quick locally but slow on a cold preview deploy.
  await expect(handle).toHaveAttribute("data-hydrated", "true", {
    timeout: 20_000,
  });
  await handle.click();
  await expect(page.locator("html")).toHaveAttribute("data-drawer", "open");
}

/**
 * Wait until a grid is not just painted but actually interactive.
 *
 * Same failure mode as `openDrawer`, one layer down. The hero grid is
 * server-rendered, so its header buttons, filter funnels, row-select checkboxes
 * and resize handles are all in the initial HTML — painted, hit-testable, and
 * considered actionable by Playwright — while React has yet to attach a single
 * listener. A click that lands in that window is accepted by the browser and
 * dropped on the floor, and the test then fails somewhere downstream with a
 * symptom that looks unrelated (a dialog locator timing out, a checkbox that
 * never flips).
 *
 * `[data-pretable-scroll-viewport]` cannot discriminate here either: it ships in
 * the prerendered markup alongside the dead controls, so `toBeVisible()` on it
 * is satisfied long before anything works.
 *
 * `data-pretable-hydrated` is emitted by `PretableSurface` from a
 * `useSyncExternalStore` gate that resolves to `"false"` on the server and
 * during hydration, then `"true"` on the first client-only render — the same
 * render that attaches the handlers. It is a documented part of the package's
 * data-attribute contract, not a test hook, so waiting on it is waiting on the
 * library's own statement that the grid is live.
 *
 * `scope` is an optional CSS selector for a section containing exactly one grid
 * (e.g. `"#column-layout"`); omit it for the hero grid. Grids that mount
 * client-side on scroll (the showcase sections) report `"true"` on their very
 * first render, so this is cheap there — but it keeps every grid interaction in
 * both specs on one idiom rather than two.
 */
export async function waitForGridReady(
  page: Page,
  scope?: string,
): Promise<void> {
  const grid = page
    .locator(`${scope ? `${scope} ` : ""}[data-pretable-scroll-viewport]`)
    .first();
  // Generous: hydration is quick locally but slow on a cold preview deploy.
  await expect(grid).toBeVisible({ timeout: 20_000 });
  await expect(grid).toHaveAttribute("data-pretable-hydrated", "true", {
    timeout: 20_000,
  });
}
