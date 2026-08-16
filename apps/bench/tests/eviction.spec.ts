import { expect, test, type Page } from "@playwright/test";

/**
 * Task 4 of the eviction plan is a GATE, not a step: it answers whether a
 * selection actually survives its rows being released, in a real browser, all
 * the way to the pixel. The engine can retain a range, count it by arithmetic
 * over dataset spans and answer containment without loading a row — and none
 * of that is worth anything if `PretableSurface` still resolves a range by
 * looking its endpoints up in the loaded snapshot.
 *
 * jsdom cannot answer it. There is no layout engine there, so which rows are
 * mounted is not a question it has an opinion about, and "the selection
 * painted" degenerates into "the memo returned true".
 *
 * **This drives the CELL-RANGE slice — click and shift-click — on purpose.**
 * `rowSelectionColumn` checkboxes drive a *separate* sparse row-selection
 * program that never resolved endpoints and was already eviction-independent;
 * a gate written against checkbox ticks would pass whether or not any of this
 * shipped. Every assertion below reads `data-pretable-selected` off a CELL.
 *
 * Fixture: 10,000 rows total, 50 loaded at a time, 48px rows
 * (`apps/bench/src/app.css` pins `--pretable-row-height`), window at dataset
 * offset 5,000 — so a loaded index and a dataset index can never be
 * accidentally equal. See `apps/bench/src/windowed-harness.tsx`.
 */

const ROW_HEIGHT = 48;
const PAGE_SIZE = 50;
const WINDOW_START = 5_000;

/** The selection under test: 11 rows, at dataset positions 5,010–5,020. */
const SELECT_FROM = 5_010;
const SELECT_TO = 5_020;
const SPAN_ROWS = SELECT_TO - SELECT_FROM + 1;

/**
 * Window offsets the test slides through, in order.
 *
 * `INCREMENTAL` is the one that matters. It clears the range's START endpoint
 * (5,010) while its END endpoint (5,020) is still loaded — the ordinary
 * sliding-window case, and the case a jump-based test cannot reach. A jump
 * that clears both endpoints at once is the easy one: it never exercises the
 * half-resolved branch, where a previous round silently collapsed an 81-row
 * selection to 1 row while still reporting itself verified.
 */
const INCREMENTAL = 5_015;
/** Clears BOTH endpoints: the whole selection is now unloaded. */
const FULLY_EVICTED = 5_030;

function cellSelector(datasetIndex: number): string {
  return `[data-pretable-row-id="row-${datasetIndex}"] [data-pretable-column-id="value"]`;
}

/**
 * What the browser is actually showing, plus what the grid says about it.
 *
 * `selectedValues` is read off CELLS, not rows: the row element carries its
 * own `data-pretable-selected`, and reading that would conflate the
 * cell-range slice with the checkbox program that also feeds it.
 */
async function readSelection(page: Page) {
  return page.evaluate(() => {
    const cells = [
      ...document.querySelectorAll<HTMLElement>(
        "[data-pretable-row] [data-pretable-column-id='value']",
      ),
    ];
    const valueOf = (cell: HTMLElement) => Number(cell.textContent);
    return {
      renderedValues: cells.map(valueOf),
      selectedValues: cells
        .filter(
          (cell) => cell.getAttribute("data-pretable-selected") === "true",
        )
        .map(valueOf),
      summary: window.__pretableWindowedHarness?.cellSelectionSummary() ?? null,
      selection: window.__pretableWindowedHarness?.lastSelection() ?? null,
    };
  });
}

/** Dataset indices in `[from, to]` that are currently mounted. */
function renderedWithin(
  renderedValues: readonly number[],
  from: number,
  to: number,
): number[] {
  return renderedValues.filter((value) => value >= from && value <= to);
}

