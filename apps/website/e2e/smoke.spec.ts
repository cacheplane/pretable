import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from "@playwright/test";

import {
  columnParts,
  columnSelectors,
  dragResizeHandle,
  openDrawer,
  openFilterMenu,
  scrollViewportTo,
  waitForDocsReady,
  waitForGridReady,
  waitForStablePosition,
} from "./helpers";
import { parseSitemapXml } from "../scripts/generate-sitemap";

async function expectIconResponse(response: APIResponse) {
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^image\//i);
  expect((await response.body()).byteLength).toBeGreaterThan(100);
}

type JsonLdNode = Record<string, unknown>;

function flattenJsonLd(value: unknown): JsonLdNode[] {
  if (Array.isArray(value)) {
    return value.flatMap(flattenJsonLd);
  }

  if (typeof value !== "object" || value === null) {
    return [];
  }

  const node = value as JsonLdNode;
  return [node, ...flattenJsonLd(node["@graph"])];
}

async function expectCrawlerVisibleSeo({
  page,
  request,
  path,
  schemaType,
}: {
  page: Page;
  request: APIRequestContext;
  path: string;
  schemaType: "WebPage" | "TechArticle";
}) {
  const response = await request.get(path, { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  expect(new URL(response.url()).pathname).toBe(path);
  expect(response.headers()["content-type"]).toMatch(/^text\/html(?:;|$)/i);

  await page.setContent(await response.text(), {
    waitUntil: "domcontentloaded",
  });

  const canonicalUrl = new URL(path, "https://pretable.ai").toString();
  const canonical = page.locator('head link[rel="canonical"]');
  await expect(canonical).toHaveCount(1);
  const canonicalHref = await canonical.getAttribute("href");
  if (!canonicalHref) throw new Error(`Expected a canonical href for ${path}`);
  expect(new URL(canonicalHref).href).toBe(canonicalUrl);

  const schemas = await page
    .locator('script[type="application/ld+json"]')
    .allTextContents();
  const pageSchemas = schemas
    .flatMap((schema) => flattenJsonLd(JSON.parse(schema) as unknown))
    .filter((schema) => schema["@type"] === schemaType);
  expect(pageSchemas).toHaveLength(1);
  expect(pageSchemas[0]?.url).toBe(canonicalUrl);

  const description = page.locator('head meta[name="description"]');
  await expect(description).toHaveCount(1);
  const metaDescription = await description.getAttribute("content");
  if (!metaDescription) {
    throw new Error(`Expected a meta description for ${path}`);
  }
  expect(pageSchemas[0]?.description).toBe(metaDescription);

  const ogImage = page.locator('head meta[property="og:image"]');
  await expect(ogImage).toHaveCount(1);
  const ogImageUrl = await ogImage.getAttribute("content");
  if (!ogImageUrl) throw new Error(`Expected an OG image for ${path}`);
  const parsedOgImageUrl = new URL(ogImageUrl);
  expect(parsedOgImageUrl.href).toBe("https://pretable.ai/og/pretable.png");

  const imageResponse = await request.get(
    `${parsedOgImageUrl.pathname}${parsedOgImageUrl.search}`,
    { maxRedirects: 0 },
  );
  expect(imageResponse.status()).toBe(200);
  expect(new URL(imageResponse.url()).pathname).toBe(parsedOgImageUrl.pathname);
  expect(imageResponse.headers()["content-type"]).toMatch(
    /^image\/png(?:;|$)/i,
  );
}

test.describe("crawler-visible SEO output", () => {
  test.use({ javaScriptEnabled: false });

  for (const { path, schemaType } of [
    { path: "/", schemaType: "WebPage" },
    { path: "/bench", schemaType: "WebPage" },
    { path: "/docs/grid/filtering", schemaType: "TechArticle" },
  ] as const) {
    test(`${path} exposes canonical metadata and page schema`, async ({
      page,
      request,
    }) => {
      await expectCrawlerVisibleSeo({ page, request, path, schemaType });
    });
  }

  test("publishes robots and the complete sitemap", async ({ request }) => {
    const robots = await request.get("/robots.txt", { maxRedirects: 0 });
    expect(robots.status()).toBe(200);
    expect(new URL(robots.url()).pathname).toBe("/robots.txt");
    expect(robots.headers()["content-type"]).toMatch(/^text\/plain(?:;|$)/i);

    const sitemap = await request.get("/sitemap.xml", { maxRedirects: 0 });
    expect(sitemap.status()).toBe(200);
    expect(new URL(sitemap.url()).pathname).toBe("/sitemap.xml");
    expect(sitemap.headers()["content-type"]).toMatch(
      /^(?:application|text)\/xml(?:;|$)/i,
    );
    const sitemapEntries = parseSitemapXml(await sitemap.text());
    expect(sitemapEntries).toHaveLength(51);
    expect(sitemapEntries.map((entry) => entry.lastmod)).toHaveLength(51);
    expect(
      new Set(sitemapEntries.map((entry) => entry.lastmod)).size,
    ).toBeGreaterThan(1);
  });
});

test("canonicalizes duplicate docs entrypoints", async ({ request }) => {
  const docsRedirect = await request.get("/docs", { maxRedirects: 0 });
  expect(docsRedirect.status()).toBe(308);
  expect(docsRedirect.headers()["location"]).toBe("/docs/getting-started");

  const markdownRedirect = await request.get("/docs.md", { maxRedirects: 0 });
  expect(markdownRedirect.status()).toBe(308);
  expect(markdownRedirect.headers()["location"]).toBe(
    "/docs/getting-started.md",
  );

  expect(
    (await request.get("/docs/getting-started", { maxRedirects: 0 })).status(),
  ).toBe(200);
  expect(
    (
      await request.get("/docs/getting-started.md", { maxRedirects: 0 })
    ).status(),
  ).toBe(200);
});

test("publishes the App Router favicon metadata", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });

  const directResponse = await request.get("/favicon.ico");
  await expectIconResponse(directResponse);

  const docsResponse = await page.goto("/docs", {
    waitUntil: "domcontentloaded",
  });
  expect(docsResponse?.status()).toBe(200);
  const iconLink = page
    .locator('head link[rel~="icon"][href*="/favicon.ico"]')
    .first();
  await expect(iconLink).toHaveAttribute("href", /^\/favicon\.ico(?:\?.*)?$/);

  const iconHref = await iconLink.getAttribute("href");
  if (!iconHref) throw new Error("Expected a favicon metadata href");
  await expectIconResponse(await request.get(iconHref));
  await waitForDocsReady(page);
  expect(errors).toEqual([]);
});

