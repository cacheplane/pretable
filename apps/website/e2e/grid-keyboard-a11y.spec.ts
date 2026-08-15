import { expect, test, type Page } from "@playwright/test";

import { waitForGridReady } from "./helpers";

/**
 * The grid's WCAG Level A keyboard contract, driven with real Tab presses in
 * real engines.
 *
 * None of this is testable in jsdom. jsdom has no sequential focus order at
 * all — `Tab` is an ordinary keydown there, and nothing moves unless a handler
 * moves it — so every assertion below would pass vacuously against a grid that
 * no keyboard user can enter or leave. WebKit matters separately: Safari keeps
 * bare `<button>`s out of the tab order unless Full Keyboard Access is on, so
 * the two engines disagree about which parts of this component are reachable
 * and only running both discriminates.
 *
 * What was measured here BEFORE the fixes these tests pin (Chromium and WebKit
 * alike, on the pages used below):
 *
 * - **Entry.** `tabindexZeroCount: 0` against `gridcellCount: 96` at cold
 *   start. The engine starts at `focus: {ref: null, columnId: null}`, the
 *   roving tabindex only ever gave the 0 to the focused cell, and the viewport
 *   is `tabIndex={-1}` — so every cell resolved to -1 and there was no
 *   keyboard route into the body at all. Tabbing in from before the grid
 *   walked the 16 header buttons and out the far side in Chromium, and skipped
 *   the grid entirely in WebKit. (WCAG 2.1.1)
 * - **Exit.** With the old `tabBehavior="wrap-rows"` default, 120 consecutive
 *   Tab presses from a focused cell never left the grid, in either engine.
 *   Shift+Tab wrapped up and clamped on the top-left cell; Escape did not
 *   release either. A trap strands the user on the whole page. (WCAG 2.1.2)
 * - **Divergence.** With a row-select column, clicking a checkbox left
 *   `document.activeElement` pinned to that `<button role="checkbox">` in
 *   Chromium while the roving `tabIndex={0}` marched r1 → r2 → r3 under three
 *   ArrowDowns — the visible ring and the real focus came apart.
 */

const KEYBOARD_DOCS = "/docs/grid/keyboard";
const SELECTION_DOCS = "/docs/grid/selection";

/**
 * Generous, and deliberately not tight. The grid's own header renders a Sort
 * and a Filter button per column (16 of them on the keyboard demo), and those
 * sit between the page content and the first body cell in Chromium's tab
 * order. What these tests assert is that the walk TERMINATES somewhere sane,
 * not the exact number of stops — that number is a header-chrome detail, and
 * pinning it here would make every header change a failure in an a11y spec.
 */
const WALK_BOUND = 25;

/**
 * How many presses may be needed to get OUT of the grid body. This one is
 * tight on purpose: it is the whole point of the exit fix. One press is what
 * both engines actually do; the slack is for a future in-cell focusable.
 */
const EXIT_BOUND = 2;

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

/** Is DOM focus currently inside the grid's scroll viewport? */
function focusIsInGrid(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const active = document.activeElement;
    // `null` and `<body>` both mean "no focus owner", which is emphatically
    // outside the grid. Writing this as `active?.closest(...) !== null` — the
    // obvious spelling — inverts that: optional chaining yields `undefined`,
    // and `undefined !== null` is true, so a walk that parked focus on `<body>`
    // would report itself as still trapped inside the grid forever.
    if (active === null || active === document.body) return false;
    return active.closest("[data-pretable-scroll-viewport]") !== null;
  });
}

/** Is DOM focus currently on a body cell (not a header control)? */
function focusIsOnCell(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.activeElement?.closest("[data-pretable-cell]") != null,
  );
}

/** The engine's focus address, as the DOM publishes it. */
function focusedCellAddress(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const cell = document.querySelector(
      '[data-pretable-cell][data-pretable-focused="true"]',
    );
    if (cell === null) return null;
    const rowId = cell
      .closest("[data-pretable-row]")
      ?.getAttribute("data-pretable-row-id");
    return `${rowId},${cell.getAttribute("data-pretable-column-id")}`;
  });
}

