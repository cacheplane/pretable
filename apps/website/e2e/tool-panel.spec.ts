import { expect, test, type Locator, type Page } from "@playwright/test";

import { waitForGridReady, waitForStablePosition } from "./helpers";

/**
 * The tool panel, driven with a real pointer and a real keyboard — the
 * halves jsdom cannot express. Five blocks, each with its own target page:
 * the COLUMNS section (this opening block, on the keyboard-navigation
 * example), the FILTERS section (SP2b, on /docs/grid/tool-panel), the
 * GROUPING section (SP3b, on /fixtures/grouping plus the keyboard example),
 * a consumer-supplied CUSTOM section (SP4, on
 * /fixtures/tool-panel-sections), and PANE RESIZING + AUTO WIDTH (SP5, on
 * the keyboard example and the filters example). The later blocks open with banner
 * comments naming their targets and why; what every block proves is the
 * same kind of thing — the measured DOM the handlers feed, the engine
 * commits, and the panel's tab order all behave on a live page, while the
 * underlying math stays unit-tested (`tool-panel-drop-target.test.ts` for
 * the insertion index here).
 *
 * The columns block's target: the keyboard-navigation example on
 * /docs/grid/keyboard. Its grid ships the tool panel default-on with an
 * UNCONTROLLED column layout (the column-layout example controls
 * `columnOrder`/`columnPinned`, which would re-impose the prop state over
 * the panel's engine writes), and it declares ID pinned left + Status
 * pinned right — so both pinned subgroups render, which is what makes
 * cross-boundary drops reachable.
 *
 * Column roster: id (left) | time account symbol side quantity price | status
 * (right).
 */

/**
 * Every in-page jump on the docs site is SMOOTH-scrolled (globals.css), and
 * two of them fire around this spec's setup: the scrollIntoView that mounts
 * the lazy example, and an intermittent focus-reveal scroll right after the
 * rail tab is clicked. Coordinates measured mid-animation are stale by the
 * time the mouse presses, which is exactly where a 14px drag handle punishes
 * it. The site gates smooth scrolling on prefers-reduced-motion (a supported
 * user mode, not a test hook), so the spec declares it and every scroll
 * lands in one frame.
 */
test.use({ contextOptions: { reducedMotion: "reduce" } });

const KEYBOARD_DOCS = "/docs/grid/keyboard";

async function mountExample(page: Page) {
  await page.goto(KEYBOARD_DOCS, { waitUntil: "domcontentloaded" });
  // Demos mount lazily on "in view AND selected", so the figure has to be
  // scrolled into view before the grid exists to be waited on.
  await page
    .locator("figure")
    .first()
    .evaluate((el) => el.scrollIntoView({ block: "center" }));
  await waitForGridReady(page);
  // The demo replacing its placeholder reflows the figure after the grid is
  // already "ready", so hold for the layout to stop moving before anything
  // below measures a coordinate or presses a small control.
  await waitForStablePosition(railTab(page));
}

function railTab(page: Page): Locator {
  return page.locator(
    '[data-pretable-tool-tab][data-pretable-section="columns"]',
  );
}

async function openColumnsPane(page: Page): Promise<void> {
  const pane = page.locator("[data-pretable-tool-pane]");
  // Retry the click, bounded: on a page still settling, a press can land
  // beside the 28px tab (the same dropped-press family the helpers document).
  // Toggle-safe: the pane mounts synchronously with the activation, so "no
  // pane after the wait" means the click never landed — a re-click cannot be
  // closing a pane that was actually opened.
  for (let attempt = 0; attempt < 3; attempt++) {
    await railTab(page).click();
    try {
      await expect(pane).toBeVisible({ timeout: 1_500 });
      return;
    } catch {
      // fall through to re-click
    }
  }
  await expect(pane).toBeVisible();
}

function panelRow(page: Page, columnId: string): Locator {
  return page.locator(
    `[data-pretable-tool-column-row][data-pretable-column-id="${columnId}"]`,
  );
}

function grip(page: Page, columnId: string): Locator {
  return panelRow(page, columnId).locator("[data-pretable-tool-row-grip]");
}

/** Drawn header order, by id — only the columns actually rendered. */
function headerIds(page: Page): Promise<(string | null)[]> {
  return page
    .locator("[data-pretable-header-cell]")
    .evaluateAll((cells) =>
      cells.map((cell) => cell.getAttribute("data-pretable-column-id")),
    );
}

/** Whether DOM focus is inside the tool-panel card (pane or rail included). */
function focusInPanel(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const active = document.activeElement;
    const panel = document.querySelector("[data-pretable-tool-pane]");
    const rail = document.querySelector("[data-pretable-tool-rail]");
    return Boolean(
      (panel && active && panel.contains(active)) ||
      (rail && active && rail.contains(active)),
    );
  });
}

/**
 * Whether `walk` is a subsequence of `full` — the tab walks' shared order
 * check. It pins tree order without demanding every stop: a stop the
 * browser never offered (a plain button, per the filters walk's WebKit
 * note) is simply skipped over in `full`, while a stray stop, a repeat off
 * one slot, or an out-of-order pair all break the match.
 */
function isSubsequenceOf(
  full: readonly string[],
  walk: readonly string[],
): boolean {
  let at = 0;
  for (const stop of walk) {
    at = full.indexOf(stop, at);
    if (at === -1) return false;
    at += 1;
  }
  return true;
}

/**
 * Park focus before the grid and Tab forward until the rail is reached —
 * the opening move the keyboard walks (columns, grouping, custom section)
 * share.
 *
 * Focus starts BEFORE the grid — on the example figure's own Preview tab by
 * default, or on `start` where the page provides its own parking spot (the
 * sections fixture) — so the walk must REACH the rail: through the grid,
 * which is its own bounded set of stops, and reach it as ONE stop: the
 * roving-tabindex assertion at the end holds however many sections the rail
 * grows.
 */
async function reachRail(page: Page, start?: Locator): Promise<void> {
  const parkingSpot =
    start ??
    page.locator("figure").first().getByRole("tab", { name: "Preview" });
  await parkingSpot.focus();

  let reachedRail = false;
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    if (
      await page.evaluate(
        () =>
          document.activeElement?.hasAttribute("data-pretable-tool-tab") ??
          false,
      )
    ) {
      reachedRail = true;
      break;
    }
  }
  expect(reachedRail).toBe(true);

  // Roving tabindex: however many sections the rail grows, it is one stop.
  await expect(
    page.locator('[data-pretable-tool-tab][tabindex="0"]'),
  ).toHaveCount(1);
}