test("landing renders grid + control bar + drawer handle; drawer opens", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page).toHaveTitle("pretable");

  await expect(page.locator("[data-pretable-scroll-viewport]")).toBeVisible({
    timeout: 10_000,
  });

  await expect(page.locator("[data-testid='drawer-handle']")).toBeVisible();

  // Click handle → drawer opens
  await openDrawer(page);
  await expect(page.getByText(/built in bend, or\./i)).toBeVisible();

  // /docs still resolves
  const docsResponse = await page.goto("/docs", {
    waitUntil: "domcontentloaded",
  });
  expect(docsResponse?.status()).toBe(200);

  // /docs/grid/filtering resolves too
  const filteringDocs = await page.goto("/docs/grid/filtering", {
    waitUntil: "domcontentloaded",
  });
  expect(filteringDocs?.status()).toBe(200);

  // ...as does /docs/grid/paste
  const pasteDocs = await page.goto("/docs/grid/paste", {
    waitUntil: "domcontentloaded",
  });
  expect(pasteDocs?.status()).toBe(200);
});

test("docs brand link returns to drawer when it was last open", async ({
  page,
}) => {
  await page.goto("/");
  // Open the drawer via the bottom handle.
  await openDrawer(page);

  // Navigate to /docs via the in-drawer /docs link.
  await page
    .getByTestId("drawer-shell")
    .getByRole("link", { name: "/docs", exact: true })
    .click();
  await expect(page).toHaveURL(/\/docs/);

  // Click brand → should land back on / with drawer open.
  await page.getByRole("link", { name: /pretable\.ai/i }).click();
  await expect(page).toHaveURL(/\/#receipts$/);
  await expect(page.locator("html")).toHaveAttribute("data-drawer", "open");
});

test("docs brand link goes to bare grid when drawer was never opened", async ({
  page,
}) => {
  await page.goto("/docs");
  await page.getByRole("link", { name: /pretable\.ai/i }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("html")).toHaveAttribute("data-drawer", "closed");
});

test("hero shows the live portfolio: ticks/s, streaming analyst text, no row drift", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  // The positions grid renders.
  await expect(
    page.getByRole("grid", { name: /portfolio positions/i }),
  ).toBeVisible({ timeout: 10_000 });

  // Control bar advertises the market stream in ticks/s.
  await expect(page.getByText(/ticks\/s/i).first()).toBeVisible();

  // The AI Analyst column streams wrapped commentary in: a known phrase appears.
  await expect(page.getByText(/single-name guardrail/i)).toBeVisible({
    timeout: 12_000,
  });

  // Row-drift guard: the grid's frame must not jump while commentary streams and
  // rows take on variable heights. This is the demo's headline correctness claim.
  const bezel = page.getByTestId("hero-bezel");
  const before = await bezel.boundingBox();
  await page.waitForTimeout(3000);
  const after = await bezel.boundingBox();
  expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(2);
});

test("hero grid row-select checkbox column is visible and clickable", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);

  // Header checkbox is rendered.
  const headerCheckbox = page.locator("[data-pretable-row-select-all]").first();
  await expect(headerCheckbox).toBeVisible();
  await expect(headerCheckbox).toHaveAttribute(
    "aria-checked",
    /true|false|mixed/,
  );

  // At least one body checkbox is rendered.
  const bodyCheckbox = page.locator("[data-pretable-row-select]").first();
  await expect(bodyCheckbox).toBeVisible();

  // Select a row WHILE the stream is live and confirm it stays selected across
  // several ticks. The grid reconciles row updates in place rather than
  // recreating itself, so selection survives streaming.
  await bodyCheckbox.click();
  await expect(bodyCheckbox).toHaveAttribute("aria-checked", "true");
  await page.waitForTimeout(2000); // several stream ticks
  await expect(bodyCheckbox).toHaveAttribute("aria-checked", "true");

  // --- The DOM contract the docs promise for this synthetic column ---
  // /docs/grid/cell-renderers#telling-it-apart-in-the-dom tells readers how to
  // include or exclude the checkbox column in a selector. That advice is only
  // as good as the attributes it rests on, and the trap it warns about is an
  // asymmetry easy to "tidy" away by accident, so assert it here.
  const dom = await page
    .locator("[data-pretable-scroll-viewport]")
    .first()
    .evaluate((grid) => {
      const count = (sel: string) => grid.querySelectorAll(sel).length;
      return {
        firstHeaderIsRowSelect: grid
          .querySelector("[data-pretable-header-cell]")!
          .hasAttribute("data-pretable-row-select-header"),
        firstCellIsRowSelect:
          grid
            .querySelector("[data-pretable-cell]")!
            .getAttribute("data-pretable-row-select-cell") === "true",
        rsHeaderColumnId: grid
          .querySelector(
            "[data-pretable-header-cell][data-pretable-row-select-header]",
          )!
          .getAttribute("data-pretable-column-id"),
        rsCellColumnId: grid
          .querySelector(
            '[data-pretable-cell][data-pretable-row-select-cell="true"]',
          )!
          .getAttribute("data-pretable-column-id"),
        allCells: count("[data-pretable-cell]"),
        cellsByColumnId: count("[data-pretable-cell][data-pretable-column-id]"),
        cellsExcluded: count(
          "[data-pretable-cell]:not([data-pretable-row-select-cell])",
        ),
        rsCells: count(
          '[data-pretable-cell][data-pretable-row-select-cell="true"]',
        ),
        allHeaders: count("[data-pretable-header-cell]"),
        headersByColumnId: count(
          "[data-pretable-header-cell][data-pretable-column-id]",
        ),
      };
    });

  // Left-pinned, so it is the FIRST match for both generic selectors.
  expect(dom.firstHeaderIsRowSelect).toBe(true);
  expect(dom.firstCellIsRowSelect).toBe(true);

  // The asymmetry: the header omits the column id, the cells publish it.
  expect(dom.rsHeaderColumnId).toBeNull();
  expect(dom.rsCellColumnId).toBe("__pretable_row_select__");

  // Which is why [data-pretable-column-id] narrows headers but not cells...
  expect(dom.headersByColumnId).toBe(dom.allHeaders - 1);
  expect(dom.cellsByColumnId).toBe(dom.allCells);

  // ...and :not([data-pretable-row-select-cell]) is the one that excludes them.
  expect(dom.rsCells).toBeGreaterThan(0);
  expect(dom.cellsExcluded).toBe(dom.allCells - dom.rsCells);
});

