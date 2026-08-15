import { expect, test, type Page } from "@playwright/test";

import { waitForGridReady } from "./helpers";

/**
 * The column header as part of the grid's roving-tabindex model.
 *
 * The assertion this whole file exists for is the first one: **the grid is
 * exactly one tab stop**. Before the header joined the model, a five-column
 * grid measured ten stops in Chromium (a Sort button and a Filter funnel per
 * column) and zero in WebKit. Neither number was the contract, and a
 * twenty-column grid was forty presses to walk past.
 *
 * Why real browsers, and both of them:
 *
 * - jsdom has no sequential focus order at all. `Tab` is an ordinary keydown
 *   there and nothing moves unless a handler moves it, so every tab-stop
 *   assertion below would pass vacuously against a grid nobody can navigate.
 * - The two engines disagreed about the header in opposite directions, so only
 *   running both discriminates a fix from a coincidence.
 *
 * What is deliberately NOT asserted: a per-engine split in the header-stop
 * count. Safari keeping bare `<button>`s out of the sequential focus order is
 * a *macOS platform policy*, not a WebKit-engine one — Playwright's Linux
 * WebKit in CI does include them. An earlier spec asserted 0-in-WebKit,
 * measured 0 locally and 16 in CI, and failed there. What is asserted here is
 * what our own code controls: the count is ONE, in both engines, because the
 * `tabIndex` we write says so.
 */

const KEYBOARD_DOCS = "/docs/grid/keyboard";
const FILTERING_DOCS = "/docs/grid/filtering";
const GROUPING_DOCS = "/docs/grid/grouping";

/**
 * Presses to walk from before the grid to well past it. Generously past the
 * one stop the grid should now be, so a regression that reintroduces
 * per-column stops is COUNTED rather than truncated — an under-sized bound
 * would report the cap instead of the real number and hide how bad it got.
 */
const WALK_BOUND = 60;

/**
 * Cells of the FIRST rendered row. ArrowUp from any lower row just moves up a
 * row, so a header-entry test anchored anywhere else would pass without a
 * header transition ever happening.
 */
const FIRST_ROW_CELLS =
  '[data-pretable-scroll-viewport] [data-pretable-row][data-pretable-row-index="0"] [role=gridcell][data-pretable-column-id]';

async function mountFirstExample(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  // Demos mount lazily on "in view AND selected", so the figure has to be
  // scrolled into view before the grid exists to be waited on.
  await page
    .locator("figure")
    .first()
    .evaluate((el) => el.scrollIntoView({ block: "center" }));
  await waitForGridReady(page);
}

/**
 * Wait until the document has stopped scrolling.
 *
 * `scrollIntoView` above is SMOOTH on this site, and a click is free to nudge
 * the page again — measured, the tail of that motion kept firing `scroll` for
 * ~1.5s in Chromium after `waitForGridReady` had already resolved. That
 * matters here and nowhere else in the suite because `useHeaderPopover` closes
 * on ANY window scroll (so a popover can never float away from the rect it was
 * positioned against): a filter opened inside that window is unmounted in the
 * same breath, which reads exactly like the binding not working. It failed the
 * FIRST open on a page and passed every later one — the signature of a race,
 * not of a broken key.
 */
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
 * Park focus on a control that sits before the grid in the tab order, and mark
 * it so the walk below can tell when it has come all the way back around.
 */
async function focusBeforeGrid(page: Page) {
  const previewTab = page
    .locator("figure", {
      has: page.getByRole("tablist", { name: "Example view" }),
    })
    .first()
    .getByRole("tab", { name: "Preview" });
  await expect(previewTab).toHaveAttribute("aria-selected", "true");
  await previewTab.focus();
  await previewTab.evaluate((el) => el.setAttribute("data-walk-start", ""));
}

/** Is DOM focus currently anywhere inside the grid's scroll viewport? */
function focusIsInGrid(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const active = document.activeElement;
    // `null` and `<body>` both mean "no focus owner", which is outside the
    // grid. The obvious `active?.closest(...) !== null` spelling inverts that:
    // optional chaining yields `undefined`, and `undefined !== null` is true.
    if (active === null || active === document.body) return false;
    return active.closest("[data-pretable-scroll-viewport]") !== null;
  });
}

/**
 * Walk Tab from before the grid and count how many stops land inside it, over
 * exactly ONE pass of the document's focus order.
 *
 * Counts STOPS, not presses: a press that leaves focus outside the grid is not
 * a stop, and the walk keeps going past the grid, so a second stop after the
 * first is still counted rather than being missed by an early break.
 *
 * The one-pass bound is not a nicety. A tab walk WRAPS: past the last
 * focusable, the browser returns to the top of the document and comes round to
 * the grid again. Measured on this page, WebKit's order is short enough that
 * 30 presses lap it four times — so a naive counter reported `4` for a grid
 * that is genuinely one stop, and would have reported the lap count for any
 * grid at all. The walk therefore stops when focus returns to the element it
 * started from, or lands on `<body>` (which is how WebKit spells the wrap
 * point between the document end and the browser chrome).
 */
