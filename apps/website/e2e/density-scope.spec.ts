import { expect, test, type Page } from "@playwright/test";

import { waitForGridReady } from "./helpers";

/**
 * `data-density` scopes to a wrapper the way `data-theme` does.
 *
 * It did not: the three density tokens the engine reads in JavaScript were
 * resolved off `document.documentElement` unconditionally, so a grid inside
 * `<div data-density="compact">` painted compact — the tokens are custom
 * properties and inherit — while row height, header height and the whole
 * virtualization geometry came from the root. Paint and measurement disagreed.
 *
 * ## Why these assertions are here and not in jsdom
 *
 * The unit suite (`packages/react/src/__tests__/density-scope.test.tsx`) can
 * check that the engine RESOLVES the scoped value — jsdom does apply selectors
 * and does inherit custom properties. Two things it cannot check, both pinned
 * here:
 *
 *  1. **Real pixels.** jsdom measures every element at zero, so "the row is
 *     40px tall" is not a claim it can make about anything. It also cannot see
 *     that `--pretable-row-height` is a floor rather than a height.
 *  2. **The scoped value is what gets PAINTED, not a correction after a visible
 *     frame.** The read happens through a ref, which is null on the render that
 *     creates the element, so the first snapshot of a mounting grid resolves the
 *     root and something later has to replace it. Whether the replacement beats
 *     the browser to the screen is a question about frames, and jsdom converges
 *     either way — it lays nothing out and reports both as passing. The
 *     per-frame sampler this fixture installs is the only instrument that
 *     separates them, and it is what established that `PretableSurface` paints
 *     nothing size-dependent before its ref attaches (see the long comment in
 *     `packages/react/src/density.ts` for the measurement and what it rules
 *     out).
 *
 * The fixture's bootstrap script installs that sampler before React hydrates.
 * See `apps/website/app/fixtures/density-scope/page.tsx`.
 */

const FIXTURE = "/fixtures/density-scope";

const ROOT_ROW_HEIGHT = 96;
const ROOT_HEADER_HEIGHT = 72;
const SCOPED_ROW_HEIGHT = 40;
const SCOPED_HEADER_HEIGHT = 28;

interface SampleWindow {
  __densitySamples: { scoped: number[]; unscoped: number[] };
  __densityResetSamples: () => void;
}

async function firstRowHeight(page: Page, testId: string): Promise<number> {
  const row = page
    .locator(`[data-testid="${testId}"] [data-pretable-row]`)
    .first();
  const box = await row.boundingBox();
  expect(box).not.toBeNull();
  return box!.height;
}

async function headerRowHeight(page: Page, testId: string): Promise<number> {
  const header = page
    .locator(`[data-testid="${testId}"] [data-pretable-header-row]`)
    .first();
  const box = await header.boundingBox();
  expect(box).not.toBeNull();
  return box!.height;
}

async function openFixture(page: Page): Promise<void> {
  await page.goto(FIXTURE);
  await waitForGridReady(page, '[data-testid="scoped"]');
  await waitForGridReady(page, '[data-testid="unscoped"]');
}