test("cockpit: filter, edit (guardrail + success), and select+copy under streaming", async ({
  page,
}) => {
  // This is the longest test in the suite — a filter round-trip, two edits,
  // a range select, a copy, and two streaming waits, each a real interaction.
  // Locally it finishes in ~8s; against a live Vercel deployment every one of
  // those steps pays network latency and it exceeds the 30s default, which is
  // what reddened the production smoke gate. It failed parked on the final
  // `waitForTimeout(2000)` at the end — not because that sleep hangs, but
  // because it is simply where the clock ran out.
  //
  // Note the 4s of hard sleeps below are pure deterministic cost and neither
  // one verifies that a tick actually landed; converting them to poll on a
  // real streamed change would reclaim the time AND strengthen them.
  test.setTimeout(60_000);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  // No separate "grid is up" wait: `openFilterMenu` gates on
  // `data-pretable-hydrated` itself, and this test's first grid interaction is
  // the Symbol funnel.

  // --- Filter via the built-in header funnels ---
  // ([data-pretable-row] counts only virtualized/visible rows, so assert
  //  deterministic filtered counts and ">5" for the unfiltered view.)
  // Symbol funnel → contains NVDA → 1 row.
  const symbolDialog = await openFilterMenu(page, "Symbol");
  await symbolDialog.locator("[data-pretable-filter-value]").fill("NVDA");
  await expect(page.locator("[data-pretable-row]")).toHaveCount(1); // auto-waits past the ~200ms live-apply debounce
  // Clear restores the book.
  await symbolDialog.locator("[data-pretable-filter-clear]").click();
  await expect
    .poll(() => page.locator("[data-pretable-row]").count())
    .toBeGreaterThan(5);
  await page.keyboard.press("Escape");
  await expect(symbolDialog).toBeHidden();

  // Sector funnel → enum checklist (auto-derived) → Energy → 2 rows.
  const sectorDialog = await openFilterMenu(page, "Sector");
  await sectorDialog
    .locator("[data-pretable-filter-set]")
    .getByRole("checkbox", { name: "Energy" })
    .check();
  await expect(page.locator("[data-pretable-row]")).toHaveCount(2); // XOM, CVX
  const shown = await page
    .locator('[data-pretable-row] [data-pretable-column-id="sector"]')
    .allInnerTexts();
  expect(new Set(shown.map((s) => s.trim()))).toEqual(new Set(["Energy"]));
  // Active-funnel indicator.
  await expect(
    page.locator(
      '[data-pretable-filter-funnel][data-pretable-column-id="sector"]',
    ),
  ).toHaveAttribute("data-pretable-filter-active", "true");

  // Filter survives streaming: wait several ticks, still 2 rows.
  await page.waitForTimeout(2000);
  await expect(page.locator("[data-pretable-row]")).toHaveCount(2);

  // Clear + close so the edit/copy phases see the full book.
  await sectorDialog.locator("[data-pretable-filter-clear]").click();
  await expect
    .poll(() => page.locator("[data-pretable-row]").count())
    .toBeGreaterThan(5);
  await page.keyboard.press("Escape");
  await expect(sectorDialog).toBeHidden();

  // --- Edit qty → 7% guardrail rejection (NVDA is already > 7% of the book) ---
  const nvdaQty = page.locator(
    '[data-pretable-row][data-pretable-row-id="NVDA"] [data-pretable-column-id="qty"]',
  );
  await nvdaQty.dblclick();
  const editor = page.getByLabel("Edit quantity");
  await editor.fill("13000"); // within 10x sanity, but still breaches 7%
  await editor.press("Enter");
  // Target the rejection alert specifically: the streaming AI-analyst column
  // also mentions "guardrail" once its commentary has ticked in, so a bare
  // text locator is ambiguous under strict mode. (Filter by text because
  // Next's route announcer is also role=alert.)
  await expect(
    page.getByRole("alert").filter({ hasText: /guardrail/i }),
  ).toBeVisible({ timeout: 5000 });
  await editor.press("Escape");

  // --- Edit qty → success (low-weight, viewport-visible holding; the qty is a
  //     deterministic non-rejected value that keeps the name under 7%) ---
  const jpmQty = page.locator(
    '[data-pretable-row][data-pretable-row-id="JPM"] [data-pretable-column-id="qty"]',
  );
  await jpmQty.dblclick();
  const editor2 = page.getByLabel("Edit quantity");
  await editor2.fill("14500");
  await editor2.press("Enter");
  await expect(jpmQty).toContainText("14,500", { timeout: 5000 });

  // --- Cell-range select + copy, surviving streaming ticks ---
  const cellA = page.locator(
    '[data-pretable-row][data-pretable-row-id="NVDA"] [data-pretable-column-id="dayPnl"]',
  );
  const cellB = page.locator(
    '[data-pretable-row][data-pretable-row-id="MSFT"] [data-pretable-column-id="weight"]',
  );
  await cellA.click();
  await cellB.click({ modifiers: ["Shift"] });
  await expect(page.getByText(/selected · ⌘C to copy/i)).toBeVisible();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+c" : "Control+c",
  );
  // Scope to the Selection panel: the toast renders as a nested span inside
  // the "… selected · ⌘C to copy" span, so a bare getByText(/Copied/) matches
  // both the child and its parent and trips strict mode.
  await expect(page.getByRole("region", { name: "Selection" })).toContainText(
    /Copied/i,
  );
  await page.waitForTimeout(2000); // ticks
  await expect(page.getByText(/selected · ⌘C to copy/i)).toBeVisible();
});

test("cockpit: the selection summary counts the rows the user can see", async ({
  page,
}) => {
  // The sidebar's "N × M selected" claims to describe the rectangle ⌘C copies.
  // A selection range is a pair of boundary ids with everything between them
  // implied, so it only means anything against the order the grid is DRAWING.
  //
  // A filter is the cheapest way to make the drawn order diverge from any
  // locally-held one — the drawn set is a subset — and it is a gesture the hero
  // invites, so it is the case worth pinning. The grouped case is pinned in
  // grouping.spec.ts, but only by counts that happen to coincide there: the
  // derived group column replaces the grouped one, so a column total taken
  // against the wrong order still lands on the right number.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);

  // Pause the market first. The book is ranked by live weight and every tick
  // recomputes every weight, so a position that overtakes its neighbour swaps
  // with it — rarely (measured: about one reorder per 25s), but this test picks
  // two rows BY POSITION and clicks them one after the other, and a reorder
  // landing between those two clicks would select a different rectangle than
  // the one it then asserts on. Pausing removes the window entirely rather than
  // making the assertion loose enough to survive it.
  await page.getByRole("button", { name: "Pause market" }).click();

  const sectorDialog = await openFilterMenu(page, "Sector");
  await sectorDialog
    .locator("[data-pretable-filter-set]")
    .getByRole("checkbox", { name: "Consumer" })
    .check();
  await expect(page.locator("[data-pretable-row]")).toHaveCount(6);
  await page.keyboard.press("Escape");

  // Two adjacent rows ON SCREEN, three columns wide (symbol → sector → qty).
  // Those two holdings are far apart in the unfiltered book, so a summary read
  // against the whole roster reports the gap between them instead of the two
  // rows the user dragged across — it read "9 × 3" for this exact selection.
  const rows = page.locator("[data-pretable-row]");
  await rows.nth(0).locator('[data-pretable-column-id="symbol"]').click();
  await rows
    .nth(1)
    .locator('[data-pretable-column-id="qty"]')
    .click({ modifiers: ["Shift"] });

  await expect(page.getByRole("region", { name: "Selection" })).toContainText(
    "2 × 3 selected",
  );
});

