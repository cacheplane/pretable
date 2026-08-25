import { expect, test, type Locator, type Page } from "@playwright/test";

import { waitForGridReady, waitForStablePosition } from "./helpers";

/**
 * The tool panel's columns section, driven with a real pointer and a real
 * keyboard — the halves jsdom cannot express. The insertion-index math
 * itself is unit-tested (`tool-panel-drop-target.test.ts`); what this file
 * proves is that the measured DOM the handlers feed it, the engine commits
 * on drop, and the panel's tab order all behave on a live page.
 *
 * Target: the keyboard-navigation example on /docs/grid/keyboard. Its grid
 * ships the tool panel default-on with an UNCONTROLLED column layout (the
 * column-layout example controls `columnOrder`/`columnPinned`, which would
 * re-impose the prop state over the panel's engine writes), and it declares
 * ID pinned left + Status pinned right — so both pinned subgroups render,
 * which is what makes cross-boundary drops reachable.
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

  // Park focus before the grid (the example figure's own Preview tab), then
  // Tab forward: the walk must REACH the rail — through the grid, which is
  // its own bounded set of stops — and reach it as ONE stop.
  const previewTab = page
    .locator("figure")
    .first()
    .getByRole("tab", { name: "Preview" });
  await previewTab.focus();

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

  // Arrows move within the rail without leaving it (SP1 ships one section,
  // so the move wraps onto itself — the invariant is "still on a rail tab").
  await page.keyboard.press("ArrowDown");
  expect(
    await page.evaluate(() =>
      document.activeElement?.hasAttribute("data-pretable-tool-tab"),
    ),
  ).toBe(true);

  // Enter opens the pane.
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
