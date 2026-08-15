import { expect, test, type Page } from "@playwright/test";

/**
 * Task 4 of the windowed-data plan is a GATE, not a step: it answers whether
 * `<Pretable>` — the drop-in component, which cannot receive `onTelemetryChange`
 * because it hardcodes its own viewport — can offer useful windowing on
 * `resultMeta.window` alone, with no telemetry round-trip.
 *
 * jsdom has no layout engine, so scroll geometry and rendered order are
 * vacuous there; this has to run in a real browser. The harness at
 * `/?windowed=1` mounts `PretableSurface` in its ROWS-OWNED, UNCONTROLLED
 * mode — no `model`, no `onTelemetryChange` — which is exactly the code path
 * `<Pretable>` wraps. See apps/bench/src/windowed-harness.tsx for the full
 * rationale.
 *
 * Dataset: 10,000 rows total, 50 loaded (`PAGE_SIZE`) at a time, 48px row
 * height (apps/bench/src/app.css pins `--pretable-row-height`). A window at
 * dataset offset 5,000 is the fixture throughout, so "loaded index" and
 * "dataset index" are never accidentally equal.
 */

const ROW_HEIGHT = 48;
const TOTAL_ROWS = 10_000;
const PAGE_SIZE = 50;
const WINDOW_START = 5_000;

async function readGeometry(page: Page) {
  return page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>(
      "[data-pretable-scroll-viewport]",
    );
    const content = document.querySelector<HTMLElement>(
      "[data-pretable-scroll-content]",
    );
    const rows = [
      ...document.querySelectorAll<HTMLElement>("[data-pretable-row]"),
    ];
    const firstRow = rows[0] ?? null;
    return {
      scrollHeight: viewport?.scrollHeight ?? null,
      contentHeight: content ? parseFloat(content.style.height) : null,
      ariaRowCount: viewport?.getAttribute("aria-rowcount") ?? null,
      firstRowAriaRowIndex: firstRow?.getAttribute("aria-rowindex") ?? null,
      firstRowText: firstRow?.textContent ?? null,
      // Every rendered row's text (the dataset-index value cell), in DOM
      // order — used to check WHICH rows are mounted, not just the first,
      // since overscan (default 6) keeps rows above the fold mounted for
      // small scroll deltas.
      renderedValues: rows.map((row) => row.textContent),
      rowCount: rows.length,
    };
  });
}

/**
 * The GLOBAL offset of local row `localRow` in a window drawn at `windowStart`.
 *
 * The leading spacer is `windowStart` unloaded rows tall, each drawn at the
 * theme row height, so the loaded window begins `windowStart * 48` px down a
 * scroller whose extent spans the whole dataset. `scrollTop = 0` is over the
 * spacer and correctly blank; these are the positions where the rows are.
 */
function globalRowOffset(windowStart: number, localRow: number): number {
  return (windowStart + localRow) * ROW_HEIGHT;
}

/**
 * Not row 0. Parking at the window's very first row is the one position a
 * clamp against the LOADED height happens to get right by accident — it pins
 * every request to the top of the window, which is where the viewport already
 * is. 20 rows in, that clamp shows the window's first rows instead of the ones
 * scrolled to, so the assertions below can see it.
 */
const PARK_LOCAL_ROW = 20;

/**
 * Park the scroll viewport and wait until the row placement stops moving.
 *
 * Two polls with an identical set of `style.top` values, because the layout
 * controller converges over several passes as rows report measured heights;
 * sampling in between reads a half-built plan. Same rule as `parkAt` in
 * eviction.spec.ts.
 */
async function parkAtGlobal(page: Page, scrollTop: number) {
  await page.locator("[data-pretable-scroll-viewport]").evaluate((el, top) => {
    el.scrollTop = top;
  }, scrollTop);
  await page.waitForFunction(() => {
    const store = window as { __pretableWindowTops?: string };
    const key = [
      ...document.querySelectorAll<HTMLElement>("[data-pretable-row]"),
    ]
      .map((row) => row.style.top)
      .join("|");
    const settled = key.length > 0 && store.__pretableWindowTops === key;
    store.__pretableWindowTops = key;
    return settled;
  });
}

/**
 * GEOMETRY, not DOM visibility.
 *
 * `toBeVisible()` means "not `display:none`, non-zero box". It is true of a row
 * sitting 240,000px below the fold, which is exactly how this defect shipped
 * past the assertions above. The only question that catches it is whether the
 * row's client rect INTERSECTS the scroll viewport's client rect.
 */