test("cockpit: paste a TSV block into Qty (real clipboard on Chromium)", async ({
  page,
  context,
  browserName,
}) => {
  // The tail of this test waits for the replay to tick XOM specifically, and
  // the recording only patches that symbol six times per 27s loop.
  test.setTimeout(60_000);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  // Filter to Energy first: the book is ranked by live weight, so an unfiltered
  // "the row below XOM" is not stable under streaming. Energy is exactly
  // {XOM, CVX} and their weights are far enough apart that the order holds.
  // (`openFilterMenu` also gates on `data-pretable-hydrated`, which this test
  // needs anyway before it clicks a cell to move focus into the grid.)
  const sectorDialog = await openFilterMenu(page, "Sector");
  await sectorDialog
    .locator("[data-pretable-filter-set]")
    .getByRole("checkbox", { name: "Energy" })
    .check();
  await expect(page.locator("[data-pretable-row]")).toHaveCount(2); // XOM, CVX
  // Close the menu: its value input would otherwise hold focus, and a paste
  // into an input belongs to that input, not to the grid.
  await page.keyboard.press("Escape");
  await expect(sectorDialog).toBeHidden();

  const qty = (rowId: string) =>
    page.locator(
      `[data-pretable-row][data-pretable-row-id="${rowId}"] [data-pretable-column-id="qty"]`,
    );

  // CRITICAL: a paste event is delivered to document.activeElement, so focus
  // has to be inside the grid before the keystroke. Clicking a cell moves the
  // roving tabindex onto it.
  await qty("XOM").click();
  await expect(qty("XOM")).toBeFocused();

  // 2 rows × 2 cols anchored on Qty: the first column lands on Qty (editable),
  // the second on Last (not editable) and comes back rejected.
  // Both quantities deliberately avoid the demo's deterministic desk-reject
  // hash: this case proves a successful batch, while rejection is covered by
  // the edit guardrail flow above.
  const tsv = "23000\t999\n12801\t888";

  if (browserName === "chromium") {
    // Real OS-clipboard path: write the text with the page's own Clipboard API,
    // then press the paste shortcut. Playwright maps it to Chromium's editing
    // command, so the browser produces a genuine `paste` event.
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.evaluate(
      async (text) => await navigator.clipboard.writeText(text),
      tsv,
    );
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+v" : "Control+v",
    );
  } else {
    // WebKit exposes no clipboard permission to Playwright and refuses
    // programmatic clipboard writes outside a user gesture, so this engine
    // dispatches a synthetic `paste` event carrying the same text. That still
    // exercises the surface's real listener and the whole gate/apply pipeline —
    // it is NOT coverage of the OS clipboard or of the ⌘V key path.
    await page.evaluate((text) => {
      const target = document.activeElement ?? document.body;
      let event: Event;
      try {
        const data = new DataTransfer();
        data.setData("text/plain", text);
        event = new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        });
      } catch {
        event = new Event("paste", { bubbles: true, cancelable: true });
        Object.defineProperty(event, "clipboardData", {
          value: { getData: () => text },
        });
      }
      target.dispatchEvent(event);
    }, tsv);
  }

  // The pasted quantities actually land in the cells...
  await expect(qty("XOM")).toContainText("23,000", { timeout: 10_000 });
  await expect(qty("CVX")).toContainText("12,801");
  // ...and the non-editable Last column's two cells come back rejected.
  await expect(page.getByTestId("paste-summary")).toHaveText(
    /Pasted 2 of 4 · 2 rejected/,
  );

  // Pasted values survive streaming ticks — checked on a DERIVED column, which
  // is the only place the check has teeth. Every tick patch in the recording
  // carries {id,last,mktValue,dayPnl,dayPnlPct} and never `qty`, so re-reading
  // the Qty cell here would pass even with the edited-qty override map deleted.
  // What the override map actually does is recompute Mkt Val from the NEW share
  // count: a tick's own mktValue was computed from XOM's ORIGINAL 22,000 shares
  // (~$2.46M), while the pasted 23,000 shares is ~$2.58M. So: wait for a real
  // tick to land on XOM (its price changes), then check Mkt Val against the
  // price the grid is actually showing rather than a hardcoded one.
  const cellText = async (rowId: string, columnId: string): Promise<string> =>
    (
      await page
        .locator(
          `[data-pretable-row][data-pretable-row-id="${rowId}"] [data-pretable-column-id="${columnId}"]`,
        )
        .innerText()
    ).trim();

  const priceBeforeTick = await cellText("XOM", "last");
  await expect
    .poll(() => cellText("XOM", "last"), { timeout: 20_000 })
    .not.toBe(priceBeforeTick);

  // One evaluate so price and value come from the same rendered commit.
  const shown = await page.evaluate(() => {
    const row = document.querySelector(
      '[data-pretable-row][data-pretable-row-id="XOM"]',
    );
    const text = (id: string) =>
      (
        row?.querySelector(`[data-pretable-column-id="${id}"]`) as HTMLElement
      )?.innerText.trim() ?? "";
    return { last: text("last"), mktValue: text("mktValue") };
  });
  const price = Number.parseFloat(shown.last);
  expect(Number.isFinite(price)).toBe(true);
  const compactUsd = (shares: number) =>
    `$${((shares * price) / 1_000_000).toFixed(1)}M`;
  const live = compactUsd(23_000); // pasted share count
  const stale = compactUsd(22_000); // the book's original share count
  // Guard: if the two formatted the same the assertion below would prove
  // nothing. Across the recording's XOM price range they never do.
  expect(live).not.toBe(stale);
  expect(shown.mktValue).toBe(live);
  // And the qty itself is of course still there.
  await expect(qty("XOM")).toContainText("23,000");
});

