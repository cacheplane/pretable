import { expect, test, type Page } from "@playwright/test";

import { waitForGridReady } from "./helpers";

/**
 * The grid, in a DEVELOPMENT build.
 *
 * Every other spec in this directory runs against `next start` — a production
 * build, where React StrictMode does not double-invoke. That blind spot is not
 * theoretical: from #321 until #383 the homepage grid rendered NOTHING in
 * `next dev`, because StrictMode's rehearsal unmount ran a cleanup that
 * disposed the row model the remount was about to keep using. The suite stayed
 * 100/100 green for weeks while the dev experience was a blank page.
 *
 * A development build is the first thing any contributor and any evaluating
 * user sees, so it is worth one spec. This one asserts the two facts that were
 * false the whole time: a grid renders rows, and nothing threw getting there.
 *
 * Run against a dev server:
 *
 *   pnpm --filter @pretable/app-website exec next dev -p 3100
 *   PRETABLE_DEV_URL=http://localhost:3100 pnpm --filter @pretable/app-website \
 *     exec playwright test e2e/dev-mode.spec.ts --project=chromium
 *
 * Skipped when `PRETABLE_DEV_URL` is unset, so the production smoke — which
 * points `BASE_URL` at a deployment — is unaffected.
 */
const devUrl = process.env.PRETABLE_DEV_URL;

test.describe("development build", () => {
  test.skip(
    !devUrl,
    "set PRETABLE_DEV_URL to a running `next dev` server to run this",
  );

  /** Fails the test on the first page error rather than at the assertion. */
  function collectFatals(page: Page): string[] {
    const fatals: string[] = [];
    page.on("pageerror", (error) => fatals.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") fatals.push(`console: ${message.text()}`);
    });
    return fatals;
  }

  test("the homepage grid renders rows under StrictMode", async ({ page }) => {
    const fatals = collectFatals(page);

    await page.goto(`${devUrl}/`, { waitUntil: "domcontentloaded" });
    await waitForGridReady(page);

    // Rows, not just a grid shell: the regression painted headers and nothing
    // else, so a `toBeVisible` on the grid would have passed straight through
    // it. The hero streams its book in, hence the poll.
    await expect
      .poll(() => page.locator("[data-pretable-row]").count(), {
        timeout: 20_000,
      })
      .toBeGreaterThan(5);

    expect(
      fatals,
      [
        "The dev build threw while rendering the grid.",
        "StrictMode double-invokes effects here and does not in production, so",
        "this is the build that catches lifecycle faults — a resource disposed",
        "on a rehearsal unmount, an effect that is not idempotent.",
        "",
        ...fatals,
      ].join("\n"),
    ).toEqual([]);
  });

  test("the docs grouping example renders under StrictMode", async ({
    page,
  }) => {
    // A second surface, mounted a different way: the hero streams into a model
    // it owns, this one is handed a settled model. The #382 fault lived in
    // ownership, so a spec that only ever checked the hero would have been one
    // refactor away from blind again.
    const fatals = collectFatals(page);

    await page.goto(`${devUrl}/docs/grid/grouping`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("[data-pretable-group-row]").first()).toBeVisible(
      {
        timeout: 20_000,
      },
    );
    expect(fatals).toEqual([]);
  });
});
