import {
  expect,
  test,
  type Locator,
  type Page,
  type Request,
} from "@playwright/test";

import { openFilterMenu, waitForGridReady } from "./helpers";

/**
 * The claims the /docs/server-data section makes, checked against the
 * running pages rather than against the prose.
 *
 * Every one of these is a claim a unit test structurally cannot make. The
 * examples are the documentation: what they teach is only true if a real
 * browser, talking to the real `POST /api/docs/rows`, does the thing the page
 * says it does — one request per query change, rows that survive a failure,
 * a total whose confidence changes what the grid is willing to announce.
 *
 * Each test is written so that DELETING the behaviour it names turns it red.
 * That ruled out the obvious assertions:
 *
 * - "rows appeared" cannot test whether the server was asked. Rows appear
 *   from the mount fetch whether or not `onQueryChange` is wired, so a grid
 *   that never reported a single query change would pass. The request COUNT
 *   is the only thing that discriminates, so that is what test 1 reads.
 * - "the row count is unchanged" cannot test whether an error preserved the
 *   result. A wholesale replacement of all twelve rendered rows keeps the
 *   count at twelve. Test 2 reads the row IDS.
 * - "rows appear after scrolling" cannot test windowing. Rows appear from a
 *   grid that simply loaded all 480, and they appear from one that appends
 *   every block it fetches and never releases anything — which is the exact
 *   thing the windowing page claims does not happen. The windowing tests
 *   therefore read three numbers that move independently (the window's start,
 *   the rows in memory, the rows fetched since mount) and the dataset position
 *   a row ANNOUNCES, which is the value that was wrong before #422.
 */

const OVERVIEW = "/docs/server-data";
const OWNERSHIP = "/docs/server-data/query-ownership";
const LIFECYCLE = "/docs/server-data/lifecycle";
const TOTALS = "/docs/server-data/totals";
const WINDOWING = "/docs/server-data/windowing";

const ROWS_ENDPOINT = "/api/docs/rows";

/** The wrapper `<PretableSurface>` publishes `dataState.phase` on. */
const PHASE = "[data-pretable-data-state-wrapper]";

/**
 * Opens a server-data example and resolves once its FIRST result has
 * committed.
 *
 * Two gates, and both are needed. `waitForGridReady` is the hydration gate
 * documented on the helper itself: these grids are server-rendered, so their
 * header buttons — and the radios, search box and submit button the client
 * components render beside them, which hydrate in the same React root — are
 * painted and hit-testable while still inert, and a click landing in that
 * window is accepted by the browser and dropped on the floor.
 *
 * The phase gate is the second one. Hydration says the controls are live; it
 * says nothing about the network. Every example here opens `loading` and
 * fetches on mount against an endpoint that deliberately sleeps 500ms, so a
 * test that interacted at hydration would be racing the first response —
 * counting requests, or snapshotting row ids, against a grid that has none
 * yet. `idle` is the surface's own statement that a result committed.
 */
async function openExample(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);
  await expect(page.locator(PHASE)).toHaveAttribute(
    "data-pretable-data-phase",
    "idle",
    // Generous: 500ms of deliberate server latency on top of a cold route.
    { timeout: 20_000 },
  );
}

/** The ids of the rows currently in the DOM, in document order. */
function renderedRowIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-pretable-row]")).map(
      (row) => row.getAttribute("data-pretable-row-id") ?? "",
    ),
  );
}

/**
 * Records every POST the page makes to the rows endpoint, with its body.
 *
 * Observed via `page.on("request")` rather than `page.route`: fulfilling or
 * even continuing an intercepted request perturbs the timing of the very
 * thing under test, and nothing here needs the response changed. The endpoint
 * answers `cache-control: no-store`, so one query change is one request on
 * the wire and not a served-from-cache no-op.
 *
 * Attached before `goto`, because the mount fetch is one of the requests
 * being counted.
 */