test("showcase: scale grid virtualizes; column layout resizes + resets", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await openDrawer(page);

  // --- Scale section: scroll into view, grid mounts, counter proves virtualization ---
  await page.locator("#scale").scrollIntoViewIfNeeded();
  const scaleGrid = page.getByRole("grid", { name: /2,500 by 500/i });
  await expect(scaleGrid).toBeVisible({ timeout: 10_000 });
  await waitForGridReady(page, "#scale");
  // Model total is shown.
  await expect(page.getByTestId("scale-counter")).toContainText("1,250,000");
  // DOM-rendered cell count is tiny relative to 1.25M (virtualization on).
  // Wait for the POSITIVE condition first. `data-pretable-hydrated="true"`
  // means the grid is interactive, not that it has rendered rows: at the
  // moment it flips, the viewport still reports scrollHeight ~418 and zero
  // cells. Rows arrive a beat later.
  //
  // Polling `toBeLessThan(2000)` cannot do this waiting, because 0 satisfies
  // it on the first sample — the poll returns instantly and the next
  // assertion races the row render.
  //
  // The ordering above was wrong on its own terms and is worth keeping right.
  // But "both engines behave identically, webkit is merely slower" — the
  // original reading of this failure — was not true when it was written.
  // Measured from `data-pretable-hydrated` to first painted cell: Chromium
  // 13ms, WebKit 263ms across 25 clamped `setTimeout(0)` hops, because
  // renderer-dom's layout scheduler had no unclamped fallback and Safari ships
  // no `scheduler.postTask`. Deleting `postTask` in Chromium reproduced it
  // (176-190ms). Fixed in renderer-dom; WebKit now paints in ~15ms, before
  // this gate is even reached.
  await expect
    .poll(
      async () => await page.locator("#scale [data-pretable-cell]").count(),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);
  // Only now is a cell count meaningful: small relative to 1.25M means
  // virtualization is on, rather than meaning nothing has rendered yet.
  expect(
    await page.locator("#scale [data-pretable-cell]").count(),
  ).toBeLessThan(2000);
  // Scroll the grid; the rendered count stays small.
  await page
    .locator("#scale [data-pretable-scroll-viewport]")
    .evaluate((el) => {
      el.scrollTop = 4000;
      el.scrollLeft = 6000;
    });
  await expect
    .poll(async () => await page.locator("#scale [data-pretable-cell]").count())
    .toBeLessThan(2000);

  // --- Column-layout section: resize a column, then reset ---
  await page.locator("#column-layout").scrollIntoViewIfNeeded();
  const layoutGrid = page.getByRole("grid", {
    name: /resizable, reorderable/i,
  });
  await expect(layoutGrid).toBeVisible({ timeout: 10_000 });
  await waitForGridReady(page, "#column-layout");

  // A column's header cell, resize strip and filter funnel are separate
  // subtrees of the header row — see `columnSelectors` for the shape.
  const layout = page.locator("#column-layout");
  const symbol = columnParts(layout, "symbol", "NVDA");
  await expect(symbol.header).toBeVisible();

  // Measure only once the section has stopped moving, so `widthBefore` and the
  // drag below describe the same layout.
  await waitForStablePosition(symbol.handle);
  const widthBefore = (await symbol.header.boundingBox())?.width ?? 0;
  expect(widthBefore).toBeGreaterThan(0);

  // Drag the symbol column's resize handle to the right by 80px.
  await dragResizeHandle(symbol.handle, 80);
  await expect
    .poll(async () => (await symbol.header.boundingBox())?.width ?? 0)
    .toBeGreaterThan(widthBefore + 20);

  // Reset restores the original width.
  await page.getByTestId("reset-layout").click();
  await expect
    .poll(async () => (await symbol.header.boundingBox())?.width ?? 0)
    .toBeLessThan(widthBefore + 20);

  // --- Pinned columns stay glued to the viewport's two edges ---
  // The showcase pins "Symbol" left and "Analyst note" right, and the column
  // set is wider than the container, so there is real horizontal scroll to
  // exercise.
  const layoutViewport = layout.locator("[data-pretable-scroll-viewport]");
  const note = columnParts(layout, "note", "NVDA");
  // `qty` is a plain scrollable column that stays rendered at both scroll
  // extremes — it is the control that proves the scroll actually moved content.
  const qty = columnParts(layout, "qty", "NVDA");
  await expect(note.cell).toHaveAttribute("data-pretable-pinned", "right");
  // The left-pinned side of the same grid is the regression case: its overlays
  // are placed by counting back from the column's TRAILING edge, and a
  // left-pinned column's trailing edge is only a few hundred px into the
  // scrollport, so anything sticky there has to survive the one offset where a
  // sticky `left` inset is inert — scrollLeft 0, where the flow position of an
  // in-flow overlay sits PAST its target and a `left` inset can only push a box
  // further right, never pull it back.
  await expect(symbol.cell).toHaveAttribute("data-pretable-pinned", "left");

  // Every box in ONE evaluate, so the whole comparison describes a single
  // layout frame. Read box-by-box it did not: this section lazy-mounts and the
  // drawer scrolls smoothly, so a relayout landing between two round-trips
  // would be compared against a scrollport edge measured before it, and the 2px
  // tolerances below are far tighter than the ~31px relayout that section does.
  const measure = async () =>
    await layoutViewport.evaluate(
      (vp, sel) => {
        const rect = vp.getBoundingClientRect();
        const edges = (selector: string) => {
          const el = vp.querySelector(selector);
          if (!el) throw new Error(`no element for ${selector}`);
          const box = el.getBoundingClientRect();
          return { left: box.left, right: box.right };
        };
        return {
          innerLeft: rect.left + vp.clientLeft,
          innerRight: rect.left + vp.clientLeft + vp.clientWidth,
          scrollLeft: vp.scrollLeft,
          maxScrollLeft: vp.scrollWidth - vp.clientWidth,
          note: {
            cell: edges(sel.note.cell),
            header: edges(sel.note.header),
            handle: edges(sel.note.handle),
            funnel: edges(sel.note.funnel),
          },
          symbol: {
            cell: edges(sel.symbol.cell),
            header: edges(sel.symbol.header),
            handle: edges(sel.symbol.handle),
            funnel: edges(sel.symbol.funnel),
          },
          qtyLeft: edges(sel.qty.cell).left,
        };
      },
      {
        note: columnSelectors("note", "NVDA"),
        symbol: columnSelectors("symbol", "NVDA"),
        qty: columnSelectors("qty", "NVDA"),
      },
    );

  // Right side: the body cell, the header button and the resize strip all end
  // on the scrollport's inner right edge; the funnel ends 4px inside it.
  // Left side: the body cell and the header button start on the scrollport's
  // inner LEFT edge, and the same two overlays hang off that column's trailing
  // edge with the same 0px/4px spacing.
  const expectPinned = (m: Awaited<ReturnType<typeof measure>>) => {
    expect(Math.abs(m.note.cell.right - m.innerRight)).toBeLessThan(2);
    expect(Math.abs(m.note.header.right - m.innerRight)).toBeLessThan(2);
    expect(Math.abs(m.note.handle.right - m.innerRight)).toBeLessThan(2);
    expect(Math.abs(m.note.funnel.right - (m.innerRight - 4))).toBeLessThan(2);

    expect(Math.abs(m.symbol.cell.left - m.innerLeft)).toBeLessThan(2);
    expect(Math.abs(m.symbol.header.left - m.innerLeft)).toBeLessThan(2);
    expect(
      Math.abs(m.symbol.handle.right - m.symbol.header.right),
    ).toBeLessThan(2);
    expect(
      Math.abs(m.symbol.funnel.right - (m.symbol.header.right - 4)),
    ).toBeLessThan(2);
  };

  // Settle before the first read: `data-pretable-hydrated` says the handlers
  // are attached, not that the layout has stopped moving.
  await waitForStablePosition(symbol.handle);
  const before = await measure();
  expect(before.scrollLeft).toBe(0);
  expect(before.maxScrollLeft).toBeGreaterThan(60);
  expectPinned(before);

  // Mid-scroll: the pin must hold at every offset, not just the extremes.
  expect(await scrollViewportTo(layoutViewport, "middle")).toBeGreaterThan(30);
  expectPinned(await measure());

  // --- Mid-scroll, a pinned header must fully OCCLUDE what slid under it ---
  // Two separate ways a pinned header can leak. First paint: the header row
  // paints --pretable-bg-header behind its cells, but each cell on top of it
  // is its own box, so a transparent pinned header cell lets the scrolled-under
  // header's label read straight through.
  const headerFill = await note.header.evaluate((el) => {
    const row = el.closest("[data-pretable-header-row]")!;
    return {
      cell: getComputedStyle(el).backgroundColor,
      row: getComputedStyle(row).backgroundColor,
    };
  });
  expect(headerFill.cell).not.toMatch(/transparent|rgba\([^)]*,\s*0\)/);
  expect(headerFill.cell).toBe(headerFill.row);

  // Second, hit-testing: the header row's boxes share one stacking context, so
  // an unpinned column's funnel or resize strip that outranks the pinned header
  // keeps taking clicks from on top of it, invisibly.
  const foreignHits = await note.header.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const y = rect.top + rect.height / 2;
    const hits: string[] = [];
    for (let x = Math.ceil(rect.left) + 1; x < rect.right - 1; x += 2) {
      const owner = document
        .elementFromPoint(x, y)
        ?.closest("[data-pretable-column-id]");
      const id = owner?.getAttribute("data-pretable-column-id") ?? "(none)";
      if (id !== "note") hits.push(`${Math.round(x - rect.left)}:${id}`);
    }
    return hits;
  });
  expect(foreignHits).toEqual([]);

  expect(await scrollViewportTo(layoutViewport, "end")).toBeGreaterThan(60);

  const after = await measure();
  // The unpinned control column moved left by exactly the scroll distance...
  expect(
    Math.abs(before.qtyLeft - after.qtyLeft - after.scrollLeft),
  ).toBeLessThan(2);
  // ...while every pinned box stayed on its edge of the viewport.
  expectPinned(after);

  // Back to rest. scrollLeft 0 is the offset where a sticky `left` inset does
  // no work, so it is the one that catches an overlay parked on its flow
  // position instead of its intended inset — assert it coming back too, not
  // just on the first paint.
  expect(await scrollViewportTo(layoutViewport, "start")).toBe(0);
  expectPinned(await measure());
});

