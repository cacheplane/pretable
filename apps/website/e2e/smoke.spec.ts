import { expect, test } from "@playwright/test";

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
  await page.locator("[data-testid='drawer-handle']").click();
  await expect(page.locator("html")).toHaveAttribute("data-drawer", "open");
  await expect(page.getByText(/built in bend, or\./i)).toBeVisible();

  // /docs still resolves
  const docsResponse = await page.goto("/docs", {
    waitUntil: "domcontentloaded",
  });
  expect(docsResponse?.status()).toBe(200);
});

test("docs brand link returns to drawer when it was last open", async ({
  page,
}) => {
  await page.goto("/");
  // Open the drawer via the bottom handle.
  await page.getByTestId("drawer-handle").click();
  await expect(page.locator("html")).toHaveAttribute("data-drawer", "open");

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
  await expect(page.locator("[data-pretable-scroll-viewport]")).toBeVisible({
    timeout: 10_000,
  });

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
});

test("cockpit: filter, edit (guardrail + success), and select+copy under streaming", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-pretable-scroll-viewport]")).toBeVisible({
    timeout: 10_000,
  });

  // --- Filter: search narrows, clear restores, sector chip narrows ---
  // ([data-pretable-row] counts only virtualized/visible rows, so assert
  //  deterministic filtered counts and ">5" for the unfiltered view.)
  const search = page.getByPlaceholder(/filter symbol/i);
  await search.fill("NVDA");
  await expect(page.locator("[data-pretable-row]")).toHaveCount(1);
  await search.fill("");
  await expect
    .poll(() => page.locator("[data-pretable-row]").count())
    .toBeGreaterThan(5);
  const sectors = page.getByRole("group", { name: "Sector" });
  await sectors.getByRole("button", { name: "Energy" }).click();
  await expect(page.locator("[data-pretable-row]")).toHaveCount(2); // XOM, CVX
  const shown = await page
    .locator('[data-pretable-row] [data-pretable-column-id="sector"]')
    .allInnerTexts();
  expect(new Set(shown.map((s) => s.trim()))).toEqual(new Set(["Energy"]));
  await sectors.getByRole("button", { name: "All" }).click();
  await expect
    .poll(() => page.locator("[data-pretable-row]").count())
    .toBeGreaterThan(5);

  // --- Edit qty → 7% guardrail rejection (NVDA is already > 7% of the book) ---
  const nvdaQty = page.locator(
    '[data-pretable-row][data-pretable-row-id="NVDA"] [data-pretable-column-id="qty"]',
  );
  await nvdaQty.dblclick();
  const editor = page.getByLabel("Edit quantity");
  await editor.fill("13000"); // within 10x sanity, but still breaches 7%
  await editor.press("Enter");
  await expect(page.getByText(/guardrail/i)).toBeVisible({ timeout: 5000 });
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
  await expect(page.getByText(/Copied/i)).toBeVisible();
  await page.waitForTimeout(2000); // ticks
  await expect(page.getByText(/selected · ⌘C to copy/i)).toBeVisible();
});