function recordRowRequests(
  page: Page,
): { query: unknown; totalKind?: string }[] {
  const bodies: { query: unknown; totalKind?: string }[] = [];
  page.on("request", (request: Request) => {
    if (request.method() !== "POST" || !request.url().includes(ROWS_ENDPOINT)) {
      return;
    }
    bodies.push(
      (request.postDataJSON() ?? {}) as { query: unknown; totalKind?: string },
    );
  });
  return bodies;
}

test("one query change is exactly one request, carrying that query", async ({
  page,
}) => {
  const requests = recordRowRequests(page);
  await openExample(page, OVERVIEW);

  // The mount fetch, and only the mount fetch. Asserted as an exact length at
  // a settled moment (the phase is `idle`, so the first result has landed)
  // rather than as "at least one" — a grid that fetched twice per query would
  // satisfy the looser reading and is exactly the bug worth catching.
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ query: { filters: [], sort: [] } });

  await page.getByRole("columnheader", { name: "Sort Total" }).click();

  // Poll: the click publishes a new query, the effect fires the request. Poll
  // to 2 rather than reading once, then re-assert the exact length after the
  // result commits so a second, duplicate request cannot slip in behind it.
  await expect.poll(() => requests.length, { timeout: 10_000 }).toBe(2);

  // The request is FOR the sort that was clicked — this is what makes the
  // count mean "the reader's intent reached the server" rather than "some
  // request happened". First click on a header sorts descending.
  expect(requests[1]).toMatchObject({
    query: { sort: [{ columnId: "total", direction: "desc" }] },
  });

  await expect(page.locator(PHASE)).toHaveAttribute(
    "data-pretable-data-phase",
    "idle",
    { timeout: 20_000 },
  );
  expect(requests).toHaveLength(2);
});

test("a failed request keeps the rows it already had, and the header still sorts", async ({
  page,
}) => {
  await openExample(page, LIFECYCLE);

  const before = await renderedRowIds(page);
  // Guards the comparison below from passing vacuously on two empty arrays.
  expect(before.length).toBeGreaterThan(0);

  // Any query containing "fail" is a deterministic 500 from the fixture, so
  // the error phase is reachable without waiting on real network flake.
  await page.getByLabel("Search orders by customer").fill("fail");
  await page.getByRole("button", { name: "Search" }).click();

  await expect(page.locator(PHASE)).toHaveAttribute(
    "data-pretable-data-phase",
    "error",
    { timeout: 20_000 },
  );

  // The claim: a failed request never discards the last result that did
  // answer. Ids, not a count — replacing all twelve rendered rows with twelve
  // different ones would leave a count assertion green.
  expect(await renderedRowIds(page)).toEqual(before);

  // And the grid is not merely displaying stale rows, it is still working on
  // them. Sorting is local here (`processing` declares only `filter:
  // "external"`), which is what makes it usable while the server is down.
  const totalHeader = page.getByRole("columnheader", { name: "Sort Total" });
  await expect(totalHeader).toHaveAttribute("aria-sort", "none");
  await totalHeader.click();
  await expect(totalHeader).toHaveAttribute("aria-sort", "descending");

  // aria-sort alone would pass on a grid that merely re-rendered its header
  // glyph, so check that the body actually reordered.
  await expect
    .poll(async () => (await renderedRowIds(page))[0], { timeout: 10_000 })
    .not.toBe(before[0]);

  // Still in the error phase: the sort happened DURING the failure, not after
  // some silent recovery that would make the whole test vacuous.
  await expect(page.locator(PHASE)).toHaveAttribute(
    "data-pretable-data-phase",
    "error",
  );
});

