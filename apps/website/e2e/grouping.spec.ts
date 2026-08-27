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

test("portfolio hero groups Sector without changing its bezel", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);

  const heroGrid = page.getByRole("grid", {
    name: /live portfolio positions/i,
  });
  const heroPanel = page.locator("[data-pretable-group-panel]").first();
  const bezel = page.getByTestId("hero-bezel");
  await expect(heroGrid).toBeVisible();
  await expect(heroPanel).toContainText("Drag a column here to group");
  await expect(page.locator("[data-pretable-group-row]")).toHaveCount(0);
  await waitForStablePosition(bezel);
  const before = await bezel.boundingBox();
  expect(before).not.toBeNull();

  await page.locator("[data-pretable-header-row]").first().hover();
  await page.getByRole("button", { name: "Column menu for Sector" }).click();
  await page.getByRole("menuitem", { name: "Group by this column" }).click();

  await expect(
    page.getByRole("treegrid", { name: /live portfolio positions/i }),
  ).toBeVisible();
  await expect(heroPanel).toContainText("Sector");
  await expect(page.locator("[data-pretable-group-row]").first()).toBeVisible();

  // Let live portfolio ticks cross the grouped model before checking that the
  // grouping interaction and its fixed-size shell remain intact.
  await page.waitForTimeout(1_000);
  await expect(heroPanel).toContainText("Sector");
  await expect(
    page.getByRole("treegrid", { name: /live portfolio positions/i }),
  ).toBeVisible();
  const after = await bezel.boundingBox();
  expect(after).not.toBeNull();
  expect(Math.abs(after!.width - before!.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(after!.height - before!.height)).toBeLessThanOrEqual(1);
});

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

test("cold SSR hydration adopts theme geometry without recovery", async ({
  page,
}) => {
  const hydrationErrors: string[] = [];
  page.on("pageerror", (error) => {
    hydrationErrors.push(error.message);
  });
  page.on("console", (message) => {
    if (
      /hydrat|server rendered html|Minified React error #(418|419|423|424)/i.test(
        message.text(),
      )
    ) {
      hydrationErrors.push(message.text());
    }
  });

  await page.goto(FIXTURE, { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);

  const header = await page
    .locator("[data-pretable-header-row]")
    .first()
    .elementHandle();
  const groupPanel = await page
    .locator("[data-pretable-group-panel]")
    .first()
    .elementHandle();
  const viewport = await viewportOf(page).first().elementHandle();
  if (!header || !groupPanel || !viewport) {
    throw new Error(
      "Expected the grouping fixture to render its header, group panel, and viewport",
    );
  }

  expect(
    await header.evaluate((element) =>
      parseFloat(getComputedStyle(element).height),
    ),
  ).toBe(52);
  expect(
    await groupPanel.evaluate((element) =>
      parseFloat(getComputedStyle(element).height),
    ),
  ).toBe(44);
  expect(
    await viewport.evaluate(
      (element) => element.querySelectorAll("[data-pretable-row-id]").length,
    ),
  ).toBe(13);
  expect(hydrationErrors).toEqual([]);
});

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
  page,
}) => {
  await page.goto(FIXTURE, { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);

  const regionMenu = page.getByRole("button", {
    name: "Column menu for Region",
  });

  // Reached by the grid's own focus model, not by the browser's tab order.
  //
  // This used to Tab from the adjacent filter funnel into the menu button —
  // with an `Alt+Tab` variant for WebKit, because Safari's default macOS
  // preference keeps bare `<button>`s out of sequential navigation unless
  // Option is held. Neither route exists any more: the header joined the
  // roving-tabindex model, so both controls are `tabIndex={-1}` and the whole
  // grid is one tab stop. The engine-native route replaces it, and it is the
  // same in both engines, which is why the `browserName` branch is gone.
  await page
    .locator('[data-pretable-header-cell][data-pretable-column-id="region"]')
    .click();
  await expect(
    page.locator(
      '[data-pretable-header-cell][data-pretable-column-id="region"][data-pretable-focused="true"]',
    ),
  ).toHaveCount(1);
  await page.keyboard.press("Shift+F10");
  await expect(regionMenu).toHaveAttribute("aria-expanded", "true");
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
    new Set([3]),
  );
  expect(representative[0]).toEqual(["West", "Holding 01-1-1", "111"]);
  expect(representative[1]).toEqual(["West", "Holding 01-1-2", "112"]);
  expect(representative[5]).toEqual(["Industry 01-2", "", "Σ 615"]);
  expect(representative[6]).toEqual(["West", "Holding 01-2-1", "121"]);
  expect(lines).toContain("Sector 02\t\tΣ 4560");
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
    new Set([3]),
  );
  expect(selectedRows[0]).toEqual(["West", "Holding 01-1-1", "111"]);
  expect(selectedRows.at(-1)).toEqual(["East", "Holding 10-4-5", "1045"]);
});

