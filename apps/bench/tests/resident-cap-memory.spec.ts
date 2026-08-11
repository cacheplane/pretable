import { expect, test } from "@playwright/test";

import { BENCH_RESIDENT_CAP_ROWS } from "../src/data-update-plan";

/** Design §11: grid-attributable heap ≤ 32 MB at the resident cap. PROPOSED ceiling —
 *  this spec produces the first measurement. */
const HEAP_CEILING_MB = 32;

/**
 * The baseline is a BLANK PAGE, not the bench app running another script.
 *
 * Every bench URL mounts a grid: the adapter renders `initialRows ?? dataset.rows`,
 * so `script=initial` on S1/dev holds all 2 000 scenario rows — twice the 1 000-row
 * resident cap under test here. Subtracting it yields a NEGATIVE difference that
 * clears any ceiling while measuring nothing, so the run below reports it as evidence
 * and never subtracts it.
 *
 * Against a blank page the difference is the WHOLE bench page — app bundle, React,
 * the generated scenario dataset, and the grid. That over-counts, which is the safe
 * direction: the grid is a subset of the page, so a page under the ceiling puts the
 * grid under it too. A number ABOVE the ceiling would be inconclusive rather than a
 * failure, and would need a real no-grid baseline to resolve.
 */
test("grid-attributable heap at the resident cap stays under the ceiling", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const session = await page.context().newCDPSession(page);
  await session.send("HeapProfiler.enable");

  const measure = async (): Promise<number> => {
    // Collect first: without it the number is dominated by garbage the run happened
    // to leave behind, and the "measurement" is a coin flip.
    await session.send("HeapProfiler.collectGarbage");
    const { usedSize } = (await session.send("Runtime.getHeapUsage")) as {
      usedSize: number;
    };
    return usedSize / (1024 * 1024);
  };

  await page.goto("about:blank");
  const baseline = await measure();

  // The append script ends at the 1 000-row resident cap.
  await page.goto(
    "/?adapter=pretable&scenario=S1&scale=dev&script=append&autorun=1",
  );
  await expect(page.getByLabel("Pretable React adapter").first()).toBeVisible();
  await page.waitForFunction(
    () => window.__PRETABLE_BENCH_RESULT__ !== undefined,
    undefined,
    { timeout: 90_000 },
  );

  const result = await page.evaluate(() => window.__PRETABLE_BENCH_RESULT__);
  // A run that bailed leaves the grid short of the cap, and the heap below would be
  // measured at a row count the budget was never written about. Read through the
  // status narrowing rather than `result?.metrics`: only the completed and partial
  // variants carry metrics at all.
  expect(result?.status).toBe("completed");
  const residentRows =
    result?.status === "completed"
      ? result.metrics.result_row_count
      : undefined;
  expect(residentRows).toBe(BENCH_RESIDENT_CAP_ROWS);

  // Two seconds of idle. The bench applies one update and stops, so this is the grid
  // at rest at the cap — it is NOT the steady-polling load §11 names, which no bench
  // script currently produces.
  await page.waitForTimeout(2_000);
  const atCap = await measure();

  const attributable = atCap - baseline;
  console.log(
    `[resident-cap-memory] blank ${baseline.toFixed(2)} MB, at cap ${atCap.toFixed(2)} MB, ` +
      `page-attributable ${attributable.toFixed(2)} MB (ceiling ${HEAP_CEILING_MB} MB)`,
  );

  // Reported, never subtracted: the number that shows why a bench page cannot serve
  // as this measurement's baseline.
  await page.goto("/?adapter=pretable&scenario=S1&scale=dev&script=initial");
  await expect(page.getByLabel("Pretable React adapter").first()).toBeVisible();
  const fullDataset = await measure();
  console.log(
    `[resident-cap-memory] same page holding all 2 000 scenario rows: ${fullDataset.toFixed(2)} MB ` +
      `(${(fullDataset - atCap).toFixed(2)} MB above the 1 000-row cap state)`,
  );

  expect(attributable).toBeLessThan(HEAP_CEILING_MB);
});
