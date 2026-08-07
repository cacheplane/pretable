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
 * Opens a column's filter menu from its header funnel, and returns the dialog.
 *
 * Same failure mode as the drawer handle above — a click accepted by the
 * browser but dropped, most often because the control is not live yet. It is
 * worse here: the menu never opens and the `fill` that follows burns the whole
 * test timeout instead of failing on the click.
 *
 * The grid has no `data-hydrated` equivalent to wait on, so re-attempt instead.
 * Unlike the drawer, the funnel *toggles*, so a blind re-click would close a
 * menu that did open; check the dialog first and only click when it is
 * genuinely absent.
 */
export async function openFilterMenu(page: Page, column: string) {
  const dialog = page.getByRole("dialog", { name: `Filter ${column}` });
  await expect(async () => {
    if (!(await dialog.isVisible())) {
      // The funnel is opacity-0 until the header row is hovered. Opacity does
      // not block Playwright actionability, but hover first to mirror real
      // usage (and dodge engine flakiness).
      await page.locator("[data-pretable-header-row]").first().hover();
      await page
        .getByRole("button", { name: `Filter ${column}` })
        .click({ timeout: 5_000 });
    }
    await expect(dialog).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 10_000 });
  return dialog;
}

/**
 * Presses the docs search shortcut until the palette opens, and returns it.
 *
 * DocsSearch registers its keydown listener in an effect and renders nothing
 * until that listener fires (app/components/docs/DocsSearch.tsx), so a press
 * before hydration is swallowed without a trace — there is no `data-hydrated`
 * to wait on as there is for the drawer handle. Re-pressing an open palette is
 * harmless (the handler just sets `open` to true again), so retry the press.
 */
export async function openDocsSearch(page: Page) {
  const dialog = page.getByRole("dialog");
  await expect(async () => {
    await page.keyboard.press("Control+K");
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
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