/**
 * Press the grip and cross the drag threshold, VERIFIED: the dragging
 * attribute is the component's own statement that the gesture armed. Under
 * load the page can still drift a couple of px between measuring and
 * pressing (waitForStablePosition is best-effort by design), which lands
 * the press beside the ~16px handle — so a missed acquire is released and
 * retried against fresh geometry rather than failing the whole test on a
 * press that never landed.
 */
async function beginGripDrag(
  page: Page,
  columnId: string,
): Promise<{ x: number; y: number }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const box = await grip(page, columnId).boundingBox();
    if (!box) continue;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    // Cross the 5px slop in two moves — a single jump can be coalesced into
    // one event that both crosses the threshold and lands.
    await page.mouse.move(x, y + 6, { steps: 2 });
    await page.mouse.move(x, y + 10, { steps: 2 });
    try {
      await expect(panelRow(page, columnId)).toHaveAttribute(
        "data-pretable-tool-row-dragging",
        "",
        { timeout: 1_000 },
      );
      return { x, y };
    } catch {
      await page.mouse.up(); // missed the handle: release and re-acquire
    }
  }
  throw new Error(`could not arm a drag on the ${columnId} grip`);
}

test("drag a row two positions down reorders the drawn header", async ({
  page,
}) => {
  await mountExample(page);
  await openColumnsPane(page);

  // The docs page keeps settling for a beat after the grid hydrates (lazy
  // content above the figure), and a scroll between measuring these boxes
  // and dragging puts the drop a page-shift away from the aim point —
  // measured, not hypothetical: idRect drifted ~170px in one probed run.
  await waitForStablePosition(panelRow(page, "id"));

  // Time sits first in the unpinned subgroup: time, account, symbol, ...
  // The travel target is measured AFTER the gesture is armed — the arming
  // loop is what proves the page has actually stopped moving.
  const start = await beginGripDrag(page, "time");
  const sideBox = (await panelRow(page, "side").boundingBox())!;
  // Just under "side"'s top edge: past symbol's midpoint, before side's —
  // the slot after symbol, two positions down from where time started.
  await page.mouse.move(start.x, sideBox.y + 4, { steps: 8 });

  // Mid-drag: the row is marked, the indicator is drawn, and NOTHING has
  // committed yet (commit on drop, never mid-move).
  await expect(panelRow(page, "time")).toHaveAttribute(
    "data-pretable-tool-row-dragging",
    "",
  );
  await expect(
    page.locator("[data-pretable-tool-drop-indicator]"),
  ).toBeVisible();
  const before = await headerIds(page);
  expect(before.indexOf("time")).toBeLessThan(before.indexOf("account"));

  await page.mouse.up();

  const after = await headerIds(page);
  expect(after.indexOf("account")).toBeLessThan(after.indexOf("time"));
  expect(after.indexOf("symbol")).toBeLessThan(after.indexOf("time"));
  expect(after.indexOf("time")).toBeLessThan(after.indexOf("side"));
  // The panel list mirrors the commit.
  await expect(
    page.locator("[data-pretable-tool-column-row]").nth(3),
  ).toHaveAttribute("data-pretable-column-id", "time");
});

test("drag across the Pinned-left boundary pins the column", async ({
  page,
}) => {
  await mountExample(page);
  await openColumnsPane(page);

  // Same settling wait as the reorder drag above — an unsettled page turns
  // the aim point into a different row's territory.
  await waitForStablePosition(panelRow(page, "id"));

  const start = await beginGripDrag(page, "account");
  const idBox = (await panelRow(page, "id").boundingBox())!;
  // The lower third of the ID row: past its midpoint (so the slot is "after
  // ID") but above the subgroup gap's split — the Pinned-left side of the
  // boundary.
  await page.mouse.move(start.x, idBox.y + idBox.height - 4, { steps: 8 });
  await page.mouse.up();

  // The drawn header shows the pin — the engine regrouped the column into
  // the left-pinned strip, right after ID.
  const accountHeader = page.locator(
    '[data-pretable-header-cell][data-pretable-column-id="account"]',
  );
  await expect(accountHeader).toHaveAttribute("data-pretable-pinned", "left");
  const ids = await headerIds(page);
  expect(ids.indexOf("account")).toBe(ids.indexOf("id") + 1);
  // And the panel row moved into the Pinned left subgroup: it now renders
  // before the first unpinned row.
  const rowIds = await page
    .locator("[data-pretable-tool-column-row]")
    .evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-pretable-column-id")),
    );
  expect(rowIds.slice(0, 2)).toEqual(["id", "account"]);
});

test("keyboard: Shift+ArrowDown on a focused grip moves the row", async ({
  page,
}) => {
  await mountExample(page);
  await openColumnsPane(page);

  await grip(page, "time").focus();

  // Precondition, same as the drag test above: time starts BEFORE account,
  // so the swap below is a real move — roster drift cannot make the
  // post-press assertion pass vacuously.
  const before = await headerIds(page);
  expect(before.indexOf("time")).toBeLessThan(before.indexOf("account"));

  await page.keyboard.press("Shift+ArrowDown");

  const ids = await headerIds(page);
  expect(ids.indexOf("account")).toBeLessThan(ids.indexOf("time"));
  // Focus followed the row — the chord can be pressed again without
  // re-acquiring the grip.
  await expect(grip(page, "time")).toBeFocused();
});

test("keyboard walk: one rail stop, Enter opens, the pane is traversable, forward-Tab exits, Escape returns", async ({
  page,
}) => {
  await mountExample(page);
  await reachRail(page);

  // Arrows move between the rail's tabs without leaving the rail. Two
  // sections ship now, so this is a real move rather than a wrap onto the
  // same tab — which is what makes the one-stop assertion above mean
  // something: the second tab is reachable, and never by Tab.
  const focusedSection = () =>
    page.evaluate(
      () =>
        document.activeElement?.getAttribute("data-pretable-section") ?? null,
    );
  expect(await focusedSection()).toBe("columns");
  await page.keyboard.press("ArrowDown");
  expect(await focusedSection()).toBe("filters");
  await page.keyboard.press("ArrowUp");
  expect(await focusedSection()).toBe("columns");

  // Enter opens the FOCUSED section — Columns, whose search box and grips the
  // rest of this walk reaches for.
  await page.keyboard.press("Enter");
  await expect(railTab(page)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("[data-pretable-tool-pane]")).toBeVisible();

  // Tab order runs [grid][pane][rail][out] — the pane PRECEDES the rail in
  // the DOM (visual order, pane left of rail), so from the rail tab one
  // backward Tab enters the pane at its last control...
  await page.keyboard.press("Shift+Tab");
  expect(
    await page.evaluate(() =>
      Boolean(
        document
          .querySelector("[data-pretable-tool-pane]")
          ?.contains(document.activeElement),
      ),
    ),
  ).toBe(true);

  // ...and from that last control, forward-Tab EXITS the panel — through the
  // rail tab, out the far side, no trap. Two presses, bounded and exact.
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() =>
      document.activeElement?.hasAttribute("data-pretable-tool-tab"),
    ),
  ).toBe(true);
  await page.keyboard.press("Tab");
  expect(await focusInPanel(page)).toBe(false);

  // Escape from inside the pane hands focus back to the rail tab.
  await page.locator("[data-pretable-tool-search]").click();
  await page.keyboard.press("Escape");
  await expect(railTab(page)).toBeFocused();
});

