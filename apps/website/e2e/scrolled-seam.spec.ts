import { expect, test } from "@playwright/test";

import { waitForGridReady } from "./helpers";

/**
 * The house theme is frameless, so the sticky header's only seam against rows
 * scrolling under it is a shadow keyed on `data-pretable-scrolled`. This
 * asserts the PAINTED longhand on the real component, per the
 * prove-the-pixel rule: a rule that matches and a token that resolves are
 * not proof anything draws.
 */

const FIXTURE = "/fixtures/scrolled-seam";

test("the header casts a seam only while scrolled", async ({ page }) => {
  await page.goto(FIXTURE);
  await waitForGridReady(page);

  const viewport = page.locator("[data-pretable-scroll-viewport]").first();
  const header = viewport.locator("[data-pretable-header-row]").first();

  await expect(viewport).not.toHaveAttribute("data-pretable-scrolled");
  await expect
    .poll(() => header.evaluate((el) => getComputedStyle(el).boxShadow))
    .toBe("none");

  await viewport.evaluate((el) => {
    el.scrollTop = 200;
  });
  await expect(viewport).toHaveAttribute("data-pretable-scrolled", "");
  await expect
    .poll(() => header.evaluate((el) => getComputedStyle(el).boxShadow))
    .not.toBe("none");

  // The container itself is frameless.
  const frame = await viewport.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      border: s.borderTopWidth,
      shadow: s.boxShadow,
      radius: s.borderTopLeftRadius,
    };
  });
  expect(frame).toEqual({ border: "0px", shadow: "none", radius: "0px" });

  await viewport.evaluate((el) => {
    el.scrollTop = 0;
  });
  await expect(viewport).not.toHaveAttribute("data-pretable-scrolled");
  await expect
    .poll(() => header.evaluate((el) => getComputedStyle(el).boxShadow))
    .toBe("none");
});