test("showcase: rejected write keeps the grid and banners; refetch recovers", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await openDrawer(page);

  await page.locator("#rejected-writes").scrollIntoViewIfNeeded();
  const grid = page.getByRole("grid", {
    name: /streaming portfolio positions/i,
  });
  await expect(grid).toBeVisible({ timeout: 10_000 });
  await waitForGridReady(page, "#rejected-writes");

  // Row-count selectors are scoped to the section — the page has several grids.
  const rows = page.locator("#rejected-writes [data-pretable-row]");
  // `data-pretable-hydrated` means the handlers are attached, not that rows
  // have painted (see the scale section above) — wait for rows positively
  // before recording the baseline count.
  await expect
    .poll(async () => await rows.count(), { timeout: 15_000 })
    .toBeGreaterThan(0);
  const rowCountBefore = await rows.count();

  // Baseline: streaming, no banner.
  await expect(page.getByTestId("rw-banner")).toHaveCount(0);

  // Corrupt ARMS the next server page; the banner lands on the next tick
  // (default tickMs 1500), so well inside this timeout.
  await page.getByTestId("rw-corrupt").click();
  const banner = page.getByTestId("rw-banner");
  await expect(banner).toBeVisible({ timeout: 5_000 });

  // While diverged the stream pauses, but auto-heal refetches at healMs
  // (6s) — every diverged-state read below has to finish inside that window.
  // One evaluate, so banner text, both tick counters, the row count and the
  // survivor row all come from the same rendered commit.
  const diverged = await page.evaluate(() => {
    const section = document.querySelector("#rejected-writes")!;
    const text = (testid: string) =>
      (
        section.querySelector(`[data-testid="${testid}"]`) as HTMLElement
      )?.innerText.trim() ?? "";
    return {
      banner: text("rw-banner"),
      sentTick: Number(text("rw-sent-tick")),
      gridTick: Number(text("rw-grid-tick")),
      rowCount: section.querySelectorAll("[data-pretable-row]").length,
      // The corrupt page overwrites one row's id with another's; the model
      // rejects the page WHOLESALE, so the overwritten row must still be on
      // screen. Variant 0 duplicates AAPL over MSFT — MSFT is the survivor.
      msftRow:
        section.querySelector(
          '[data-pretable-row][data-pretable-row-id="MSFT"]',
        ) != null,
    };
  });
  expect(diverged.banner).toContain("duplicate-row-id");
  // The grid kept its last clean page: same row count, survivor row intact.
  expect(diverged.rowCount).toBe(rowCountBefore);
  expect(diverged.msftRow).toBe(true);
  // The counters split by exactly the one refused page; the pause while
  // diverged makes the reads stable, no tick can land between them.
  expect(diverged.sentTick).toBe(diverged.gridTick + 1);

  // Refetch recovers: banner derives from the rejected-writes record, so its
  // disappearance IS the record clearing — and the corrupt button re-arms.
  await page.getByTestId("rw-refetch").click();
  await expect(banner).toHaveCount(0);
  await expect(page.getByTestId("rw-corrupt")).toBeEnabled();
});

