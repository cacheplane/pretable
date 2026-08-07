import { expect, type Locator, type Page } from "@playwright/test";

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

/**
 * Opens a column's filter menu from its header funnel, and returns the dialog.
 *
 * Same failure mode as the drawer handle above — a click accepted by the
 * browser but dropped because the control is not live yet. It is worse here:
 * the menu never opens and the `fill` that follows burns the whole test timeout
 * instead of failing on the click.
 *
 * This used to re-attempt the click, because when it was written the grid had
 * no `data-hydrated` equivalent to wait on. It has one now, so wait on the
 * signal rather than retrying until a click happens to land: the funnel lives
 * inside the server-rendered hero grid, and `waitForGridReady` resolves exactly
 * when that grid's handlers are attached. The retry's awkward companion
 * problem — the funnel *toggles*, so a blind re-click would close a menu that
 * did open — goes away with it.
 */
export async function openFilterMenu(page: Page, column: string) {
  await waitForGridReady(page);
  // The funnel is opacity-0 until the header row is hovered. Opacity does not
  // block Playwright actionability, but hover first to mirror real usage (and
  // dodge engine flakiness).
  await page.locator("[data-pretable-header-row]").first().hover();
  await page.getByRole("button", { name: `Filter ${column}` }).click();
  const dialog = page.getByRole("dialog", { name: `Filter ${column}` });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  return dialog;
}

/**
 * Wait until the docs page's client components are live.
 *
 * Third instance of the same failure mode as `openDrawer` and
 * `waitForGridReady`, on the routes neither of them covers: docs pages render
 * no `PretableSurface`, so `data-pretable-hydrated` is nowhere on the page.
 *
 * `DocsMobileDrawer`'s Menu button is the one docs control that is both
 * server-rendered and pressable, so it is the one that publishes readiness:
 * `data-hydrated`, written from `useHydrated()` — the same
 * `useSyncExternalStore` gate the grid uses — is `"false"` in the SSR HTML and
 * flips to `"true"` on the first client-only render, the render that attaches
 * `onClick`.
 *
 * It gates the ⌘K palette too, even though the palette is a different
 * component. `DocsSearch` renders `null` until its keydown listener fires
 * (app/components/docs/DocsSearch.tsx), so it has no element of its own to
 * carry an attribute, and adding a hidden one purely to be waited on would be a
 * test hook rather than a product signal. It does not need one: both
 * components are siblings under `DocsShell` in a single React root, so they
 * hydrate in the same pass, and the ordering runs the right way round —
 * `DocsSearch`'s listener is registered in a passive effect of the hydration
 * commit, while the attribute flip is a re-render *scheduled from* that same
 * effect flush. The attribute can therefore only reach the DOM after the
 * listener is attached, never before. Measured, not just argued: 72 gated
 * single presses under 9-worker load on a box at load 108–320, no misses.
 *
 * Located by CSS rather than by role on purpose — the button is `md:hidden`,
 * so at desktop viewports it is `display: none` and out of the accessibility
 * tree, which is exactly where the palette test needs this gate.
 */
export async function waitForDocsReady(page: Page): Promise<void> {
  // Generous: hydration is quick locally but slow on a cold preview deploy.
  await expect(page.locator('button[aria-label="Menu"]')).toHaveAttribute(
    "data-hydrated",
    "true",
    { timeout: 20_000 },
  );
}

/**
 * Opens the docs sidebar drawer from its Menu button, and returns the dialog.
 *
 * Small-viewport only: the button is `md:hidden`, so callers must set a mobile
 * viewport first.
 */
export async function openDocsMenu(page: Page) {
  await waitForDocsReady(page);
  await page.getByRole("button", { name: /menu/i }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  return dialog;
}

/**
 * Presses the docs search shortcut and returns the palette.
 *
 * This used to re-press until the palette opened, because when it was written
 * the docs routes had no readiness signal at all to wait on. They have one now
 * (`waitForDocsReady`), so wait on it and press once — one idiom across the
 * drawer, the grid and the docs routes rather than three.
 */
export async function openDocsSearch(page: Page) {
  await waitForDocsReady(page);
  await page.keyboard.press("Control+K");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  return dialog;
}

/**
 * Resolves once `locator`'s box has held the same position across
 * `samples` consecutive polls, and returns that box.
 *
 * The showcase sections lazy-mount on intersection and the drawer scrolls
 * smoothly (`scroll-behavior: smooth` in app/globals.css), so content keeps
 * moving well after a grid first reports visible. Sampling the column-layout
 * resize handle on a local production build showed ~22px of scroll easing
 * followed by a discrete ~31px relayout roughly 700ms in. Playwright's own
 * stability check only requires two consecutive animation frames, which that
 * quiet gap before the relayout can satisfy, so hold the bar higher here.
 *
 * Best-effort by design, and deliberately short: a heavily loaded machine may
 * never hold still, and neither failing nor waiting it out is right — both
 * trade a flake for a different flake, and the tests only get 30s each.
 * Settling improves the odds that a press lands; callers still have to verify
 * that it did.
 */
export async function waitForStablePosition(
  locator: Locator,
  { samples = 4, gapMs = 120, timeout = 3_000 } = {},
) {
  const deadline = Date.now() + timeout;
  let previous: { x: number; y: number } | null = null;
  let held = 0;
  while (Date.now() < deadline) {
    const box = await locator.boundingBox();
    if (
      box &&
      previous &&
      Math.abs(box.x - previous.x) < 0.5 &&
      Math.abs(box.y - previous.y) < 0.5
    ) {
      held += 1;
      if (held >= samples) return box;
    } else {
      held = 0;
    }
    previous = box;
    await locator.page().waitForTimeout(gapMs);
  }
}

/**
 * Drags a column's resize handle right by `deltaX`, proving the press engaged
 * the drag before moving the pointer.
 *
 * The handle is a 4px-wide strip (see the resize handle in
 * packages/react/src/pretable-surface.tsx). If the header shifts between the
 * measurement and the press — which it does while the page is still settling,
 * and settling takes longer under parallel test load — the press lands beside
 * the handle and the resize silently never starts, leaving the column at its
 * original width. `data-pretable-dragging` is the grid's own signal that the
 * press armed a resize, so assert on it and re-aim from a fresh measurement
 * instead of dragging nothing.
 */
export async function dragResizeHandle(handle: Locator, deltaX: number) {
  const page = handle.page();
  for (let attempt = 1; attempt <= 3; attempt++) {
    await waitForStablePosition(handle);
    // hover() re-checks visibility and stability, asserts the handle is the
    // element that actually receives pointer events at that point, and parks
    // the pointer on its centre.
    await handle.hover();
    const box = await handle.boundingBox();
    if (!box) throw new Error("resize handle disappeared before the press");
    await page.mouse.down();
    if ((await handle.getAttribute("data-pretable-dragging")) !== "true") {
      // The press missed the strip. Release and re-aim.
      await page.mouse.up();
      continue;
    }
    // WebKit only engages pointer capture once the pointer traverses
    // intermediate positions, so move in steps rather than a single jump.
    const startX = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(startX + deltaX / 4, y, { steps: 6 });
    await page.mouse.move(startX + deltaX, y, { steps: 12 });
    await page.mouse.up();
    return;
  }
  throw new Error(
    "column resize never engaged: data-pretable-dragging stayed false across 3 presses",
  );
}