async function countTabStopsInsideGrid(page: Page): Promise<number> {
  await focusBeforeGrid(page);
  let stops = 0;
  for (let i = 0; i < WALK_BOUND; i += 1) {
    await page.keyboard.press("Tab");
    const wrapped = await page.evaluate(() => {
      const active = document.activeElement;
      return (
        active === null ||
        active === document.body ||
        (active as HTMLElement).hasAttribute("data-walk-start")
      );
    });
    if (wrapped) break;
    if (await focusIsInGrid(page)) stops += 1;
  }
  return stops;
}

/** What the keyboard demo's caption reports as the current focus address. */
function focusReadout(page: Page) {
  return page
    .locator("figure p", { hasText: "Focus:" })
    .first()
    .locator("code");
}

/** How many columns the demo grid draws — the number the "one stop" claim is about. */
function headerColumnCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      document.querySelectorAll(
        "[data-pretable-scroll-viewport] [data-pretable-header-cell][data-pretable-column-id]",
      ).length,
  );
}

test.describe("the grid is one tab stop", () => {
  test("a grid with N columns is exactly one tab stop, not 2N", async ({
    page,
    browserName,
  }) => {
    await mountFirstExample(page, KEYBOARD_DOCS);
    const columns = await headerColumnCount(page);
    // Guards the assertion below against a grid that rendered no header at
    // all: "one stop" would be trivially true of an empty grid.
    expect(columns).toBeGreaterThan(1);

    const stops = await countTabStopsInsideGrid(page);
    console.log(
      `[${browserName}] ${columns} columns -> ${stops} tab stop(s) inside the grid`,
    );

    // THE assertion. Before the header joined the roving model this was
    // (see the sibling test below for the same walk with the header controls
    // put back into the tab order, which is what "before" measured)
    // `columns * 2` in Chromium (Sort + Filter each) and 0 in WebKit.
    expect(stops).toBe(1);
  });

  test("the same walk counts 2N when the header controls are put back in the tab order", async ({
    page,
    browserName,
  }) => {
    // The mutation, kept in the suite rather than run once by hand.
    //
    // An assertion of `toBe(1)` is only worth something if the counter can
    // produce another number, and this walk had already lied once: a naive
    // version reported `4` in WebKit purely because the tab order laps the
    // document. Putting the header controls back at `tabIndex = 0` — which is
    // exactly what a bare `<button>` has, i.e. the state before this change —
    // must move the count to the old one.
    await mountFirstExample(page, KEYBOARD_DOCS);
    const columns = await headerColumnCount(page);

    const restored = await page.evaluate(() => {
      const viewport = document.querySelector(
        "[data-pretable-scroll-viewport]",
      )!;
      const controls = [
        ...viewport.querySelectorAll(
          "[data-pretable-header-cell], [data-pretable-filter-funnel]",
        ),
      ];
      for (const el of controls) (el as HTMLElement).tabIndex = 0;
      return controls.length;
    });
    // A Sort button and a Filter funnel per column, which is where the 2N
    // comes from.
    expect(restored).toBe(columns * 2);

    const stops = await countTabStopsInsideGrid(page);
    console.log(
      `[${browserName}] header controls restored: ${columns} columns -> ${stops} tab stop(s)`,
    );
    // 2N — a Sort button and a Filter funnel per column. Measured 16 on this
    // 8-column grid in BOTH engines, which is the same arithmetic behind the
    // spec's "10 tab stops on a five-column grid".
    //
    // Not 2N+1: the body's roving cell drops out along the way, and correctly
    // so. Focusing a header seeds the engine's cursor onto it, at which point
    // the header IS the grid's single address and the body's entry fallback
    // stands down — which is the very rule that makes the real count 1. So
    // this walk measures the header chrome alone.
    expect(stops).toBe(columns * 2);
  });

  test("the one stop is a body cell, and the header controls are not stops", async ({
    page,
  }) => {
    // `stops === 1` alone would also be satisfied by a grid whose single stop
    // was a header button and whose body was unreachable — which is the WCAG
    // 2.1.1 failure #423 fixed. This says WHICH element it is.
    await mountFirstExample(page, KEYBOARD_DOCS);
    await focusBeforeGrid(page);

    let landedOnCell = false;
    for (let i = 0; i < WALK_BOUND; i += 1) {
      await page.keyboard.press("Tab");
      if (await focusIsInGrid(page)) {
        landedOnCell = await page.evaluate(
          () => document.activeElement?.closest("[data-pretable-cell]") != null,
        );
        break;
      }
    }
    expect(landedOnCell).toBe(true);

    // And every header control really is out of the order, rather than merely
    // being skipped because the walk happened to end early.
    const tabbableHeaderControls = await page.evaluate(() => {
      const viewport = document.querySelector(
        "[data-pretable-scroll-viewport]",
      )!;
      return [
        ...viewport.querySelectorAll(
          "[data-pretable-header-cell], [data-pretable-filter-funnel], [data-pretable-column-menu-button]",
        ),
      ].filter((el) => (el as HTMLElement).tabIndex === 0).length;
    });
    expect(tabbableHeaderControls).toBe(0);
  });
});