/* -------------------------------------------------------------------------
 * SP3 — the panel's horizontal overflow
 *
 * The strip's height is FIXED: `--pretable-group-panel-height` is subtracted
 * from `viewportHeight` so enabling the panel does not change the box the
 * component occupies. Chips that do not fit therefore have to go sideways, and
 * the strip scrolls. Everything below is a claim about that scrolling, so
 * everything below is a claim jsdom cannot make: there `scrollWidth`,
 * `clientWidth` and every rect are 0, and an assigned `scrollLeft` reads back
 * unchanged — so a "chips are reachable" unit test could only ever be vacuous.
 *
 * The fixture is a route of its own (`/fixtures/grouping-overflow`) rather than
 * a second grid on `/fixtures/grouping`, because every locator above is
 * page-wide — `panel(page)`, `chipIds(page)`, `headerCell(page, id)` — and a
 * second grid would turn each of them into a strict-mode violation.
 * ---------------------------------------------------------------------- */

const OVERFLOW_FIXTURE = "/fixtures/grouping-overflow";
const OVERFLOW_LEVELS = [
  "alpha",
  "bravo",
  "charlie",
  "delta",
  "echo",
  "foxtrot",
  "golf",
  "hotel",
];

/**
 * Loads the overflow fixture and proves its premise before any test leans on
 * it: eight chips, none of them squeezed, in a strip about a third their total
 * width. Returned so callers can compute the maximum scroll offset.
 *
 * The premise is checked because it is exactly what a regression would take
 * away. A nowrap flex row has a second way out of an overflow — shrinking its
 * items to fit — and if the chips ever took it (a shorter label, a `flex-shrink`
 * added in passing, a smaller `max-width`) the strip would stop scrolling and
 * every assertion below would pass against a panel with nothing to reveal.
 */
async function gotoOverflowFixture(page: Page) {
  await page.goto(OVERFLOW_FIXTURE, { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);
  expect(await chipIds(page)).toEqual(OVERFLOW_LEVELS);

  const widths = await panel(page)
    .locator("[data-pretable-group-chip]")
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
  expect(Math.min(...widths)).toBeGreaterThan(140);

  const metrics = await panel(page).evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    scrollLeft: el.scrollLeft,
  }));
  expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth * 2);
  expect(metrics.scrollLeft).toBe(0);
  return { ...metrics, maxScroll: metrics.scrollWidth - metrics.clientWidth };
}

/** True when `columnId`'s chip is entirely inside the strip's scrollport. */
async function chipIsInsidePanel(page: Page, columnId: string) {
  const panelBox = (await panel(page).boundingBox())!;
  const chipBox = (await chip(page, columnId).boundingBox())!;
  return (
    chipBox.x >= panelBox.x - 1 &&
    chipBox.x + chipBox.width <= panelBox.x + panelBox.width + 1
  );
}

/**
 * Presses a chip and moves far enough to arm its drag, leaving the pointer
 * down. Same shape and same reasons as `grabHeader`: the grab is the fragile
 * half, and `data-pretable-chip-dragging` is the panel's own statement that it
 * took.
 */
async function grabChip(page: Page, columnId: string) {
  const target = chip(page, columnId);
  await waitForStablePosition(target);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const box = await target.boundingBox();
    if (!box) continue;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    // WebKit only engages pointer capture once the pointer has traversed
    // intermediate positions, so this must be stepped, never a single jump.
    await page.mouse.move(x + 10, y, { steps: 3 });
    if ((await target.getAttribute("data-pretable-chip-dragging")) !== null) {
      return { x, y };
    }
    await page.mouse.up();
  }
  throw new Error(`chip drag never engaged on ${columnId}`);
}

