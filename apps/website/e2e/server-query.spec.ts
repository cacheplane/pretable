import { expect, test, type Page } from "@playwright/test";

import { waitForGridReady } from "./helpers";

/**
 * Sort, filter and group against rows the SERVER produced.
 *
 * Every other e2e on this site hands the grid its rows and lets the engine
 * apply the query. This one drives `/fixtures/server-query`, where the query
 * makes a round trip through `POST /api/rows` and the rows on screen are the
 * ones that came back.
 *
 * READ THIS BEFORE ADDING AN ASSERTION HERE. The rendered grid is not evidence
 * that the server did anything. Controlled mode (`query` + `onQueryChange`)
 * stops the grid applying a query *transition* itself — it reports intent and
 * waits for the consumer — but it still applies the `query` prop it holds to
 * the `rows` prop it holds, and the fixture hands it both. So the engine
 * re-sorts and re-filters the server's answer, and every assertion about what
 * is on screen would pass unchanged if `/api/rows` shuffled its rows and
 * ignored the query completely. Confirmed by mutation, not by argument: with
 * the response rows reversed by a `page.route` interceptor, the rendered order
 * was still correct.
 *
 * Two things do discriminate, and every test here leans on them:
 *
 * - the outgoing request body, asserted whole, which proves the query the user
 *   expressed is the query the server was asked;
 * - `data-server-row-ids` on the fixture, which is the server's answer verbatim
 *   in the order it arrived, published before the engine touches it.
 *
 * `data-fetch-count` is the third: it proves a round trip happened at all, and
 * is what fails first if the fetch stops firing.
 */
const FIXTURE = "/fixtures/server-query";

/** The natural order of `SERVER_ROWS`, which is also the empty query's answer. */
const UNSORTED = "s1,s2,s3,s4,s5,s6,s7,s8";

const fixture = (page: Page) =>
  page.locator("[data-testid=server-query-fixture]");

const fetchCount = async (page: Page) =>
  Number(await fixture(page).getAttribute("data-fetch-count"));

/** The server's answer, verbatim and in arrival order. */
const serverRowIds = async (page: Page) =>
  (await fixture(page).getAttribute("data-server-row-ids")) ?? "";

const amounts = async (page: Page) =>
  (
    await page.$$eval(
      '[data-pretable-row] [data-pretable-column-id="amount"]',
      (cells) => cells.map((cell) => cell.textContent?.trim() ?? ""),
    )
  ).map(Number);

/**
 * Records every `/api/rows` request body, and lands the fixture in its settled
 * initial state: 8 rows fetched and drawn, `data-fetch-count` at rest.
 *
 * The count has to be sampled after that settling rather than at mount, so
 * that a later "it went up" reading can only be the interaction's doing.
 * `reactStrictMode` is on, so the mount effect runs twice in dev and two
 * identical requests go out; the fixture's generation guard drops the first
 * answer, so the count lands on 1 either way, but the second request is still
 * in flight for a moment.
 */
async function openFixture(page: Page) {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/rows"))
      requests.push(request.postData() ?? "");
  });

  await page.goto(FIXTURE, { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);
  await expect.poll(() => page.locator("[data-pretable-row]").count()).toBe(8);
  await expect.poll(() => serverRowIds(page)).toBe(UNSORTED);

  return {
    requests,
    /** The parsed body of the most recent request. */
    lastQuery: () => JSON.parse(requests.at(-1) ?? "null") as unknown,
  };
}