test("keyboard focus scrolls the viewport into view (vertical, jump, right-pin)", async ({
  page,
}) => {
  // jsdom does no layout, so the unit/integration tests can only prove that the
  // surface *wrote* an offset. This is the test that the browser actually moves
  // and that the focused cell ends up somewhere a human can read it.
  //
  // Two heavy showcase grids plus ~30 discrete key presses; the default 30s is
  // tight on a cold preview deploy.
  test.slow();

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await openDrawer(page);

  const mod = process.platform === "darwin" ? "Meta" : "Control";

  // One evaluate per sample so every rect comes from the same layout frame.
  // `clientTop` / `clientLeft` + `clientWidth` / `clientHeight` give the
  // scrollport's *inner* box, which excludes any classic scrollbar — that is the
  // box the reveal math resolves against.
  const readFrame = (sectionId: string) =>
    page.evaluate((id) => {
      const section = document.querySelector(`#${id}`);
      const viewport = section?.querySelector(
        "[data-pretable-scroll-viewport]",
      );
      const header = section?.querySelector("[data-pretable-header-row]");
      const cell = section?.querySelector(
        '[data-pretable-cell][data-pretable-focused="true"]',
      );
      if (!(viewport instanceof HTMLElement) || !header || !cell) {
        return null;
      }
      const vr = viewport.getBoundingClientRect();
      const cr = cell.getBoundingClientRect();
      const row = cell.closest("[data-pretable-row]");
      return {
        scrollTop: viewport.scrollTop,
        scrollLeft: viewport.scrollLeft,
        maxScrollTop: viewport.scrollHeight - viewport.clientHeight,
        maxScrollLeft: viewport.scrollWidth - viewport.clientWidth,
        innerTop: vr.top + viewport.clientTop,
        innerBottom: vr.top + viewport.clientTop + viewport.clientHeight,
        innerLeft: vr.left + viewport.clientLeft,
        innerRight: vr.left + viewport.clientLeft + viewport.clientWidth,
        headerBottom: header.getBoundingClientRect().bottom,
        cellTop: cr.top,
        cellBottom: cr.bottom,
        cellLeft: cr.left,
        cellRight: cr.right,
        columnId: cell.getAttribute("data-pretable-column-id"),
        rowIndex: Number(row?.getAttribute("data-pretable-row-index") ?? -1),
      };
    }, sectionId);

  type Frame = NonNullable<Awaited<ReturnType<typeof readFrame>>>;

  // The focused cell is inside the scrollport AND below the sticky header — a
  // cell hidden under the header is "in the viewport rect" but unreadable, which
  // is exactly the case the reveal math exists to prevent.
  const expectReadable = (f: Frame) => {
    expect(f.cellTop).toBeGreaterThanOrEqual(f.headerBottom - 2);
    expect(f.cellBottom).toBeLessThanOrEqual(f.innerBottom + 2);
    expect(f.cellLeft).toBeGreaterThanOrEqual(f.innerLeft - 2);
    expect(f.cellRight).toBeLessThanOrEqual(f.innerRight + 2);
  };

  // --- Vertical: ArrowDown past the rendered window ---
  await page.locator("#scale").scrollIntoViewIfNeeded();
  await expect(page.getByRole("grid", { name: /2,500 by 500/i })).toBeVisible({
    timeout: 10_000,
  });
  await waitForGridReady(page, "#scale");

  // Start from a scrollable (non-pinned) cell in the first row. `row` is the
  // grid's left-pinned column, so starting there would never exercise the
  // horizontal side.
  await page
    .locator(
      '#scale [data-pretable-row][data-pretable-row-index="0"] [data-pretable-column-id="c3"]',
    )
    .click();
  const start = await readFrame("scale");
  expect(start).not.toBeNull();
  expect(start?.rowIndex).toBe(0);
  expect(start?.scrollTop).toBe(0);

  // The scale grid is a 420px viewport over 32px rows with overscan 6, so at
  // most ~19 rows are ever in the DOM from the top. Row 30 is comfortably past
  // that: before this behaviour existed the focused cell simply stopped
  // existing in the DOM here.
  const TARGET_ROW = 30;
  for (let i = 0; i < TARGET_ROW; i += 1) {
    await page.keyboard.press("ArrowDown");
  }

  // The focused cell existing at row 30 at all already proves the viewport
  // scrolled — an unrendered row has no DOM node to carry the attribute.
  await expect
    .poll(async () => (await readFrame("scale"))?.rowIndex ?? -1, {
      timeout: 10_000,
    })
    .toBe(TARGET_ROW);

  const down = (await readFrame("scale")) as Frame;
  expect(down.scrollTop).toBeGreaterThan(0);
  expectReadable(down);
  // Minimal scroll, not centring: walking down off the bottom edge aligns the
  // target's bottom with the band's bottom.
  expect(Math.abs(down.cellBottom - down.innerBottom)).toBeLessThan(8);
  // Focus never left column c3, and c3 was already visible, so nothing should
  // have moved horizontally.
  expect(down.columnId).toBe("c3");
  expect(down.scrollLeft).toBe(0);

  // --- Cmd/Ctrl+End: last cell of the grid, both axes move ---
  await page.keyboard.press(`${mod}+End`);
  await expect
    .poll(async () => (await readFrame("scale"))?.columnId ?? "", {
      timeout: 10_000,
    })
    .toBe("c500");

  const end = (await readFrame("scale")) as Frame;
  expect(end.rowIndex).toBe(2499);
  expect(end.scrollTop).toBeGreaterThan(down.scrollTop);
  expect(end.scrollLeft).toBeGreaterThan(0);
  expectReadable(end);
  // `row` is left-pinned and overlays the scrollport's left edge, so the
  // revealed cell has to clear it, not merely clear `innerLeft`.
  const pinnedLeftRight = await page
    .locator(
      '#scale [data-pretable-row][data-pretable-row-index="2499"] [data-pretable-column-id="row"]',
    )
    .evaluate((el) => el.getBoundingClientRect().right);
  expect(end.cellLeft).toBeGreaterThanOrEqual(pinnedLeftRight - 2);

  // --- Right-pinned group: the revealed cell stops short of it ---
  // The column-layout showcase pins "Analyst note" right and is wider than its
  // container, so the last *scrollable* column ("weight") can only be revealed
  // by scrolling it clear of that sticky group.
  await page.locator("#column-layout").scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("grid", { name: /resizable, reorderable/i }),
  ).toBeVisible({ timeout: 10_000 });
  await waitForGridReady(page, "#column-layout");

  await page
    .locator(
      '#column-layout [data-pretable-row][data-pretable-row-id="NVDA"] [data-pretable-column-id="symbol"]',
    )
    .click();
  expect((await readFrame("column-layout"))?.scrollLeft).toBe(0);

  // `End` → last column in the row, which is the right-pinned "note". A pinned
  // column is on screen at every offset, so this must NOT scroll.
  await page.keyboard.press("End");
  await expect
    .poll(async () => (await readFrame("column-layout"))?.columnId ?? "")
    .toBe("note");
  expect((await readFrame("column-layout"))?.scrollLeft).toBe(0);

  // One column left is "weight", the last scrollable column — hidden behind the
  // pinned group at scrollLeft 0, so revealing it requires real scrolling.
  await page.keyboard.press("ArrowLeft");
  await expect
    .poll(async () => (await readFrame("column-layout"))?.columnId ?? "")
    .toBe("weight");

  const weight = (await readFrame("column-layout")) as Frame;
  expect(weight.scrollLeft).toBeGreaterThan(0);
  expectReadable(weight);
  // The pinned group's left edge is the real right boundary of the readable
  // band; measure it from the pinned cell rather than assuming its width.
  const pinnedRightLeft = await page
    .locator(
      '#column-layout [data-pretable-row][data-pretable-row-id="NVDA"] [data-pretable-column-id="note"]',
    )
    .evaluate((el) => el.getBoundingClientRect().left);
  expect(weight.cellRight).toBeLessThanOrEqual(pinnedRightLeft + 2);
});

