import { expect, test } from "@playwright/test";

/**
 * The unit tests for the row-height floor run in jsdom, which has no layout
 * engine: there the floor is the only thing that can decide a row's height,
 * which makes them precise about the floor and blind to everything else.
 *
 * This is the other half — a real engine, real fonts, real content — asserting
 * the two properties that only a browser can show:
 *
 *  1. rows land on the theme's --pretable-row-height rather than the old
 *     hard-coded 44, and
 *  2. the scroll extent agrees with them, so the scrollbar is not sized from a
 *     different number than the rows are drawn at.
 */
test("rows render at the theme's row height, and the scroll extent agrees", async ({
  page,
}) => {
  await page.goto("/?adapter=pretable&scenario=S1&scale=dev");

  const row = page.locator("[data-pretable-row]").first();
  await expect(row).toBeVisible();

  const themeRowHeight = await page.evaluate(() =>
    parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--pretable-row-height",
      ),
    ),
  );
  // The bench pins this to match the comparators; if that pin is ever removed
  // the assertions below still hold, they just hold against a different number.
  expect(themeRowHeight).toBeGreaterThan(0);

  const heights = await page.evaluate(() =>
    [...document.querySelectorAll("[data-pretable-row]")].map(
      (node) => node.getBoundingClientRect().height,
    ),
  );
  expect(heights.length).toBeGreaterThan(3);
  // Every row, not just the first: the floor is applied per row, and a bug
  // that reached only the initially-measured window would still pass a
  // single-row check.
  for (const height of heights) {
    expect(height).toBeCloseTo(themeRowHeight, 1);
  }

  // The scroll extent is built from estimates for rows nobody has measured.
  // It used to come from a separate constant, so a themed grid claimed one
  // height for its scrollbar and drew another in its rows.
  const { contentHeight, rowCount } = await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>(
      "[data-pretable-scroll-content]",
    );
    const viewport = document.querySelector<HTMLElement>(
      "[data-pretable-scroll-viewport]",
    );
    return {
      contentHeight: content ? parseFloat(content.style.height) : NaN,
      rowCount: Number(viewport?.getAttribute("aria-rowcount") ?? NaN),
    };
  });
  expect(Number.isFinite(contentHeight)).toBe(true);
  expect(Number.isFinite(rowCount)).toBe(true);
  // aria-rowcount includes the header row; the body holds the rest.
  expect(contentHeight).toBeCloseTo((rowCount - 1) * themeRowHeight, 0);
});