test("narrow viewport: the grid area shrinks and the rail stays inside the card", async ({
  page,
}) => {
  // The `minWidth: 0` pin owed from Task 6: a flex item's automatic minimum
  // is its content's min-content size, and the viewport's content carries
  // `minWidth: totalWidth` (780px of columns here) — without the override
  // the grid area cannot shrink and shoves the rail out of the card.
  await page.setViewportSize({ width: 520, height: 900 });
  await mountExample(page);

  const layoutBox = (await page
    .locator("[data-pretable-tool-layout]")
    .boundingBox())!;
  const railBox = (await page
    .locator("[data-pretable-tool-rail]")
    .boundingBox())!;

  // The rail's right edge sits inside the card...
  expect(railBox.x + railBox.width).toBeLessThanOrEqual(
    layoutBox.x + layoutBox.width + 1,
  );
  // ...and the card itself fits the viewport: the grid area shrank rather
  // than pushing the rail out.
  expect(layoutBox.x + layoutBox.width).toBeLessThanOrEqual(521);
  expect(railBox.x + railBox.width).toBeLessThanOrEqual(521);
});

/* -------------------------------------------------------------------------
 * The filters section (SP2b).
 *
 * Target: the `tool-panel-filters` example on /docs/grid/tool-panel, whose
 * grid ships `defaultActiveSection: "filters"` over an UNCONTROLLED query.
 * That is NOT the columns example's reason: a controlled `columnOrder` is
 * re-imposed on every write-back pass, whereas a controlled `query` is
 * re-applied only when the query prop's own identity changes (or the columns
 * prop does), so a consumer round-tripping through `onQueryChange` would not
 * fight the panel. It is left uncontrolled because owning it here would put a
 * third writer in a loop the funnel and the panel already share, for no gain.
 *
 * The row count is read from the example's own telemetry readout
 * (`rowModelRowCount`, the post-filter count) rather than from
 * `[data-pretable-row]` elements: the body is virtualized, so a DOM count
 * measures the viewport, not the filter. The specific rows are still checked
 * in the DOM, so the readout cannot pass while the grid shows something else.
 *
 * Column roster: symbol | desk | sector | quantity | price | marketValue,
 * over 12 holdings. `symbol` is first, so a fresh `+ filter` row lands on it
 * with `contains` — and exactly four symbols contain an "s" (MSFT, GS, USO,
 * SMH).
 * ---------------------------------------------------------------------- */

const TOOL_PANEL_DOCS = "/docs/grid/tool-panel";

/**
 * The filters example's figure, found by the title its shell renders.
 *
 * NOT `figure` by index: rehype-pretty-code renames every fenced code block's
 * `<pre>` to a `<figure>`, so this page's figures are [columns example,
 * two tsx fences, filters example] and an nth-based locator moves whenever
 * anyone adds a fence.
 */
function filtersFigure(page: Page): Locator {
  return page.locator("figure").filter({ hasText: "The filters section" });
}

async function mountFiltersExample(page: Page): Promise<void> {
  await page.goto(TOOL_PANEL_DOCS, { waitUntil: "domcontentloaded" });
  const figure = filtersFigure(page);
  await figure.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const viewport = figure.locator("[data-pretable-scroll-viewport]").first();
  await expect(viewport).toBeVisible({ timeout: 20_000 });
  // The demo is painted before it is live — see `waitForGridReady`'s note on
  // why this attribute, and not visibility, is the signal.
  await expect(viewport).toHaveAttribute("data-pretable-hydrated", "true", {
    timeout: 20_000,
  });
  await waitForStablePosition(filtersRailTab(page));
}

function filtersRailTab(page: Page): Locator {
  return filtersFigure(page).locator(
    '[data-pretable-tool-tab][data-pretable-section="filters"]',
  );
}

function columnsRailTab(page: Page): Locator {
  return filtersFigure(page).locator(
    '[data-pretable-tool-tab][data-pretable-section="columns"]',
  );
}

/** The post-filter row count the example prints from `onTelemetryChange`. */
function shownRowCount(page: Page): Locator {
  return filtersFigure(page).getByTestId("filtered-row-count");
}

/**
 * The root run's add pair. Every run renders its own pair AFTER its children,
 * so the root's is always the last of each in the DOM — which stays true as
 * groups nest, where an index into all of them would not.
 */
function addFilterButton(page: Page): Locator {
  return filtersFigure(page)
    .getByRole("button", { name: "+ filter", exact: true })
    .last();
}

function addGroupButton(page: Page): Locator {
  return filtersFigure(page)
    .getByRole("button", { name: "+ group", exact: true })
    .last();
}

/**
 * Whether DOM focus is inside THIS example's tool panel — scoped to the
 * figure, because the page carries a second grid (the columns example) whose
 * pane a document-wide `querySelector` would find first.
 */
function focusInFiltersPanel(page: Page): Promise<boolean> {
  return filtersFigure(page).evaluate((figure) => {
    const active = document.activeElement;
    if (!active) return false;
    const pane = figure.querySelector("[data-pretable-tool-pane]");
    const rail = figure.querySelector("[data-pretable-tool-rail]");
    return Boolean(pane?.contains(active) || rail?.contains(active));
  });
}

