import { test } from "@playwright/test";

import { columnSelectors, waitForGridReady } from "./helpers";

/**
 * TEMPORARY diagnostic. Not an assertion — it always passes and prints (by
 * throwing; Playwright's reporter buffers console output and it does not
 * reach `gh run view --log-failed`, so a thrown error is the only channel
 * proven to surface here — see commit 06f5c7fb).
 *
 * Every previous diagnostic in this investigation (see PR #362's pinned
 * comment) read `event.target` from its own probe listener, which always
 * resolved correctly on both engines. What has never been observed is the
 * *production* handler's own read — `onPointerDown` in
 * `packages/react/src/pretable-surface.tsx` now pushes to
 * `window.__pretableMarqueeDebug` from inside `handleWindowPointerMove` and
 * `resolveHover` themselves (see `pushMarqueeDebug` in that file). This spec
 * just drains that array and reports it.
 *
 * Delete this file, and every `pushMarqueeDebug` call site plus the function
 * itself in pretable-surface.tsx, once the divergence is found.
 */

const FIXTURE = "/fixtures/range-selection";

test("DIAGNOSTIC: what the production marquee handler itself observes", async ({
  page,
}, testInfo) => {
  await page.goto(FIXTURE, { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);

  await page.evaluate(() => {
    (
      window as unknown as { __pretableMarqueeDebug: unknown[] }
    ).__pretableMarqueeDebug = [];
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

  const log = await page.evaluate(
    () =>
      (window as unknown as { __pretableMarqueeDebug: unknown[] })
        .__pretableMarqueeDebug,
  );
  const selected = await page
    .locator('[data-pretable-selected="true"]')
    .count();

  const counts = log.reduce<Record<string, number>>((acc, entry) => {
    const step = (entry as { step: string }).step;
    acc[step] = (acc[step] ?? 0) + 1;
    return acc;
  }, {});

  const summary = [
    `project=${testInfo.project.name}`,
    `selectedCount=${selected} (expected 8)`,
    `stepCounts=${JSON.stringify(counts)}`,
    `entries=${log.length}`,
    ...log.map((entry, i) => `  [${i}] ${JSON.stringify(entry)}`),
  ].join("\n");

  await testInfo.attach("marquee-production-debug", { body: summary });
  throw new Error(`MARQUEE PRODUCTION DEBUG (not a real failure)\n${summary}`);
});
