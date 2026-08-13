import { test } from "@playwright/test";

import { columnSelectors, waitForGridReady } from "./helpers";

/**
 * TEMPORARY diagnostic. Delete once answered.
 *
 * After the capture-phase fix, Linux WebKit selects EIGHT cells during the
 * marquee drag (it selected one before), yet `range-selection.spec.ts` still
 * fails asserting `r1/qty`. Both specs drive a byte-identical drag. A
 * count-based check passing while an identity-based check fails means the
 * rectangle is landing somewhere other than where it should.
 *
 * This reports WHICH cells are selected, and the geometry it dragged between,
 * so the offset can be read off directly rather than inferred.
 */

const FIXTURE = "/fixtures/range-selection";

test("DIAGNOSTIC: which cells does the marquee actually select", async ({
  page,
}, testInfo) => {
  await page.goto(FIXTURE, { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);

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

  // What actually ended up selected, by address.
  const selected = await page.evaluate(() =>
    [...document.querySelectorAll('[data-pretable-selected="true"]')].map(
      (el) => {
        const row = el.closest("[data-pretable-row-id]");
        return `${row?.getAttribute("data-pretable-row-id") ?? "?"}/${el.getAttribute("data-pretable-column-id") ?? "?"}`;
      },
    ),
  );

  // Where the pointer actually was, and what sits under those points — if the
  // fixture lays out differently on this engine, the drag targets different
  // cells than the test names.
  const under = await page.evaluate(
    ([f, t]) => {
      const at = (x: number, y: number) => {
        const el = document
          .elementFromPoint(x, y)
          ?.closest("[data-pretable-cell]");
        if (!el) return "-";
        const row = el.closest("[data-pretable-row-id]");
        return `${row?.getAttribute("data-pretable-row-id") ?? "?"}/${el.getAttribute("data-pretable-column-id") ?? "?"}`;
      };
      return { fromCell: at(f.x, f.y), toCell: at(t.x, t.y) };
    },
    [from, to] as const,
  );

  const summary = [
    `project=${testInfo.project.name}`,
    `dragFrom=(${Math.round(from.x)},${Math.round(from.y)}) resolves to ${under.fromCell} (named r1/name)`,
    `dragTo=(${Math.round(to.x)},${Math.round(to.y)}) resolves to ${under.toCell} (named r4/qty)`,
    `selectedCount=${selected.length}`,
    `selected=${JSON.stringify(selected.sort())}`,
    `expected=["r1/name","r1/qty","r2/name","r2/qty","r3/name","r3/qty","r4/name","r4/qty"]`,
  ].join("\n");

  await testInfo.attach("marquee-cells", { body: summary });
  throw new Error(`MARQUEE CELLS (not a real failure)\n${summary}`);
});
