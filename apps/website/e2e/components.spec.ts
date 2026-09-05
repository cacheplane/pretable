import { expect, test } from "@playwright/test";

import { waitForGridReady } from "./helpers";

/**
 * The `components` slot in a real browser. The jsdom suite proves the
 * context resolves and reaches the sites; a browser is needed for the two
 * claims that depend on the real DOM: that a replacement lands inside a
 * popover portalled to document.body, and that the grid's own behaviour on
 * the replacement — the menu it anchors on the node, the focus it returns
 * there — still works through the forwarded ref.
 */
test("every button in the grid is the consumer's, including inside the portalled filter dialog", async ({
  page,
}) => {
  await page.goto("/fixtures/components");
  await waitForGridReady(page);

  // Nothing the kit draws itself is left.
  await expect(page.locator("[data-pretable-button]")).toHaveCount(0);
  await expect(page.locator("[data-pretable-icon-button]")).toHaveCount(0);

  // The tool panel's reset is the replacement, with its site and variant.
  const reset = page.locator("[data-pretable-tool-reset]");
  await expect(reset).toHaveAttribute("data-fixture-button", "tool-reset");
  await expect(reset).toHaveAttribute("data-fixture-variant", "link");

  // The header funnel is the icon replacement; the funnel is out of the
  // sequential tab order and only revealed on hover (grid-header-popover-scroll.spec.ts's
  // recipe), so hover the header row before clicking it.
  await page.locator("[data-pretable-header-row]").first().hover();
  const funnel = page.locator("[data-pretable-filter-funnel]").first();
  await expect(funnel).toHaveAttribute("data-fixture-icon", "filter-funnel");
  await funnel.click();

  // The dialog is a child of <body>, and its Clear button is ours.
  const dialog = page.locator("[data-pretable-filter-menu]");
  await expect(dialog).toBeVisible();
  expect(
    await dialog.evaluate((el) => el.parentElement === document.body),
  ).toBe(true);
  await expect(dialog.locator("[data-pretable-filter-clear]")).toHaveAttribute(
    "data-fixture-button",
    "filter-clear",
  );
  await page.keyboard.press("Escape");
});

test("the grid still anchors a menu on, and returns focus to, a replaced icon button", async ({
  page,
}) => {
  await page.goto("/fixtures/components");
  await waitForGridReady(page);

  const kebab = page.locator("[data-pretable-tool-row-menu-button]").first();
  await expect(kebab).toHaveAttribute(
    "data-fixture-icon",
    "tool-row-menu-button",
  );
  await kebab.click();
  const menu = page.locator("[data-pretable-column-menu]");
  await expect(menu).toBeVisible();

  // The menu opened below the node the replacement forwarded its ref to.
  // Horizontally, `popover-position.ts`'s `placement()` clamps `left` to
  // `min(anchorRect.left, viewportWidth - WIDTH(240) - MARGIN(8))` — the
  // kebab sits in the tool panel near the right edge of a desktop viewport,
  // so this fixture actually exercises the clamp rather than the
  // unclamped case; assert the exact rule the code guarantees instead of a
  // "close to the anchor" heuristic that only holds when unclamped.
  const [kebabBox, menuBox, viewportSize] = await Promise.all([
    kebab.boundingBox(),
    menu.boundingBox(),
    page.viewportSize(),
  ]);
  expect(menuBox!.y).toBeGreaterThanOrEqual(kebabBox!.y + kebabBox!.height);
  const expectedLeft = Math.max(
    8,
    Math.min(kebabBox!.x, viewportSize!.width - 240 - 8),
  );
  expect(Math.abs(menuBox!.x - expectedLeft)).toBeLessThanOrEqual(1);

  // Escape closes it and puts focus back on that node.
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(kebab).toBeFocused();
});