/**
 * Park the viewport at a known offset into the loaded window, and wait for
 * `requiredRows` to be mounted and holding still.
 *
 * `localRow` names a row within the loaded window; the offset written to the
 * scroller is GLOBAL, because the scroller's extent spans the whole dataset
 * and always has. Local row `n` of a window DRAWN at dataset offset `d` is
 * therefore `(d + n) * 48`, not `n * 48` — the latter is `d` rows above the
 * window, in the leading spacer.
 *
 * `drawnStart` is where the grid actually draws the window, which is not
 * always the slice the harness fetched: `resultMeta.window` is what creates
 * the leading spacer, so under `?windowMeta=0` the grid draws its 50 rows at
 * offset 0 whatever their dataset indices are. Every park has to name the
 * DRAWN offset, and it is threaded in rather than inferred because the test
 * slides the window several times.
 */
async function parkAt(
  page: Page,
  drawnStart: number,
  localRow: number,
  requiredRows: readonly number[],
) {
  await page.locator("[data-pretable-scroll-viewport]").evaluate(
    (el, top) => {
      el.scrollTop = top;
    },
    (drawnStart + localRow) * ROW_HEIGHT,
  );
  // Every required row mounted AND holding still. Both halves are
  // load-bearing, and each cost a failing run to learn:
  //
  //  - mounted: the layout controller converges over several passes as rows
  //    report measured heights, so more rows appear after the first one does.
  //    Reading in between reported 4 of 11 rows on screen — which reads as a
  //    selection defect and is not one.
  //  - holding still: `data-pretable-selected` is read from the same commit,
  //    so reading mid-convergence samples a half-built plan.
  await page.waitForFunction(
    (rows) => {
      const store = window as { __pretableRowTops?: string };
      const tops = rows.map(
        (value) =>
          document.querySelector<HTMLElement>(
            `[data-pretable-row-id="row-${value}"]`,
          )?.style.top,
      );
      if (tops.some((top) => top === undefined)) {
        store.__pretableRowTops = undefined;
        return false;
      }
      const key = tops.join("|");
      const settled = store.__pretableRowTops === key;
      store.__pretableRowTops = key;
      return settled;
    },
    [...requiredRows],
  );
}

/**
 * Move the window, then wait for the row model to settle — `setRows` lands
 * across cooperative slices, so the new window is not in the DOM on the
 * render that requests it — and park the viewport where the caller asked.
 *
 * `drawnStart` defaults to `start`, which is right whenever `resultMeta.window`
 * is published. The `?windowMeta=0` mutation check has to pass `0`: with no
 * window there is no leading spacer, so the grid draws the same rows at the
 * top of a 50-row extent. See `parkAt`.
 */
async function slideWindowTo(
  page: Page,
  start: number,
  localRow: number,
  requiredRows: readonly number[],
  drawnStart: number = start,
) {
  await page.evaluate((next) => {
    window.__pretableWindowedHarness?.setWindowStart(next);
  }, start);
  await page.waitForFunction(
    (loaded) => {
      const cells = [
        ...document.querySelectorAll<HTMLElement>(
          "[data-pretable-row] [data-pretable-column-id='value']",
        ),
      ];
      if (cells.length === 0) return false;
      return cells.every((cell) => {
        const value = Number(cell.textContent);
        return (
          Number.isFinite(value) && value >= loaded.start && value < loaded.end
        );
      });
    },
    { start, end: start + PAGE_SIZE },
  );
  await parkAt(page, drawnStart, localRow, requiredRows);
}

/**
 * Select dataset rows 5,010–5,020 with a click and a shift-click on the
 * grid's own cells — the gesture, not a hand-built range handed to the
 * engine. Both events land on the real `onClick` handler, so the range, its
 * anchor and its dataset span are all produced the way a user produces them.
 *
 * **A real `locator.click()`, deliberately.**
 *
 * This file was written with `locator.click()` first, and had to be downgraded
 * to `dispatchEvent("click")` because a pointer could not reach the rows: a
 * windowed grid drew its loaded rows in GLOBAL (spacer-inclusive) coordinates
 * while the layout controller kept its `scrollTop` LOCAL to the loaded window,
 * clamped to the loaded rows' ~2,000px height against a ~480,000px content
 * div. With the window at dataset offset 5,000 that was a 240,000px
 * disagreement, and a sweep of `scrollTop` across 0 · 1,000 · 2,000 · 100,000
 * · 239,000 · 240,000 · 241,000 · 479,600 put ZERO rows inside the viewport at
 * every one of them. `locator.click()` failed 2 runs in 5 and hung for the
 * full 30s timeout in 3 of 8.
 *
 * The controller now publishes one coordinate system (see
 * `renderer-dom/row-layout-controller.ts`), so the gesture is back on a real
 * pointer — which makes this an independent check on those coordinates rather
 * than only an eviction gate. A synthetic event lands wherever the element is,
 * on screen or 240,000px below it; a real click has to be scrolled to and hit,
 * so it can only pass if the geometry is right. If this starts flaking, the
 * coordinates have regressed — do not put `dispatchEvent` back.
 */