test("a chip past the strip's width is reachable with the wheel", async ({
  page,
}) => {
  // The defect this whole section exists for: the strip used to be
  // `overflow: hidden`, so the levels past its width were painted into dead
  // space with no scrollbar and no way to reach them.
  //
  // The wheel — not an assigned `scrollLeft` — is what makes this test mean
  // something. An `overflow: hidden` box is still a scroll container in the
  // CSSOM: assigning `scrollLeft` moves it just fine, so a programmatic scroll
  // would pass against the bug it is meant to catch. Only user input
  // distinguishes the two.
  const metrics = await gotoOverflowFixture(page);
  const panelBox = (await panel(page).boundingBox())!;

  const before = (await chip(page, "hotel").boundingBox())!;
  expect(before.x).toBeGreaterThan(panelBox.x + panelBox.width);
  expect(await chipIsInsidePanel(page, "hotel")).toBe(false);

  await page.mouse.move(
    panelBox.x + panelBox.width / 2,
    panelBox.y + panelBox.height / 2,
  );
  for (let nudge = 0; nudge < 12; nudge += 1) {
    await page.mouse.wheel(400, 0);
    const at = await panel(page).evaluate((el) => el.scrollLeft);
    if (at >= metrics.maxScroll - 1) break;
  }
  await expect
    .poll(() => panel(page).evaluate((el) => el.scrollLeft))
    .toBeGreaterThanOrEqual(metrics.maxScroll - 1);

  expect(await chipIsInsidePanel(page, "hotel")).toBe(true);
  // Inside the strip's box AND actually painted there — `toBeInViewport` is an
  // intersection test, so it stays false for a chip an ancestor clips away.
  await expect(chip(page, "hotel")).toBeInViewport();
});