test("filters: a filter drops the row count, and an empty group does not", async ({
  page,
}) => {
  await mountFiltersExample(page);

  // Baseline, stated out loud: an assertion that the count DROPS is only
  // worth something against a known starting point.
  await expect(shownRowCount(page)).toHaveText("12");
  await expect(filtersFigure(page).getByTestId("total-row-count")).toHaveText(
    "12",
  );

  // The rail actually switches sections: away from Filters, the section's
  // controls are gone; back to it, they return. `defaultActiveSection` opened
  // the pane, so without this round-trip nothing here would have opened it.
  await columnsRailTab(page).click();
  await expect(addFilterButton(page)).toHaveCount(0);
  await filtersRailTab(page).click();
  await expect(filtersRailTab(page)).toHaveAttribute("aria-selected", "true");
  await expect(addFilterButton(page)).toBeVisible();

  // Empty tree: the pane says so, and no row exists yet.
  await expect(
    filtersFigure(page).locator("[data-pretable-filter-empty]"),
  ).toBeVisible();

  await addFilterButton(page).click();

  const row = filtersFigure(page).locator("[data-pretable-filter-row]");
  await expect(row).toHaveCount(1);
  // A fresh row lands on the first column with its type's default operator —
  // and holds its place as an empty group until it has a value, so the grid
  // is still unfiltered at this point.
  await expect(row.locator("[data-pretable-filter-row-column]")).toHaveValue(
    "symbol",
  );
  await expect(shownRowCount(page)).toHaveText("12");

  await row.locator("[data-pretable-filter-row-value]").fill("s");

  // The operand is debounced ~200ms; `toHaveText` retries, so this waits for
  // the commit rather than racing it.
  await expect(shownRowCount(page)).toHaveText("4");
  // ...and the grid really is showing those four rows, not just reporting a
  // number: MSFT contains an "s", NVDA does not.
  await expect(
    filtersFigure(page).locator(
      '[data-pretable-row][data-pretable-row-id="h2"]',
    ),
  ).toBeVisible();
  await expect(
    filtersFigure(page).locator(
      '[data-pretable-row][data-pretable-row-id="h1"]',
    ),
  ).toHaveCount(0);

  // An empty group evaluates TRUE under both operators, deliberately: a group
  // added before it has children must not blank the grid while you fill it.
  await addGroupButton(page).click();
  await expect(
    filtersFigure(page).locator("[data-pretable-filter-rail]"),
  ).toHaveCount(1);
  await expect(shownRowCount(page)).toHaveText("4");
  // Still the same four rows, not a coincidentally equal count — both
  // directions, because "h1 is still gone" alone would also hold over an
  // empty grid, which is precisely the failure this assertion is about.
  await expect(
    filtersFigure(page).locator(
      '[data-pretable-row][data-pretable-row-id="h2"]',
    ),
  ).toBeVisible();
  await expect(
    filtersFigure(page).locator(
      '[data-pretable-row][data-pretable-row-id="h1"]',
    ),
  ).toHaveCount(0);
});

test("filters: the pane is walkable and forward-Tab still exits the panel", async ({
  page,
}) => {
  await mountFiltersExample(page);
  await addFilterButton(page).click();
  await expect(
    filtersFigure(page).locator("[data-pretable-filter-row]"),
  ).toHaveCount(1);

  const PARTS = [
    "data-pretable-filter-row-column",
    "data-pretable-filter-row-operator",
    "data-pretable-filter-row-value",
    "data-pretable-filter-row-remove",
    "data-pretable-filter-add",
    "data-pretable-tool-tab",
  ];

  const whereFocusIs = () =>
    page.evaluate((parts) => {
      const active = document.activeElement;
      if (!active) return "none";
      for (const part of parts) {
        if (active.hasAttribute(part)) return part;
      }
      return "other";
    }, PARTS);

  // Walk forward from the pane's FIRST stop — the resize handle (SP5), which
  // sits before every section's content. Starting there rather than on the
  // row's first control makes the walk itself prove the handle chains into
  // the section: one Tab off the handle must land the row's column select.
  // Update this start point if the pane ever gains an earlier stop.
  const resizeHandle = filtersFigure(page).locator(
    "[data-pretable-pane-resize]",
  );
  await resizeHandle.focus();
  await expect(resizeHandle).toBeFocused();
  const seen: string[] = [];
  let escaped = false;
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("Tab");
    if (!(await focusInFiltersPanel(page))) {
      escaped = true;
      break;
    }
    seen.push(await whereFocusIs());
  }

  // The section's controls are ordinary Tab stops, in tree order.
  //
  // Not asserted as one fixed list. WebKit's sequential focus navigation
  // skips a plain `<button>` unless macOS's "Tab moves between all controls"
  // is on — a platform preference, not something a component can set, and one
  // a developer's Mac may well have enabled. A `toEqual` against either
  // spelling is two-sided, so it would fail on the machines with the OTHER
  // setting and report a bug that isn't one. What is actually required is
  // derived from what the browser gave: the stops it does offer come in tree
  // order, every stop that exists everywhere is among them, and the walk ends
  // at the rail.
  const BUTTONS = new Set([
    "data-pretable-filter-row-remove",
    "data-pretable-filter-add",
  ]);
  const FULL = [
    "data-pretable-filter-row-column",
    "data-pretable-filter-row-operator",
    "data-pretable-filter-row-value",
    "data-pretable-filter-row-remove",
    "data-pretable-filter-add", // + filter
    "data-pretable-filter-add", // + group
    "data-pretable-tool-tab", // the rail: the panel's last stop
  ];

  // Tree order, and nothing focused that isn't one of these — a stray stop,
  // or the same one twice, breaks the walk out of FULL's order.
  expect(isSubsequenceOf(FULL, seen), `walk was ${seen.join(" → ")}`).toBe(
    true,
  );
  // The non-button controls are stops in every browser, so they are asserted
  // exactly: the two selects, the operand field, and the rail.
  expect(seen.filter((part) => !BUTTONS.has(part))).toEqual([
    "data-pretable-filter-row-column",
    "data-pretable-filter-row-operator",
    "data-pretable-filter-row-value",
    "data-pretable-tool-tab",
  ]);
  // And where the browser offers button stops at all, it must offer all of
  // them — a missing remove or add button there is a real bug, not a policy.
  if (seen.some((part) => BUTTONS.has(part))) {
    expect(seen).toEqual(FULL);
  }
  // ...and the walk LEAVES. `grid-tab-wrap-rows.spec.ts` makes the same claim
  // about the rail stop from the grid's side; this is the filters pane's.
  expect(escaped).toBe(true);

  // Escape from inside the pane hands focus back to the rail tab, exactly as
  // it does from the columns section.
  await filtersFigure(page)
    .locator("[data-pretable-filter-row-operator]")
    .focus();
  await page.keyboard.press("Escape");
  await expect(filtersRailTab(page)).toBeFocused();
});

/* -------------------------------------------------------------------------
 * The grouping section (SP3b).
 *
 * Target for the two model tests: `/fixtures/grouping` — the one page that
 * ships BOTH projections the one-model invariant spans: the group strip
 * (`groupPanel: { enabled: true }`) and the tool panel's grouping pane (the
 * panel is default-on). It arrives grouped by sector + industry with `region`
 * ungrouped, and `qty` declares `aggregate: "sum"` with a `formatAggregate`
 * of `Σ <n>` — Industry 01-2's five qty values are 121…125, so sum (Σ 615)
 * and avg (Σ 123) are hand-computable AND distinguishable, which is what
 * makes the override assertion mean something.
 *
 * The keyboard walk stays on the keyboard-navigation example, next to the
 * columns walk it extends: that page is where "the rail is ONE stop" is
 * already proven, and its grid is rows-mode, so the grouping pane renders its
 * full control set (aggregate pickers included) while ungrouped.
 * ---------------------------------------------------------------------- */

