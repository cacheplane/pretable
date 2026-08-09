import { expect, test, type Locator, type Page } from "@playwright/test";

import { waitForGridReady, waitForStablePosition } from "./helpers";

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
const ROWS_PER_FIXTURE = 200;

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

/* -------------------------------------------------------------------------
 * SP3 — the drag-to-group panel
 *
 * Everything below is a claim about RECTANGLES, which is why it is here and
 * not in the vitest suite. Both drag paths ask one question — "is the pointer
 * inside the panel's box?" — and jsdom answers every `getBoundingClientRect()`
 * with zeros, so `packages/react/src/__tests__/group-panel-drag.test.tsx`
 * mocks `hitTestGroupPanel` outright. It proves the plumbing around the seam;
 * only a browser can prove the seam itself decides anything.
 *
 * Two further rules were expected to need a browser and, measured, do not.
 * Recorded here so the next reader does not re-derive them from the plan:
 *
 * - **the pointer capture's placement is not observable.** A chip drag takes
 *   the capture on the panel container rather than on a chip. Moving it onto
 *   the chip fails the unit suite's structural assertion but changes nothing
 *   in either engine, because every handler after `pointerdown` is on
 *   `document` and a captured event still bubbles there. The rule is sound
 *   defensively; it is not what makes the drag work.
 * - **focus is not dropped by the reorder.** A `Shift`+arrow move really does
 *   make React remove and re-insert the focused chip — confirmed with a
 *   MutationObserver, on both presses — and Chromium and WebKit both keep
 *   `document.activeElement` on it through the move. Deleting the refocus
 *   effect's reorder branch leaves all 757 unit tests AND the assertion below
 *   green. It stays because the REMOVAL path genuinely needs it (there the
 *   node is destroyed, and the unit suite covers that), and the assertion
 *   below stays because it pins the user-visible outcome — but neither is
 *   evidence for the effect.
 * ---------------------------------------------------------------------- */

const panel = (page: Page) => page.locator("[data-pretable-group-panel]");

/** The grouping levels the panel is currently showing, in order. */
const chipIds = (page: Page) =>
  panel(page)
    .locator("[data-pretable-group-chip]")
    .evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-pretable-column-id") ?? ""),
    );

/** The drawn header columns, in order. Grouped columns have no header. */
const headerIds = (page: Page) =>
  page
    .locator("[data-pretable-header-cell]")
    .evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-pretable-column-id") ?? ""),
    );

const headerCell = (page: Page, columnId: string) =>
  page.locator(
    `[data-pretable-header-cell][data-pretable-column-id="${columnId}"]`,
  );

const chip = (page: Page, columnId: string) =>
  page.locator(
    `[data-pretable-group-chip][data-pretable-column-id="${columnId}"]`,
  );

const copyOutput = (page: Page) =>
  page.locator("output[data-grouping-copy-output]");

const platformShortcut = (key: "a" | "c") =>
  process.platform === "darwin" ? `Meta+${key}` : `Control+${key}`;

/** Natural focus traversal only: never call `focus()` on the target. */
async function tabUntilFocused(
  page: Page,
  target: Locator,
  traversalKey: "Tab" | "Alt+Tab",
) {
  const traversed: string[] = [];
  for (let press = 0; press < 30; press += 1) {
    await page.keyboard.press(traversalKey);
    if (
      await target.evaluate((element) => element === document.activeElement)
    ) {
      return;
    }
    traversed.push(
      await page.evaluate(() => {
        const active = document.activeElement;
        if (!(active instanceof HTMLElement)) return "unknown";
        return `${active.getAttribute("role") ?? active.tagName.toLowerCase()}:${active.getAttribute("aria-label") ?? active.textContent?.trim() ?? ""}`;
      }),
    );
  }
  throw new Error(
    `target was not reached through natural Tab order: ${traversed.join(" -> ")}`,
  );
}

function nonEmptyTsvLines(text: string) {
  return text.split("\n").filter((line) => line.length > 0);
}