/**
 * {@link focusedCellAddress}, but waited on until it holds still.
 *
 * A jump key (`Cmd+End`, `Cmd+Home`, PageDown) routinely targets a row that is
 * outside the virtualization window, so there is a beat — scroll, then the new
 * render — before any cell in the DOM carries `data-pretable-focused="true"`
 * for the new address. Reading once straight after the press caught that beat
 * about 1 run in 6 in WebKit and reported the OLD address, which looks exactly
 * like the jump having silently done nothing. Two identical non-null reads in a
 * row is the cheap way to know the commit has landed.
 */
async function settledFocusAddress(page: Page): Promise<string | null> {
  let last: string | null = null;
  await expect
    .poll(
      async () => {
        const now = await focusedCellAddress(page);
        const stable = now !== null && now === last;
        last = now;
        return stable;
      },
      { timeout: 5_000 },
    )
    .toBe(true);
  return last;
}

/** The address of the single cell holding the roving `tabIndex={0}`. */
function tabStopAddress(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const viewport = document.querySelector("[data-pretable-scroll-viewport]")!;
    const stop = [...viewport.querySelectorAll("[role=gridcell]")].find(
      (cell) => (cell as HTMLElement).tabIndex === 0,
    );
    if (stop === undefined) return null;
    const rowId = stop
      .closest("[data-pretable-row]")
      ?.getAttribute("data-pretable-row-id");
    return `${rowId},${stop.getAttribute("data-pretable-column-id")}`;
  });
}

/** Park focus on a control that sits before the grid in the tab order. */
async function focusBeforeGrid(page: Page) {
  const previewTab = page
    .locator("figure", {
      has: page.getByRole("tablist", { name: "Example view" }),
    })
    .first()
    .getByRole("tab", { name: "Preview" });
  await expect(previewTab).toHaveAttribute("aria-selected", "true");
  await previewTab.focus();
}

/**
 * Press `key` until `done()` reports true, returning the press count — or
 * `null` if `limit` presses were not enough.
 */
async function pressUntil(
  page: Page,
  key: string,
  limit: number,
  done: () => Promise<boolean>,
): Promise<number | null> {
  for (let i = 1; i <= limit; i++) {
    await page.keyboard.press(key);
    if (await done()) return i;
  }
  return null;
}