test("the total's confidence changes the report, the export scope and the announced count", async ({
  page,
}) => {
  await openExample(page, TOTALS);

  const reported = page.getByTestId("reported-total");
  const scope = page.getByTestId("export-scope");
  const announced = page.getByTestId("aria-rowcount");

  // `exact` is the initial selection, so this is the state the page loads in.
  await expect(reported).toHaveText('{"kind":"exact","count":480}');
  // An exact total over a fully loaded population is the ONE case where the
  // grid may speak for records it does not hold: the export covers `all`, and
  // the announced count is the real one (480 rows + the header row).
  await expect(scope).toHaveText("all");
  await expect(announced).toHaveText("481");

  const seen = [await reported.textContent()];

  // An estimate is not a fact. The export drops to what is loaded, and the
  // grid refuses to announce a number it cannot stand behind: `aria-rowcount`
  // of -1 is ARIA's "unknown", not a bug.
  await page.getByRole("radio", { name: "estimate", exact: true }).check();
  await expect(reported).toHaveText('{"kind":"estimate","count":500}', {
    timeout: 20_000,
  });
  await expect(scope).toHaveText("loaded");
  await expect(announced).toHaveText("-1");
  seen.push(await reported.textContent());

  // A lower bound is not a fact either, and reports differently from an
  // estimate — `atLeast`, not `count`.
  await page.getByRole("radio", { name: "unknown", exact: true }).check();
  await expect(reported).toHaveText('{"kind":"unknown","atLeast":480}', {
    timeout: 20_000,
  });
  await expect(scope).toHaveText("loaded");
  await expect(announced).toHaveText("-1");
  seen.push(await reported.textContent());

  // Three kinds, three distinct reports. Without this, an example that
  // collapsed two kinds onto one readout could still satisfy every assertion
  // above if the literals were ever loosened to match each other.
  expect(new Set(seen).size).toBe(3);
});

test("a narrowing query settles the count without accusing the total", async ({
  page,
}) => {
  // Attached before the first navigation: the honesty rules run during the
  // very first render, and they warn ONCE per page load — a warning printed
  // then would latch and silence the real check for the rest of the session,
  // which is why this reads the console rather than only the attribute.
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("[pretable]")) warnings.push(message.text());
  });

  await openExample(page, OVERVIEW);
  const grid = page.getByRole("grid");
  await expect(grid).toHaveAttribute("aria-rowcount", "481");

  const dialog = await openFilterMenu(page, "Region");
  await dialog.getByRole("checkbox", { name: "North", exact: true }).click();
  await page.keyboard.press("Escape");

  // 120 matching orders plus the header row, published from the server's
  // exact total — the settled value, which was never in doubt.
  await expect(grid).toHaveAttribute("aria-rowcount", "121", {
    timeout: 20_000,
  });
  await expect(page.locator(PHASE)).toHaveAttribute(
    "data-pretable-data-phase",
    "idle",
    { timeout: 20_000 },
  );

  // The claim the attribute cannot make: the count arrived without the grid
  // first announcing that these rows and this total contradict each other.
  expect(warnings).toEqual([]);
});

test("notify-only reports a query change without owning the query", async ({
  page,
}) => {
  await openExample(page, OWNERSHIP);

  // `<Pretable>` takes no `query` prop: the engine holds the reader's intent
  // and only tells the app when it changed. The counter is incremented by the
  // fetch that `onQueryChange` drives, so it is a direct reading of whether
  // the report arrived — one for the mount load, and one more per change.
  const count = page.getByTestId("request-count");
  await expect(count).toHaveText("1");

  await page.getByRole("columnheader", { name: "Sort Total" }).click();

  await expect(count).toHaveText("2", { timeout: 20_000 });

  // The grid, not the app, applied the sort — there is no `query` prop for
  // the app to have fed back.
  await expect(
    page.getByRole("columnheader", { name: "Sort Total" }),
  ).toHaveAttribute("aria-sort", "descending");
});

// ---------------------------------------------------------------------------
// Windowing
// ---------------------------------------------------------------------------

/** The fixture ids are 1-based (`ord-0205`); dataset indices are 0-based. */
function datasetIndexOf(rowId: string): number {
  const digits = /^ord-(\d+)$/.exec(rowId);

  if (!digits) throw new Error(`not a fixture order id: ${rowId}`);

  return Number(digits[1]) - 1;
}

