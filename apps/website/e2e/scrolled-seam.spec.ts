import { expect, test } from "@playwright/test";

import { waitForGridReady } from "./helpers";

/**
 * The house theme is frameless, so the sticky header's only seam against rows
 * scrolling under it is a shadow keyed on `data-pretable-scrolled`. This
 * asserts the PAINTED longhand on the real component, per the
 * prove-the-pixel rule: a rule that matches and a token that resolves are
 * not proof anything draws.
 *
 * Why this is a browser test and not a jsdom one: jsdom does apply attribute
 * selectors and does inherit custom properties, but it cannot resolve `var()`
 * inside `getComputedStyle`, so `box-shadow: var(--pretable-shadow-header)`
 * never becomes a shadow string there. The jsdom half — that the surface flips
 * the attribute at `scrollTop > 0` — lives in
 * `packages/react/src/__tests__/scrolled-attribute.test.tsx`.
 *
 * Both engines serialise a computed box-shadow colour-first (`rgba(...) 0px
 * 1px ...`), so the scrolled check matches on that prefix rather than
 * `not "none"`, which an empty string would satisfy vacuously.
 */

const FIXTURE = "/fixtures/scrolled-seam";

test("the header casts a seam only while scrolled", async ({ page }) => {
  await page.goto(FIXTURE);
  await waitForGridReady(page);

  const viewport = page.locator("[data-pretable-scroll-viewport]").first();
  const header = viewport.locator("[data-pretable-header-row]").first();

  await expect(viewport).not.toHaveAttribute("data-pretable-scrolled");
  await expect(header).toHaveCSS("box-shadow", "none");

  await viewport.evaluate((el) => {
    el.scrollTop = 200;
  });
  await expect(viewport).toHaveAttribute("data-pretable-scrolled", "");
  await expect(header).toHaveCSS("box-shadow", /^rgba?\(/);

  await viewport.evaluate((el) => {
    el.scrollTop = 0;
  });
  await expect(viewport).not.toHaveAttribute("data-pretable-scrolled");
  await expect(header).toHaveCSS("box-shadow", "none");
});

test("the viewport has no frame", async ({ page }) => {
  await page.goto(FIXTURE);
  await waitForGridReady(page);

  const viewport = page.locator("[data-pretable-scroll-viewport]").first();

  for (const side of ["top", "right", "bottom", "left"]) {
    await expect(viewport).toHaveCSS(`border-${side}-width`, "0px");
  }
  for (const corner of [
    "top-left",
    "top-right",
    "bottom-right",
    "bottom-left",
  ]) {
    await expect(viewport).toHaveCSS(`border-${corner}-radius`, "0px");
  }
  await expect(viewport).toHaveCSS("box-shadow", "none");
});
