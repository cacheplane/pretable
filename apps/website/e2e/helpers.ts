import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Opens the homepage drawer via the bottom handle.
 *
 * Under parallel load a first click is sometimes dropped outright: it reports
 * success and the drawer stays shut. Instrumenting this helper caught exactly
 * that, and a second click opened it — so the retry below, not the wait above,
 * is what fixes the flake. (It is not a pre-hydration click being swallowed:
 * React replays those, and `data-drawer` is typically set well before the
 * click lands.)
 *
 * `data-drawer` only exists once `useDrawer`'s effect has run
 * (app/components/useDrawer.ts), so waiting for it is a cheap precondition —
 * it keeps a genuine hydration stall failing legibly instead of as ten seconds
 * of pointless re-clicks.
 */
export async function openDrawer(page: Page) {
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-drawer", /^(open|closed)$/, {
    timeout: 15_000,
  });
  // Opening is idempotent, so re-click until the state actually flips.
  // Re-check the attribute first so a merely slow open is not mistaken for a
  // dropped click (the handle is `display: none` once open, and clicking it
  // again would then fail actionability).
  await expect(async () => {
    if ((await html.getAttribute("data-drawer")) !== "open") {
      await page.getByTestId("drawer-handle").click({ timeout: 5_000 });
    }
    await expect(html).toHaveAttribute("data-drawer", "open", {
      timeout: 2_000,
    });
  }).toPass({ timeout: 10_000 });
}

/**
 * Opens a column's filter menu from its header funnel, and returns the dialog.
 *
 * Same failure mode as the drawer handle: under load a first click is
 * occasionally dropped — it reports success, the menu never opens, and the
 * `fill` that follows burns the whole test timeout instead of failing on the
 * click. Unlike opening the drawer, the funnel *toggles*, so a blind re-click
 * would close a menu that did open; check the dialog first and only click when
 * it is genuinely absent.
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
 * before hydration is swallowed without a trace — unlike the drawer, there is
 * no attribute to wait on. Re-pressing an open palette is harmless (the
 * handler just sets `open` to true again), so retry the press instead.
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
