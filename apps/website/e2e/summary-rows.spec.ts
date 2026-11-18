import { expect, test, type Page } from "@playwright/test";
import { waitForGridReady } from "./helpers";

const scope = "[data-summary-fixture]";
const viewportSelector = `${scope} [data-pretable-scroll-viewport]`;
async function open(page: Page) {
  await page.goto("/fixtures/summary-rows");
  await waitForGridReady(page, scope);
  await expect(
    page.locator('[data-pretable-summary-state="ready"]'),
  ).toHaveCount(2);
}
async function expectAlignment(page: Page) {
  const errors = await page.locator(scope).evaluate((region) => {
    const viewport = region.querySelector("[data-pretable-scroll-viewport]")!;
    const frame = viewport.getBoundingClientRect();
    const result: string[] = [];
    for (const header of viewport.querySelectorAll<HTMLElement>(
      "[data-pretable-header-cell]",
    )) {
      const id = header.dataset.pretableColumnId!;
      const expected = header.getBoundingClientRect();
      if (expected.right < frame.left || expected.left > frame.right) continue;
      for (const summary of region.querySelectorAll<HTMLElement>(
        `[data-pretable-summary-column="${id}"]`,
      )) {
        const actual = summary.getBoundingClientRect();
        if (
          Math.abs(actual.left - expected.left) > 1.5 ||
          Math.abs(actual.width - expected.width) > 1.5
        )
          result.push(
            `${id}: header ${expected.left}/${expected.width}, summary ${actual.left}/${actual.width}`,
          );
      }
    }
    return result;
  });
  expect(errors).toEqual([]);
}

test("fixed bottom tables align through scrolling, resize, reorder, hide and pin changes", async ({
  page,
}) => {
  await open(page);
  const region = page.locator("[data-pretable-summaries]");
  const before = await region.boundingBox();
  await expectAlignment(page);
  const resizeHandle = page.locator(
    `${viewportSelector} [data-pretable-resize-handle][data-pretable-column-id="hours"]`,
  );
  const grip = (await resizeHandle.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    grip.x + grip.width / 2 + 24,
    grip.y + grip.height / 2,
    { steps: 4 },
  );
  // Check the live width while the pointer is still held, before commit.
  await expectAlignment(page);
  await page.mouse.up();
  await expectAlignment(page);
  await page.locator(viewportSelector).evaluate((element) => {
    element.scrollLeft = 130;
    element.scrollTop = 500;
  });
  await expect
    .poll(async () =>
      page
        .locator("[data-pretable-summary-scroll]")
        .first()
        .evaluate((el) => el.scrollLeft),
    )
    .toBe(130);
  await expectAlignment(page);
  expect((await region.boundingBox())!.y).toBeCloseTo(before!.y, 0);
  for (const control of [
    "Resize hours",
    "Reorder columns",
    "Hide owner",
    "Unpin hours",
  ]) {
    await page.getByRole("button", { name: control, exact: true }).click();
    await expectAlignment(page);
  }
  await expect(
    page.locator('[data-pretable-summary-column="owner"]'),
  ).toHaveCount(0);
  const height = (await page.locator(viewportSelector).boundingBox())!.height;
  await page
    .getByRole("button", { name: "Toggle summaries", exact: true })
    .click();
  await expect(region).toHaveCount(0);
  expect(
    (await page.locator(viewportSelector).boundingBox())!.height,
  ).toBeGreaterThan(height);
});

test("narrow RTL, group and tool panel layouts keep captions visible and totals aligned", async ({
  page,
}) => {
  await open(page);
  await page
    .getByRole("button", { name: "Toggle narrow", exact: true })
    .click();
  await expectAlignment(page);
  await page
    .getByRole("button", { name: "Toggle group panel", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Toggle tool panel", exact: true })
    .click();
  await expectAlignment(page);
  await page.getByRole("button", { name: "Toggle RTL", exact: true }).click();
  await page.locator(viewportSelector).evaluate((el) => {
    el.scrollLeft = -120;
  });
  await expect
    .poll(async () =>
      page
        .locator("[data-pretable-summary-scroll]")
        .first()
        .evaluate((el) => el.scrollLeft),
    )
    .toBe(-120);
  await expectAlignment(page);
  const bounds = await page.locator(scope).boundingBox();
  for (const caption of await page
    .locator("[data-pretable-summaries] caption")
    .all()) {
    const box = (await caption.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(bounds!.x - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(
      bounds!.x + bounds!.width + 1,
    );
  }
  expect(
    (await page.locator("[data-pretable-summary-wrapper]").boundingBox())!
      .height,
  ).toBeCloseTo(440, 0);
});

test("server states remain explicit and incompatible answers disappear", async ({
  page,
}) => {
  await open(page);
  await page
    .getByRole("combobox", { name: "Authority", exact: true })
    .selectOption("server");
  const table = page.locator('[data-pretable-summary-scope="all"]');
  await expect(table).toContainText("Server totals");
  await expect(table).toContainText("9000");
  await page
    .getByRole("button", { name: "Toggle partial", exact: true })
    .click();
  await expect(table).toContainText("Partial result");
  await page
    .getByRole("button", { name: "Change request key", exact: true })
    .click();
  await expect(table).toContainText("Unavailable");
  await expect(table).not.toContainText("9000");
  await page
    .getByRole("combobox", { name: "Server state", exact: true })
    .selectOption("stale");
  await expect(table).toContainText("Stale: Previous refresh");
  await expect(table).toContainText("9000");
  await page
    .getByRole("button", { name: "Change definition key", exact: true })
    .click();
  await expect(table).toContainText("Unavailable");
  await expect(table).not.toContainText("9000");
  await page
    .getByRole("combobox", { name: "Server state", exact: true })
    .selectOption("error");
  await expect(table).toContainText("Error: Refresh failed");
});

test("native table associations survive hydration and summaries add no focus stops", async ({
  page,
  request,
}) => {
  const response = await request.get("/fixtures/summary-rows");
  expect(await response.text()).toContain('data-pretable-summary-scope="all"');
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  const table = page.getByRole("table", {
    name: "All input rows",
    exact: true,
  });
  await expect(
    table.getByRole("columnheader", { name: "Hours", exact: true }),
  ).toHaveCount(1);
  await expect(table.getByRole("row")).toHaveCount(2);
  const associations = await table.locator("td").evaluateAll((cells) =>
    cells.every((cell) => {
      const header = document.getElementById(
        cell.getAttribute("headers") ?? "",
      );
      return header?.tagName === "TH" && header.getAttribute("scope") === "col";
    }),
  );
  expect(associations).toBe(true);
  const accessibility = await table.ariaSnapshot();
  expect(accessibility).toContain('columnheader "Hours"');
  expect(accessibility).toContain('cell "2250"');
  await page.locator("[data-before-grid]").focus();
  await page.keyboard.press("Tab");
  expect(
    await page
      .locator(viewportSelector)
      .evaluate((el) => el.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press("Tab");
  await expect(page.locator("[data-after-grid]")).toBeFocused();
  // The same exit target with summaries disabled pins the baseline behavior.
  await page
    .getByRole("button", { name: "Toggle summaries", exact: true })
    .click();
  await page.locator("[data-before-grid]").focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(page.locator("[data-after-grid]")).toBeFocused();
  expect(errors).toEqual([]);
});