async function readViewportIntersection(page: Page) {
  return page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>(
      "[data-pretable-scroll-viewport]",
    );
    if (viewport === null) return null;
    const viewportRect = viewport.getBoundingClientRect();
    const rows = [
      ...document.querySelectorAll<HTMLElement>("[data-pretable-row]"),
    ];
    const intersecting = rows.filter((row) => {
      const rect = row.getBoundingClientRect();
      return rect.bottom > viewportRect.top && rect.top < viewportRect.bottom;
    });
    return {
      scrollTop: viewport.scrollTop,
      viewport: { top: viewportRect.top, bottom: viewportRect.bottom },
      mountedRowCount: rows.length,
      intersectingRowCount: intersecting.length,
      intersectingValues: intersecting.map((row) => row.textContent),
      // Diagnostic only — the first three mounted rows, wherever they landed.
      firstRowRects: rows.slice(0, 3).map((row) => {
        const rect = row.getBoundingClientRect();
        return { styleTop: row.style.top, top: rect.top, bottom: rect.bottom };
      }),
    };
  });
}

test.describe("a windowed grid at a nonzero offset is actually on screen", () => {
  /**
   * The defect: at a nonzero window offset the grid draws its rows in GLOBAL
   * (spacer-inclusive) coordinates while the controller keeps its `scrollTop`
   * LOCAL to the loaded window, so no scroll position lines the two up and the
   * grid paints blank. Telemetry reports the same failure from the other side:
   * `visibleRowCount` is 0 because no drawn row's band overlaps the viewport's.
   *
   * Both assertions are soft and share one cause; they must go green together.
   */
  test("rows intersect the viewport, and telemetry counts them", async ({
    page,
  }) => {
    await page.goto(`/?windowed=1&windowStart=${WINDOW_START}&telemetry=1`);
    await expect(page.locator("[data-pretable-row]").first()).toBeAttached();

    await parkAtGlobal(page, globalRowOffset(WINDOW_START, PARK_LOCAL_ROW));

    const geometry = await readViewportIntersection(page);
    const telemetry = await page.evaluate(
      () => window.__pretableWindowedHarness?.lastTelemetry() ?? null,
    );

    expect
      .soft(
        geometry?.intersectingRowCount ?? 0,
        `rows whose client rect intersects the scroll viewport (${JSON.stringify(geometry)})`,
      )
      .toBeGreaterThan(0);
    // Reachability: not merely SOME row on screen, but the one the viewport
    // was scrolled to. A clamp against the loaded window's own height draws
    // the window's first rows at every offset, which satisfies the assertion
    // above at the window's top edge and fails here.
    expect
      .soft(
        geometry?.intersectingValues ?? [],
        `the row scrolled to is the row on screen (${JSON.stringify(geometry)})`,
      )
      .toContain(String(WINDOW_START + PARK_LOCAL_ROW));
    expect
      .soft(
        telemetry?.visibleRowCount ?? 0,
        `telemetry visibleRowCount (${JSON.stringify(telemetry)})`,
      )
      .toBeGreaterThan(0);
  });

  /**
   * The control. `windowStart = 0` is the case that already worked — local and
   * global coincide there — so this passes before and after the fix, and its
   * job is to show that the test above is about the OFFSET rather than about
   * windowing in general. Without it, a fix that broke windowing outright would
   * look indistinguishable from a fix that worked.
   */
  test("windowStart = 0 is unchanged", async ({ page }) => {
    await page.goto("/?windowed=1&windowStart=0&telemetry=1");
    await expect(page.locator("[data-pretable-row]").first()).toBeAttached();

    await parkAtGlobal(page, globalRowOffset(0, PARK_LOCAL_ROW));

    const geometry = await readViewportIntersection(page);
    const telemetry = await page.evaluate(
      () => window.__pretableWindowedHarness?.lastTelemetry() ?? null,
    );

    expect
      .soft(
        geometry?.intersectingRowCount ?? 0,
        `rows whose client rect intersects the scroll viewport (${JSON.stringify(geometry)})`,
      )
      .toBeGreaterThan(0);
    expect
      .soft(
        geometry?.intersectingValues ?? [],
        `the row scrolled to is the row on screen (${JSON.stringify(geometry)})`,
      )
      .toContain(String(PARK_LOCAL_ROW));
    expect
      .soft(
        telemetry?.visibleRowCount ?? 0,
        `telemetry visibleRowCount (${JSON.stringify(telemetry)})`,
      )
      .toBeGreaterThan(0);
  });
});

