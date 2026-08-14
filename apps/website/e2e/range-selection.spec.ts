import { expect, test } from "@playwright/test";

import { columnSelectors, waitForGridReady } from "./helpers";

/**
 * Marquee cell-range drag, driven with real pointer events.
 *
 * This is the one claim `packages/react/src/__tests__/row-activation.test.tsx`
 * cannot make: that the range resolves correctly under a real browser's own
 * hit-testing and layout, across actual screen coordinates. The drag itself
 * does not use `setPointerCapture` — the anchor cell's `pointerdown` attaches
 * `pointermove`/`pointerup` listeners to `window` instead, so the drag still
 * ends correctly even when the pointer is released outside the grid (see
 * `packages/react/src/marquee-drag.ts` for the two capture-based designs this
 * replaced and why both failed). jsdom can exercise that wiring with
 * synthetic events, but has no layout engine to prove the resolved cell is
 * the one actually under the cursor — hence `page.mouse` here rather than
 * any synthetic event.
 *
 * This spec is also the only reproduction available for the CI-specific
 * failure two earlier fixes hit: CI's Linux WebKit selected only the anchor
 * cell while Chromium (CI and local) and local WebKit (macOS) all passed. A
 * local WebKit pass on this spec is necessary but not sufficient evidence —
 * it did not reproduce the failure before either fix and does not reproduce
 * it now, so it cannot confirm this redesign fixed it either.
 */

const FIXTURE = "/fixtures/range-selection";

/** The bounding-box center of a data cell, addressed by (rowId, columnId). */
async function cellCenter(
  page: import("@playwright/test").Page,
  rowId: string,
  columnId: string,
) {
  const cell = page.locator(columnSelectors(columnId, rowId).cell);
  const box = await cell.boundingBox();
  if (!box) throw new Error(`no box for ${rowId}/${columnId}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function isSelected(
  page: import("@playwright/test").Page,
  rowId: string,
  columnId: string,
) {
  return page.locator(columnSelectors(columnId, rowId).cell);
}

test("dragging from one cell to another selects every cell in the rectangle between them", async ({
  page,
}) => {
  await page.goto(FIXTURE, { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);

  const from = await cellCenter(page, "r1", "name");
  const to = await cellCenter(page, "r4", "qty");

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Stepped moves rather than one jump straight to the target — the same
  // reason `dragResizeHandle` in helpers.ts steps its move — so each
  // intermediate position dispatches its own pointermove, the way a real
  // drag gesture does, rather than a single move a browser might otherwise
  // collapse or fail to recognize as a drag at all.
  await page.mouse.move(
    from.x + (to.x - from.x) / 2,
    from.y + (to.y - from.y) / 2,
    { steps: 6 },
  );
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();

  // The rectangle between (r1, name) and (r4, qty): rows r1..r4, columns
  // name and qty (status is the third column and sits outside it).
  const inRange: [string, string][] = [
    ["r1", "name"],
    ["r1", "qty"],
    ["r2", "name"],
    ["r2", "qty"],
    ["r3", "name"],
    ["r3", "qty"],
    ["r4", "name"],
    ["r4", "qty"],
  ];
  for (const [rowId, columnId] of inRange) {
    await expect(
      isSelected(page, rowId, columnId),
      `${rowId}/${columnId} should be selected`,
    ).toHaveAttribute("data-pretable-selected", "true");
  }

  const outOfRange: [string, string][] = [
    ["r1", "status"],
    ["r4", "status"],
    ["r5", "name"],
    ["r5", "qty"],
  ];
  for (const [rowId, columnId] of outOfRange) {
    await expect(
      isSelected(page, rowId, columnId),
      `${rowId}/${columnId} should NOT be selected`,
    ).toHaveAttribute("data-pretable-selected", "false");
  }

  // Pins the whole rectangle, not just the sampled corners and neighbors
  // above: exactly 8 cells selected (4 rows x 2 columns), no more, no less.
  await expect(page.locator('[data-pretable-selected="true"]')).toHaveCount(
    inRange.length,
  );
});