async function selectSpanByGesture(
  page: Page,
  drawnStart: number = WINDOW_START,
) {
  const spanRows = Array.from(
    { length: SPAN_ROWS },
    (_, index) => SELECT_FROM + index,
  );
  await parkAt(page, drawnStart, SELECT_FROM - WINDOW_START, spanRows);
  await page.locator(cellSelector(SELECT_FROM)).click();
  await page.locator(cellSelector(SELECT_TO)).click({ modifiers: ["Shift"] });
  await expect(page.locator(cellSelector(SELECT_FROM))).toHaveAttribute(
    "data-pretable-selected",
    "true",
  );
}

/**
 * What actually holds DOM focus, in the only terms that answer §5's rule.
 *
 * `document.activeElement` is the whole question here and jsdom cannot answer
 * it: where focus lands when its element unmounts is browser behaviour, not
 * anything the engine returns. Reported as a description rather than asserted
 * inside `page.evaluate` so a failure says WHAT holds focus, not just that the
 * expected thing does not.
 */
async function describeActiveElement(page: Page) {
  return page.evaluate(() => {
    const active = document.activeElement;
    if (active === null) return { tagName: null, isBody: false };
    const cell = active.closest?.("[data-pretable-cell]") ?? null;
    return {
      tagName: active.tagName,
      isBody: active === document.body,
      /** Still somewhere the grid owns, which is what §5 actually demands. */
      insideGrid:
        active.closest?.("[data-pretable-scroll-viewport]") !== null ||
        active.hasAttribute("data-pretable-scroll-viewport"),
      isViewport: active.hasAttribute("data-pretable-scroll-viewport"),
      cellRowId:
        cell
          ?.closest("[data-pretable-row-id]")
          ?.getAttribute("data-pretable-row-id") ?? null,
      cellColumnId: cell?.getAttribute("data-pretable-column-id") ?? null,
      /** How many cells the grid itself believes are focused. */
      focusedCells: document.querySelectorAll(
        "[data-pretable-cell][data-pretable-focused='true']",
      ).length,
    };
  });
}

/**
 * Put the cursor on a cell with a REAL click, and wait until the browser
 * agrees. A synthetic event would set the engine's focus address without ever
 * moving DOM focus, which is the exact thing under test.
 */
async function focusCellByGesture(
  page: Page,
  datasetIndex: number,
  drawnStart: number = WINDOW_START,
) {
  await parkAt(page, drawnStart, datasetIndex - WINDOW_START, [
    datasetIndex,
    datasetIndex + 1,
  ]);
  await page.locator(cellSelector(datasetIndex)).click();
  await expect(page.locator(cellSelector(datasetIndex))).toBeFocused();
}

