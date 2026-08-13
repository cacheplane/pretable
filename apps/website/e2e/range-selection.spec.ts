import { expect, test } from "@playwright/test";

import { columnSelectors, waitForGridReady } from "./helpers";

/**
 * Marquee cell-range drag, driven with real pointer events.
 *
 * This is the one claim `packages/react/src/__tests__/row-activation.test.tsx`
 * cannot make. The anchor cell calls `setPointerCapture` on `pointerdown` so a
 * drag that ends outside the grid still delivers `pointerup` — but per the
 * Pointer Events spec, capture retargets every SUBSEQUENT pointer event to the
 * capturing element, regardless of where the cursor physically is. jsdom does
 * not implement that retargeting at all, so a jsdom test that fires
 * `pointerEnter` directly on a target cell is proving a code path a real
 * drag can never take. `PretableSurface` resolves the hovered cell off
 * `pointermove` + `document.elementFromPoint` instead (see
 * `packages/react/src/marquee-drag.ts`), and only a real browser's actual
 * capture retargeting can prove that resolution works — hence `page.mouse`
 * here rather than any synthetic event.
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
  // WebKit only engages pointer capture once the pointer traverses
  // intermediate positions (the same reason `dragResizeHandle` in helpers.ts
  // steps its move rather than jumping straight to the target).
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