const GROUPING_FIXTURE = "/fixtures/grouping";

function groupingRailTab(page: Page): Locator {
  return page.locator(
    '[data-pretable-tool-tab][data-pretable-section="grouping"]',
  );
}

async function mountGroupingFixture(page: Page): Promise<void> {
  await page.goto(GROUPING_FIXTURE, { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);
  await waitForStablePosition(groupingRailTab(page));
}

/** Same bounded re-click as `openColumnsPane`, for the same dropped-press
 * family — and toggle-safe for the same reason: the section mounts
 * synchronously with the activation, so "no section after the wait" means
 * the click never landed. */
async function openGroupingPane(page: Page): Promise<void> {
  const section = page.locator("[data-pretable-tool-grouping]");
  for (let attempt = 0; attempt < 3; attempt++) {
    await groupingRailTab(page).click();
    try {
      await expect(section).toBeVisible({ timeout: 1_500 });
      return;
    } catch {
      // fall through to re-click
    }
  }
  await expect(section).toBeVisible();
}

/** The pane's group-by list, in order. */
const paneGroupIds = (page: Page) =>
  page
    .locator("[data-pretable-tool-group-row]")
    .evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-pretable-column-id") ?? ""),
    );

/** The strip's chips, in order — the OTHER projection of the same model. */
const stripChipIds = (page: Page) =>
  page
    .locator("[data-pretable-group-chip]")
    .evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-pretable-column-id") ?? ""),
    );

test("grouping: a level added in the pane appears in the grid and the strip, and its removal undoes both", async ({
  page,
}) => {
  await mountGroupingFixture(page);
  await openGroupingPane(page);

  // The invariant's baseline, both projections: pane list == strip chips ==
  // the fixture's two levels — and no third depth exists yet, so the
  // "appears" below is a real appearance. Both polled, one idiom: nothing
  // has written yet, but the strip hydrates on the same settle as the pane.
  await expect.poll(() => paneGroupIds(page)).toEqual(["sector", "industry"]);
  await expect.poll(() => stripChipIds(page)).toEqual(["sector", "industry"]);
  await expect(
    page.locator('[data-pretable-group-row][aria-level="3"]'),
  ).toHaveCount(0);

  // Add region through the pane's own add path: the button, then the menu.
  await page.locator("[data-pretable-add-group]").click();
  const menu = page.locator("[data-pretable-add-group-menu]");
  await expect(menu).toBeVisible();
  await menu
    .locator('[data-pretable-menu-item][data-pretable-column-id="region"]')
    .click();

  // The BODY says so: group rows at the new depth exist in the grid...
  await expect(
    page.locator('[data-pretable-group-row][aria-level="3"]').first(),
  ).toBeVisible();
  // ...and both projections of the one model agree with each other.
  await expect
    .poll(() => paneGroupIds(page))
    .toEqual(["sector", "industry", "region"]);
  await expect
    .poll(() => stripChipIds(page))
    .toEqual(["sector", "industry", "region"]);
  // Grouped, with the default hide-grouped in force: the column left the
  // header row — the same "grouping, not reordering" check grouping.spec.ts
  // makes for the drag path.
  await expect(
    page.locator(
      '[data-pretable-header-cell][data-pretable-column-id="region"]',
    ),
  ).toHaveCount(0);

  // Remove the level through the pane row's own remove button.
  await page
    .locator(
      '[data-pretable-tool-group-row][data-pretable-column-id="region"] [data-pretable-tool-group-remove]',
    )
    .click();

  await expect(
    page.locator('[data-pretable-group-row][aria-level="3"]'),
  ).toHaveCount(0);
  await expect.poll(() => paneGroupIds(page)).toEqual(["sector", "industry"]);
  await expect.poll(() => stripChipIds(page)).toEqual(["sector", "industry"]);
  // ...and the column is drawn again.
  await expect(
    page.locator(
      '[data-pretable-header-cell][data-pretable-column-id="region"]',
    ),
  ).toHaveCount(1);
});

test("grouping: an aggregate override changes what the group row shows, and clearing restores the declared aggregate", async ({
  page,
}) => {
  await mountGroupingFixture(page);
  await openGroupingPane(page);

  // The fixture computes qty = s*100 + i*10 + r, so Industry 01-2's five
  // leaves (s=1, i=2, r=1…5) are 121…125: sum 615, avg 123 (exactly — no
  // float residue). The fixture's `formatAggregate` wraps whichever value the
  // engine computed, so the CELL TEXT is the discriminator.
  const groupRow = page
    .locator("[data-pretable-group-row]")
    .filter({ hasText: "Industry 01-2" });
  const aggregateCell = groupRow.locator(
    '[data-pretable-cell][data-pretable-column-id="qty"]',
  );
  await expect(aggregateCell).toHaveText("Σ 615");

  const qtyPicker = page.locator(
    '[data-pretable-aggregate-row][data-pretable-column-id="qty"] select',
  );
  await qtyPicker.selectOption("avg");

  // The differently-computed value, not a re-render of the same one: sum and
  // avg genuinely disagree on this fixture.
  await expect(aggregateCell).toHaveText("Σ 123");

  // Back to Default: the override was a layer over the declared aggregate,
  // not a rewrite of it — clearing it restores the declared sum.
  await qtyPicker.selectOption("default");
  await expect(aggregateCell).toHaveText("Σ 615");
});

