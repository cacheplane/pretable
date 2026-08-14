import { expect, test, type Page } from "@playwright/test";

import { waitForGridReady } from "./helpers";

/**
 * The running-examples component's core promise: toggling between Preview
 * and Code never tears down the demo. Both panes stay mounted at all times
 * (see the block comment above the pane markup in ExampleShell.tsx) — the
 * inactive one is faded out and made `inert`, not unmounted or
 * `display: none`-d, so a reader's scroll position, selection, or grouping
 * state inside the demo survives a round trip through Code.
 *
 * `toBeVisible()` is unusable for the pane assertions on purpose: it ignores
 * `opacity: 0`, so it would pass just as happily if the WRONG pane were
 * showing — it cannot see the bug this file exists to catch. Assertions
 * below read the `inert` attribute and computed opacity directly instead.
 */

const DOCS_URL = "/docs/grid/grouping";

/**
 * Docs pages carry several examples each, so "the figure on this page" is not
 * a locator — it resolves to every example and trips strict mode.
 *
 * Scope by POSITION rather than by title. Filtering on the title would make
 * the title assertion below tautological: the locator would select the figure
 * containing that text and then assert that text is present, which no
 * regression can fail. `.first()` keeps the assertion able to fail.
 *
 * First is also the only safe index: demos mount lazily (in view + selected),
 * so an example further down the page has no grid at all until it is scrolled
 * to.
 */
const EXAMPLE_TITLE = "Drag-to-group panel";

const exampleFigure = (page: Page) =>
  page
    .locator("figure", {
      has: page.getByRole("tablist", { name: "Example view" }),
    })
    .first();

test("renders the example figure with its title", async ({ page }) => {
  await page.goto(DOCS_URL, { waitUntil: "domcontentloaded" });
  const figure = exampleFigure(page);
  await expect(figure).toBeVisible();
  await expect(figure).toContainText(EXAMPLE_TITLE);
});

test("toggling Code and back does not tear down the demo; the .md link resolves", async ({
  page,
  request,
}) => {
  await page.goto(DOCS_URL, { waitUntil: "domcontentloaded" });

  // The demo is a Pretable grid mounted inside the example's Preview pane,
  // and the example shell's own tab controls hydrate in the same React root
  // as that grid — so the grid's own hydration signal doubles as the
  // shell's. By the time the grid reports data-pretable-hydrated="true", the
  // tab click handlers below are live too. Same failure mode as documented
  // on `waitForGridReady` itself: a click that lands before hydration is
  // accepted by the browser and silently dropped, so gate on the signal
  // rather than clicking blind.
  await waitForGridReady(page);

  const figure = exampleFigure(page);
  const previewTab = figure.getByRole("tab", { name: "Preview" });
  const codeTab = figure.getByRole("tab", { name: "Code" });
  await expect(previewTab).toHaveAttribute("aria-selected", "true");
  await expect(codeTab).toHaveAttribute("aria-selected", "false");

  // Panes are located the same way the unit suite does
  // (app/components/docs/mdx/__tests__/ExampleShell.test.tsx): each tab's
  // `aria-controls` names its pane's id.
  const previewPaneId = await previewTab.getAttribute("aria-controls");
  const codePaneId = await codeTab.getAttribute("aria-controls");
  if (!previewPaneId || !codePaneId) {
    throw new Error("Expected both view tabs to carry aria-controls");
  }
  const previewPane = page.locator(`#${previewPaneId}`);
  const codePane = page.locator(`#${codePaneId}`);

  const opacityOf = (locator: typeof previewPane) =>
    locator.evaluate((el) => Number(getComputedStyle(el).opacity));

  // The pane fade is `transition-opacity` (see ExampleShell.tsx), so a click
  // leaves opacity mid-animation for a beat — reading it once, right after
  // the click, is a race. Poll to the settled value instead of asserting a
  // single sample.
  const expectSettledOpacity = (locator: typeof previewPane, value: number) =>
    expect.poll(() => opacityOf(locator), { timeout: 2_000 }).toBe(value);

  // Starts on Preview: the pane is live (no inert, full opacity) and Code is
  // parked (inert, faded).
  await expect(previewPane).not.toHaveAttribute("inert");
  await expect(codePane).toHaveAttribute("inert");
  await expectSettledOpacity(previewPane, 1);
  await expectSettledOpacity(codePane, 0);

  // Tag the actual grid node inside the preview pane before touching
  // anything. If the component ever regressed to unmounting the inactive
  // pane instead of fading it, this tag would disappear with the old node
  // and the "same node" assertion below would fail loudly instead of
  // accidentally passing against a fresh mount that merely looks the same.
  const grid = previewPane.locator("[data-pretable-scroll-viewport]").first();
  await expect(grid).toBeVisible();
  await grid.evaluate((el) => el.setAttribute("data-e2e-kept", "yes"));

  // --- Code ---
  await codeTab.click();
  await expect(codeTab).toHaveAttribute("aria-selected", "true");
  await expect(previewTab).toHaveAttribute("aria-selected", "false");
  await expect(codePane).not.toHaveAttribute("inert");
  await expect(previewPane).toHaveAttribute("inert");
  await expectSettledOpacity(codePane, 1);
  await expectSettledOpacity(previewPane, 0);

  // --- back to Preview ---
  await previewTab.click();
  await expect(previewTab).toHaveAttribute("aria-selected", "true");
  await expect(codeTab).toHaveAttribute("aria-selected", "false");
  await expect(previewPane).not.toHaveAttribute("inert");
  await expect(codePane).toHaveAttribute("inert");
  await expectSettledOpacity(previewPane, 1);
  await expectSettledOpacity(codePane, 0);

  // The tag survives: this is the same DOM node the test tagged before the
  // round trip, not a fresh mount that happens to look the same.
  await expect(grid).toHaveAttribute("data-e2e-kept", "yes");

  // The .md link resolves for real, not just as an anchor with an href.
  const mdHref = await figure
    .getByRole("link", { name: ".md" })
    .getAttribute("href");
  if (!mdHref) throw new Error("Expected the .md link to have an href");
  const mdResponse = await request.get(mdHref);
  expect(mdResponse.status()).toBe(200);
  expect(mdResponse.headers()["content-type"]).toMatch(/text\/markdown/);
});