test.describe("windowed positioning without telemetry", () => {
  test("extent, position, scrolling, and the pager gesture", async ({
    page,
  }) => {
    await page.goto(`/?windowed=1&windowStart=${WINDOW_START}`);

    const viewport = page.locator("[data-pretable-scroll-viewport]");
    await expect(viewport).toBeVisible();
    await expect(page.locator("[data-pretable-row]").first()).toBeVisible();

    // 1. EXTENT — the scroll viewport's scrollHeight should span the whole
    // 10,000-row dataset, not just the 50 loaded rows. Loaded-only would be
    // ~50 * 48 = 2,400px; the whole dataset is ~10,000 * 48 = 480,000px. The
    // two are off by two orders of magnitude, so there is no ambiguity about
    // which one the browser is actually showing.
    const beforeGeometry = await readGeometry(page);
    const expectedFullExtent = TOTAL_ROWS * ROW_HEIGHT;
    const loadedOnlyExtent = PAGE_SIZE * ROW_HEIGHT;

    // 2. POSITION — aria-rowindex on the first drawn row should report the
    // DATASET position (5,000 + local 0 + 2 for the header/1-based offset =
    // 5,002), not the local position (2).
    const expectedFirstRowIndex = String(WINDOW_START + 2);

    // 3. SCROLLING — scrolling within the loaded window should resolve rows
    // whose values match their dataset index, proving virtualization is
    // reading the right slice as the user scrolls inside the window. 30 rows
    // (not 5) so the scroll clears the default overscan of 6 — otherwise the
    // very first row stays mounted for a small delta and the check is vacuous.
    //
    // The offset is GLOBAL — the leading spacer plus 30 rows — because that is
    // the only space the scroller has ever had. This used to read `30 * 48`,
    // which is local to the loaded window; it passed only because the layout
    // controller reinterpreted the scroller's offset as local too, and that
    // disagreement is exactly what drew the grid off screen. At `30 * 48` the
    // viewport is now genuinely 4,970 rows above the window, in the spacer, so
    // the loaded rows correctly stay parked at local 0.
    await viewport.evaluate(
      (el, top) => {
        el.scrollTop = top;
      },
      (WINDOW_START + 30) * ROW_HEIGHT,
    );
    await page.waitForTimeout(50);
    const afterScrollGeometry = await readGeometry(page);

    // 4. THE PAGER GESTURE — change window.start and swap rows, with NO
    // telemetry wiring in this harness at all (window.__pretableWindowedHarness
    // is a plain setState call). Verify the grid repositions correctly.
    //
    // Reset scrollTop to 0 first, the way a real pager's Next/Prev control
    // would when it moves to a new page — this isolates "does the pager
    // gesture itself reposition correctly" from "did step 3's leftover scroll
    // offset get reinterpreted against the new window's local coordinates",
    // which is a second, real gap this harness surfaced (see report): with no
    // spacer geometry, nothing reconciles a stale scrollTop against a new
    // window at all, and a naive pager swap without this reset lands on the
    // wrong row.
    await viewport.evaluate((el) => {
      el.scrollTop = 0;
    });
    const NEXT_WINDOW_START = 6_000;
    await page.evaluate((start) => {
      window.__pretableWindowedHarness?.setWindowStart(start);
    }, NEXT_WINDOW_START);
    await page.waitForTimeout(50);
    const afterPagerGeometry = await readGeometry(page);

    // ---- Assertions, all as SOFT so one run reports the whole picture rather
    // than stopping at the first red one. ----

    // 1. Extent.
    expect
      .soft(beforeGeometry.scrollHeight, "1. extent: scrollHeight")
      .toBeGreaterThan(loadedOnlyExtent * 5);
    expect
      .soft(beforeGeometry.scrollHeight, "1. extent: scrollHeight")
      .toBeCloseTo(expectedFullExtent, -3);

    // 2. Position.
    expect
      .soft(
        beforeGeometry.firstRowAriaRowIndex,
        "2. position: first row aria-rowindex",
      )
      .toBe(expectedFirstRowIndex);

    // 3. Scrolling within the window: after scrolling 30 rows down (past
    // overscan), dataset row 5030 — the window's local row 30 — should now be
    // mounted, and dataset row 5000 — local row 0, the very first — should no
    // longer be, since it is now 30 rows above the overscan boundary.
    expect
      .soft(afterScrollGeometry.rowCount, "3. scrolling: rows still rendered")
      .toBeGreaterThan(0);
    expect
      .soft(
        afterScrollGeometry.renderedValues,
        "3. scrolling: resolves the row scrolled down to",
      )
      .toContain(String(WINDOW_START + 30));
    expect
      .soft(
        afterScrollGeometry.renderedValues,
        "3. scrolling: unmounts the row scrolled past",
      )
      .not.toContain(String(WINDOW_START));

    // 4. The pager gesture — no telemetry wiring exists in this harness.
    expect
      .soft(
        afterPagerGeometry.firstRowAriaRowIndex,
        "4. pager: aria-rowindex reflects the new window",
      )
      .toBe(String(NEXT_WINDOW_START + 2));
    expect
      .soft(
        afterPagerGeometry.scrollHeight,
        "4. pager: extent still spans the dataset after repositioning",
      )
      .toBeCloseTo(expectedFullExtent, -3);
  });

  test("mutation check: removing resultMeta.window reddens the positioning assertions", async ({
    page,
  }) => {
    await page.goto(`/?windowed=1&windowStart=${WINDOW_START}&windowMeta=0`);
    await expect(page.locator("[data-pretable-row]").first()).toBeVisible();

    const geometry = await readGeometry(page);

    // Without resultMeta.window, aria-rowindex has nothing to offset by and
    // falls back to the local (1-based, +1 header) index — "2" for the first
    // loaded row — never "5002". This is the redenning this task's report
    // has to show verbatim.
    expect(geometry.firstRowAriaRowIndex).not.toBe(String(WINDOW_START + 2));
  });
});