test("grouping: arrows reach its rail tab, Enter opens it, and forward-Tab exits the pane", async ({
  page,
}) => {
  await mountExample(page);
  await reachRail(page);

  // Arrows, never Tab, move within the rail: columns → filters → grouping.
  // ×2 is a PIN on the roster — three sections ship today and grouping is
  // last; update the count when a section is added.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  expect(
    await page.evaluate(() =>
      document.activeElement?.getAttribute("data-pretable-section"),
    ),
  ).toBe("grouping");

  // Enter opens the FOCUSED section.
  await page.keyboard.press("Enter");
  await expect(groupingRailTab(page)).toHaveAttribute("aria-selected", "true");
  const section = page.locator("[data-pretable-tool-grouping]");
  await expect(section).toBeVisible();

  // Walk forward from the pane's FIRST stop — the resize handle (SP5), the
  // walk's START point and so never in `seen`; update the start if the pane
  // ever gains an earlier stop. This grid is ungrouped, so the recordable
  // roster after it is: the add-group button (a plain <button> — a
  // conditional stop, per the filters walk's WebKit note), expand/
  // collapse-all (DISABLED — never stops), the hide-grouped checkbox, one
  // aggregate select per column, then the rail. Selects — and the rail tab,
  // which carries an explicit tabindex — are Tab stops in every browser; the
  // checkbox and the add-group button are the conditional RECORDED stops,
  // per the platform's "Tab moves between all controls" preference.
  const aggregateCount = await page
    .locator("[data-pretable-aggregate-row]")
    .count();
  expect(aggregateCount).toBeGreaterThan(0);

  const whereFocusIs = () =>
    page.evaluate(() => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return "out";
      if (active.hasAttribute("data-pretable-tool-tab")) return "rail";
      if (active.hasAttribute("data-pretable-pane-resize")) return "resize";
      if (active.hasAttribute("data-pretable-add-group")) return "add-group";
      if (active.hasAttribute("data-pretable-expand-all")) return "expand-all";
      if (active.hasAttribute("data-pretable-collapse-all")) {
        return "collapse-all";
      }
      if (active.hasAttribute("data-pretable-hide-grouped")) {
        return "hide-grouped";
      }
      if (active.closest("[data-pretable-aggregate-row]") !== null) {
        return "aggregate-select";
      }
      return "other";
    });

  const groupingResizeHandle = page.locator("[data-pretable-pane-resize]");
  await groupingResizeHandle.focus();
  await expect(groupingResizeHandle).toBeFocused();
  const seen: string[] = [];
  let escaped = false;
  for (let i = 0; i < aggregateCount + 10; i++) {
    await page.keyboard.press("Tab");
    if (!(await focusInPanel(page))) {
      escaped = true;
      break;
    }
    seen.push(await whereFocusIs());
  }

  // The walk LEAVES — no trap — and every stop it saw belongs to the
  // section (or the rail): nothing stray, and nothing disabled.
  expect(escaped, `walk was ${seen.join(" → ")}`).toBe(true);
  expect(seen).not.toContain("expand-all");
  expect(seen).not.toContain("collapse-all");
  expect(seen).not.toContain("resize"); // the start — seeing it again is a wrap
  expect(seen).not.toContain("other");

  // Tree order, the filters walk's way: the whole walk must be a subsequence
  // of the full roster, so when a conditional stop (the add-group button, the
  // checkbox) IS a stop its POSITION is pinned too — add-group first,
  // hide-grouped before every picker, never between them.
  const FULL = [
    "add-group",
    "hide-grouped",
    ...Array<string>(aggregateCount).fill("aggregate-select"),
    "rail",
  ];
  expect(isSubsequenceOf(FULL, seen), `walk was ${seen.join(" → ")}`).toBe(
    true,
  );
  // The stops that exist in every browser, exactly: every aggregate picker,
  // then the rail as the panel's last stop.
  expect(
    seen.filter((stop) => stop !== "hide-grouped" && stop !== "add-group"),
  ).toEqual([
    ...Array<string>(aggregateCount).fill("aggregate-select"),
    "rail",
  ]);

  // Escape-returns-to-rail is deliberately not re-proven here: the columns
  // and filters walks already pin it, and the handler is the pane shell's —
  // section-agnostic — not the grouping section's.
});

/* -------------------------------------------------------------------------
 * A custom section through the real shell (SP4).
 *
 * Target: `/fixtures/tool-panel-sections` — a small grid whose roster is
 * `["columns", NOTES, "filters", "grouping"]`, NOTES being a consumer
 * descriptor (id "notes": a heading, two buttons, a text input). The unit
 * suite proves the roster resolver; what only a real browser can prove is
 * spec decision 6 — consumer content inherits the shell's a11y contract for
 * free: the rail stays one Tab stop with the custom tab arrow-reachable, the
 * pane's controls are ordinary Tab stops in DOM order, forward-Tab from the
 * last one LEAVES the panel, and Escape hands focus back to the rail tab.
 *
 * ROSTER PINS (update together with the fixture):
 * - rail order: columns, notes, filters, grouping — notes is SECOND, one
 *   ArrowDown from the walk's landing tab.
 * - the pane's first stop is the SHELL's resize handle (SP5) — it precedes
 *   every section's content, consumer sections included.
 * - notes pane controls, in DOM order: save button, clear button, text input.
 * ---------------------------------------------------------------------- */

const SECTIONS_FIXTURE = "/fixtures/tool-panel-sections";

function notesRailTab(page: Page): Locator {
  return page.locator(
    '[data-pretable-tool-tab][data-pretable-section="notes"]',
  );
}

async function mountSectionsFixture(page: Page): Promise<void> {
  await page.goto(SECTIONS_FIXTURE, { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);
  await waitForStablePosition(notesRailTab(page));
}

/** Same bounded re-click as `openColumnsPane`, same dropped-press family —
 * and toggle-safe for the same reason: the pane mounts synchronously with
 * the activation, so "no pane after the wait" means the click never landed. */
async function openNotesPane(page: Page): Promise<void> {
  const heading = page.locator("[data-notes-heading]");
  for (let attempt = 0; attempt < 3; attempt++) {
    await notesRailTab(page).click();
    try {
      await expect(heading).toBeVisible({ timeout: 1_500 });
      return;
    } catch {
      // fall through to re-click
    }
  }
  await expect(heading).toBeVisible();
}

test("custom section: the rail shows the four-section roster in fixture order", async ({
  page,
}) => {
  await mountSectionsFixture(page);

  // The whole rail, in order — a custom descriptor interleaved between
  // built-ins renders exactly where the roster put it, not appended.
  await expect
    .poll(() =>
      page
        .locator("[data-pretable-tool-tab]")
        .evaluateAll((tabs) =>
          tabs.map((tab) => tab.getAttribute("data-pretable-section")),
        ),
    )
    .toEqual(["columns", "notes", "filters", "grouping"]);
  // The custom tab carries the consumer's id verbatim, and its accessible
  // name is the descriptor's plain-string label.
  await expect(notesRailTab(page)).toHaveAttribute("aria-label", "Notes");
});

test("custom section: arrows reach its tab, Enter opens the pane, and the walk exits forward", async ({
  page,
}) => {
  await mountSectionsFixture(page);
  await reachRail(page, page.locator("[data-fixture-tab-start]"));

  // Arrows, never Tab, move within the rail. ×1 is a PIN on the fixture's
  // roster — notes is second, right after columns; update the count when a
  // section is added before it.
  await page.keyboard.press("ArrowDown");
  expect(
    await page.evaluate(() =>
      document.activeElement?.getAttribute("data-pretable-section"),
    ),
  ).toBe("notes");

  // Enter opens the FOCUSED section — the consumer's pane, through the same
  // shell as the built-ins.
  await page.keyboard.press("Enter");
  await expect(notesRailTab(page)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("[data-pretable-tool-pane]")).toBeVisible();
  await expect(page.locator("[data-notes-heading]")).toHaveText("Trade notes");

  // Walk forward from the pane's FIRST stop — the SHELL's resize handle
  // (SP5), the walk's START point, so it can never appear in `seen`; update
  // the start if the pane ever gains an earlier stop. The recordable roster
  // after it: the save and clear buttons (plain <button>s — browser-
  // conditional stops, per the filters walk's WebKit note), the text input,
  // then the rail. Bounded: a trap runs the loop out rather than hanging.
  const whereFocusIs = () =>
    page.evaluate(() => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return "out";
      if (active.hasAttribute("data-pretable-tool-tab")) return "rail";
      if (active.hasAttribute("data-pretable-pane-resize")) return "resize";
      if (active.hasAttribute("data-notes-save")) return "save";
      if (active.hasAttribute("data-notes-clear")) return "clear";
      if (active.hasAttribute("data-notes-input")) return "input";
      return "other";
    });

  const notesResizeHandle = page.locator("[data-pretable-pane-resize]");
  await notesResizeHandle.focus();
  await expect(notesResizeHandle).toBeFocused();
  const seen: string[] = [];
  let escaped = false;
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Tab");
    if (!(await focusInPanel(page))) {
      escaped = true;
      break;
    }
    seen.push(await whereFocusIs());
  }

  // The walk LEAVES — no trap around consumer content — and saw nothing
  // stray: every stop belongs to the section or is the rail.
  expect(escaped, `walk was ${seen.join(" → ")}`).toBe(true);
  expect(seen).not.toContain("resize"); // the start — seeing it again is a wrap
  expect(seen).not.toContain("other");

  // Tree order, the filters walk's way: the whole walk must be a
  // subsequence of the full roster, so when a conditional button IS a
  // stop its POSITION is pinned too.
  const FULL = ["save", "clear", "input", "rail"];
  expect(isSubsequenceOf(FULL, seen), `walk was ${seen.join(" → ")}`).toBe(
    true,
  );
  // The stops that exist in every browser, exactly: the text input, then
  // the rail as the panel's last stop before the exit.
  expect(seen.filter((stop) => stop !== "save" && stop !== "clear")).toEqual([
    "input",
    "rail",
  ]);
});