test.describe("entry — WCAG 2.1.1 Keyboard", () => {
  test("an untouched grid has exactly one tabbable cell", async ({ page }) => {
    await mountFirstExample(page, KEYBOARD_DOCS);

    const counts = await page.evaluate(() => {
      const cells = [
        ...document
          .querySelector("[data-pretable-scroll-viewport]")!
          .querySelectorAll("[role=gridcell]"),
      ];
      return {
        total: cells.length,
        tabbable: cells.filter((c) => (c as HTMLElement).tabIndex === 0).length,
      };
    });

    // The count is the assertion. `> 0` would pass for a grid that made every
    // cell tabbable, which is the opposite failure and just as wrong: the
    // roving-tabindex pattern is "exactly one", and 96 tab stops in one grid
    // is its own 2.1.2-adjacent misery.
    expect(counts.total).toBeGreaterThan(10);
    expect(counts.tabbable).toBe(1);

    // Tabbable, but NOT focused: the engine's focus address is still null and
    // must stay that way until the user actually arrives. Seeding it on mount
    // would fire `onFocusChange` and run scroll-into-view on page load.
    expect(await focusedCellAddress(page)).toBeNull();
  });

  test("Tab from before the grid reaches a data cell", async ({ page }) => {
    await mountFirstExample(page, KEYBOARD_DOCS);
    await focusBeforeGrid(page);

    const reachedAt = await pressUntil(page, "Tab", WALK_BOUND, () =>
      focusIsOnCell(page),
    );
    expect(reachedAt).not.toBeNull();

    // Arriving is what seeds the engine, so the ring and the address exist
    // from the first press rather than from the first arrow key.
    expect(await focusedCellAddress(page)).not.toBeNull();
    expect(await tabStopAddress(page)).toBe(await focusedCellAddress(page));
  });

  test("the header is not part of the body's single tab stop", async ({
    page,
    browserName,
  }) => {
    // Pins the engine split that content/docs/grid/keyboard.mdx now states, and
    // states BECAUSE it is measurable: the header's per-column Sort and Filter
    // buttons are real tab stops in Chromium and are skipped outright in
    // WebKit, which keeps bare `<button>`s out of the sequential focus order
    // unless Full Keyboard Access is on. The direction of the split is the
    // assertion; the exact count is header chrome and deliberately not pinned.
    await mountFirstExample(page, KEYBOARD_DOCS);
    await focusBeforeGrid(page);

    let headerStops = 0;
    let reachedCell = false;
    for (let i = 1; i <= WALK_BOUND; i++) {
      await page.keyboard.press("Tab");
      if (await focusIsOnCell(page)) {
        reachedCell = true;
        break;
      }
      if (await focusIsInGrid(page)) headerStops += 1;
    }

    // Without this, `headerStops === 0` in WebKit would also be satisfied by a
    // walk that never entered the grid at all — which is precisely the broken
    // state this whole file exists to rule out.
    expect(reachedCell).toBe(true);

    // The header-stop COUNT is deliberately not asserted.
    //
    // An earlier version asserted 0 in WebKit and >0 in Chromium, on the basis
    // that Safari keeps native `<button>`s out of the sequential tab order.
    // That is a *macOS* platform policy, not a WebKit-engine one: Playwright's
    // Linux WebKit in CI does include them, so the test measured 0 locally and
    // 16 in CI and failed there — pinning someone's operating system rather
    // than our code.
    //
    // What this file is entitled to assert is what our code controls: the body
    // is reachable (above) and escapable (elsewhere). The header's own stop
    // count only becomes our contract once the header joins the roving model —
    // see docs/superpowers/specs/2026-08-14-grid-header-touch-and-keyboard-design.md.
    // Until then it is recorded, not asserted.
    console.log(`header tab stops (${browserName}): ${headerStops}`);
  });

  test("arrows move focus once Tab has entered", async ({ page }) => {
    await mountFirstExample(page, KEYBOARD_DOCS);
    await focusBeforeGrid(page);
    await pressUntil(page, "Tab", WALK_BOUND, () => focusIsOnCell(page));

    const entry = await focusedCellAddress(page);
    await page.keyboard.press("ArrowDown");
    const down = await focusedCellAddress(page);
    await page.keyboard.press("ArrowRight");
    const right = await focusedCellAddress(page);

    expect(down).not.toBe(entry);
    expect(right).not.toBe(down);
    // DOM focus went with it — the address moving on its own is exactly the
    // divergence bug this file also covers.
    expect(await tabStopAddress(page)).toBe(right);
    expect(await focusIsOnCell(page)).toBe(true);
  });
});