test.describe("density scoped to a wrapper", () => {
  test("the grid is drawn at the wrapper's density, in real pixels", async ({
    page,
  }) => {
    await openFixture(page);

    // Both grids are identical components on the same page. A single read of
    // document.documentElement gives them the same number by construction, so
    // this pair cannot pass unless the read is genuinely per-element.
    await expect
      .poll(() => firstRowHeight(page, "scoped"))
      .toBeCloseTo(SCOPED_ROW_HEIGHT, 0);
    await expect
      .poll(() => firstRowHeight(page, "unscoped"))
      .toBeCloseTo(ROOT_ROW_HEIGHT, 0);

    // The header height is used directly rather than as a floor, so it is the
    // one that cannot be satisfied by content happening to be tall.
    expect(await headerRowHeight(page, "scoped")).toBeCloseTo(
      SCOPED_HEADER_HEIGHT,
      0,
    );
    expect(await headerRowHeight(page, "unscoped")).toBeCloseTo(
      ROOT_HEADER_HEIGHT,
      0,
    );
  });

  test("the root's density is never painted in the scoped grid", async ({
    page,
  }) => {
    // The no-flash claim, measured across a REMOUNT rather than the initial
    // load. On a warm localhost load hydration completes inside a single frame,
    // so the first paint cannot distinguish "corrected before paint" from
    // "corrected one frame later" — there was no earlier frame to be wrong in.
    // A click-driven remount puts a mount commit in the middle of a normal
    // frame cadence, where a post-paint correction is a visible frame at the
    // root's height.
    await openFixture(page);
    await expect
      .poll(() => firstRowHeight(page, "scoped"))
      .toBeCloseTo(SCOPED_ROW_HEIGHT, 0);

    await page.evaluate(() => {
      (window as unknown as SampleWindow).__densityResetSamples();
    });
    await page.getByTestId("remount").click();
    await waitForGridReady(page, '[data-testid="scoped"]');
    // Let the sampler run well past the frame the remount committed in, so a
    // post-paint correction has somewhere to show up.
    await page.waitForTimeout(1000);

    const samples = await page.evaluate(
      () => (window as unknown as SampleWindow).__densitySamples.scoped,
    );

    // Sanity: the sampler is running and saw the remounted grid. Without this
    // the assertion below would pass vacuously on an empty list.
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.at(-1)).toBeCloseTo(SCOPED_ROW_HEIGHT, 0);

    // The claim: no frame between the remount and now was drawn at the root's
    // row height.
    for (const height of samples) {
      expect(
        Math.abs(height - ROOT_ROW_HEIGHT) > 1,
        `painted a frame at the root's row height; sequence was ${JSON.stringify(samples)}`,
      ).toBe(true);
    }
  });

  test("a runtime density swap on the wrapper is picked up", async ({
    page,
  }) => {
    // The observer half: watching <html> alone, this attribute write happens on
    // an unobserved node, so nothing fires and the grid keeps the geometry it
    // resolved at mount even though the CSS around it has moved.
    await openFixture(page);
    await expect
      .poll(() => firstRowHeight(page, "scoped"))
      .toBeCloseTo(SCOPED_ROW_HEIGHT, 0);
    expect(await headerRowHeight(page, "scoped")).toBeCloseTo(
      SCOPED_HEADER_HEIGHT,
      0,
    );

    await page.evaluate(() => {
      document
        .querySelector('[data-testid="scoped"]')
        ?.removeAttribute("data-density");
    });

    await expect
      .poll(() => firstRowHeight(page, "scoped"))
      .toBeCloseTo(ROOT_ROW_HEIGHT, 0);
    await expect
      .poll(() => headerRowHeight(page, "scoped"))
      .toBeCloseTo(ROOT_HEADER_HEIGHT, 0);
  });

  test("root-level density still drives an unscoped grid at runtime", async ({
    page,
  }) => {
    // The old contract, which the fix must not have traded away. The unscoped
    // grid resolves through its own element too now, so a root-level change has
    // to reach it by ordinary inheritance and by an observer that still watches
    // the root.
    await openFixture(page);
    await expect
      .poll(() => firstRowHeight(page, "unscoped"))
      .toBeCloseTo(ROOT_ROW_HEIGHT, 0);

    await page.evaluate(() => {
      document.documentElement.style.setProperty(
        "--pretable-row-height",
        "64px",
      );
    });

    await expect
      .poll(() => firstRowHeight(page, "unscoped"))
      .toBeCloseTo(64, 0);
    // And the scoped grid does not follow it: the wrapper's declaration still
    // wins for its own subtree.
    expect(await firstRowHeight(page, "scoped")).toBeCloseTo(
      SCOPED_ROW_HEIGHT,
      0,
    );
  });
});
