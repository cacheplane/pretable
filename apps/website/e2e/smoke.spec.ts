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

  // The header cell and its resize handle are SIBLINGS in the header row, each
  // tagged with the same data-pretable-column-id (verified against
  // packages/react/src/pretable-surface.tsx) — the handle is NOT nested inside
  // the header cell, so both are scoped from the column-layout section root.
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

  // --- Right-pinned column stays glued to the viewport's right edge ---
  // The showcase's "Analyst note" column is pinned right, and the column set is
  // wider than the container, so there is real horizontal scroll to exercise.
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
  const noteFunnel = layout
    .locator('[data-pretable-filter-funnel][data-pretable-column-id="note"]')
    .locator("xpath=..");
  const rightEdge = (locator: typeof noteCell) =>
    locator.evaluate((el) => el.getBoundingClientRect().right);

  const measure = async () => {
    const viewport = await layoutViewport.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return {
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
      qtyLeft: await qtyCell.evaluate((el) => el.getBoundingClientRect().left),
    };
  };

  // The body cell, the header button and the resize strip all end on the
  // scrollport's inner right edge; the funnel ends 4px inside it.
  const expectPinned = (m: Awaited<ReturnType<typeof measure>>) => {
    expect(Math.abs(m.noteRight - m.innerRight)).toBeLessThan(2);
    expect(Math.abs(m.headerRight - m.innerRight)).toBeLessThan(2);
    expect(Math.abs(m.handleRight - m.innerRight)).toBeLessThan(2);
    expect(Math.abs(m.funnelRight - (m.innerRight - 4))).toBeLessThan(2);
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
  // ...while every right-pinned box stayed on the viewport's right edge.
  expectPinned(after);
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
  // The handle is server-rendered but its onClick only exists after hydration,
  // so a click that lands early is silently dropped. Retry until it takes.
  await expect(async () => {
    await page.getByTestId("drawer-handle").click();
    await expect(page.locator("html")).toHaveAttribute("data-drawer", "open", {
      timeout: 2000,
    });
  }).toPass({ timeout: 20_000 });

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
  expect(weight.cellRight).toBeLessThanOrEqual(pinnedRightLeft + 2);test("showcase: column reorder drops where the indicator points, scrolled sideways", async ({
  page,
}) => {
  // The column-layout grid is wider than its container, so the header the user
  // grabs and the header they drop on are both offset from their content
  // positions by scrollLeft. The drop index used to be computed from viewport
  // coordinates but compared against content offsets, which put the indicator
  // — and the drop — a scroll-distance away from the cursor.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("drawer-handle").click();
  await page.locator("#column-layout").scrollIntoViewIfNeeded();

  const layout = page.locator("#column-layout");
  const viewport = layout.locator("[data-pretable-scroll-viewport]");
  await expect(viewport).toBeVisible({ timeout: 10_000 });

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
  await viewport.evaluate((el) => {
    el.scrollLeft = el.scrollWidth - el.clientWidth;
  });
  await expect
    .poll(async () => await viewport.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(60);

  const before = await headerBoxes();
  const source = before.find((b) => b.id === "sector");
  const targetCol = before.find((b) => b.id === "weight");
  expect(source).toBeTruthy();
  expect(targetCol).toBeTruthy();
  if (!source || !targetCol) return;

  // Drag "sector" onto the left half of "weight". WebKit only engages pointer
  // capture once the pointer has traversed intermediate positions, so the drag
  // moves in steps rather than a single jump.
  const y = await layout
    .locator('[data-pretable-header-cell][data-pretable-column-id="sector"]')
    .evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return rect.top + rect.height / 2;
    });
  const cursorX = targetCol.left + 20;
  await page.mouse.move((source.left + source.right) / 2, y);
  await page.mouse.down();
  await page.mouse.move((source.left + source.right) / 2 + 10, y, { steps: 3 });
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
  expect(ids.indexOf("sector")).toBe(ids.indexOf("weight") - 1);});
