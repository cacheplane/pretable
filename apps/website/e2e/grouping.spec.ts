import { expect, test, type Locator, type Page } from "@playwright/test";

import { waitForGridReady } from "./helpers";

/**
 * Row grouping, in a browser that actually lays out.
 *
 * Every claim here is one jsdom structurally cannot make. The depth indent is a
 * `calc()` over a custom property resolved against a theme token — jsdom
 * resolves neither, so the RTL suite can only assert that the declaration was
 * written, not that it moved anything. Right-pin shipped measurably broken past
 * 316 green jsdom tests on exactly that gap.
 */

const FIXTURE = "/fixtures/grouping";

function viewportOf(page: Page): Locator {
  return page.locator("[data-pretable-scroll-viewport]");
}

/** A group header row at a given nesting level (`aria-level` is 1-based). */
function groupRowAtLevel(page: Page, level: number): Locator {
  return page.locator(`[data-pretable-group-row][aria-level="${level}"]`);
}

/** Scroll the grid's scrollport vertically and wait for the offset to take. */
async function scrollTo(viewport: Locator, to: number | "bottom") {
  const target = await viewport.evaluate((el, t) => {
    const max = el.scrollHeight - el.clientHeight;
    const value = t === "bottom" ? max : t;
    el.scrollTop = value;
    return el.scrollTop;
  }, to);
  await expect
    .poll(
      async () =>
        Math.abs((await viewport.evaluate((el) => el.scrollTop)) - target),
      { timeout: 5_000 },
    )
    .toBeLessThanOrEqual(1);
  return target;
}

test("depth indent is real pixels, not a declaration jsdom cannot resolve", async ({
  page,
}) => {
  await page.goto(FIXTURE, { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);

  const depth0 = groupRowAtLevel(page, 1).first();
  const depth1 = groupRowAtLevel(page, 2).first();
  await expect(depth0).toBeVisible();
  await expect(depth1).toBeVisible();

  // One `evaluate` per row, and both rows are on screen together, so the two
  // boxes come from the same layout — no chance of a reflow between them.
  const read = (row: Locator) =>
    row.evaluate((el) => {
      const cell = el.querySelector<HTMLElement>("[data-pretable-group-cell]");
      const label = el.querySelector<HTMLElement>(
        "[data-pretable-group-label]",
      );
      if (!cell || !label) throw new Error("group cell or label missing");
      const style = getComputedStyle(cell);
      return {
        cellLeft: cell.getBoundingClientRect().left,
        labelLeft: label.getBoundingClientRect().left,
        paddingLeft: parseFloat(style.paddingLeft),
        indentToken: style.getPropertyValue("--pretable-group-indent").trim(),
      };
    });

  const a = await read(depth0);
  const b = await read(depth1);

  // The two group cells occupy the same column, so any horizontal difference
  // between their labels is the indent and nothing else.
  expect(b.cellLeft).toBeCloseTo(a.cellLeft, 1);

  // The token has to resolve to a length. `calc(0 * <nothing>)` is invalid and
  // collapses the whole padding, which is the failure mode a theme missing the
  // token would produce.
  expect(a.indentToken).toMatch(/^[\d.]+px$/);
  const step = parseFloat(a.indentToken);
  expect(step).toBeGreaterThan(0);

  const paddingDelta = b.paddingLeft - a.paddingLeft;
  const labelDelta = b.labelLeft - a.labelLeft;

  // Reported so a regression says how far off it is rather than just "false".
  console.log(
    `[grouping] indent step=${step}px paddingDelta=${paddingDelta}px labelDelta=${labelDelta}px`,
  );

  expect(paddingDelta).toBeCloseTo(step, 1);
  // The padding only matters if it actually moves the label: this is the half
  // jsdom cannot see.
  expect(labelDelta).toBeGreaterThan(0);
  expect(labelDelta).toBeCloseTo(step, 1);
});

test("collapsing at the bottom of a long list leaves scroll in range and rows on screen", async ({
  page,
}) => {
  await page.goto(FIXTURE, { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);

  const viewport = viewportOf(page);
  const before = await viewport.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
  expect(before.scrollHeight).toBeGreaterThan(before.clientHeight * 4);

  const atBottom = await scrollTo(viewport, "bottom");
  expect(atBottom).toBeCloseTo(before.scrollHeight - before.clientHeight, 0);

  // The deepest group whose header is on screen at the bottom. Collapsing it
  // removes height that is entirely BELOW the current offset, so `scrollTop`
  // is left past the shrunken `scrollHeight` — the one case the design says is
  // not free (see "Expansion and scroll" in the spec).
  const twisty = page.locator("[data-pretable-group-twisty]").last();
  await expect(twisty).toBeVisible();
  await twisty.click();

  const after = await viewport.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const rows = Array.from(
      el.querySelectorAll<HTMLElement>(
        "[data-pretable-row], [data-pretable-group-row]",
      ),
    );
    const onScreen = rows.filter((row) => {
      const r = row.getBoundingClientRect();
      return r.bottom > rect.top + 1 && r.top < rect.bottom - 1;
    });
    return {
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      renderedRows: rows.length,
      onScreenRows: onScreen.length,
    };
  });

  console.log(
    `[grouping] collapse-at-bottom scrollTop=${after.scrollTop} max=${
      after.scrollHeight - after.clientHeight
    } rendered=${after.renderedRows} onScreen=${after.onScreenRows}`,
  );

  // The collapse must actually have shrunk the content, or this test proves
  // nothing about the out-of-range window.
  expect(after.scrollHeight).toBeLessThan(before.scrollHeight);
  expect(after.scrollTop).toBeLessThanOrEqual(
    after.scrollHeight - after.clientHeight + 1,
  );
  // The real symptom of planning against a stale offset is a viewport of blank
  // spacer with the rows drawn off the end of it.
  expect(after.onScreenRows).toBeGreaterThan(0);
});

test("keyboard round-trip: ArrowLeft collapses, ArrowRight expands", async ({
  page,
}) => {
  await page.goto(FIXTURE, { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);

  const viewport = viewportOf(page);
  const topGroup = groupRowAtLevel(page, 1).first();
  await expect(topGroup).toHaveAttribute("aria-expanded", "true");

  // Click the label, not the twisty: the twisty toggles on click, which would
  // make the ArrowLeft below a no-op rather than the collapse under test.
  await topGroup.locator("[data-pretable-group-label]").click();
  await expect(topGroup.locator("[data-pretable-group-cell]")).toHaveAttribute(
    "data-pretable-focused",
    "true",
  );

  const contentHeight = () => viewport.evaluate((el) => el.scrollHeight);
  const expandedHeight = await contentHeight();
  const firstChild = page.locator('[data-pretable-row-id="s1-i1-r1"]');
  await expect(firstChild).toHaveCount(1);

  await page.keyboard.press("ArrowLeft");
  await expect(topGroup).toHaveAttribute("aria-expanded", "false");
  await expect(firstChild).toHaveCount(0);
  const collapsedHeight = await contentHeight();

  console.log(
    `[grouping] keyboard expanded=${expandedHeight}px collapsed=${collapsedHeight}px`,
  );
  expect(collapsedHeight).toBeLessThan(expandedHeight);

  await page.keyboard.press("ArrowRight");
  await expect(topGroup).toHaveAttribute("aria-expanded", "true");
  await expect(firstChild).toHaveCount(1);
  expect(await contentHeight()).toBe(expandedHeight);
});