test.describe("exit — WCAG 2.1.2 No Keyboard Trap", () => {
  test("Tab leaves the grid from a focused cell", async ({ page }) => {
    await mountFirstExample(page, KEYBOARD_DOCS);
    await page
      .locator("[data-pretable-scroll-viewport] [role=gridcell]")
      .nth(3)
      .click();
    expect(await focusIsInGrid(page)).toBe(true);

    const escapedAt = await pressUntil(page, "Tab", EXIT_BOUND, async () =>
      (await focusIsInGrid(page)) ? false : true,
    );
    expect(escapedAt).not.toBeNull();
  });

  test("Shift+Tab leaves the grid backward", async ({ page }) => {
    await mountFirstExample(page, KEYBOARD_DOCS);
    // Focus is established by KEYBOARD here, not by a click, and that is not
    // incidental tidiness — it is the only way this measures WebKit.
    //
    // Safari does not treat a mouse-or-programmatic focus as the sequential
    // navigation starting point, so Shift+Tab from a CLICKED cell does not move
    // at all there: measured `CELL(T-1000,symbol)` before and after the press,
    // and still stuck after 120 of them. From the very same cell reached by
    // Tab, one Shift+Tab leaves the grid outright. Chromium leaves either way
    // (into the header chrome). Since the trap this test exists for is a
    // keyboard-only user's trap, keyboard entry is also the honest scenario —
    // but the WebKit quirk is real and worth knowing about before reading a
    // click-based version of this test as a pass.
    await focusBeforeGrid(page);
    const enteredAt = await pressUntil(page, "Tab", WALK_BOUND, () =>
      focusIsOnCell(page),
    );
    expect(enteredAt).not.toBeNull();

    // Bounded by the header chrome rather than by EXIT_BOUND: Shift+Tab out of
    // the body walks back through the per-column Sort/Filter buttons in
    // Chromium. WebKit skips those and leaves on the first press.
    const escapedAt = await pressUntil(
      page,
      "Shift+Tab",
      WALK_BOUND,
      async () => ((await focusIsInGrid(page)) ? false : true),
    );
    expect(escapedAt).not.toBeNull();
  });

  test("Tab leaves a grid that has a row-select column", async ({ page }) => {
    // The same EXIT_BOUND, on a grid whose every rendered row carries a
    // `<button role="checkbox">` inside its first cell. Left in the sequential
    // tab order those buttons stood between the focused cell and the way out —
    // one per rendered row, a count that moves with the virtualization window —
    // so this is what pins them at `tabIndex={-1}`.
    await mountFirstExample(page, SELECTION_DOCS);
    await expect(
      page
        .locator("[data-pretable-scroll-viewport] [data-pretable-row-select]")
        .first(),
    ).toBeVisible();
    await page
      .locator("[data-pretable-scroll-viewport] [role=gridcell]")
      .nth(3)
      .click();
    expect(await focusIsInGrid(page)).toBe(true);

    const escapedAt = await pressUntil(page, "Tab", EXIT_BOUND, async () =>
      (await focusIsInGrid(page)) ? false : true,
    );
    expect(escapedAt).not.toBeNull();
  });

  test("Shift+Tab back into the grid restores the focused cell", async ({
    page,
  }) => {
    await mountFirstExample(page, KEYBOARD_DOCS);
    const cell = page
      .locator("[data-pretable-scroll-viewport] [role=gridcell]")
      .nth(3);
    await cell.click();
    const before = await focusedCellAddress(page);
    expect(before).not.toBeNull();

    await page.keyboard.press("Tab");
    expect(await focusIsInGrid(page)).toBe(false);
    await page.keyboard.press("Shift+Tab");

    expect(await focusIsOnCell(page)).toBe(true);
    expect(await focusedCellAddress(page)).toBe(before);
  });
});