/** Every rendered body row's id and announced position, in document order. */
function announcedRows(
  page: Page,
): Promise<{ rowId: string; ariaRowIndex: number }[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-pretable-row]")).map((row) => ({
      rowId: row.getAttribute("data-pretable-row-id") ?? "",
      ariaRowIndex: Number(row.getAttribute("aria-rowindex")),
    })),
  );
}

/** The example's readout: where the window starts, and what it has cost. */
async function readWindow(
  page: Page,
): Promise<{ start: number; loaded: number; fetched: number }> {
  const [start, loaded, fetched] = await Promise.all([
    page.getByTestId("window-start").textContent(),
    page.getByTestId("loaded-rows").textContent(),
    page.getByTestId("fetched-rows").textContent(),
  ]);

  return {
    start: Number(start),
    loaded: Number(loaded),
    fetched: Number(fetched),
  };
}

/**
 * Opens the windowing example and resolves once its first block has committed,
 * returning the grid's scrollport.
 *
 * Not `openExample`, and the difference is one line that has to come between
 * its two steps. `ExampleShell` mounts its demo on intersection, and on this
 * page the example sits below two paragraphs of prose — so at a 1280×720
 * viewport nothing of the grid exists yet, and `waitForGridReady` would spend
 * its whole timeout waiting for an element that is never going to be created
 * because nothing has scrolled. The `Preview` tab is part of the shell rather
 * than of the demo, so it is server-rendered and reachable before the grid is;
 * scrolling it into view is what starts the mount.
 *
 * The hydration gate still applies afterwards, for the reason `openExample`
 * documents: `waitForGridReady` waits on `data-pretable-hydrated`, without
 * which a grid that is painted but inert accepts scrolls and reports no
 * telemetry at all — every assertion below reads a number that only moves
 * because `onTelemetryChange` fired.
 */
async function openWindowingExample(page: Page): Promise<Locator> {
  await page.goto(WINDOWING, { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "Preview" }).scrollIntoViewIfNeeded();
  await waitForGridReady(page);
  await expect(page.locator(PHASE)).toHaveAttribute(
    "data-pretable-data-phase",
    "idle",
    // Generous: 500ms of deliberate server latency on top of a cold route.
    { timeout: 20_000 },
  );

  return page.locator("[data-pretable-scroll-viewport]").first();
}

/**
 * Scrolls the grid roughly 40% of the way down the POPULATION and resolves
 * once the window has slid to cover the viewport.
 *
 * A fraction of `scrollHeight` rather than a pixel count on purpose: the extent
 * is the windowing claim. It measures 480 rows because the spacers reserve the
 * unloaded ones, so 40% of it is dataset row ~190 — a place the loaded block
 * does not reach and never will until the grid asks for it. Against a grid that
 * had dropped its spacers the same fraction would land inside the first
 * hundred, and every assertion downstream would be about a window that never
 * moved, so the poll below is what turns that into a failure rather than a
 * quietly weaker test.
 *
 * The example slides half a block per signal, so this is several sequential
 * 500ms round trips. It settles on its own: once the loaded block covers the
 * viewport there is no gap to report and nothing more is fetched.
 */
async function advanceWindowPastFirstBlock(
  page: Page,
  viewport: Locator,
): Promise<void> {
  await viewport.evaluate((element) => {
    element.scrollTop = Math.round(element.scrollHeight * 0.4);
  });

  await expect
    .poll(async () => (await readWindow(page)).start, { timeout: 25_000 })
    .toBeGreaterThanOrEqual(100);
  await expect(page.locator(PHASE)).toHaveAttribute(
    "data-pretable-data-phase",
    "idle",
    { timeout: 20_000 },
  );
}

