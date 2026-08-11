import { expect, test } from "@playwright/test";

import { BENCH_RESIDENT_CAP_ROWS } from "../src/data-update-plan";

/** Design §11: grid-attributable heap ≤ 32 MB at the resident cap. PROPOSED ceiling —
 *  this spec produces the first measurement, and measures the WHOLE PAGE against it
 *  rather than the grid alone. See the baseline note below. */
const HEAP_CEILING_MB = 32;

/**
 * This spec hard-codes pretable/S1/dev and ignores the `PRETABLE_BENCH_*` selectors,
 * so it must not run inside a selected bench run. `scripts/bench-matrix.mjs` spawns
 * `pnpm bench:e2e` with no spec filter, which collects the whole testDir — without
 * this gate all 16 default matrix cells would each pay a full 1 000-row append run,
 * three navigations and a 2 s idle wait, and would report the same pretable number
 * under a comparator's name. `pnpm bench:memory` runs it with no selectors set.
 */
const selectors = [
  "PRETABLE_BENCH_ADAPTER",
  "PRETABLE_BENCH_SCENARIO",
  "PRETABLE_BENCH_SCALE",
  "PRETABLE_BENCH_SCRIPT",
];
const selected = selectors.filter((name) => process.env[name] !== undefined);
test.skip(
  selected.length > 0,
  `measures pretable/S1/dev only; ${selected.join(", ")} selected a different run. Use \`pnpm bench:memory\`.`,
);

/**
 * The baseline is a BLANK PAGE, not the bench app running another script, so the
 * number below is the WHOLE bench page — app bundle, React, the generated scenario
 * dataset, and the grid.
 *
 * Every bench URL mounts a grid: the adapter renders `initialRows ?? dataset.rows`,
 * so `script=initial` on S1/dev holds all 2 000 scenario rows — twice the 1 000-row
 * resident cap under test here. Subtracting it yields a NEGATIVE difference that
 * clears any ceiling while measuring nothing, so the run below reports it as evidence
 * and never subtracts it.
 *
 * Over-counting is the safe direction: the grid is a subset of the page, so a page
 * under the ceiling puts the grid under it too. A number ABOVE the ceiling would be
 * inconclusive rather than a failure, and would need a real no-grid baseline.
 *
 * What this CANNOT do is resolve the resident row count. The evidence measurement
 * puts twice the resident rows on the page and comes back BELOW the cap state,
 * because both pages retain the full generated dataset either way and the grid's
 * marginal cost is row metadata — inside `Runtime.getHeapUsage` noise. Against a
 * 32 MB ceiling at a measured ~11 MB this assertion trips only on a roughly 3x
 * whole-page regression; raising `BENCH_RESIDENT_CAP_ROWS` would not move it. It is
 * a page ceiling, not a per-row instrument.
 */
test("the bench page at the resident cap stays under the whole-page heap ceiling", async ({
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

  // The budget verdict comes before the evidence below: a flake in an extra
  // navigation must not decide whether the ceiling was met.
  expect(attributable).toBeLessThan(HEAP_CEILING_MB);

  // Reported, never subtracted. Two things at once: why a bench page cannot serve as
  // this measurement's baseline, and why the assertion above is a page ceiling —
  // twice the resident rows should cost MORE and does not.
  await page.goto("/?adapter=pretable&scenario=S1&scale=dev&script=initial");
  await expect(page.getByLabel("Pretable React adapter").first()).toBeVisible();
  const fullDataset = await measure();
  console.log(
    `[resident-cap-memory] same page holding all 2 000 scenario rows: ${fullDataset.toFixed(2)} MB ` +
      `(${(fullDataset - atCap).toFixed(2)} MB above the 1 000-row cap state) — a negative ` +
      `figure here means resident row count is below this instrument's resolution`,
  );
});