test.describe("focus follows the engine for a control inside a cell", () => {
  test("arrowing away from a clicked row-select checkbox moves real focus", async ({
    page,
  }) => {
    await mountFirstExample(page, SELECTION_DOCS);
    await page
      .locator("[data-pretable-scroll-viewport] [data-pretable-row-select]")
      .first()
      .click();

    const trace: { active: string | null; ring: string | null }[] = [];
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("ArrowDown");
      trace.push({
        active: await page.evaluate(() => {
          const cell = document.activeElement?.closest("[data-pretable-cell]");
          if (cell == null) return null;
          const rowId = cell
            .closest("[data-pretable-row]")
            ?.getAttribute("data-pretable-row-id");
          return `${rowId},${cell.getAttribute("data-pretable-column-id")}`;
        }),
        ring: await tabStopAddress(page),
      });
    }

    // Both halves matter. Asserting only that the ring moved is what let this
    // ship: the ring moved perfectly the whole time, on the wrong element.
    for (const step of trace) {
      expect(step.active).not.toBeNull();
      expect(step.active).toBe(step.ring);
    }
    // And it genuinely walked rows rather than sitting still in lockstep.
    expect(new Set(trace.map((s) => s.ring)).size).toBe(3);
  });

  test("Space toggles the focused row's checkbox", async ({ page }) => {
    await mountFirstExample(page, SELECTION_DOCS);

    // Asserted on the demo's `onRowSelectionChange` caption, NOT on the
    // checkbox's `aria-checked`. The two slices are different things and
    // aria-checked cannot tell them apart: it renders "true" for a row that is
    // fully covered by a CELL RANGE as well as for a ticked row, and "mixed"
    // for a partially covered one. A version of this test that clicked a cell
    // and then read aria-checked went "mixed" → "true" on Space with the
    // toggle deleted, because `replaceSelectionWithFullRow` alone moved it.
    // The caption is fed by `onRowSelectionChange` and nothing else, so only
    // the checkbox slice can move it.
    const ticked = page
      .locator("figure p", { hasText: "Ticked rows" })
      .first()
      // `.last()`: the paragraph reads `Ticked rows (<code>onRowSelectionChange
      // </code>): <code>…</code>` — the value is the second one.
      .locator("code")
      .last();
    await expect(ticked).toHaveText("(none)");

    await page
      .locator(
        "[data-pretable-scroll-viewport] [role=gridcell]:not([data-pretable-row-select-cell])",
      )
      .first()
      .click();
    // A cell click builds a range; it must NOT tick anything.
    await expect(ticked).toHaveText("(none)");

    // The checkbox is `tabIndex={-1}` (a control inside a cell, per the roving
    // pattern) and the arrow keys snap off the synthetic row-select column, so
    // Space on the focused row is the ONLY keyboard route to this slice. In
    // WebKit it is the only route at all — a bare <button> is not in Safari's
    // tab order, so the checkbox was never keyboard-reachable there.
    await page.keyboard.press(" ");
    await expect(ticked).not.toHaveText("(none)");
  });
});

test.describe("the rest of the keyboard contract still works", () => {
  test("Home/End, Cmd+Home/End and editing entry survive the focus changes", async ({
    page,
  }) => {
    await mountFirstExample(page, KEYBOARD_DOCS);
    await page
      .locator("[data-pretable-scroll-viewport] [role=gridcell]")
      .nth(3)
      .click();
    const mod = process.platform === "darwin" ? "Meta" : "Control";

    await page.keyboard.press("End");
    const atRowEnd = await settledFocusAddress(page);
    await page.keyboard.press("Home");
    const atRowStart = await settledFocusAddress(page);
    expect(atRowEnd).not.toBe(atRowStart);
    // Same row, different column — End/Home move within the row.
    expect(atRowEnd?.split(",")[0]).toBe(atRowStart?.split(",")[0]);

    await page.keyboard.press(`${mod}+End`);
    const atGridEnd = await settledFocusAddress(page);
    expect(atGridEnd).not.toBe(atRowEnd);
    expect(atGridEnd?.split(",")[0]).not.toBe(atRowStart?.split(",")[0]);

    await page.keyboard.press(`${mod}+Home`);
    await expect.poll(() => focusedCellAddress(page)).toBe(atRowStart);

    // Cmd+A still selects, and Escape still collapses — both run through the
    // same keydown path the Tab change touched.
    await page.keyboard.press(`${mod}+a`);
    expect(
      await page.locator('[data-pretable-cell][aria-selected="true"]').count(),
    ).toBeGreaterThan(1);
    await page.keyboard.press("Escape");
  });

  test("F2 opens an editor on an editable grid", async ({ page }) => {
    await mountFirstExample(page, "/docs/grid/editing");
    await page
      .locator(
        "[data-pretable-scroll-viewport] [role=gridcell][data-pretable-column-id]",
      )
      .nth(1)
      .click();
    await page.keyboard.press("F2");
    await expect(
      page.locator("[data-pretable-edit-status]").first(),
    ).toBeVisible({ timeout: 5_000 });
  });
});