test("arrowing to a chip past the strip's width scrolls it into view", async ({
  page,
}) => {
  // The keyboard is the accessible path to every grouping operation, so a chip
  // the arrow keys can reach but not show is worse than the mouse case: focus
  // lands somewhere invisible and the roving tab stop goes with it.
  await gotoOverflowFixture(page);

  await tabUntilFocused(page, chip(page, "alpha"), "Tab");
  for (let press = 0; press < OVERFLOW_LEVELS.length - 1; press += 1) {
    await page.keyboard.press("ArrowRight");
  }
  await expect(chip(page, "hotel")).toBeFocused();

  await expect
    .poll(() => panel(page).evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(0);
  expect(await chipIsInsidePanel(page, "hotel")).toBe(true);
  await expect(chip(page, "hotel")).toBeInViewport();
});

test("revealing a focused chip moves the strip and nothing else", async ({
  page,
}) => {
  // Why the reveal is hand-rolled instead of left to the browser. Focusing an
  // element scrolls EVERY scrollable ancestor that does not already contain
  // it, up to the document — so once the strip has scrolled the chip to its
  // own right-hand edge, a document whose viewport ends before that edge
  // scrolls too, and the whole page lurches sideways on one arrow press.
  //
  // Measured, with the panel's right edge past the window's: plain `focus()`
  // moves the document ~765px in Chromium and ~781px in WebKit.
  // `focus({ preventScroll: true })` plus `revealChipInPanel` moves 0.
  await gotoOverflowFixture(page);

  // Build that hostile page: the fixture itself is deliberately plain, and
  // this is a property of the surrounding document rather than of the grid.
  // `scroll-behavior` is forced to `auto` so a page scroll, if one happened,
  // could not hide behind the site's smooth-scroll animation.
  const parked = await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = "auto";
    const main = document.querySelector("main") as HTMLElement;
    main.style.marginLeft = "1200px";
    const spacer = document.createElement("div");
    spacer.style.width = "2600px";
    spacer.style.height = "1px";
    document.body.appendChild(spacer);

    const strip = document.querySelector<HTMLElement>(
      "[data-pretable-group-panel]",
    )!;
    const absoluteLeft = strip.getBoundingClientRect().left + window.scrollX;
    // Park the strip's LEFT edge 300px inside the window's right half, so the
    // first chip is on screen (Tab can reach it without scrolling anything)
    // and the strip's right edge — where a revealed chip ends up — is past the
    // window's. That is the arrangement in which the document has to move.
    window.scrollTo({
      left: absoluteLeft - (window.innerWidth - 300),
      top: 0,
      behavior: "instant",
    });
    return window.scrollX;
  });
  expect(parked).toBeGreaterThan(0);
  expect(await chipIsInsidePanel(page, "alpha")).toBe(true);

  await tabUntilFocused(page, chip(page, "alpha"), "Tab");
  for (let press = 0; press < OVERFLOW_LEVELS.length - 1; press += 1) {
    await page.keyboard.press("ArrowRight");
  }
  await expect(chip(page, "hotel")).toBeFocused();

  expect(await chipIsInsidePanel(page, "hotel")).toBe(true);
  expect(await page.evaluate(() => window.scrollX)).toBe(parked);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test("a chip drag held near the strip's edge autoscrolls it", async ({
  page,
}) => {
  // Without this, a level that is scrolled out is a level nothing can be
  // dropped next to: the pointer reaches the edge and simply stops.
  const metrics = await gotoOverflowFixture(page);
  const panelBox = (await panel(page).boundingBox())!;

  const grab = await grabChip(page, "alpha");
  // Well clear of the buffer at the grab point, so the scroll below is caused
  // by the move and not by where the gesture started.
  expect(grab.x - panelBox.x).toBeGreaterThan(60);
  expect(await panel(page).evaluate((el) => el.scrollLeft)).toBe(0);

  // Hold just inside the right edge. The pointer does not move again: the
  // whole point is that a STATIONARY pointer keeps the strip moving.
  await page.mouse.move(
    panelBox.x + panelBox.width - 6,
    panelBox.y + panelBox.height / 2,
    { steps: 10 },
  );
  await expect
    .poll(() => panel(page).evaluate((el) => el.scrollLeft), {
      timeout: 5_000,
    })
    .toBeGreaterThanOrEqual(metrics.maxScroll - 1);
  // ...and the levels it walked past are now reachable to drop against.
  expect(await chipIsInsidePanel(page, "hotel")).toBe(true);

  // Leave the strip and release: this gesture was about the scrolling, and a
  // drop outside the panel commits nothing.
  await page.mouse.move(
    panelBox.x + panelBox.width / 2,
    panelBox.y + panelBox.height + 60,
    { steps: 5 },
  );
  await page.mouse.up();
  expect(await chipIds(page)).toEqual(OVERFLOW_LEVELS);
});

test("the insertion index is right when the strip is scrolled", async ({
  page,
}) => {
  // `insertIndexAt` counts the chip midpoints the pointer has passed, from
  // `getBoundingClientRect()`. Those are VIEWPORT coordinates, so a scrolled
  // strip needs no correction — and "correcting" it by `scrollLeft`, which is
  // the obvious-looking fix, would put every drop at level 0. This is the test
  // that tells those two apart.
  const metrics = await gotoOverflowFixture(page);
  await panel(page).evaluate((el, to) => {
    el.scrollLeft = to;
  }, metrics.maxScroll);
  await expect
    .poll(() => panel(page).evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(0);

  const panelBox = (await panel(page).boundingBox())!;
  await grabChip(page, "hotel");

  // Measured AFTER the drag armed: arming inserts the drop indicator, which
  // shifts every chip after it.
  const foxtrot = (await chip(page, "foxtrot").boundingBox())!;
  const golf = (await chip(page, "golf").boundingBox())!;
  const dropX = (foxtrot.x + foxtrot.width + golf.x) / 2;
  // Clear of both autoscroll buffers, or this test would be measuring the
  // autoscroll instead and the strip would move out from under the drop.
  expect(dropX).toBeGreaterThan(panelBox.x + 48);
  expect(dropX).toBeLessThan(panelBox.x + panelBox.width - 48);

  await page.mouse.move(dropX, panelBox.y + panelBox.height / 2, { steps: 10 });
  await expect(
    panel(page).locator("[data-pretable-chip-drop-indicator]"),
  ).toHaveCount(1);
  const scrolledAtDrop = await panel(page).evaluate((el) => el.scrollLeft);
  expect(scrolledAtDrop).toBeGreaterThan(0);
  await page.mouse.up();

  // Dropped between "foxtrot" and "golf" — level 6 — not at level 0.
  await expect
    .poll(() => chipIds(page))
    .toEqual([
      "alpha",
      "bravo",
      "charlie",
      "delta",
      "echo",
      "foxtrot",
      "hotel",
      "golf",
    ]);
});

test("a chip label wider than its cap ellipses rather than clipping", async ({
  page,
}) => {
  await gotoOverflowFixture(page);

  const label = chip(page, "charlie").locator("[data-pretable-chip-label]");
  const measured = await label.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      textOverflow: style.textOverflow,
      whiteSpace: style.whiteSpace,
      overflow: style.overflowX,
    };
  });
  // The premise: this label really is too long for the chip's `max-width`.
  expect(measured.scrollWidth).toBeGreaterThan(measured.clientWidth);
  expect(measured.textOverflow).toBe("ellipsis");
  expect(measured.whiteSpace).toBe("nowrap");
  expect(measured.overflow).toBe("hidden");
});

