import { test } from "@playwright/test";

import { columnSelectors, waitForGridReady } from "./helpers";

/**
 * TEMPORARY diagnostic. Delete once answered.
 *
 * Established so far on Linux WebKit: the drag endpoints resolve to the right
 * cells, `pointermove` events arrive (19, with correctly advancing targets),
 * and the production handler — now capture-phase, same as this probe — still
 * extends nothing. Events reach the page; the handler rejects them.
 *
 * The handler guards every window event with
 * `if (moveEvent.pointerId !== pointerId) return`, where `pointerId` is
 * captured from the originating `pointerdown`. If WebKit issues a different
 * id for moves than for the down that started the gesture, every move is
 * silently discarded — which would look exactly like this, on one engine only.
 *
 * This replicates that guard and reports whether it holds.
 */

const FIXTURE = "/fixtures/range-selection";

test("DIAGNOSTIC: does the pointerId guard hold during a drag", async ({
  page,
}, testInfo) => {
  await page.goto(FIXTURE, { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);

  await page.evaluate(() => {
    const w = window as unknown as {
      __ids: { down: number | null; moves: number[]; types: string[] };
    };
    w.__ids = { down: null, moves: [], types: [] };
    window.addEventListener(
      "pointerdown",
      (e) => {
        if (w.__ids.down === null) w.__ids.down = e.pointerId;
        w.__ids.types.push(`down:${e.pointerType}:primary=${e.isPrimary}`);
      },
      true,
    );
    window.addEventListener(
      "pointermove",
      (e) => {
        if (w.__ids.moves.length < 30) w.__ids.moves.push(e.pointerId);
        if (w.__ids.types.length < 6)
          w.__ids.types.push(`move:${e.pointerType}:primary=${e.isPrimary}`);
      },
      true,
    );
  });

  const center = async (rowId: string, columnId: string) => {
    const box = await page
      .locator(columnSelectors(columnId, rowId).cell)
      .boundingBox();
    if (!box) throw new Error(`no box for ${rowId}/${columnId}`);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };

  const from = await center("r1", "name");
  const to = await center("r4", "qty");

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(
    from.x + (to.x - from.x) / 2,
    from.y + (to.y - from.y) / 2,
    { steps: 6 },
  );
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();

  const ids = await page.evaluate(
    () =>
      (
        window as unknown as {
          __ids: { down: number | null; moves: number[]; types: string[] };
        }
      ).__ids,
  );
  const selected = await page
    .locator('[data-pretable-selected="true"]')
    .count();

  // The guard the production handler applies, evaluated against what arrived.
  const afterDown = ids.moves.slice(1); // moves during the drag, not the pre-move
  const matching = afterDown.filter((id) => id === ids.down).length;

  const summary = [
    `project=${testInfo.project.name}`,
    `selectedCount=${selected} (expected 8)`,
    `downPointerId=${ids.down}`,
    `movePointerIds=${JSON.stringify([...new Set(ids.moves)])}`,
    `movesDuringDrag=${afterDown.length} matchingDownId=${matching}`,
    `GUARD_WOULD_DISCARD=${afterDown.length - matching} of ${afterDown.length}`,
    `pointerTypes=${JSON.stringify(ids.types)}`,
  ].join("\n");

  await testInfo.attach("marquee-pointerid", { body: summary });
  throw new Error(`MARQUEE POINTERID (not a real failure)\n${summary}`);
});
