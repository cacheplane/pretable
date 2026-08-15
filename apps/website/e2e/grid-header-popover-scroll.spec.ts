import { expect, test, type Page } from "@playwright/test";

import { waitForGridReady } from "./helpers";

/**
 * A header popover, and what a scroll is allowed to do to it.
 *
 * `useHeaderPopover` positions its popover against the anchor's rect at the
 * moment it opened. Something has to keep the two together as the page moves,
 * and the original something was "close on any window scroll" — a rule that
 * cannot tell a page still settling from a user deliberately scrolling away.
 *
 * That is not a hypothetical. `grid-header-keyboard.spec.ts` carries a
 * `waitForScrollSettled` helper written for exactly this: the site's smooth
 * `scrollIntoView` kept firing `scroll` for ~1.5s after the grid was ready, so
 * the FIRST filter opened on a page was unmounted in the same breath and every
 * later one worked. A user who opens a filter mid-scroll got the same
 * treatment, with no test to say so.
 *
 * The contract asserted here is the one the rule was reaching for: the popover
 * FOLLOWS its anchor while the anchor is on screen, and closes when the anchor
 * is genuinely gone.
 *
 * Why real browsers, and both engines: jsdom does not scroll, has no layout,
 * and returns a 0x0 rect for every element — every assertion below would pass
 * vacuously there. The reposition math is pure geometry, so it is the engines'
 * scroll and layout behaviour that is under test.
 */

const FILTERING_DOCS = "/docs/grid/filtering";

/** The open filter popover, wherever it is portaled to. */
const POPOVER = "[data-pretable-filter-menu]";

/** Vertical distance a scroll assertion allows for, in px. */
const TOLERANCE = 2;

async function mountFirstExample(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page
    .locator("figure")
    .first()
    .evaluate((el) => el.scrollIntoView({ block: "center" }));
  await waitForGridReady(page);
}

/** Wait until the document has stopped scrolling. */
async function waitForScrollSettled(page: Page) {
  let previous = Number.NaN;
  await expect
    .poll(
      async () => {
        const now = await page.evaluate(() => window.scrollY);
        const settled = now === previous;
        previous = now;
        return settled;
      },
      { intervals: [100], timeout: 5_000 },
    )
    .toBe(true);
}

/**
 * Open the first column's filter popover from its funnel.
 *
 * Returns the funnel and the popover, both already measured as visible, so a
 * caller can compare their positions before and after a scroll.
 */
async function openFirstFilter(page: Page) {
  await page.locator("[data-pretable-header-row]").first().hover();
  const funnel = page.locator("[data-pretable-filter-funnel]").first();
  await funnel.click();
  const popover = page.locator(POPOVER);
  await expect(popover).toHaveCount(1);
  return { funnel, popover };
}

/**
 * Viewport-relative geometry of the funnel and the popover, in one read.
 *
 * `getBoundingClientRect` rather than Playwright's `boundingBox()`: the
 * popover is `position: fixed` and the funnel is not, so the two only live in
 * the same coordinate space when that space is the VIEWPORT. Mixing the two
 * would make a stationary popover look like it had followed a scrolling
 * anchor.
 */
function measure(page: Page) {
  return page.evaluate(() => {
    const funnel = document.querySelector("[data-pretable-filter-funnel]");
    const popover = document.querySelector("[data-pretable-filter-menu]");
    return {
      funnelBottom: funnel?.getBoundingClientRect().bottom ?? null,
      popoverTop: popover?.getBoundingClientRect().top ?? null,
      scrollY: window.scrollY,
    };
  });
}

/** Scroll the window by `dy` and wait for the offset to actually change. */
async function scrollWindowBy(page: Page, dy: number) {
  const before = await page.evaluate(() => window.scrollY);
  await page.evaluate((amount) => {
    window.scrollBy({ top: amount, behavior: "instant" as ScrollBehavior });
  }, dy);
  await expect
    .poll(async () => page.evaluate(() => window.scrollY))
    .not.toBe(before);
  return before;
}