test("custom section: Escape from inside the pane returns focus to its rail tab", async ({
  page,
}) => {
  await mountSectionsFixture(page);
  await openNotesPane(page);

  // The shell courtesy, proven for consumer content: Escape anywhere in the
  // pane hands focus back to the tab that opened it — the NOTES tab, not
  // merely some rail tab.
  await page.locator("[data-notes-input]").click();
  await expect(page.locator("[data-notes-input]")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(notesRailTab(page)).toBeFocused();
});

/* -------------------------------------------------------------------------
 * Pane resizing + auto width (SP5).
 *
 * Two target pages, both already in this file. The RESIZE tests run on the
 * keyboard example: its pane is untouched and uncontrolled (no width props),
 * so the A5 inline-style rule is observable — no inline `inline-size` until
 * someone acts, and Enter/Escape restore the stylesheet width by REMOVING
 * the style rather than writing the old number back. Its grid also carries
 * 780px of columns in a viewport narrower than that, so Status (pinned
 * right) rides the viewport's right edge — which turns "the grid genuinely
 * reflowed" into one measurable x-coordinate.
 *
 * The AUTO-WIDTH test runs on the filters example: auto width is a MODE BIT,
 * not a content fit (spec Fact 2 — verified in a real browser), so proving
 * the negative needs the visible content to CHANGE while the width must not,
 * and this page's filter builder is the one place a test can swap the desk
 * column's visible values ("Equities", 8 chars → "Macro", 5) without
 * touching layout. None of these fixtures declare `flex`, so the renderer's
 * width for an auto column is exactly its 140px default — the flex-share
 * variant stays a unit-suite concern.
 * ---------------------------------------------------------------------- */

function paneResizeHandle(page: Page): Locator {
  return page.locator("[data-pretable-pane-resize]");
}

function toolPane(page: Page): Locator {
  return page.locator("[data-pretable-tool-pane]");
}

async function paneWidth(page: Page): Promise<number> {
  return Math.round((await toolPane(page).boundingBox())!.width);
}

/**
 * Press the seam and arm the drag, VERIFIED: the pane's width applies LIVE
 * (spec A2), so a small probe travel that moved the width is the drag's own
 * statement that the press landed on the slim strip. A missed press changes
 * nothing — release and re-aim against fresh geometry, `beginGripDrag`'s
 * pattern. Returns the probe position and the width the drag started from
 * (BEFORE the probe's 8px), in ltr, where travel toward +x SHRINKS the pane.
 */
async function beginSeamDrag(
  page: Page,
): Promise<{ x: number; y: number; startWidth: number }> {
  const handle = paneResizeHandle(page);
  for (let attempt = 0; attempt < 3; attempt++) {
    await waitForStablePosition(handle);
    const box = await handle.boundingBox();
    if (!box) continue;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const startWidth = await paneWidth(page);
    await page.mouse.move(x, y);
    await page.mouse.down();
    // Two moves, like the grip drags: a single jump can be coalesced away.
    await page.mouse.move(x + 4, y, { steps: 2 });
    await page.mouse.move(x + 8, y, { steps: 2 });
    try {
      await expect
        .poll(() => paneWidth(page), { timeout: 1_000 })
        .toBe(startWidth - 8);
      return { x, y, startWidth };
    } catch {
      await page.mouse.up(); // missed the strip: release and re-acquire
    }
  }
  throw new Error("could not arm a drag on the pane resize seam");
}

test("pane resize: dragging the seam narrows the pane and the grid genuinely reflows", async ({
  page,
}) => {
  await mountExample(page);
  await openColumnsPane(page);

  const statusHeader = page.locator(
    '[data-pretable-header-cell][data-pretable-column-id="status"]',
  );
  const statusBefore = (await statusHeader.boundingBox())!;

  // Precondition for the reflow assertion: the grid is horizontally
  // scrollable (780px of columns in a narrower viewport), so Status rides
  // the viewport's right edge and MUST move when the grid area grows. A
  // wide-enough grid would leave Status parked at its column offset and the
  // assertion below would measure nothing.
  const viewport = page.locator("[data-pretable-scroll-viewport]");
  expect(await viewport.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
    true,
  );

  const drag = await beginSeamDrag(page);
  // +60 total from the press, toward +x: in ltr the seam's travel away from
  // the pane SHRINKS it — the pane docks at the row's inline end.
  await page.mouse.move(drag.x + 30, drag.y, { steps: 4 });
  await page.mouse.move(drag.x + 60, drag.y, { steps: 4 });
  await page.mouse.up();

  // The pane gave up exactly the travel (rounded whole px by the clamp)...
  await expect.poll(() => paneWidth(page)).toBe(drag.startWidth - 60);
  // ...and the GRID took it: the right-pinned header cell moved with the
  // viewport's right edge — the reflow, measured grid-side, not the pane's
  // own style echoed back.
  await expect
    .poll(async () => {
      const box = (await statusHeader.boundingBox())!;
      return Math.abs(box.x - (statusBefore.x + 60)) <= 1.5;
    })
    .toBe(true);
});

test("pane resize: the handle is a tab stop; arrows resize, Enter restores the stylesheet width", async ({
  page,
}) => {
  await mountExample(page);
  await openColumnsPane(page);
  const handle = paneResizeHandle(page);
  const pane = toolPane(page);

  // Untouched and uncontrolled: no inline width — the stylesheet's number
  // is in charge (spec A5), which is what Enter must restore below.
  expect(await pane.evaluate((el) => el.style.inlineSize)).toBe("");

  // The handle is the pane's FIRST stop in the real sequential order: one
  // Shift+Tab from the columns section's first control (the search box)
  // lands on it. Update this hop if the pane ever gains an earlier stop.
  await page.locator("[data-pretable-tool-search]").focus();
  await page.keyboard.press("Shift+Tab");
  await expect(handle).toBeFocused();

  // aria-valuenow reports the RENDERED width even before any interaction.
  const before = await paneWidth(page);
  await expect(handle).toHaveAttribute("aria-valuenow", String(before));

  // ltr: ArrowRight drags the seam away from the pane — shrink by the 16px
  // step — and the REAL width follows the aria value, not just the number.
  await page.keyboard.press("ArrowRight");
  await expect(handle).toHaveAttribute("aria-valuenow", String(before - 16));
  await expect.poll(() => paneWidth(page)).toBe(before - 16);
  expect(await pane.evaluate((el) => el.style.inlineSize)).toBe(
    `${before - 16}px`,
  );

  // ArrowLeft grows it back — the direction pair, not the same key twice.
  await page.keyboard.press("ArrowLeft");
  await expect(handle).toHaveAttribute("aria-valuenow", String(before));
  await expect.poll(() => paneWidth(page)).toBe(before);

  // Enter resets: uncontrolled with no default prop, "the default" is the
  // stylesheet width, restored by REMOVING the inline style (A5).
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => paneWidth(page)).toBe(before - 16);
  await page.keyboard.press("Enter");
  await expect.poll(() => pane.evaluate((el) => el.style.inlineSize)).toBe("");
  await expect.poll(() => paneWidth(page)).toBe(before);
});

