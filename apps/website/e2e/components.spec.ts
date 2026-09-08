import { expect, test } from "@playwright/test";

import {
  chooseOption,
  mountGroupingFixture,
  openFilterMenu,
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
  await expect(page.locator("[data-pretable-text-input]")).toHaveCount(0);
  await expect(page.locator("[data-pretable-checkbox]")).toHaveCount(0);

  // The row-select cell is the checkbox replacement, at its own site — and
  // the header's select-all is the same component at a different one.
  await expect(
    page.locator("[data-pretable-row-select]").first(),
  ).toHaveAttribute("data-fixture-checkbox", "row-select");
  await expect(page.locator("[data-pretable-row-select-all]")).toHaveAttribute(
    "data-fixture-checkbox",
    "row-select-all",
  );

  // The Columns pane's search box is the field replacement. The pane is the
  // fixture's default active section, so it is already rendered.
  await expect(page.locator("[data-pretable-tool-search]")).toHaveAttribute(
    "data-fixture-field",
    "tool-search",
  );

  // The tool panel's reset is the replacement, with its site and variant.
  const reset = page.locator("[data-pretable-tool-reset]");
  await expect(reset).toHaveAttribute("data-fixture-button", "tool-reset");
  await expect(reset).toHaveAttribute("data-fixture-variant", "link");

  // The header funnel is the icon replacement; the funnel is out of the
  // sequential tab order and only revealed on hover (grid-header-popover-scroll.spec.ts's
  // recipe), so hover the header row before clicking it.
  await page.locator("[data-pretable-header-row]").first().hover();
  const funnel = page.locator(
    '[data-pretable-filter-funnel][data-pretable-column-id="name"]',
  );
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
  // `name` is a text column, so the dialog's operand is the single-value
  // field — the field replacement, portalled into the dialog with it.
  await expect(dialog.locator("[data-pretable-filter-value]")).toHaveAttribute(
    "data-fixture-field",
    "filter-value",
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
  await expect(dialog).toHaveCount(0);

  // The OTHER value shape: `status` is an enum column, so its funnel offers
  // the checklist rather than a field, and every choice in it is the checkbox
  // replacement at `filter-choice` — the site that used to be a native
  // `<input type="checkbox">` and could not be replaced at all.
  const statusDialog = await openFilterMenu(page, "Status");
  const choices = statusDialog.locator("[data-pretable-filter-choice]");
  await expect(choices).toHaveCount(2);
  await expect(choices.first()).toHaveAttribute(
    "data-fixture-checkbox",
    "filter-choice",
  );
  // The grid hands the replacement its state and its option identity, so a
  // driver can still tell the choices apart.
  await expect(choices.first()).toHaveAttribute(
    "data-fixture-checked",
    "false",
  );
  await expect(choices.first()).toHaveAttribute(
    "data-pretable-option-value",
    "open",
  );
  await page.keyboard.press("Escape");
  await expect(statusDialog).toHaveCount(0);

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
  // Still nothing the kit draws itself, now that every site above has
  // rendered at least once — the builder's own field and checklist included.
  await expect(page.locator("[data-pretable-select]")).toHaveCount(0);
  await expect(page.locator("[data-pretable-text-input]")).toHaveCount(0);
  await expect(page.locator("[data-pretable-checkbox]")).toHaveCount(0);
  await expect(
    page.locator('[data-fixture-field="filter-row-value"]'),
  ).toHaveCount(1);
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

test("the funnel dialog survives a picked operator, and Escape unwinds one layer at a time", async ({
  page,
}) => {
  await page.goto("/fixtures/grouping", { waitUntil: "domcontentloaded" });
  const dialog = await openFilterMenu(page, "Name");
  const operator = dialog.locator("[data-pretable-filter-operator]");
  const list = page.locator("[data-pretable-listbox]");

  // `name` is a text column, so the draft opens on the type's first operator.
  await expect(operator).toHaveAttribute("data-pretable-value", "contains");

  // The claim only a real browser can make. The list is portalled to <body>,
  // so its options are OUTSIDE the dialog's subtree: the dialog's own
  // outside-press listener sees the pointerdown that picks one. Nothing here
  // asserts a style — this passes only if that press is recognised as
  // belonging to the dialog, and fails by the dialog vanishing mid-choice.
  await chooseOption(page, operator, "startsWith");
  await expect(page.locator("[data-pretable-filter-menu]")).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(operator).toHaveAttribute("data-pretable-value", "startsWith");

  // Escape unwinds ONE layer per press: the list is the innermost dismissable
  // thing, so the first press closes it and leaves the dialog standing (with
  // focus back on the trigger, not lost to <body>); the second closes the
  // dialog. A list that let Escape through would take both at once.
  await operator.click();
  await expect(list).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(list).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(operator).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

/**
 * The kit's own checkbox, on a real grid with nothing replaced.
 *
 * Two claims jsdom can only approximate, at a site where a wrong answer is
 * visible in the grid. `/fixtures/grouping` is grouped by `sector` and
 * `industry` with `hideGroupedColumns` on by default, so those two columns
 * are ABSENT from the header row; the pane's switch is the control that puts
 * them back, and the header is the verdict on whether the toggle reached the
 * engine rather than only the button's own attribute.
 *
 * 1. Space activates it. `PretableCheckbox` ships no key handler at all — it
 *    relies on the native button's activation behaviour, where Space fires a
 *    click. jsdom does not implement that mapping (a synthesised keydown
 *    produces no click), so the unit suite has to dispatch the click itself
 *    and the claim is only ever checked here.
 * 2. A wrapping `<label>` forwards a click on its TEXT to the control.
 *    `<button>` is a labelable element, so the browser does this; jsdom's
 *    label handling is partial, and the assertion there would pass on a
 *    label that forwards nothing.
 */
test("the kit's checkbox takes Space and its label's text, and the grid follows", async ({
  page,
}) => {
  await mountGroupingFixture(page);
  await openGroupingPane(page);

  const box = page.locator("[data-pretable-hide-grouped]");
  const sectorHeader = page.locator(
    '[data-pretable-header-cell][data-pretable-column-id="sector"]',
  );

  // The starting state, and the grid agreeing with it: hide-grouped is on, so
  // the grouped column is not drawn.
  await expect(box).toHaveAttribute("aria-checked", "true");
  await expect(sectorHeader).toHaveCount(0);

  // Focus it directly rather than tabbing to it. WebKit skips a plain
  // `<button>` in the sequential order unless macOS's "Tab moves between all
  // controls" is on, and this checkbox carries no explicit `tabIndex` — the
  // tab-order question is tool-panel.spec.ts's, which treats this stop as
  // conditional for exactly that reason. What is asserted here is that the
  // control is focusable and that Space activates it once focused.
  await box.focus();
  await expect(box).toBeFocused();
  await page.keyboard.press(" ");

  await expect(box).toHaveAttribute("aria-checked", "false");
  // THE VISIBLE CONSEQUENCE: the write reached the engine, and the column the
  // grouping was hiding is drawn again.
  await expect(sectorHeader).toHaveCount(1);

  // Now the label. Click a point inside the `<label>` that is past the
  // checkbox's right edge — the text, not the box — and the browser forwards
  // it to the control.
  const label = page.locator("[data-pretable-tool-grouping] label", {
    has: page.locator("[data-pretable-hide-grouped]"),
  });
  const [labelBox, boxBox] = await Promise.all([
    label.boundingBox(),
    box.boundingBox(),
  ]);
  const textX = boxBox!.x + boxBox!.width + 8 - labelBox!.x;
  // The click point really is off the control — otherwise this test would
  // pass by clicking the checkbox a second time and prove nothing.
  expect(textX).toBeLessThan(labelBox!.width);
  const hitIsTheBox = await page.evaluate(
    ([x, y]) =>
      document
        .elementFromPoint(x as number, y as number)
        ?.closest("[data-pretable-hide-grouped]") !== null,
    [labelBox!.x + textX, labelBox!.y + labelBox!.height / 2],
  );
  expect(hitIsTheBox).toBe(false);

  await label.click({ position: { x: textX, y: labelBox!.height / 2 } });
  await expect(box).toHaveAttribute("aria-checked", "true");
  await expect(sectorHeader).toHaveCount(0);
});
