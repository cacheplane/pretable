import { expect, test, type Page } from "@playwright/test";

/**
 * The unit test for this behaviour (`src/__tests__/ag-grid-adapter.test.tsx`)
 * asserts that a wrapped column's cell carries `ag-cell-wrap-text` and
 * `ag-cell-auto-height`. Those classes are applied straight off the colDef
 * (`CellCtrl.applyStaticCssClasses` toggles them from `column.isAutoHeight()`
 * and `colDef.wrapText`), so the assertion passes whether or not a single
 * pixel moved — and it cannot do better, because jsdom has no layout engine:
 * `getBoundingClientRect()` returns zeros and `scrollHeight` is always 0
 * there. Wrapping is a layout fact, so the proof has to run somewhere that
 * does layout.
 *
 * This is that proof. Real Chromium, real fonts, real line breaking, asserting
 * three things a matching selector cannot:
 *
 *  1. wrapped rows are TALLER than the fixed `rowHeight`, and not all the same
 *     height — i.e. `autoHeight` really resized them;
 *  2. each row's height agrees with its tallest cell's content — i.e. the
 *     wrapped text is not being clipped by a row that stayed at 48; and
 *  3. the wrapped text is laid out at the matrix's leading (1.5), not at the
 *     row-height-derived leading AG Grid's theme applies by default, which put
 *     39px of leading on a 14px font and made the same sentence occupy nearly
 *     twice the height it does in every other adapter.
 *
 * Plus the negative half: a scenario with no wrapped columns still draws
 * fixed 48px rows, so none of this leaks into S1/S3/S6.
 */

const ROW_HEIGHT = 48;
/** Matches pretable (22.5/15) and TanStack (24/16); MUI is 1.43. */
const EXPECTED_LEADING_RATIO = 1.5;

interface RowMetrics {
  height: number;
  contentHeight: number;
  borderBottom: number;
}

async function readRowMetrics(page: Page): Promise<RowMetrics[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".ag-row")].map((row) => {
      const style = getComputedStyle(row);
      return {
        height: row.getBoundingClientRect().height,
        contentHeight: Math.max(
          0,
          ...[...row.querySelectorAll<HTMLElement>(".ag-cell")].map(
            (cell) => cell.scrollHeight,
          ),
        ),
        borderBottom: parseFloat(style.borderBottomWidth || "0"),
      };
    }),
  );
}

/**
 * AG Grid paints a row at the row model's height and corrects it afterwards
 * (measure on cell mount -> 1ms-debounced `calculateRowHeights` -> redraw), and
 * each correction can pull another row into the viewport, so the settling is
 * iterative. Poll for a repeated height signature rather than picking a
 * timeout: what this test is about is the settled layout, and the un-settled
 * layout is measured by the bench itself, not here.
 */
async function waitForSettledRowHeights(page: Page) {
  let previous = "";
  await expect
    .poll(
      async () => {
        const signature = (await readRowMetrics(page))
          .map((row) => Math.round(row.height))
          .join(",");
        const stable = signature !== "" && signature === previous;
        previous = signature;
        return stable;
      },
      { timeout: 15_000, intervals: [150] },
    )
    .toBe(true);
}

test("AG Grid's wrapped rows really grow to fit their text, at the matrix's leading", async ({
  page,
}) => {
  await page.goto("/?adapter=ag-grid&scenario=S2&scale=dev");
  await expect(page.locator(".ag-row").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await waitForSettledRowHeights(page);

  const rows = await readRowMetrics(page);
  expect(rows.length).toBeGreaterThan(1);

  // (1) `autoHeight` resized the rows. Drop the flag and every row sits at the
  // 48px `rowHeight` instead, which fails here on the first row. S2's wrapped
  // corpus is multi-sentence at a 220px column width, so no row's content fits
  // inside the floor — the shortest measured ~65px.
  for (const row of rows) {
    expect(row.height).toBeGreaterThan(ROW_HEIGHT);
  }
  // At least one row is much taller than the floor, so "grew by a pixel" does
  // not pass for "grew to fit a paragraph".
  expect(Math.max(...rows.map((row) => row.height))).toBeGreaterThan(
    ROW_HEIGHT * 2,
  );

  // ...and variably. S2's corpus is multilingual and of uneven length, so a
  // grid doing real auto height cannot produce one height for every row. This
  // is what catches a "fix" that just raises the fixed row height.
  const distinctHeights = new Set(rows.map((row) => Math.round(row.height)));
  expect(distinctHeights.size).toBeGreaterThan(1);

  // (2) The row is as tall as its tallest cell's content, so nothing is
  // clipped. This is the same quantity the bench reports as
  // `row_height_error_p95_px`, asserted on the settled layout.
  for (const row of rows) {
    expect(
      Math.abs(row.contentHeight + row.borderBottom - row.height),
    ).toBeLessThan(3);
  }

  // (3) Leading. AG Grid's core CSS sets
  // `.ag-cell { line-height: var(--ag-internal-content-line-height) }`, which
  // is derived from `--ag-row-height` — 39px on a 14px font here. Without the
  // adapter's `cellStyle` override this reads ~2.79 and the same sentence
  // occupies a 236px row instead of a 128px one.
  const leading = await page.evaluate(() => {
    const cell = document.querySelector<HTMLElement>(
      '.ag-cell[col-id="col_0"]',
    );
    if (!cell) return null;
    const style = getComputedStyle(cell);
    return {
      lineHeight: parseFloat(style.lineHeight),
      fontSize: parseFloat(style.fontSize),
      whiteSpace: style.whiteSpace,
      contentHeight: cell.scrollHeight,
    };
  });
  expect(leading).not.toBeNull();
  expect(leading!.whiteSpace).toBe("normal");
  expect(leading!.lineHeight / leading!.fontSize).toBeCloseTo(
    EXPECTED_LEADING_RATIO,
    1,
  );
  // And it is genuinely wrapping — more than one line box in the cell. A cell
  // that happened to fit on one line would satisfy the ratio check vacuously.
  expect(leading!.contentHeight).toBeGreaterThan(leading!.lineHeight * 1.5);
});

test("a scenario with no wrapped columns still draws fixed 48px rows", async ({
  page,
}) => {
  // The load-bearing negative. Setting `wrapText` / `autoHeight` / `cellStyle`
  // unconditionally would satisfy every assertion above while silently
  // re-basing S1, S3 and S6 — the fixed-height scenarios whose whole point is
  // that nothing varies.
  await page.goto("/?adapter=ag-grid&scenario=S1&scale=dev");
  await expect(page.locator(".ag-row").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await waitForSettledRowHeights(page);

  const rows = await readRowMetrics(page);
  expect(rows.length).toBeGreaterThan(3);
  for (const row of rows) {
    expect(row.height).toBeCloseTo(ROW_HEIGHT, 0);
  }

  const unwrapped = await page.evaluate(() => {
    const cell = document.querySelector<HTMLElement>(".ag-cell");
    if (!cell) return null;
    return {
      whiteSpace: getComputedStyle(cell).whiteSpace,
      autoHeight: cell.classList.contains("ag-cell-auto-height"),
      wrapText: cell.classList.contains("ag-cell-wrap-text"),
    };
  });
  expect(unwrapped).toEqual({
    whiteSpace: "nowrap",
    autoHeight: false,
    wrapText: false,
  });
});
