import { expect, test } from "@playwright/test";

import {
  mountGroupingFixture,
  openGroupingPane,
  waitForGridReady,
} from "./helpers";

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

  // The dialog's operator picker is the replacement too — and the grid's own
  // behaviour on it survived: `FilterMenu` focuses the picker on mount through
  // a ref, so a replacement that dropped its ref would leave focus on <body>.
  const operator = dialog.locator("[data-fixture-select]");
  await expect(operator).toHaveAttribute(
    "data-fixture-select",
    "filter-operator",
  );
  // `name` is a text column, so the draft opens on the type's first operator.
  await expect(operator).toHaveAttribute("data-fixture-value", "contains");
  await expect(operator).toBeFocused();
  await page.keyboard.press("Escape");

  // The builder's pickers are replaced at their sites as well, and the grid
  // hands them a real option list rather than rendering the kit's own.
  await page
    .locator('[data-pretable-tool-tab][data-pretable-section="filters"]')
    .click();
  await page.getByRole("button", { name: "+ filter", exact: true }).click();
  const rowColumn = page.locator('[data-fixture-select="filter-row-column"]');
  await expect(rowColumn).toHaveCount(1);
  expect(
    Number(await rowColumn.getAttribute("data-fixture-option-count")),
  ).toBeGreaterThan(0);
  // Still nothing the kit draws itself, now that a second site has rendered.
  await expect(page.locator("[data-pretable-select]")).toHaveCount(0);
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

  // The menu opened where the placement rule puts it for this anchor —
  // proving the grid's own props (`onClick` → `event.currentTarget`) landed
  // on the replacement's real node. This is a placement check, not a ref
  // check.
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
  // THIS is the ref claim. Focus moved onto the menu's first item when it
  // opened (`menu-keyboard.ts`), and the grid returns it through
  // `kebabNodesRef` — filled by the ref callback the replacement forwarded.
  // A replacement that dropped its ref would leave focus on <body> here.
  await expect(kebab).toBeFocused();
});

/**
 * The kit's own picker, on a real grid with nothing replaced.
 *
 * The unit suite drives `PretableSelect` in jsdom, where a keypress is a
 * synthesised React event and focus is bookkeeping. This is the browser's
 * verdict on the same contract, at a site where a wrong commit is visible in
 * the grid: `/fixtures/grouping` declares `aggregate: "sum"` on `qty` with a
 * `formatAggregate` of `Σ <n>`, and Industry 01-2's five values are 121…125 —
 * so sum (Σ 615) and avg (Σ 123) disagree, and the group row's cell says which
 * one the keyboard actually chose.
 */
test("the kit's picker commits by keyboard, with typeahead, and Escape leaves focus on the trigger", async ({
  page,
}) => {
  await mountGroupingFixture(page);
  await openGroupingPane(page);

  const picker = page.locator(
    '[data-pretable-aggregate-row][data-pretable-column-id="qty"] [data-pretable-aggregate]',
  );
  await expect(picker).toHaveAttribute("data-pretable-value", "default");
  const aggregateCell = page
    .locator("[data-pretable-group-row]")
    .filter({ hasText: "Industry 01-2" })
    .locator('[data-pretable-cell][data-pretable-column-id="qty"]');
  await expect(aggregateCell).toHaveText("Σ 615");

  const list = page.locator("[data-pretable-listbox]");

  // ArrowDown on a closed trigger opens the list — the native <select>
  // contract — and the list is portalled out to <body>, which is the whole
  // reason it needs its own placement.
  await picker.focus();
  await page.keyboard.press("ArrowDown");
  await expect(list).toBeVisible();
  expect(await list.evaluate((el) => el.parentElement === document.body)).toBe(
    true,
  );

  // Typeahead by label prefix. The offered labels here are `Default (Sum)`,
  // `None`, `Sum`, `Average`, `Min`, `Max`, `Count`, so "a" is unambiguous —
  // and it is NOT the committed value, so the assertion below can fail.
  await page.keyboard.press("a");
  await page.keyboard.press("Enter");

  await expect(picker).toHaveAttribute("data-pretable-value", "avg");
  await expect(list).toHaveCount(0);
  // Enter commits and hands focus back to the trigger, not to <body>.
  await expect(picker).toBeFocused();
  // ...and the commit reached the model, not just the trigger's own state.
  await expect(aggregateCell).toHaveText("Σ 123");

  // Space opens too, and Escape closes without committing anything.
  await page.keyboard.press(" ");
  await expect(list).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(list).toHaveCount(0);
  await expect(picker).toBeFocused();
  await expect(picker).toHaveAttribute("data-pretable-value", "avg");
  await expect(aggregateCell).toHaveText("Σ 123");
});