test.describe("a header popover and the scrolling page", () => {
  test("an ordinary scroll repositions the popover instead of closing it", async ({
    page,
  }) => {
    await mountFirstExample(page, FILTERING_DOCS);
    await waitForScrollSettled(page);

    const { popover } = await openFirstFilter(page);

    const before = await measure(page);
    // The popover sits a fixed gap under its anchor. That GAP is the invariant
    // a reposition has to preserve — asserting the popover's absolute `top`
    // alone would also be satisfied by a popover re-anchored to anything else.
    const gap = before.popoverTop! - before.funnelBottom!;

    const scrolledBy = 120;
    await scrollWindowBy(page, scrolledBy);

    // The whole point: still open.
    await expect(popover).toHaveCount(1);

    const after = await measure(page);

    // Confirm the anchor genuinely moved in the viewport before reading
    // anything into the popover having followed it. Without this, a page that
    // failed to scroll would make the gap assertion below pass trivially.
    expect(after.scrollY - before.scrollY).toBeGreaterThan(TOLERANCE);
    expect(before.funnelBottom! - after.funnelBottom!).toBeGreaterThan(
      TOLERANCE,
    );

    expect(
      Math.abs(after.popoverTop! - after.funnelBottom! - gap),
    ).toBeLessThan(TOLERANCE);
  });

  test("a popover opened while the page is still moving survives", async ({
    page,
  }) => {
    await mountFirstExample(page, FILTERING_DOCS);
    await waitForScrollSettled(page);

    // Focus the first column's header, so the popover can be opened from the
    // keyboard — a click cannot reliably land on a target that is moving.
    await page
      .locator(
        '[data-pretable-scroll-viewport] [data-pretable-row][data-pretable-row-index="0"] [role=gridcell][data-pretable-column-id]',
      )
      .first()
      .click();
    await page.keyboard.press("ArrowUp");
    await waitForScrollSettled(page);

    // How far the page can scroll while KEEPING the header on screen. A scroll
    // that carries the anchor out of the viewport is supposed to close the
    // popover — that is the next test — so overshooting here would assert the
    // opposite of what this test is about. Measured on this page the header
    // sits ~280px down a 720px viewport, so there is a few hundred px of room.
    const delta = await page.evaluate(() => {
      const anchor = document.querySelector("[data-pretable-filter-funnel]")!;
      return Math.floor(anchor.getBoundingClientRect().top) - 60;
    });
    // Enough motion that the smooth scroll is unambiguously still running when
    // the keypress lands. If the layout ever changes so there is no room, this
    // fails loudly instead of passing on a scroll that never happened.
    expect(delta).toBeGreaterThan(150);

    // Put the page genuinely in motion, then open. This is the user who opens
    // a filter mid-scroll.
    await page.evaluate((amount) => {
      window.scrollBy({ top: amount, behavior: "smooth" });
    }, delta);
    await page.keyboard.press("Alt+ArrowDown");

    await expect(page.locator(POPOVER)).toHaveCount(1);

    // And it is still there once the motion stops — a popover that survived
    // only because the assertion ran before the first scroll event would fail
    // here.
    await waitForScrollSettled(page);
    await expect(page.locator(POPOVER)).toHaveCount(1);
  });

  test("scrolling the anchor off the screen still closes the popover", async ({
    page,
  }) => {
    await mountFirstExample(page, FILTERING_DOCS);
    await waitForScrollSettled(page);

    const { funnel, popover } = await openFirstFilter(page);

    // Far enough that the header row is unambiguously out of the viewport.
    await page.evaluate(() => {
      const anchor = document.querySelector("[data-pretable-filter-funnel]")!;
      const top = anchor.getBoundingClientRect().top;
      window.scrollBy({
        top: top + window.innerHeight,
        behavior: "instant" as ScrollBehavior,
      });
    });

    await expect(popover).toHaveCount(0);
    // Proves the close was earned: the anchor really did leave the viewport.
    const funnelTop = await funnel.evaluate(
      (el) => el.getBoundingClientRect().bottom,
    );
    expect(funnelTop).toBeLessThanOrEqual(0);
  });

  test("Escape and an outside click still close the popover", async ({
    page,
  }) => {
    await mountFirstExample(page, FILTERING_DOCS);
    await waitForScrollSettled(page);

    const { popover } = await openFirstFilter(page);
    await page.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);

    await openFirstFilter(page);
    await expect(page.locator(POPOVER)).toHaveCount(1);
    // Somewhere unambiguously outside both the popover and the funnel.
    await page.mouse.click(4, 4);
    await expect(page.locator(POPOVER)).toHaveCount(0);
  });
});
