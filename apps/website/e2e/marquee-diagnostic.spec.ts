import { test } from "@playwright/test";

import { columnSelectors, waitForGridReady } from "./helpers";

/**
 * TEMPORARY diagnostic. Not an assertion — it always passes and prints.
 *
 * Three different marquee-drag mechanisms (pointerenter, elementFromPoint,
 * window listeners) have failed identically on CI's Linux WebKit while passing
 * on Chromium and on macOS WebKit, which cannot reproduce the failure at all.
 * Since the anchor cell DOES select (the r1/name assertion passes; r1/qty is
 * the first failure), pointerdown works and only extension does not.
 *
 * That fork is what this measures: does Linux WebKit deliver `pointermove` to
 * `window` during a Playwright-driven drag at all, or only compatibility mouse
 * events? Every mechanism tried so far depends on pointermove existing.
 *
 * Delete this file once the answer is known.
 */

const FIXTURE = "/fixtures/range-selection";

test("DIAGNOSTIC: which events arrive during a marquee drag", async ({
  page,
}, testInfo) => {
  await page.goto(FIXTURE, { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);

  await page.evaluate(() => {
    const w = window as unknown as { __log: string[] };
    w.__log = [];
    const cell = (t: EventTarget | null) => {
      const el =
        t instanceof Element ? t.closest("[data-pretable-cell]") : null;
      if (!el) return "-";
      const row = el.closest("[data-pretable-row-id]");
      return `${row?.getAttribute("data-pretable-row-id") ?? "?"}/${el.getAttribute("data-pretable-column-id") ?? "?"}`;
    };
    for (const type of [
      "pointerdown",
      "pointermove",
      "pointerup",
      "mousedown",
      "mousemove",
      "mouseup",
      "gotpointercapture",
      "lostpointercapture",
      "selectstart",
      "dragstart",
    ]) {
      window.addEventListener(
        type,
        (e) => {
          if (w.__log.length > 60) return;
          w.__log.push(`${type} target=${cell(e.target)}`);
        },
        true,
      );
    }
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
    () => (window as unknown as { __log: string[] }).__log,
  );
  const counts = log.reduce<Record<string, number>>((acc, line) => {
    const type = line.split(" ")[0];
    acc[type] = (acc[type] ?? 0) + 1;
    return acc;
  }, {});

  const selected = await page
    .locator('[data-pretable-selected="true"]')
    .count();

  const summary = [
    `project=${testInfo.project.name}`,
    `from=r1/name (${Math.round(from.x)},${Math.round(from.y)}) to=r4/qty (${Math.round(to.x)},${Math.round(to.y)})`,
    `selectedCells=${selected} (expected 8)`,
    `counts=${JSON.stringify(counts)}`,
    `trace:`,
    ...log.slice(0, 40).map((l) => `  ${l}`),
  ].join("\n");

  await testInfo.attach("marquee-diagnostic", { body: summary });

  // Deliberately thrown, not logged. Playwright's reporter buffers a test's
  // console output, and on CI that buffer did not reach the job log — so the
  // first run of this diagnostic produced nothing readable. A thrown error is
  // the one channel guaranteed to appear in `gh run view --log-failed`. The
  // suite is already red on the real assertion, so this costs no signal.
  throw new Error(`MARQUEE DIAGNOSTIC (not a real failure)\n${summary}`);
});