test("a windowed row announces its dataset position, not its array position", async ({
  page,
}) => {
  const viewport = await openWindowingExample(page);
  await advanceWindowPastFirstBlock(page, viewport);

  const { start } = await readWindow(page);
  const rows = await announcedRows(page);

  // Both guards exist to stop this passing vacuously. With `start` at 0 the
  // two readings this test distinguishes are the same number, and with no rows
  // rendered the loop below asserts nothing at all.
  expect(start).toBeGreaterThan(0);
  expect(rows.length).toBeGreaterThan(0);

  for (const { rowId, ariaRowIndex } of rows) {
    const datasetIndex = datasetIndexOf(rowId);

    // The rows on screen have to be inside the window the readout claims, or
    // the comparison below is being made against rows from somewhere else.
    expect(datasetIndex).toBeGreaterThanOrEqual(start);

    // The claim: +1 for ARIA counting from one, +1 for the header row — and
    // nothing for where the row sits in the array it arrived in. The array
    // reading would be `datasetIndex - start + 2`, which `start > 0` above
    // guarantees is a different number for every one of these rows.
    expect(
      ariaRowIndex,
      `${rowId} is dataset row ${datasetIndex}, so it must announce ${datasetIndex + 2}; the array-position answer would be ${datasetIndex - start + 2}`,
    ).toBe(datasetIndex + 2);
  }
});

test("scrolling a window forward costs fetches, not memory", async ({
  page,
}) => {
  const viewport = await openWindowingExample(page);

  const before = await readWindow(page);
  expect(before).toEqual({ start: 0, loaded: 100, fetched: 100 });

  await advanceWindowPastFirstBlock(page, viewport);

  const after = await readWindow(page);

  // Three numbers, and all three have to move the way they move — any one of
  // them alone is satisfied by a grid doing something else entirely.
  //
  // The window advanced: the reader is looking at records the first block did
  // not contain.
  expect(after.start).toBeGreaterThan(before.start);
  // More rows were fetched than are held. This is the one that separates
  // eviction from accumulation: a handler that concatenated every block would
  // report the same number in both readouts.
  expect(after.fetched).toBeGreaterThan(after.loaded);
  expect(after.fetched).toBeGreaterThan(before.fetched);
  // And what is held did not grow. Exactly one block, the same as at mount.
  expect(after.loaded).toBe(before.loaded);

  // The blocks released are not merely uncounted — the rows themselves are
  // gone from the DOM's model, so the first record is no longer reachable.
  const rendered = await announcedRows(page);
  expect(rendered.map((row) => row.rowId)).not.toContain("ord-0001");
});

test("aria-rowcount stays the population count across window advances", async ({
  page,
}) => {
  const viewport = await openWindowingExample(page);
  const grid = page.getByRole("grid");

  // 480 records plus the header row, published from the server's exact total —
  // and it is the POPULATION that is announced, not the hundred rows loaded.
  await expect(grid).toHaveAttribute("aria-rowcount", "481");

  // Sampled while the window is moving, not only at the ends. The count is
  // recomputed on every commit, so a grid that fell back to the loaded model
  // mid-slide — 101, or ARIA's -1 for "unknown" — would recover by the time
  // the last block landed, and an assertion at the end alone would miss it.
  const samples: { start: number; rowcount: string | null }[] = [];
  const sample = async () => {
    const start = (await readWindow(page)).start;

    samples.push({ start, rowcount: await grid.getAttribute("aria-rowcount") });

    return start;
  };

  await viewport.evaluate((element) => {
    element.scrollTop = Math.round(element.scrollHeight * 0.4);
  });
  await expect.poll(sample, { timeout: 25_000 }).toBeGreaterThanOrEqual(100);
  await expect(page.locator(PHASE)).toHaveAttribute(
    "data-pretable-data-phase",
    "idle",
    { timeout: 20_000 },
  );
  await sample();

  // The samples span more than one window, so "across window advances" is
  // something this test observed rather than something it assumed. Without it,
  // a poll that happened to read only the settled state would leave the
  // assertion below identical to the one already made at mount.
  expect(new Set(samples.map((entry) => entry.start)).size).toBeGreaterThan(1);
  expect([...new Set(samples.map((entry) => entry.rowcount))]).toEqual(["481"]);
});
