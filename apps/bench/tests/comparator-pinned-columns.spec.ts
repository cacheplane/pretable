import { expect, test, type Page } from "@playwright/test";

/**
 * The unit tests for this behaviour assert a colDef field (ag-grid) or an
 * inline `position: sticky` (tanstack). Both are DOM facts that jsdom can see,
 * and neither can tell you the cell actually stayed put — jsdom has no layout
 * engine, so `getBoundingClientRect()` returns zeros and nothing scrolls.
 *
 * Pinning is a layout fact. This is the proof, in real Chromium: scroll the
 * grid horizontally and assert that the pinned column's cell holds its
 * viewport x while an unpinned cell moves left by the scroll distance.
 *
 * Both directions, per adapter:
 *
 *  - S2 (`pinned_left: 1`) → the first column holds station, a later one does
 *    not, and the pinned one is still the one it claims to be (its text is
 *    unchanged, so the cell did not get recycled into a different column);
 *  - S1 (`pinned_left: 0`) → nothing is sticky, so pinning cannot have leaked
 *    into the scenarios whose baselines assume no pinned zone.
 *
 * MUI is absent on purpose. Column pinning is an MUI X Pro feature and the
 * matrix runs Community; see the comment on `toColDef` in `mui-adapter.tsx`.
 * Asserting it here would either fail forever or drive a hand-rolled sticky
 * implementation that measures our CSS instead of MUI's.
 */

const SCROLL_BY = 300;

interface CellProbe {
  x: number;
  text: string;
}

/**
 * The horizontally scrolling element differs per adapter, so each case names
 * its own. `scrollLeft` is set on that element rather than by wheel events,
 * because a wheel over a grid that also virtualizes vertically is not a
 * reliable way to move only one axis.
 */
interface AdapterCase {
  id: string;
  scenarioWithPinning: string;
  scroller: string;
  /** Resolves a cell in a given column, first row, to its rect and text. */
  cell: (columnId: string) => string;
  /** Every element the adapter would make sticky, for the negative arm. */
  stickyProbe: string;
}

const CASES: readonly AdapterCase[] = [
  {
    id: "ag-grid",
    scenarioWithPinning: "S2",
    scroller: ".ag-body-horizontal-scroll-viewport, .ag-center-cols-viewport",
    cell: (columnId) => `.ag-cell[col-id="${columnId}"]`,
    stickyProbe: ".ag-grid-pinned-left-cells .ag-cell",
  },
  {
    id: "tanstack",
    scenarioWithPinning: "S2",
    scroller: "[data-pretable-bench-tanstack-viewport]",
    cell: (columnId) => `[data-tanstack-cell][data-column-id="${columnId}"]`,
    stickyProbe: "[data-tanstack-cell][style*='sticky']",
  },
];

async function probeCell(
  page: Page,
  selector: string,
): Promise<CellProbe | null> {
  return page.evaluate((sel) => {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.x, text: (el.textContent ?? "").trim() };
  }, selector);
}

async function scrollHorizontallyBy(
  page: Page,
  scroller: string,
  by: number,
): Promise<number> {
  return page.evaluate(
    ({ sel, delta }) => {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) return 0;
      const before = el.scrollLeft;
      el.scrollLeft = before + delta;
      return el.scrollLeft - before;
    },
    { sel: scroller, delta: by },
  );
}

for (const adapter of CASES) {
  test(`${adapter.id}: a pinned column holds its position while the rest scroll`, async ({
    page,
  }) => {
    await page.goto(
      `/?adapter=${adapter.id}&scenario=${adapter.scenarioWithPinning}&scale=dev`,
    );

    const pinned = adapter.cell("col_0");
    const scrolling = adapter.cell("col_5");
    await page.waitForSelector(pinned);
    await page.waitForSelector(scrolling);

    const pinnedBefore = await probeCell(page, pinned);
    const scrollingBefore = await probeCell(page, scrolling);
    expect(pinnedBefore).not.toBeNull();
    expect(scrollingBefore).not.toBeNull();

    const moved = await scrollHorizontallyBy(page, adapter.scroller, SCROLL_BY);
    // If nothing scrolled, the assertions below would pass vacuously — a
    // pinned cell that "did not move" in a grid that did not move either.
    expect(moved).toBeGreaterThan(0);
    await page.waitForTimeout(100);

    const pinnedAfter = await probeCell(page, pinned);
    const scrollingAfter = await probeCell(page, scrolling);
    expect(pinnedAfter).not.toBeNull();
    expect(scrollingAfter).not.toBeNull();

    // The pinned cell holds station, and is still the same cell: a virtualizing
    // grid can recycle a node into a different column, which would look like
    // "did not move" while showing different data.
    expect(Math.abs(pinnedAfter!.x - pinnedBefore!.x)).toBeLessThanOrEqual(1);
    expect(pinnedAfter!.text).toBe(pinnedBefore!.text);

    // ...and the unpinned one moved left by what the scroller actually moved.
    expect(scrollingBefore!.x - scrollingAfter!.x).toBeGreaterThanOrEqual(
      moved - 1,
    );
  });

  test(`${adapter.id}: a scenario that pins nothing has no pinned zone`, async ({
    page,
  }) => {
    // S1 is `pinned_left: 0`. This is the arm that catches pinning applied
    // unconditionally, which would silently move every S1/S4/S5/S6 baseline.
    await page.goto(`/?adapter=${adapter.id}&scenario=S1&scale=dev`);
    await page.waitForSelector(adapter.cell("col_0"));

    expect(await page.locator(adapter.stickyProbe).count()).toBe(0);
  });
}