test.describe("a focused cell survives its row being evicted", () => {
  test("the cursor comes back on the same cell, and never falls to <body>", async ({
    page,
  }) => {
    await page.goto(`/?windowed=1&windowStart=${WINDOW_START}`);
    await expect(page.locator("[data-pretable-row]").first()).toBeVisible();

    await focusCellByGesture(page, SELECT_FROM);

    // Evict the focused row: the window slides past it entirely, so its cell
    // element is unmounted while it holds DOM focus.
    await slideWindowTo(page, FULLY_EVICTED, 0, [FULLY_EVICTED]);
    const whileEvicted = await describeActiveElement(page);
    expect(
      await page.locator(cellSelector(SELECT_FROM)).count(),
      "the focused row really is unloaded",
    ).toBe(0);

    // Bring it back.
    await slideWindowTo(page, WINDOW_START, 10, [SELECT_FROM, SELECT_FROM + 1]);
    const returned = await describeActiveElement(page);

    // Arrow movement resumes from where the cursor was left, not from
    // wherever the viewport happens to be parked.
    await page.keyboard.press("ArrowDown");
    const afterArrow = await describeActiveElement(page);

    expect
      .soft(whileEvicted.isBody, `evicted: focus is on ${whileEvicted.tagName}`)
      .toBe(false);
    expect
      .soft(whileEvicted.insideGrid, "evicted: focus is still inside the grid")
      .toBe(true);
    // Named rather than left as "not body": the cell's element is gone, so
    // SOMETHING has to hold focus, and the scroll viewport is the choice --
    // it is focusable, it owns the keydown handler, and it keeps a screen
    // reader inside the grid's `role="grid"` container.
    expect
      .soft(
        whileEvicted.isViewport,
        "evicted: focus parks on the grid's scroll viewport",
      )
      .toBe(true);
    expect
      .soft(returned.cellRowId, "returned: the cursor is on the same row")
      .toBe(`row-${SELECT_FROM}`);
    expect
      .soft(returned.cellColumnId, "returned: and the same column")
      .toBe("value");
    expect
      .soft(returned.focusedCells, "returned: exactly one cell is the cursor")
      .toBe(1);
    expect
      .soft(afterArrow.cellRowId, "arrow: moves on from the row it was left on")
      .toBe(`row-${SELECT_FROM + 1}`);
  });

  test("an arrow key pressed WHILE the row is evicted does not lose the cursor", async ({
    page,
  }) => {
    // The test above presses ArrowDown only after the row has come back. The
    // interesting keystroke is the one pressed while the row is still gone --
    // which is the ordinary case, because the user scrolled away and the
    // keyboard is where their hands are. `moveIndexedFocus` reconciled
    // two-argument, so that keystroke re-seated the cursor and dropped it: the
    // retention the test above proves lasted exactly until a key was pressed.
    //
    // The decided answer is that a ROW-axis move from an evicted cursor is
    // REFUSED -- the engine cannot name the row at the adjacent dataset
    // position, and jumping to the nearest loaded row would relocate the
    // user's cursor by however many rows were released. The other half of that
    // decision -- a COLUMN move still lands, because it never needed the row
    // -- is pinned in `indexed-focus.test.ts`, not here: this harness has one
    // column, so there is nowhere for a column move to go.
    await page.goto(`/?windowed=1&windowStart=${WINDOW_START}`);
    await expect(page.locator("[data-pretable-row]").first()).toBeVisible();

    await focusCellByGesture(page, SELECT_FROM);

    await slideWindowTo(page, FULLY_EVICTED, 0, [FULLY_EVICTED]);
    expect(
      await page.locator(cellSelector(SELECT_FROM)).count(),
      "the focused row really is unloaded",
    ).toBe(0);

    // Three row-axis keystrokes on an unloaded cursor. Each one used to be
    // enough on its own.
    //
    // ARROWS only, deliberately: `PageUp`/`PageDown` never reach the engine's
    // `moveIndexedFocus` at all -- `handleSurfaceKeyDown` resolves a page step
    // against the LOADED rows itself and, finding the cursor at index -1,
    // bases the step at row 0 and teleports the cursor into the loaded window.
    // That is a separate defect in the surface, not in the engine (whose unit
    // tests cover `page-down` from an evicted cursor), and it is filed rather
    // than fixed here.
    for (const key of ["ArrowDown", "ArrowDown", "ArrowUp"]) {
      await page.keyboard.press(key);
    }
    const whileEvicted = await describeActiveElement(page);

    await slideWindowTo(page, WINDOW_START, 10, [SELECT_FROM, SELECT_FROM + 1]);
    const returned = await describeActiveElement(page);

    expect
      .soft(
        whileEvicted.isBody,
        `evicted: focus is on ${whileEvicted.tagName}, not <body>`,
      )
      .toBe(false);
    expect
      .soft(
        whileEvicted.insideGrid,
        "evicted: the keystrokes left focus inside the grid",
      )
      .toBe(true);
    expect
      .soft(
        returned.cellRowId,
        "returned: the cursor is on the row it was left on, not four rows away and not nowhere",
      )
      .toBe(`row-${SELECT_FROM}`);
    expect
      .soft(returned.cellColumnId, "returned: and on the same column")
      .toBe("value");
    expect
      .soft(returned.focusedCells, "returned: exactly one cell is the cursor")
      .toBe(1);
  });

  test("mutation check: with no resultMeta.window the cursor does NOT come back", async ({
    page,
  }) => {
    // The discrimination proof for the cursor, kept in CI rather than in a
    // report someone has to trust -- the same `?windowMeta=0` kill switch the
    // selection gate uses. The window is the whole discriminator: without it
    // an absent row cannot be told from a deleted one, so the focus ref is
    // re-seated the moment its row leaves, and there is nothing left to
    // restore when the rows return.
    //
    // Note what does NOT change: focus still parks on the viewport rather than
    // falling to `<body>`. That half is unconditional, so this switch isolates
    // exactly the half the window buys -- the cursor's identity.
    await page.goto(`/?windowed=1&windowStart=${WINDOW_START}&windowMeta=0`);
    await expect(page.locator("[data-pretable-row]").first()).toBeVisible();

    // Drawn at 0 throughout: no `resultMeta.window` means no leading spacer.
    // See `parkAt`.
    await focusCellByGesture(page, SELECT_FROM, 0);
    await slideWindowTo(page, FULLY_EVICTED, 0, [FULLY_EVICTED], 0);
    const whileEvicted = await describeActiveElement(page);
    await slideWindowTo(
      page,
      WINDOW_START,
      10,
      [SELECT_FROM, SELECT_FROM + 1],
      0,
    );
    const returned = await describeActiveElement(page);

    expect
      .soft(
        await page.locator(cellSelector(SELECT_FROM)).count(),
        "the same row is back on screen -- only the cursor is not",
      )
      .toBe(1);
    expect
      .soft(
        whileEvicted.isBody,
        `no window: focus still does not fall to <body> (it is on ${whileEvicted.tagName})`,
      )
      .toBe(false);
    expect
      .soft(returned.cellRowId, "no window: no cell holds the cursor")
      .toBeNull();
    expect
      .soft(returned.focusedCells, "no window: the grid has no focused cell")
      .toBe(0);
  });
});