test("showcase: dropping into the right-pinned group pins the column", async ({
  page,
}) => {
  // A drop's pin follows from where it lands, so a pinned column is a
  // two-halves target: its leading half drops ahead of the group and stays
  // scrollable, its trailing half drops inside and takes the pin. aria-colindex
  // is read from the engine array, so it only stays in step with the rendered
  // order while that array is grouped [left..., unpinned..., right...].
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await openDrawer(page);
  await page.locator("#column-layout").scrollIntoViewIfNeeded();

  const layout = page.locator("#column-layout");
  await waitForGridReady(page, "#column-layout");

  const headers = async () =>
    await layout.locator("[data-pretable-header-cell]").evaluateAll((els) =>
      els.map((el) => ({
        id: el.getAttribute("data-pretable-column-id") ?? "",
        pinned: el.getAttribute("data-pretable-pinned"),
        colIndex: Number(el.getAttribute("aria-colindex")),
      })),
    );

  const before = await headers();
  // Headers render in visual order, so aria-colindex must ascend 1..N.
  expect(before.map((h) => h.colIndex)).toEqual(before.map((_, i) => i + 1));
  expect(before.at(-1)).toMatchObject({ id: "note", pinned: "right" });

  // Drag "sector" onto the trailing half of the right-pinned "note" — inside
  // the group, so it lands there and takes the pin. WebKit only engages
  // pointer capture once the pointer has traversed intermediate positions.
  //
  // Settling is best-effort: this section lazy-mounts and the drawer scrolls
  // smoothly, so the source is remeasured for each bounded grab attempt. The
  // ghost proves engagement; only then is the narrow destination measured.
  const sectorHeader = columnParts(layout, "sector").header;
  await waitForStablePosition(sectorHeader);

  const ghost = page.locator("[data-pretable-reorder-ghost]");
  let grabbed = false;
  for (let attempt = 0; attempt < 3 && !grabbed; attempt += 1) {
    const sector = await sectorHeader.boundingBox();
    if (!sector) continue;
    const y = sector.y + sector.height / 2;
    const grabX = sector.x + sector.width / 2;
    await page.mouse.move(grabX, y);
    await page.mouse.down();
    await page.mouse.move(grabX + 12, y, { steps: 3 });
    grabbed = (await ghost.count()) > 0;
    if (!grabbed) await page.mouse.up();
  }
  expect(grabbed, "reorder drag did not engage on the sector header").toBe(
    true,
  );

  const note = await columnParts(layout, "note").header.boundingBox();
  if (!note) await page.mouse.up();
  expect(note, "right-pinned note header is not measurable").not.toBeNull();
  if (!note) return;
  const dropY = note.y + note.height / 2;
  await page.mouse.move(note.x + note.width - 6, dropY, { steps: 10 });
  await page.mouse.up();

  await expect.poll(async () => (await headers()).at(-1)?.id).toBe("sector");
  const after = await headers();
  expect(after.map((h) => h.colIndex)).toEqual(after.map((_, i) => i + 1));
  expect(after.at(-1)).toMatchObject({ id: "sector", pinned: "right" });
  expect(after.at(-2)).toMatchObject({ id: "note", pinned: "right" });
});

test("showcase: column reorder drops where the indicator points, scrolled sideways", async ({
  page,
}) => {
  // The column-layout grid is wider than its container, so the header the user
  // grabs and the header they drop on are both offset from their content
  // positions by scrollLeft. The drop index used to be computed from viewport
  // coordinates but compared against content offsets, which put the indicator
  // — and the drop — a scroll-distance away from the cursor.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await openDrawer(page);
  await page.locator("#column-layout").scrollIntoViewIfNeeded();

  const layout = page.locator("#column-layout");
  const viewport = layout.locator("[data-pretable-scroll-viewport]");
  await waitForGridReady(page, "#column-layout");

  const headerBoxes = async () =>
    await layout.locator("[data-pretable-header-cell]").evaluateAll((els) =>
      els.map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          id: el.getAttribute("data-pretable-column-id") ?? "",
          left: rect.left,
          right: rect.right,
        };
      }),
    );

  // Scroll to the far right, where every scrollable column is displaced by the
  // full scroll distance.
  const scrolledTo = await scrollViewportTo(viewport, "end");
  expect(scrolledTo).toBeGreaterThan(60);

  // A drag is driven by raw coordinates, so the page has to stop moving before
  // they are measured — the drawer animates open and the section is still
  // settling, and a box measured mid-flight puts the pointerdown on empty space
  // (or another row) and the gesture silently never starts.
  //
  // Settling has to stay a *query*: `hover()` would scroll the header into view
  // and undo the very horizontal scroll under test. `waitForStablePosition`
  // polls `boundingBox()`, which does not scroll — the grab loop below already
  // depends on that being true in this same scrolled state.
  const sectorHeader = columnParts(layout, "sector").header;
  await waitForStablePosition(sectorHeader, { timeout: 10_000 });

  // Settling is best-effort, so prove the premise survived it rather than
  // assuming: if the scroll were undone, every assertion below would still pass
  // — against an unscrolled grid, testing nothing this test claims to test.
  expect(
    Math.abs((await viewport.evaluate((el) => el.scrollLeft)) - scrolledTo),
  ).toBeLessThanOrEqual(1);

  // Grab "sector" and drag it onto the left half of "weight". Grabbing is the
  // fragile half — a header is flanked by a 22px funnel slot and a 4px resize
  // strip, so coordinates measured a frame too early press one of those and
  // start a resize instead — so it is re-measured and retried until the ghost
  // proves the reorder engaged. The assertions below stay single-shot.
  const ghost = page.locator("[data-pretable-reorder-ghost]");
  let grabbed = false;
  let y = 0;
  for (let attempt = 0; attempt < 3 && !grabbed; attempt += 1) {
    const box = await sectorHeader.boundingBox();
    if (!box) continue;
    y = box.y + box.height / 2;
    const grabX = box.x + box.width / 2;
    await page.mouse.move(grabX, y);
    await page.mouse.down();
    // WebKit only engages pointer capture once the pointer has traversed
    // intermediate positions, so the drag moves in steps, not a single jump.
    await page.mouse.move(grabX + 10, y, { steps: 3 });
    grabbed = (await ghost.count()) > 0;
    if (!grabbed) await page.mouse.up();
  }
  expect(grabbed, "reorder drag did not engage on the sector header").toBe(
    true,
  );

  // Positions hold still for the rest of the gesture, so measure the target now.
  const before = await headerBoxes();
  const targetCol = before.find((b) => b.id === "weight");
  expect(targetCol).toBeTruthy();
  if (!targetCol) return;

  const cursorX = targetCol.left + 20;
  await page.mouse.move(cursorX, y, { steps: 10 });

  // The indicator marks the boundary the cursor is nearest — "weight"'s left
  // edge — in screen coordinates, not a scroll-distance away from it.
  const indicator = await layout
    .locator("[data-pretable-reorder-drop-indicator]")
    .boundingBox();
  expect(indicator).not.toBeNull();
  expect(Math.abs((indicator?.x ?? 0) - targetCol.left)).toBeLessThan(2);

  await page.mouse.up();

  // ...and the column lands on exactly that boundary.
  const after = await headerBoxes();
  const ids = after.map((b) => b.id);
  expect(ids.indexOf("sector")).toBe(ids.indexOf("weight") - 1);
});