test("pane resize: Escape mid-drag restores the drag-start width", async ({
  page,
}) => {
  await mountExample(page);
  await openColumnsPane(page);
  const pane = toolPane(page);

  const drag = await beginSeamDrag(page);
  await page.mouse.move(drag.x + 40, drag.y, { steps: 4 });
  await expect.poll(() => paneWidth(page)).toBe(drag.startWidth - 40);

  // The drag started from the untouched stylesheet width, so the cancel
  // restores by REMOVING the inline style, not by writing the number back.
  await page.keyboard.press("Escape");
  await expect.poll(() => pane.evaluate((el) => el.style.inlineSize)).toBe("");
  await expect.poll(() => paneWidth(page)).toBe(drag.startWidth);

  // The release after a cancelled drag commits nothing.
  await page.mouse.up();
  await expect.poll(() => paneWidth(page)).toBe(drag.startWidth);
});

test("auto width: the kebab toggle swaps the drawn width between the engine's and the renderer's — and content changes never move it", async ({
  page,
}) => {
  await mountFiltersExample(page);

  // The desk column declares widthPx: 110 — manual, so the ENGINE's stored
  // width is what the renderer draws.
  const deskHeader = filtersFigure(page).locator(
    '[data-pretable-header-cell][data-pretable-column-id="desk"]',
  );
  const drawnDeskWidth = async () =>
    Math.round((await deskHeader.boundingBox())!.width);
  expect(await drawnDeskWidth()).toBe(110);

  // Open the columns section and desk's row menu.
  await columnsRailTab(page).click();
  const deskRow = filtersFigure(page).locator(
    '[data-pretable-tool-column-row][data-pretable-column-id="desk"]',
  );
  await waitForStablePosition(deskRow);
  await deskRow.locator("[data-pretable-tool-row-menu-button]").click();
  // The menu is PORTALED out of the figure, so it is found document-wide by
  // the column id it carries — only one menu is ever open.
  const menu = page.locator(
    '[data-pretable-column-menu][data-pretable-column-id="desk"]',
  );
  await expect(menu).toBeVisible();
  const autoItem = menu.locator('[data-pretable-menu-action="auto-width"]');
  await expect(autoItem).toHaveAttribute("role", "menuitemcheckbox");
  await expect(autoItem).toHaveAttribute("aria-checked", "false");

  // Toggle auto ON: a mode bit, so the menu STAYS OPEN (a checkbox, not a
  // command) with its checked state flipped live...
  await autoItem.click();
  await expect(menu).toBeVisible();
  await expect(autoItem).toHaveAttribute("aria-checked", "true");
  // ...and the drawn width moves to the RENDERER's width — the 140px default
  // (no `flex` on this fixture), NOT a measure of "Equities". The engine
  // still stores 110; auto merely withholds it from the renderer.
  await expect.poll(drawnDeskWidth).toBe(140);

  // Now change the CONTENT while the column is auto: filter symbol to "tl"
  // — only TLT survives, and desk's visible values collapse from a mix
  // including "Equities" (8 chars) to just "Macro" (5). A content-fitting
  // grid would shrink; the mode bit must not move.
  await page.keyboard.press("Escape"); // close the menu first
  await filtersRailTab(page).click();
  await addFilterButton(page).click();
  const filterRow = filtersFigure(page).locator("[data-pretable-filter-row]");
  await filterRow.locator("[data-pretable-filter-row-value]").fill("tl");
  await expect(shownRowCount(page)).toHaveText("1");
  // The content really changed — the Equities rows are gone from the DOM.
  await expect(
    filtersFigure(page).locator(
      '[data-pretable-row][data-pretable-row-id="h1"]',
    ),
  ).toHaveCount(0);
  // The negative that pins the semantic: auto width did not budge.
  await expect.poll(drawnDeskWidth).toBe(140);

  // Toggle auto OFF: back to the ENGINE's stored width — 110 survived the
  // whole excursion untouched, which is what "withheld, not overwritten"
  // means.
  await columnsRailTab(page).click();
  await deskRow.locator("[data-pretable-tool-row-menu-button]").click();
  await expect(menu).toBeVisible();
  await expect(autoItem).toHaveAttribute("aria-checked", "true");
  await autoItem.click();
  await expect(menu).toBeVisible();
  await expect(autoItem).toHaveAttribute("aria-checked", "false");
  await expect.poll(drawnDeskWidth).toBe(110);
});
