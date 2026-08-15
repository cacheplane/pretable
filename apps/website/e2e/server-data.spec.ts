import { expect, test, type Page, type Request } from "@playwright/test";

import { waitForGridReady } from "./helpers";

/**
 * The four claims the /docs/server-data section makes, checked against the
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
 */

const OVERVIEW = "/docs/server-data";
const OWNERSHIP = "/docs/server-data/query-ownership";
const LIFECYCLE = "/docs/server-data/lifecycle";
const TOTALS = "/docs/server-data/totals";

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