/* -------------------------------------------------------------------------
 * The hero — the adoption itself.
 *
 * Everything above proves grouping works on a fixture built to exercise it.
 * Nothing proved it works where it actually ships, on a live streaming grid
 * whose rows arrive over seconds and whose heights change under wrapped text.
 * The hero is also the one place the derived column model has a CONSUMER
 * downstream of it — the cockpit sidebar — so the drawn-order invariant is
 * asserted here end to end rather than only inside the package.
 * ---------------------------------------------------------------------- */

test("the hero arrives ungrouped and groups when a header is dragged onto the panel", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);
  // The book streams in; grouping an empty grid would prove nothing.
  await expect
    .poll(() => page.locator("[data-pretable-row]").count(), {
      timeout: 15_000,
    })
    .toBeGreaterThan(5);

  // Ungrouped on arrival — the streaming first impression is untouched — with
  // the panel up and empty, inviting the gesture.
  await expect(panel(page)).toBeVisible();
  expect(await chipIds(page)).toEqual([]);
  await expect(page.locator("[data-pretable-group-row]")).toHaveCount(0);
  expect(await headerIds(page)).toContain("sector");

  const panelBox = (await panel(page).boundingBox())!;
  const headerBox = (await headerCell(page, "sector").boundingBox())!;
  // Same premise as the fixture's drop test: two disjoint boxes, panel above.
  expect(panelBox.height).toBeGreaterThan(8);
  expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(headerBox.y + 1);

  await grabHeader(page, "sector");
  await page.mouse.move(panelBox.x + 40, panelBox.y + panelBox.height / 2, {
    steps: 10,
  });
  await expect(panel(page)).toHaveAttribute(
    "data-pretable-group-panel-active",
    "",
  );
  await page.mouse.up();

  await expect.poll(() => chipIds(page)).toEqual(["sector"]);
  // Grouped, not reordered: the column left the header row and depth exists.
  expect(await headerIds(page)).not.toContain("sector");
  const firstGroup = groupRowAtLevel(page, 1).first();
  await expect(firstGroup).toBeVisible();
  if ((await firstGroup.getAttribute("aria-expanded")) !== "true") {
    await firstGroup.getByRole("button", { name: /^Expand / }).click();
  }
  await expect(firstGroup).toHaveAttribute("aria-expanded", "true");

  // --- and the cockpit still tells the truth about the grouped grid ---
  //
  // `summarizeSelection` resolves a selection range against a column order. A
  // whole-row range is encoded as drawn-first-id → drawn-last-id, and the drawn
  // list starts with the synthetic row-select column, which is in no prop — so
  // read against the hero's own `columns` array the range is unresolvable and
  // the panel reports nothing at all. That was already true ungrouped (⌘A and
  // the row checkboxes both went silent); grouping compounds it, since the
  // drawn list now also carries the derived group column and has dropped the
  // grouped one, so the count itself moves.
  await page
    .locator('[data-pretable-row] [data-pretable-column-id="symbol"]')
    .first()
    .click();
  await page.keyboard.press(platformShortcut("a"));

  const selection = page.getByRole("region", { name: "Selection" });
  await expect(selection).toContainText(/selected · ⌘C to copy/);
  // Every drawn column except the selector, derived from the header row rather
  // than hard-coded so adding a hero column does not silently pass.
  const drawnDataColumns =
    (await page.locator("[data-pretable-header-cell]").count()) - 1;
  expect(drawnDataColumns).toBeGreaterThan(1);
  const [rows, cols] = (await selection.innerText())
    .match(/(\d+) × (\d+) selected/)!
    .slice(1)
    .map(Number);
  expect(cols).toBe(drawnDataColumns);
  // Group headers are inside the rectangle ⌘C copies, so they count: more rows
  // than there are sectors, and more than the leaves alone.
  expect(rows).toBeGreaterThan(
    await page.locator("[data-pretable-group-row]").count(),
  );
});