/**
 * Presses a column header and moves far enough to arm the reorder drag, leaving
 * the pointer down and the gesture in flight. Returns the grab point.
 *
 * The grab is the fragile half and the assertions after it are not: a header is
 * flanked by a 4px resize strip and the funnel/menu overlay slot, so a box
 * measured a frame early presses one of those and the drag silently never
 * starts. `[data-pretable-reorder-ghost]` is the grid's own statement that the
 * drag armed, so re-measure and retry until it appears — the same loop as
 * `smoke.spec.ts`'s reorder tests, and for the same reason.
 */
async function grabHeader(page: Page, columnId: string) {
  const header = headerCell(page, columnId);
  const ghost = page.locator("[data-pretable-reorder-ghost]");
  await waitForStablePosition(header);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const box = await header.boundingBox();
    if (!box) continue;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    // WebKit only engages pointer capture once the pointer has traversed
    // intermediate positions, so this must be stepped, never a single jump.
    await page.mouse.move(x + 10, y, { steps: 3 });
    if ((await ghost.count()) > 0) return { x, y };
    await page.mouse.up();
  }
  throw new Error(`reorder drag never engaged on the ${columnId} header`);
}

test("a header dropped on the panel groups by that column", async ({
  page,
}) => {
  await page.goto(FIXTURE, { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);

  expect(await chipIds(page)).toEqual(["sector", "industry"]);
  await expect(headerCell(page, "region")).toBeVisible();

  const panelBox = (await panel(page).boundingBox())!;
  const headerBox = (await headerCell(page, "region").boundingBox())!;
  // The premise of the whole disambiguation: the two zones are disjoint boxes.
  // If the panel ever collapsed to nothing, or overlapped the header row, every
  // assertion in this block would be measuring the same rectangle twice.
  expect(panelBox.height).toBeGreaterThan(8);
  expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(headerBox.y + 1);

  await grabHeader(page, "region");
  // Land after both chips, so the insertion index is one the hit test has to
  // compute from chip midpoints rather than the 0 a bare "over the panel" would
  // give.
  await page.mouse.move(
    panelBox.x + panelBox.width - 12,
    panelBox.y + panelBox.height / 2,
    { steps: 10 },
  );
  await expect(panel(page)).toHaveAttribute(
    "data-pretable-group-panel-active",
    "",
  );
  await page.mouse.up();

  await expect
    .poll(() => chipIds(page))
    .toEqual(["sector", "industry", "region"]);
  // Grouping, not reordering: the column left the header row entirely
  // (`hideGroupedColumns` is on by default), and a third depth now exists.
  expect(await headerIds(page)).not.toContain("region");
  await expect(groupRowAtLevel(page, 3).first()).toBeVisible();
});

test("a header dropped on the header row still reorders and does not group", async ({
  page,
}) => {
  // THE assertion this whole file exists for. The only thing separating "group"
  // from "reorder" is which rectangle the pointer is inside, and jsdom cannot
  // compare rectangles at all. Make the panel hit test always report a hit and
  // this test — and only this test — starts grouping.
  await page.goto(FIXTURE, { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);

  const before = await headerIds(page);
  expect(before).toContain("region");
  expect(before).toContain("qty");
  expect(before.indexOf("region")).toBeLessThan(before.indexOf("qty"));

  const qty = (await headerCell(page, "qty").boundingBox())!;
  const grab = await grabHeader(page, "region");

  // Stay on the header row's own y for the entire gesture: the panel is
  // directly above it, so a drag that strayed up would be a legitimate group.
  await page.mouse.move(qty.x + qty.width - 6, grab.y, { steps: 10 });
  await expect(panel(page)).not.toHaveAttribute(
    "data-pretable-group-panel-active",
    "",
  );
  await page.mouse.up();

  // Reported rather than just asserted, so a regression says where the column
  // actually landed instead of "false".
  await expect
    .poll(async () => {
      const ids = await headerIds(page);
      console.log(`[grouping] header order after drop: ${ids.join(",")}`);
      return ids.indexOf("region") === ids.length - 1;
    })
    .toBe(true);
  // ...and grouping is untouched.
  expect(await chipIds(page)).toEqual(["sector", "industry"]);
});

test("a chip dragged past another reorders the grouping levels", async ({
  page,
}) => {
  // The chip drag end to end against real chip rectangles: the insertion index
  // is "how many chip midpoints has the pointer passed", which jsdom's
  // all-zero boxes cannot express, so its suite injects the answer.
  await page.goto(FIXTURE, { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);
  expect(await chipIds(page)).toEqual(["sector", "industry"]);

  const sector = chip(page, "sector");
  await waitForStablePosition(sector);
  const from = (await sector.boundingBox())!;
  const to = (await chip(page, "industry").boundingBox())!;

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    from.x + from.width / 2 + 10,
    from.y + from.height / 2,
    {
      steps: 3,
    },
  );
  await expect(sector).toHaveAttribute("data-pretable-chip-dragging", "");
  // Past "industry"'s midpoint, which is what makes the insertion index 2.
  await page.mouse.move(to.x + to.width - 2, to.y + to.height / 2, {
    steps: 10,
  });
  await expect(
    panel(page).locator("[data-pretable-chip-drop-indicator]"),
  ).toHaveCount(1);
  await page.mouse.up();

  await expect.poll(() => chipIds(page)).toEqual(["industry", "sector"]);
  // The engine really re-levelled, not just the strip.
  await expect(
    groupRowAtLevel(page, 1).first().locator("[data-pretable-group-label]"),
  ).toContainText("Industry");
});

test("Escape mid-drag over the panel leaves a header drag ungrouped", async ({
  page,
}) => {
  // The header drag's Escape branch lives on the scroll viewport's own
  // `onKeyDown`, so it only fires if the press put focus somewhere inside the
  // viewport — and macOS/WebKit famously does not focus a <button> on click.
  // Both engines are checked here because that is not a claim jsdom's
  // `fireEvent.keyDown(header)` can make: it dispatches straight at the header
  // whether or not a browser would have focused it.
  await page.goto(FIXTURE, { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);

  const panelBox = (await panel(page).boundingBox())!;
  await grabHeader(page, "region");
  await page.mouse.move(
    panelBox.x + panelBox.width - 12,
    panelBox.y + panelBox.height / 2,
    { steps: 10 },
  );
  // Armed over the zone that WOULD group — the sibling test above proves this
  // exact release adds a level — so the cancel has something to cancel.
  await expect(panel(page)).toHaveAttribute(
    "data-pretable-group-panel-active",
    "",
  );

  await page.keyboard.press("Escape");
  await expect(panel(page)).not.toHaveAttribute(
    "data-pretable-group-panel-active",
    "",
  );
  await page.mouse.up();

  expect(await chipIds(page)).toEqual(["sector", "industry"]);
  expect(await headerIds(page)).toContain("region");
});

test("Escape mid-drag leaves the grouping exactly as it was", async ({
  page,
}) => {
  // The point where we deliberately diverge from ag-grid, which mutates on drag
  // LEAVE and cannot undo it. Nothing here commits before the release, so
  // abandoning the gesture is the restore.
  await page.goto(FIXTURE, { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);

  const sector = chip(page, "sector");
  await waitForStablePosition(sector);
  const from = (await sector.boundingBox())!;
  const to = (await chip(page, "industry").boundingBox())!;

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    from.x + from.width / 2 + 10,
    from.y + from.height / 2,
    {
      steps: 3,
    },
  );
  await page.mouse.move(to.x + to.width - 2, to.y + to.height / 2, {
    steps: 10,
  });
  // Armed and pointing somewhere that WOULD reorder, so the cancel has
  // something to cancel.
  await expect(sector).toHaveAttribute("data-pretable-chip-dragging", "");

  await page.keyboard.press("Escape");
  await expect(sector).not.toHaveAttribute("data-pretable-chip-dragging", "");
  await page.mouse.up();

  expect(await chipIds(page)).toEqual(["sector", "industry"]);
});

test("a chip released outside the panel changes nothing", async ({ page }) => {
  // ag-grid ungroups the instant the pointer crosses the panel boundary, with
  // no undo. Releasing outside ours is a plain no-op.
  //
  // The SECOND chip is dragged out on purpose: a leaked "no hit" degrades to
  // insertion index 0, which would put the FIRST chip back where it already is
  // and make this assertion hold either way.
  //
  // Only the CHIP drag has a third "neither zone" outcome. A header drag has
  // two: over the panel it groups, anywhere else it reorders — including well
  // outside the grid, since the drop index is a function of cursor X alone.
  // Measured in both engines. The design doc's Decision 2 says otherwise
  // ("release over neither and nothing happens"); the code and its unit test
  // both say reorder, so this spec does not assert the doc's version.
  await page.goto(FIXTURE, { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);

  const industry = chip(page, "industry");
  await waitForStablePosition(industry);
  const from = (await industry.boundingBox())!;
  const panelBox = (await panel(page).boundingBox())!;

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    from.x + from.width / 2 + 10,
    from.y + from.height / 2,
    {
      steps: 3,
    },
  );
  await expect(industry).toHaveAttribute("data-pretable-chip-dragging", "");
  // Well below the panel, over the grid body.
  await page.mouse.move(
    panelBox.x + panelBox.width / 2,
    panelBox.y + panelBox.height + 160,
    { steps: 10 },
  );
  await expect(panel(page)).not.toHaveAttribute(
    "data-pretable-group-panel-active",
    "",
  );
  await page.mouse.up();

  expect(await chipIds(page)).toEqual(["sector", "industry"]);
});

test("Shift+ArrowRight twice walks the same level two places", async ({
  page,
}) => {
  // A SECOND press is the point: it is the one that asks whether the keyboard
  // is still on the chip that just moved. See the block comment at the top for
  // what was measured here — React does re-insert the focused node, and both
  // engines keep focus on it anyway, so this pins the outcome rather than the
  // mechanism.
  await page.goto(FIXTURE, { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);

  // Three levels, so "two places" is a real distance. Added through the column
  // menu rather than a drag, to keep this test about the keyboard.
  await page.locator("[data-pretable-header-row]").first().hover();
  await page.getByRole("button", { name: "Column menu for Region" }).click();
  await page.getByRole("menuitem", { name: "Group by this column" }).click();
  await expect
    .poll(() => chipIds(page))
    .toEqual(["sector", "industry", "region"]);

  const sector = chip(page, "sector");
  await sector.focus();
  await expect(sector).toBeFocused();

  await page.keyboard.press("Shift+ArrowRight");
  await expect
    .poll(() => chipIds(page))
    .toEqual(["industry", "sector", "region"]);
  // The chip moved out from under the keyboard; focus has to have gone with it
  // or the next press lands on nothing.
  await expect(chip(page, "sector")).toBeFocused();

  await page.keyboard.press("Shift+ArrowRight");
  await expect
    .poll(() => chipIds(page))
    .toEqual(["industry", "region", "sector"]);
  await expect(chip(page, "sector")).toBeFocused();
});

test("keyboard grouping keeps focus from the Region menu through final removal", async ({
  browserName,
  page,
}) => {
  await page.goto(FIXTURE, { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);

  const regionMenu = page.getByRole("button", {
    name: "Column menu for Region",
  });
  const bodyCell = page.locator(
    '[data-pretable-row-id="s1-i1-r1"] [data-pretable-column-id="name"]',
  );
  await bodyCell.click();
  await expect(bodyCell).toBeFocused();

  const regionFilter = page.getByRole("button", { name: "Filter Region" });
  await regionFilter.focus();
  await expect(regionFilter).toBeFocused();

  // WebKit models Safari's default macOS preference, where Option+Tab is the
  // native chord that includes buttons in sequential focus navigation. The
  // body click above leaves a real engine focus behind; starting on the
  // adjacent filter makes the final move into Region's menu button native
  // traversal in both engines.
  await tabUntilFocused(
    page,
    regionMenu,
    browserName === "webkit" ? "Alt+Tab" : "Tab",
  );
  await expect(regionMenu).toBeFocused();

  await page.keyboard.press("Enter");
  const groupItem = page.getByRole("menuitem", {
    name: "Group by this column",
  });
  await expect(groupItem).toBeFocused();
  await page.keyboard.press("Enter");

  const regionChip = page.getByRole("option", { name: /^Region,/ });
  await expect(regionChip).toBeFocused();
  await expect(regionMenu).toHaveCount(0);
  await expect(headerCell(page, "region")).toHaveCount(0);

  // Region was appended last. Remove the two preceding levels through the
  // roving listbox keyboard so Region becomes the final remaining chip.
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("option", { name: /^Industry,/ })).toBeFocused();
  await page.keyboard.press("Delete");
  await expect(page.getByRole("option", { name: /^Region,/ })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("option", { name: /^Sector,/ })).toBeFocused();
  await page.keyboard.press("Backspace");
  await expect(page.getByRole("option", { name: /^Region,/ })).toBeFocused();

  await page.keyboard.press("Delete");
  await expect(regionMenu).toBeFocused();
  await expect(page.getByRole("option", { name: /^Region,/ })).toHaveCount(0);
});

test("grouped Cmd/Ctrl+A copy stays rectangular across labels, leaves, and aggregates", async ({
  page,
}) => {
  await page.goto(FIXTURE, { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);

  const visibleNameCell = page.locator(
    '[data-pretable-row-id="s1-i1-r1"] [data-pretable-column-id="name"]',
  );
  await visibleNameCell.click();
  await page.keyboard.press(platformShortcut("a"));
  await page.keyboard.press(platformShortcut("c"));

  await expect(copyOutput(page)).not.toHaveText("");
  const lines = nonEmptyTsvLines((await copyOutput(page).textContent()) ?? "");
  const representative = lines.slice(0, 7).map((line) => line.split("\t"));

  expect(representative).toHaveLength(7);
  expect(new Set(representative.map((fields) => fields.length))).toEqual(
    new Set([4]),
  );
  expect(representative[0]).toEqual(["", "West", "Holding 01-1-1", "111"]);
  expect(representative[1]).toEqual(["", "West", "Holding 01-1-2", "112"]);
  expect(representative[5]).toEqual(["Industry 01-2", "", "", "Σ 615"]);
  expect(representative[6]).toEqual(["", "West", "Holding 01-2-1", "121"]);
  expect(lines).toContain("Sector 02\t\t\tΣ 4560");
});

test("grouped row checkboxes copy every drawn data column without the selector", async ({
  page,
}) => {
  await page.goto(FIXTURE, { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);

  const firstRow = page.locator('[data-pretable-row-id="s1-i1-r1"]');
  await firstRow.getByRole("checkbox", { name: "Select row" }).click();
  await page.keyboard.press(platformShortcut("c"));

  await expect(copyOutput(page)).not.toHaveText("");
  expect(((await copyOutput(page).textContent()) ?? "").split("\t")).toEqual([
    "",
    "West",
    "Holding 01-1-1",
    "111",
  ]);

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForGridReady(page);
  const selectAll = page.getByRole("checkbox", { name: "Select all rows" });
  await selectAll.click();
  await expect(selectAll).toHaveAttribute("aria-checked", "true");
  await page
    .getByRole("treegrid", { name: "Grouped holdings" })
    .press(platformShortcut("c"));

  await expect(copyOutput(page)).not.toHaveText("");
  const selectedRows = nonEmptyTsvLines(
    (await copyOutput(page).textContent()) ?? "",
  ).map((line) => line.split("\t"));
  expect(selectedRows).toHaveLength(ROWS_PER_FIXTURE);
  expect(new Set(selectedRows.map((fields) => fields.length))).toEqual(
    new Set([4]),
  );
  expect(selectedRows[0]).toEqual(["", "West", "Holding 01-1-1", "111"]);
  expect(selectedRows.at(-1)).toEqual(["", "East", "Holding 10-4-5", "1045"]);
});