test.describe("moving between the body and the header", () => {
  test("ArrowUp from the first row enters the header, ArrowDown returns", async ({
    page,
  }) => {
    await mountFirstExample(page, KEYBOARD_DOCS);
    // Click a cell in the FIRST row: ArrowUp from anywhere lower just moves up
    // a row, which would make this pass without any header transition at all.
    await page.locator(FIRST_ROW_CELLS).nth(1).click();
    const startAddress = await focusReadout(page).textContent();
    expect(startAddress).toMatch(/^row /);
    const column = startAddress!.split("column ")[1];

    await page.keyboard.press("ArrowUp");
    await expect(focusReadout(page)).toHaveText(`header, column ${column}`);

    // DOM focus went with the address. The address moving on its own — a ring
    // and a `tabIndex` marching while `document.activeElement` stays behind —
    // is a real failure mode this repo has shipped before.
    expect(
      await page.evaluate(() =>
        document.activeElement?.matches("[data-pretable-header-cell]"),
      ),
    ).toBe(true);
    expect(
      await page.evaluate(() =>
        document.activeElement?.getAttribute("data-pretable-column-id"),
      ),
    ).toBe(column);

    await page.keyboard.press("ArrowDown");
    await expect(focusReadout(page)).toHaveText(startAddress!);
    expect(
      await page.evaluate(
        () => document.activeElement?.closest("[data-pretable-cell]") != null,
      ),
    ).toBe(true);
  });

  test("Left/Right move between header columns", async ({ page }) => {
    await mountFirstExample(page, KEYBOARD_DOCS);
    await page.locator(FIRST_ROW_CELLS).nth(1).click();
    await page.keyboard.press("ArrowUp");
    const first = await focusReadout(page).textContent();

    await page.keyboard.press("ArrowRight");
    const right = await focusReadout(page).textContent();
    expect(right).not.toBe(first);
    // Still on the header — Right must move the COLUMN, not fall into the body.
    expect(right).toMatch(/^header, column /);

    await page.keyboard.press("ArrowLeft");
    await expect(focusReadout(page)).toHaveText(first!);
  });

  test("Tab still leaves the grid in one press from the header", async ({
    page,
  }) => {
    // The exit half of WCAG 2.1.2, from the newly reachable region. A header
    // that consumed Tab would be a new keyboard trap in the same component
    // that had one removed in #423.
    await mountFirstExample(page, KEYBOARD_DOCS);
    await page.locator(FIRST_ROW_CELLS).nth(1).click();
    await page.keyboard.press("ArrowUp");
    await expect(focusReadout(page)).toContainText("header");

    await page.keyboard.press("Tab");
    expect(await focusIsInGrid(page)).toBe(false);
  });
});