test("the server sorts", async ({ page }) => {
  const { lastQuery } = await openFixture(page);
  const before = await fetchCount(page);

  // Header click cycles absent → desc → asc → absent (see the plain-click
  // branch in packages/react/src/pretable-surface.tsx), so the first press is
  // descending.
  const amountHeader = page.locator(
    '[data-pretable-header-cell][data-pretable-column-id="amount"]',
  );
  await amountHeader.click();

  await expect.poll(() => fetchCount(page)).toBeGreaterThan(before);
  // The server's own answer, exact. This is the assertion that fails if
  // `/api/rows` stops sorting; the `amounts` check below would not.
  await expect.poll(() => serverRowIds(page)).toBe("s4,s7,s2,s8,s5,s1,s6,s3");
  expect(lastQuery()).toEqual({
    filters: [],
    sort: [{ columnId: "amount", direction: "desc" }],
    rowGroups: [],
  });
  // Corroborating, not probative: the engine would produce this order from the
  // query alone whatever the server sent back.
  await expect.poll(async () => (await amounts(page))[0]).toBe(900);

  // Second click flips to ascending, and the flip is server-applied too.
  await amountHeader.click();
  await expect.poll(() => serverRowIds(page)).toBe("s3,s6,s1,s5,s8,s2,s7,s4");
  expect(lastQuery()).toEqual({
    filters: [],
    sort: [{ columnId: "amount", direction: "asc" }],
    rowGroups: [],
  });
  await expect.poll(async () => (await amounts(page))[0]).toBe(55);
});

test("the server filters", async ({ page }) => {
  const { lastQuery } = await openFixture(page);
  const before = await fetchCount(page);

  // `region` is an enum column with no `options`, so the checklist is built
  // from the distinct values of the rows the grid currently holds — which are
  // the server's, so this also proves the fetched rows reached the engine.
  await page.locator("[data-pretable-header-row]").first().hover();
  await page.getByRole("button", { name: "Filter Region" }).click();
  const dialog = page.getByRole("dialog", { name: "Filter Region" });
  await expect(dialog).toBeVisible();
  for (const value of ["East", "North", "West"]) {
    await expect(dialog.getByRole("checkbox", { name: value })).toBeVisible();
  }
  await dialog.getByRole("checkbox", { name: "East" }).check();
  await page.keyboard.press("Escape");

  await expect.poll(() => fetchCount(page)).toBeGreaterThan(before);
  // Three ids, not eight: the rows the server withheld never reached the
  // client. A grid-side count cannot tell that apart from the engine hiding
  // five rows it was given.
  await expect.poll(() => serverRowIds(page)).toBe("s1,s2,s3");
  expect(lastQuery()).toEqual({
    filters: [{ columnId: "region", operator: "isAnyOf", value: ["East"] }],
    sort: [],
    rowGroups: [],
  });

  await expect.poll(() => page.locator("[data-pretable-row]").count()).toBe(3);
  const regions = await page.$$eval(
    '[data-pretable-row] [data-pretable-column-id="region"]',
    (cells) => [...new Set(cells.map((cell) => cell.textContent?.trim()))],
  );
  expect(regions).toEqual(["East"]);
});

test("the server groups", async ({ page }) => {
  const { lastQuery } = await openFixture(page);

  // Sort by amount first, deliberately: it scatters the regions
  // (s4,s7,s2,s8,s5,s1,s6,s3), so the clustering asserted after grouping is
  // work the server visibly had to do. `SERVER_ROWS` is already stored in
  // region order, so grouping an unsorted fetch would be satisfied by the
  // server returning its rows untouched — a passing assertion proving nothing.
  await page
    .locator('[data-pretable-header-cell][data-pretable-column-id="amount"]')
    .click();
  await expect.poll(() => serverRowIds(page)).toBe("s4,s7,s2,s8,s5,s1,s6,s3");
  const before = await fetchCount(page);

  await page.locator("[data-pretable-header-row]").first().hover();
  await page.getByRole("button", { name: "Column menu for Region" }).click();
  await page.getByRole("menuitem", { name: "Group by this column" }).click();

  await expect.poll(() => fetchCount(page)).toBeGreaterThan(before);
  // Regions clustered, amount-descending preserved inside each: East
  // (340, 120, 55), North (900, 210), West (480, 260, 75). Only a server that
  // applied both parts of the query returns this.
  await expect.poll(() => serverRowIds(page)).toBe("s2,s1,s3,s4,s5,s7,s8,s6");
  expect(lastQuery()).toEqual({
    filters: [],
    sort: [{ columnId: "amount", direction: "desc" }],
    rowGroups: [{ columnId: "region" }],
  });

  // The engine still builds the group rows — a server that can only cluster
  // rows cannot send tree structure, so the header rows are the client's work
  // on top of the server's ordering. One per region.
  await expect(page.locator("[data-pretable-group-row]")).toHaveCount(3);
});
