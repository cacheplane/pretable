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

  // /docs/grid/filtering resolves too
  const filteringDocs = await page.goto("/docs/grid/filtering", {
    waitUntil: "domcontentloaded",
  });
  expect(filteringDocs?.status()).toBe(200);
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

  // --- Filter via the built-in header funnels ---
  // ([data-pretable-row] counts only virtualized/visible rows, so assert
  //  deterministic filtered counts and ">5" for the unfiltered view.)
  // Symbol funnel → contains NVDA → 1 row. The funnel is opacity-0 until the
  // header row is hovered; opacity does not block Playwright actionability,
  // but hover first to mirror real usage (and dodge engine flakiness).
  await page.locator("[data-pretable-header-row]").first().hover();
  await page.getByRole("button", { name: "Filter Symbol" }).click();
  const symbolDialog = page.getByRole("dialog", { name: "Filter Symbol" });
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
  await page.getByRole("button", { name: "Filter Sector" }).click();
  const sectorDialog = page.getByRole("dialog", { name: "Filter Sector" });
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
  await expect(page.getByText(/Copied/i)).toBeVisible();
  await page.waitForTimeout(2000); // ticks
  await expect(page.getByText(/selected · ⌘C to copy/i)).toBeVisible();
});

test("showcase: scale grid virtualizes; column layout resizes + resets", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("drawer-handle").click();
  await expect(page.locator("html")).toHaveAttribute("data-drawer", "open");

  // --- Scale section: scroll into view, grid mounts, counter proves virtualization ---
  await page.locator("#scale").scrollIntoViewIfNeeded();
  const scaleGrid = page.getByRole("grid", { name: /2,500 by 500/i });
  await expect(scaleGrid).toBeVisible({ timeout: 10_000 });
  // Model total is shown.
  await expect(page.getByTestId("scale-counter")).toContainText("1,250,000");
  // DOM-rendered cell count is tiny relative to 1.25M (virtualization on).
  await expect
    .poll(
      async () => await page.locator("#scale [data-pretable-cell]").count(),
      {
        timeout: 10_000,
      },
    )
    .toBeLessThan(2000);
  // The DOM count must also be positive (the grid actually rendered cells).
  expect(
    await page.locator("#scale [data-pretable-cell]").count(),
  ).toBeGreaterThan(0);
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

  // The header cell and its resize handle are separate subtrees of the header
  // row, each tagged with the same data-pretable-column-id (verified against
  // packages/react/src/pretable-surface.tsx) — the handle is NOT nested inside
  // the header cell but in a sibling `[data-pretable-header-overlays]` anchor,
  // so both are scoped from the column-layout section root.
  const layout = page.locator("#column-layout");
  const symbolHeader = layout.locator(
    '[data-pretable-header-cell][data-pretable-column-id="symbol"]',
  );
  await expect(symbolHeader).toBeVisible();
  const widthBefore = (await symbolHeader.boundingBox())?.width ?? 0;

  // Drag the symbol column's resize handle to the right by ~80px. The handle
  // listens for pointer events and uses setPointerCapture; WebKit only engages
  // capture once the pointer actually traverses intermediate positions, so the
  // drag moves in steps (a short hop, then the full distance) rather than a
  // single jump.
  const handle = layout.locator(
    '[data-pretable-resize-handle][data-pretable-column-id="symbol"]',
  );
  const hb = await handle.boundingBox();
  expect(hb).not.toBeNull();
  if (hb) {
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + 20, hb.y + hb.height / 2, { steps: 4 });
    await page.mouse.move(hb.x + 80, hb.y + hb.height / 2, { steps: 8 });
    await page.mouse.up();
  }
  await expect
    .poll(async () => (await symbolHeader.boundingBox())?.width ?? 0)
    .toBeGreaterThan(widthBefore + 20);

  // Reset restores the original width.
  await page.getByTestId("reset-layout").click();
  await expect
    .poll(async () => (await symbolHeader.boundingBox())?.width ?? 0)
    .toBeLessThan(widthBefore + 20);

  // --- Pinned columns stay glued to the viewport's two edges ---
  // The showcase pins "Symbol" left and "Analyst note" right, and the column
  // set is wider than the container, so there is real horizontal scroll to
  // exercise.
  const layoutViewport = layout.locator("[data-pretable-scroll-viewport]");
  const noteCell = layout.locator(
    '[data-pretable-row][data-pretable-row-id="NVDA"] [data-pretable-column-id="note"]',
  );
  // `qty` is a plain scrollable column that stays rendered at both scroll
  // extremes — it is the control that proves the scroll actually moved content.
  const qtyCell = layout.locator(
    '[data-pretable-row][data-pretable-row-id="NVDA"] [data-pretable-column-id="qty"]',
  );
  await expect(noteCell).toHaveAttribute("data-pretable-pinned", "right");

  // Measure in one reference frame: the scrollport's inner right edge (client
  // box, so a classic scrollbar is excluded — that is the edge a right-pinned
  // column resolves against) versus each pinned box's right edge. All four
  // sticky sites of a right-pinned column are checked, not just the body cell:
  // the header button, the 4px resize strip on the trailing edge, and the 18px
  // filter funnel that sits 4px inside it.
  const noteHeader = layout.locator(
    '[data-pretable-header-cell][data-pretable-column-id="note"]',
  );
  const noteHandle = layout.locator(
    '[data-pretable-resize-handle][data-pretable-column-id="note"]',
  );
  const noteFunnel = layout.locator(
    '[data-pretable-header-overlays][data-pretable-column-id="note"] [data-pretable-filter-funnel-slot]',
  );
  // The left-pinned side of the same grid. Its overlays are the regression
  // case: they are placed by counting back from the column's TRAILING edge,
  // but a left-pinned column's trailing edge is only a few hundred px into the
  // scrollport, so anything sticky there has to survive the one offset where a
  // sticky `left` inset is inert — scrollLeft 0, where the flow position of an
  // in-flow overlay sits PAST its target and a `left` inset can only push a box
  // further right, never pull it back.
  const symbolCell = layout.locator(
    '[data-pretable-row][data-pretable-row-id="NVDA"] [data-pretable-column-id="symbol"]',
  );
  // `symbolHeader` and `handle` are the same boxes the resize drag above used.
  const symbolFunnel = layout.locator(
    '[data-pretable-header-overlays][data-pretable-column-id="symbol"] [data-pretable-filter-funnel-slot]',
  );
  await expect(symbolCell).toHaveAttribute("data-pretable-pinned", "left");

  const edges = (locator: typeof noteCell) =>
    locator.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    });
  const rightEdge = async (locator: typeof noteCell) =>
    (await edges(locator)).right;

  const measure = async () => {
    const viewport = await layoutViewport.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return {
        innerLeft: rect.left + el.clientLeft,
        innerRight: rect.left + el.clientLeft + el.clientWidth,
        scrollLeft: el.scrollLeft,
        maxScrollLeft: el.scrollWidth - el.clientWidth,
      };
    });
    return {
      ...viewport,
      noteRight: await rightEdge(noteCell),
      headerRight: await rightEdge(noteHeader),
      handleRight: await rightEdge(noteHandle),
      funnelRight: await rightEdge(noteFunnel),
      symbolCell: await edges(symbolCell),
      symbolHeader: await edges(symbolHeader),
      symbolHandle: await edges(handle),
      symbolFunnel: await edges(symbolFunnel),
      qtyLeft: await qtyCell.evaluate((el) => el.getBoundingClientRect().left),
    };
  };

  // Right side: the body cell, the header button and the resize strip all end
  // on the scrollport's inner right edge; the funnel ends 4px inside it.
  // Left side: the body cell and the header button start on the scrollport's
  // inner LEFT edge, and the same two overlays hang off that column's trailing
  // edge with the same 0px/4px spacing.
  const expectPinned = (m: Awaited<ReturnType<typeof measure>>) => {
    expect(Math.abs(m.noteRight - m.innerRight)).toBeLessThan(2);
    expect(Math.abs(m.headerRight - m.innerRight)).toBeLessThan(2);
    expect(Math.abs(m.handleRight - m.innerRight)).toBeLessThan(2);
    expect(Math.abs(m.funnelRight - (m.innerRight - 4))).toBeLessThan(2);

    expect(Math.abs(m.symbolCell.left - m.innerLeft)).toBeLessThan(2);
    expect(Math.abs(m.symbolHeader.left - m.innerLeft)).toBeLessThan(2);
    expect(Math.abs(m.symbolHandle.right - m.symbolHeader.right)).toBeLessThan(
      2,
    );
    expect(
      Math.abs(m.symbolFunnel.right - (m.symbolHeader.right - 4)),
    ).toBeLessThan(2);
  };

  const before = await measure();
  expect(before.scrollLeft).toBe(0);
  expect(before.maxScrollLeft).toBeGreaterThan(60);
  expectPinned(before);

  // Mid-scroll: the pin must hold at every offset, not just the extremes.
  await layoutViewport.evaluate((el) => {
    el.scrollLeft = Math.round((el.scrollWidth - el.clientWidth) / 2);
  });
  await expect
    .poll(async () => await layoutViewport.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(30);
  expectPinned(await measure());

  await layoutViewport.evaluate((el) => {
    el.scrollLeft = el.scrollWidth - el.clientWidth;
  });
  await expect
    .poll(async () => await layoutViewport.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(60);

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
  await layoutViewport.evaluate((el) => {
    el.scrollLeft = 0;
  });
  await expect
    .poll(async () => await layoutViewport.evaluate((el) => el.scrollLeft))
    .toBe(0);
  expectPinned(await measure());
});