test.describe("activation from a focused header", () => {
  test("Enter on the focused header sorts, exactly once", async ({ page }) => {
    await mountFirstExample(page, KEYBOARD_DOCS);
    await page.locator(FIRST_ROW_CELLS).nth(1).click();
    await page.keyboard.press("ArrowUp");

    const header = page.locator(
      "[data-pretable-scroll-viewport] [data-pretable-header-cell][data-pretable-focused='true']",
    );
    await expect(header).toHaveAttribute("aria-sort", "none");

    await page.keyboard.press("Enter");
    // "exactly once" is the assertion, and it is not pedantry. The header cell
    // is a real <button>, so Enter fires its native activation; a key handler
    // that ALSO sorted would run `getNextSortDirection` twice per press and
    // land on "ascending" here. The cycle is none -> desc -> asc -> none, so
    // ONE press is "descending" and two presses is "ascending" — which is
    // exactly what distinguishes the two implementations.
    await expect(header).toHaveAttribute("aria-sort", "descending");

    await page.keyboard.press("Enter");
    await expect(header).toHaveAttribute("aria-sort", "ascending");

    await page.keyboard.press("Enter");
    await expect(header).toHaveAttribute("aria-sort", "none");
  });

  test("Alt+ArrowDown opens the filter popover, Escape returns to the header", async ({
    page,
  }) => {
    await mountFirstExample(page, FILTERING_DOCS);
    await page.locator(FIRST_ROW_CELLS).nth(0).click();
    await page.keyboard.press("ArrowUp");
    await waitForScrollSettled(page);

    const focusedHeader = page.locator(
      "[data-pretable-scroll-viewport] [data-pretable-header-cell][data-pretable-focused='true']",
    );
    await expect(focusedHeader).toHaveCount(1);
    const columnId = await focusedHeader.getAttribute(
      "data-pretable-column-id",
    );

    await page.keyboard.press("Alt+ArrowDown");
    await expect(
      page.locator(`[data-pretable-filter-funnel][aria-expanded="true"]`),
    ).toHaveCount(1);

    await page.keyboard.press("Escape");
    await expect(
      page.locator(`[data-pretable-filter-funnel][aria-expanded="true"]`),
    ).toHaveCount(0);

    // Escape must not strand focus on `<body>`. `useHeaderPopover` closes from
    // a document listener without restoring focus, and FilterMenu focuses its
    // own <select> on open, so without the restore effect the user ends up
    // outside the grid with no keyboard route back in.
    expect(await focusIsInGrid(page)).toBe(true);
    expect(
      await page.evaluate(
        () =>
          document.activeElement?.closest("[data-pretable-header-cell]") !=
          null,
      ),
    ).toBe(true);
    await expect(focusedHeader).toHaveAttribute(
      "data-pretable-column-id",
      columnId!,
    );
  });

  test("Alt+ArrowDown on a DATA cell still just moves down", async ({
    page,
  }) => {
    // The scoping half. `Alt` is not a modifier any documented binding uses,
    // and the header binding must not have quietly taken ArrowDown away from
    // the body.
    await mountFirstExample(page, KEYBOARD_DOCS);
    await page
      .locator("[data-pretable-scroll-viewport] [role=gridcell]")
      .nth(3)
      .click();
    const before = await focusReadout(page).textContent();

    await page.keyboard.press("Alt+ArrowDown");
    const after = await focusReadout(page).textContent();
    expect(after).not.toBe(before);
    expect(after).toMatch(/^row /);
    expect(await page.locator("[data-pretable-filter-menu]").count()).toBe(0);
  });

  test("Shift+F10 opens the column menu on a grid that has one", async ({
    page,
  }) => {
    // The column menu only exists where grouping does, so this needs the
    // grouping page rather than the keyboard one — on a grid with no menu the
    // binding correctly does nothing, which is not a passing test of anything.
    await mountFirstExample(page, GROUPING_DOCS);
    // Entered by CLICKING the header rather than by arrowing up to it. The
    // arrow route is covered above; what this needs is a header cursor on a
    // grouped grid, whose first rendered row is a group header and so has no
    // `data-pretable-row-index="0"` to anchor on.
    //
    // It also pins the other half of the seeding rule: a pointer press on a
    // header must put the ENGINE's cursor there too, or the very next key
    // would move relative to wherever the cursor was left last.
    //
    // The column is chosen by asking which ones actually HAVE a `⋮`. On a
    // grouped grid the first drawn column is the derived group column, and
    // `showColumnMenu` deliberately excludes it — so "the first header"
    // resolves to the one column where the binding is correctly a no-op, and
    // the test would fail against working code.
    const menuColumnId = await page.evaluate(() => {
      const button = document.querySelector(
        "[data-pretable-scroll-viewport] [data-pretable-column-menu-button][data-pretable-column-id]",
      );
      return button?.getAttribute("data-pretable-column-id") ?? null;
    });
    expect(menuColumnId).not.toBeNull();
    await page
      .locator(
        `[data-pretable-scroll-viewport] [data-pretable-header-cell][data-pretable-column-id="${menuColumnId}"]`,
      )
      .click();
    await waitForScrollSettled(page);
    await expect(
      page.locator(
        "[data-pretable-scroll-viewport] [data-pretable-header-cell][data-pretable-focused='true']",
      ),
    ).toHaveCount(1);

    await page.keyboard.press("Shift+F10");
    await expect(
      page.locator('[data-pretable-column-menu-button][aria-expanded="true"]'),
    ).toHaveCount(1);

    // ColumnMenu restores focus to its own anchor on Escape, and that anchor is
    // `tabIndex={-1}` now — `.focus()` still works on it, so this asserts the
    // user lands back inside the grid rather than on `<body>`.
    await page.keyboard.press("Escape");
    await expect(
      page.locator('[data-pretable-column-menu-button][aria-expanded="true"]'),
    ).toHaveCount(0);
    expect(await focusIsInGrid(page)).toBe(true);
  });
});