test.describe("a cell selection survives its rows being evicted", () => {
  test("evict incrementally, then fully, then bring the rows back", async ({
    page,
  }) => {
    await page.goto(`/?windowed=1&windowStart=${WINDOW_START}`);
    await expect(page.locator("[data-pretable-row]").first()).toBeVisible();

    await selectSpanByGesture(page);
    const selected = await readSelection(page);

    // 1. INCREMENTAL EVICTION. The window slides forward by 15 rows, which
    // clears the range's START endpoint (5,010) and leaves its END endpoint
    // (5,020) loaded. Park at local row 0 so the rows on screen are
    // 5,015 onwards — the tail of the selection, then rows past it.
    // Required rows: the tail of the span that is still loaded, plus the
    // first row past it — the control that keeps "everything paints" from
    // satisfying the assertion.
    await slideWindowTo(page, INCREMENTAL, 0, [
      INCREMENTAL,
      SELECT_TO,
      SELECT_TO + 1,
    ]);
    const incremental = await readSelection(page);

    // 2. FULLY EVICTED. Slide past the whole selection. Nothing on screen is
    // in it, and neither endpoint is loaded, so the count can only come from
    // the remembered span.
    await slideWindowTo(page, FULLY_EVICTED, 0, [FULLY_EVICTED]);
    const evicted = await readSelection(page);

    // 3. RETURN. Slide back to where the selection was made and park at the
    // same local offset the gesture used, so the same rows are on screen.
    await slideWindowTo(page, WINDOW_START, 10, [
      SELECT_FROM - 1,
      ...Array.from({ length: SPAN_ROWS }, (_, i) => SELECT_FROM + i),
      SELECT_TO + 1,
    ]);
    const returned = await readSelection(page);

    // ---- Assertions, all SOFT so one run reports the whole picture rather
    // than stopping at the first red one. ----

    // 0. The gesture itself. Stated so a failure below can be read as
    // "eviction broke it" rather than "the selection was never made".
    expect
      .soft(selected.selectedValues, "0. gesture: the span paints")
      .toEqual(renderedWithin(selected.renderedValues, SELECT_FROM, SELECT_TO));
    expect
      .soft(selected.summary?.rowCount, "0. gesture: count")
      .toBe(SPAN_ROWS);
    expect
      .soft(
        selected.selection?.ranges[0]?.datasetRowSpan,
        "0. gesture: the range records where it sits in the dataset",
      )
      .toEqual({
        start: SELECT_FROM,
        end: SELECT_TO,
        datasetKey: "windowed-harness",
      });

    // 1a. The evicted endpoint really is gone from the DOM — otherwise
    // everything below is a test of a grid that never evicted anything.
    expect
      .soft(
        incremental.renderedValues,
        "1. incremental: the start endpoint is evicted",
      )
      .not.toContain(SELECT_FROM);
    expect
      .soft(
        incremental.renderedValues,
        "1. incremental: the end endpoint is still loaded",
      )
      .toContain(SELECT_TO);

    // 1b. THE CASE THIS GATE EXISTS FOR. Rows 5,015–5,020 are loaded, on
    // screen, and strictly inside a span whose start endpoint the grid can no
    // longer resolve by row id. Before this they painted nothing at all.
    expect
      .soft(
        incremental.selectedValues,
        "1. incremental: rows inside the span still paint, with an endpoint evicted",
      )
      .toEqual(
        renderedWithin(incremental.renderedValues, SELECT_FROM, SELECT_TO),
      );
    expect
      .soft(
        incremental.selectedValues.length,
        "1. incremental: some rows of the span are on screen",
      )
      .toBeGreaterThan(0);
    // ...and a rendered row OUTSIDE the span does not paint. Without this the
    // assertion above is satisfied by painting everything.
    expect
      .soft(
        incremental.selectedValues,
        "1. incremental: a row past the span does not paint",
      )
      .not.toContain(SELECT_TO + 1);
    expect
      .soft(incremental.summary?.rowCount, "1. incremental: count is constant")
      .toBe(SPAN_ROWS);

    // 2. Fully evicted: the count is answered with none of its rows loaded.
    expect
      .soft(evicted.renderedValues, "2. evicted: no row of the span is loaded")
      .toEqual(
        expect.not.arrayContaining([SELECT_FROM, SELECT_TO, SELECT_FROM + 5]),
      );
    expect
      .soft(
        evicted.selectedValues,
        "2. evicted: nothing on screen is in the selection",
      )
      .toEqual([]);
    expect
      .soft(
        evicted.summary?.rowCount,
        "2. evicted: count stayed constant while the rows were gone",
      )
      .toBe(SPAN_ROWS);

    // 3. The rows come back SELECTED.
    expect
      .soft(returned.renderedValues, "3. returned: the span is loaded again")
      .toContain(SELECT_FROM);
    expect
      .soft(
        returned.selectedValues,
        "3. returned: every returning row of the span paints selected",
      )
      .toEqual(renderedWithin(returned.renderedValues, SELECT_FROM, SELECT_TO));
    expect
      .soft(
        returned.selectedValues.length,
        "3. returned: the whole span is back on screen",
      )
      .toBe(SPAN_ROWS);
    expect
      .soft(
        returned.selectedValues,
        "3. returned: the row just before the span is not selected",
      )
      .not.toContain(SELECT_FROM - 1);
    expect
      .soft(
        returned.selectedValues,
        "3. returned: the row just after the span is not selected",
      )
      .not.toContain(SELECT_TO + 1);
    expect
      .soft(returned.summary?.rowCount, "3. returned: count")
      .toBe(SPAN_ROWS);
  });

  test("mutation check: with no resultMeta.window the rows come back UNSELECTED", async ({
    page,
  }) => {
    // `?windowMeta=0` strips the window and keeps everything else. The window
    // is the whole discriminator: without it an absent row cannot be told
    // from a deleted one, so a range whose endpoints have both vanished is
    // pruned exactly as it always was, and nothing returns.
    //
    // This is the discrimination proof, kept in CI rather than in a report
    // someone has to trust: every "comes back selected" assertion in the test
    // above has to be able to fail, and here it does.
    await page.goto(`/?windowed=1&windowStart=${WINDOW_START}&windowMeta=0`);
    await expect(page.locator("[data-pretable-row]").first()).toBeVisible();

    // Drawn at 0 throughout: no `resultMeta.window` means no leading spacer,
    // so this grid's 50 rows sit at the top of a 50-row extent regardless of
    // which slice of the dataset they are. See `parkAt`.
    await selectSpanByGesture(page, 0);
    await slideWindowTo(page, FULLY_EVICTED, 0, [FULLY_EVICTED], 0);
    await slideWindowTo(
      page,
      WINDOW_START,
      10,
      [
        SELECT_FROM - 1,
        ...Array.from({ length: SPAN_ROWS }, (_, i) => SELECT_FROM + i),
        SELECT_TO + 1,
      ],
      0,
    );
    const returned = await readSelection(page);

    expect
      .soft(
        returned.renderedValues,
        "the same rows are back on screen — only the selection is not",
      )
      .toContain(SELECT_FROM);
    expect
      .soft(returned.selectedValues, "no window: nothing comes back selected")
      .toEqual([]);
    expect
      .soft(returned.summary?.rowCount, "no window: the count is gone too")
      .toBe(0);
  });

  test("mutation check: with no resultMeta.datasetKey the count does not survive", async ({
    page,
  }) => {
    // The tighter, eviction-specific kill switch. `?datasetKey=0` keeps the
    // window — positioning, extent and `aria-rowindex` all still work — and
    // removes only the population identity a dataset span is measured in.
    //
    // Spans fail CLOSED on that key by design: with no evidence about the
    // population the engine cannot tell a scroll from a re-sort, so it
    // refuses to read a remembered position rather than risk painting rows
    // the user never selected. The visible cost is exactly this: the count
    // collapses the moment the rows are unloaded, and says so.
    await page.goto(`/?windowed=1&windowStart=${WINDOW_START}&datasetKey=0`);
    await expect(page.locator("[data-pretable-row]").first()).toBeVisible();

    await selectSpanByGesture(page);
    const selected = await readSelection(page);
    await slideWindowTo(page, INCREMENTAL, 0, [
      INCREMENTAL,
      SELECT_TO,
      SELECT_TO + 1,
    ]);
    const incremental = await readSelection(page);
    await slideWindowTo(page, FULLY_EVICTED, 0, [FULLY_EVICTED]);
    const evicted = await readSelection(page);

    // The positive twin: with every row loaded the count is right, so the
    // collapse below is about the missing key and not about a grid that
    // never counted anything.
    expect
      .soft(selected.summary?.rowCount, "no datasetKey: counts while loaded")
      .toBe(SPAN_ROWS);
    expect
      .soft(
        selected.selection?.ranges[0]?.datasetRowSpan,
        "no datasetKey: no span is recorded in the first place",
      )
      .toBeUndefined();
    // The half-resolved case, and the sharpest thing this switch shows: with
    // the start endpoint evicted and no span to recover it from, the range
    // collapses onto its surviving endpoint. That is exactly the shape of the
    // defect a previous round shipped — an 11-row selection reporting itself
    // as 1 — and it is what the span exists to prevent.
    expect
      .soft(
        incremental.summary?.rowCount,
        "no datasetKey: an incremental slide collapses the range to its survivor",
      )
      .toBe(1);
    expect
      .soft(
        incremental.selectedValues,
        "no datasetKey: rows inside the span stop painting",
      )
      .toEqual([SELECT_TO]);
    expect
      .soft(
        evicted.summary?.rowCount,
        "no datasetKey: the count does NOT stay constant while evicted",
      )
      .not.toBe(SPAN_ROWS);
    expect
      .soft(
        evicted.summary?.verified,
        "no datasetKey: and the grid says the number is not proven",
      )
      .toBe(false);
  });
});
